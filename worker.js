// =======================================================
// 🌐 worker.js — Site entry point (Cloudflare Workers)
//
// This project is deployed as a real Worker (not classic "Pages")
// — the functions/api/*.js convention doesn't apply here, hence
// this single file. By default (see [assets] in wrangler.toml),
// Cloudflare serves static files (HTML/CSS/JS) directly when they
// match the request, and only invokes this script for what doesn't
// match any file — so in practice, only /api/upload,
// /api/delete-account and /api/external-models.
// =======================================================

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 MB
const MAX_STL_BYTES = 50 * 1024 * 1024;    // 50 MB

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }

    if (url.pathname === "/api/delete-account" && request.method === "POST") {
      return handleDeleteAccount(request, env);
    }

    if (url.pathname === "/api/external-models" && request.method === "GET") {
      return handleExternalModels(env, ctx);
    }

    // Everything else: static files (safety net — in practice
    // Cloudflare already serves them before ever calling this
    // script when a file matches).
    return env.ASSETS.fetch(request);
  }
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Verifies the Supabase token against Supabase itself rather than
// reimplementing JWT verification here — simpler, and it correctly
// handles expiry/revocation on Supabase's side.
async function verifyUser(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) return null;

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "apikey": env.SUPABASE_ANON_KEY
    }
  });

  if (!response.ok) return null;

  const user = await response.json();
  return user && user.id ? user : null;
}

// Dynamically built regex (rather than a literal \uXXXX) to match
// combining diacritical marks after an NFD normalization — same
// technique as in data.js.
const COMBINING_MARKS_REGEX = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);

function sanitizeFileName(name) {
  return String(name || "file")
    .normalize("NFD")
    .replace(COMBINING_MARKS_REGEX, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(-100);
}

// =======================
// 🛡️ IMAGE SAFETY CHECK (Google Cloud Vision SafeSearch)
// Runs before an image is ever written to R2 — a flagged image is
// rejected outright, never stored, never made public. This is
// general content moderation (nudity/violence/gore), NOT CSAM
// hash-matching — a separate, dedicated service (Thorn Safer/
// PhotoDNA) is still needed for that.
//
// GOOGLE_VISION_API_KEY is a Worker secret (`wrangler secret put`),
// never written to wrangler.toml (which is committed to git) and
// never exposed to the browser — this check only ever runs here,
// server-side.
// =======================

// Chunked rather than String.fromCharCode(...bytes) in one call —
// spreading a large typed array as call arguments blows the call
// stack on anything but small images (same class of bug as the
// "Maximum call stack size exceeded" comment-recursion issue fixed
// earlier in this project, different cause, same lesson).
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

// racy gets a stricter bar (VERY_LIKELY only) — it flags plenty of
// innocuous content (skin-toned plastic parts, etc.) at LIKELY,
// while adult/violence keep the normal threshold since false
// positives there are rarer and missing a real one costs more.
const UNSAFE_LIKELIHOODS = ["LIKELY", "VERY_LIKELY"];

function isUnsafeAnnotation(annotation) {
  if (!annotation) return false;

  return (
    UNSAFE_LIKELIHOODS.includes(annotation.adult) ||
    UNSAFE_LIKELIHOODS.includes(annotation.violence) ||
    annotation.racy === "VERY_LIKELY"
  );
}

async function checkImageSafety(file, env) {
  if (!env.GOOGLE_VISION_API_KEY) {
    // No key configured: fail open rather than blocking every
    // upload — logged so a missing secret doesn't go unnoticed.
    console.error("GOOGLE_VISION_API_KEY is not set — skipping image safety check.");
    return { safe: true };
  }

  const base64 = arrayBufferToBase64(await file.arrayBuffer());

  let response;

  try {
    response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${env.GOOGLE_VISION_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: "SAFE_SEARCH_DETECTION" }]
          }]
        })
      }
    );
  } catch {
    // Network failure talking to Google: fail open — a moderation
    // outage shouldn't take the whole publish flow down with it.
    console.error("Could not reach Google Vision API.");
    return { safe: true };
  }

  if (!response.ok) {
    console.error("Google Vision API error:", await response.text());
    return { safe: true };
  }

  const data = await response.json();
  const annotation = data.responses && data.responses[0] && data.responses[0].safeSearchAnnotation;

  return { safe: !isUnsafeAnnotation(annotation) };
}

async function handleUpload(request, env) {
  // ---- Authentication -----------------------------------
  // Publishing requires an account (see auth.js/requireAuth on the
  // client side) — but the real check must happen HERE, server-
  // side: a browser-only check is trivially bypassed.
  const user = await verifyUser(request, env);

  if (!user) {
    return jsonResponse({ error: "You must be logged in." }, 401);
  }

  // ---- Reading the uploaded file -----------------------------
  let formData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const file = formData.get("file");
  const kind = formData.get("kind"); // "image" | "avatar" | "stl"
  const filenameOverride = formData.get("filename"); // optional

  if (!(file instanceof File)) {
    return jsonResponse({ error: "No file received." }, 400);
  }

  // ---- Validation by type ------------------------------------
  // "avatar" goes through the exact same rules as "image" (same
  // size cap, same safety check) — it only gets its own R2 prefix
  // below, so profile photos never mix into the model-image path.
  if (kind === "image" || kind === "avatar") {
    if (!file.type.startsWith("image/")) {
      return jsonResponse({ error: "The file must be an image." }, 400);
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "Image too large (8 MB maximum)." }, 400);
    }

    const safety = await checkImageSafety(file, env);

    if (!safety.safe) {
      return jsonResponse(
        { error: "This image was flagged as inappropriate and cannot be published." },
        422
      );
    }
  } else if (kind === "stl") {
    if (!file.name.toLowerCase().endsWith(".stl")) {
      return jsonResponse({ error: "The file must be a .stl." }, 400);
    }

    if (file.size > MAX_STL_BYTES) {
      return jsonResponse({ error: "STL file too large (50 MB maximum)." }, 400);
    }
  } else {
    return jsonResponse({ error: "Unrecognized file type." }, 400);
  }

  // ---- Writing to R2 ---------------------------------------
  // `filenameOverride` lets the caller (see upload.js) make the
  // model's title carry the file name instead of the name picked
  // on the computer — only relevant when there's a single file;
  // with several files, the caller chooses NOT to send it, to keep
  // distinct names (e.g. "Camera_mount.stl" / "GPS_mount.stl").
  let cleanName = sanitizeFileName(filenameOverride || file.name);

  if (kind === "stl" && !cleanName.toLowerCase().endsWith(".stl")) {
    cleanName += ".stl";
  }

  // The uuid prefix in `key` only exists to avoid name collisions
  // in the bucket (two people uploading "mount.stl" must not
  // overwrite each other) — it should never show up at download
  // time. Content-Disposition forces the browser to suggest
  // `cleanName`, independent of the actual storage path.
  const key = `${kind}/${user.id}/${crypto.randomUUID()}-${cleanName}`;

  const httpMetadata = {
    contentType: file.type || "application/octet-stream"
  };

  // STL only: "attachment" forces a download. Images must stay
  // renderable in <img> (implicit "inline" mode), otherwise they'd
  // break on the model page.
  if (kind === "stl") {
    httpMetadata.contentDisposition = `attachment; filename="${cleanName}"`;
  }

  await env.BUCKET.put(key, file, { httpMetadata });

  const url = `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;

  return jsonResponse({ url, key, name: cleanName }, 200);
}

// =======================================================
// 🗑 ACCOUNT DELETION
// The only place in this whole project that uses the Supabase
// secret key (SUPABASE_SECRET_KEY — Supabase's renamed
// "service_role"), which bypasses RLS entirely. Kept to the
// smallest possible surface: verify who's asking with their own
// token first (never trust a user id passed in the request body),
// then only ever act on THAT user's own id — this endpoint can
// never be used to delete someone else's account.
// =======================================================

async function handleDeleteAccount(request, env) {
  const user = await verifyUser(request, env);

  if (!user) {
    return jsonResponse({ error: "You must be logged in." }, 401);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request." }, 400);
  }

  const contentChoice = body.contentChoice;

  if (contentChoice !== "anonymize" && contentChoice !== "delete") {
    return jsonResponse({ error: "Invalid content choice." }, 400);
  }

  const secretHeaders = {
    "apikey": env.SUPABASE_SECRET_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json"
  };

  // ---- Content handling ---------------------------------------
  // Must happen BEFORE the auth user (and its profiles row) is
  // deleted — models/comments/requests still have a foreign key to
  // profiles, so removing the profile first would either fail
  // (blocked by that reference) or silently orphan rows, depending
  // on the path. See supabase_account_deletion.sql for the schema
  // changes that make this possible.
  try {
    if (contentChoice === "anonymize") {
      await fetch(`${env.SUPABASE_URL}/rest/v1/models?creator_id=eq.${user.id}`, {
        method: "PATCH",
        headers: secretHeaders,
        body: JSON.stringify({ creator_id: null, creator_username: "Community" })
      });

      await fetch(`${env.SUPABASE_URL}/rest/v1/comments?user_id=eq.${user.id}`, {
        method: "PATCH",
        headers: secretHeaders,
        body: JSON.stringify({ user_id: null, username: "Community" })
      });

      await fetch(`${env.SUPABASE_URL}/rest/v1/requests?creator_id=eq.${user.id}`, {
        method: "PATCH",
        headers: secretHeaders,
        body: JSON.stringify({ creator_id: null, creator_username: "Community" })
      });
    } else {
      // Deleting their models also cascades to comments/likes/
      // favorites on those specific models (existing "on delete
      // cascade" on comments.model_id etc.) — even ones written by
      // other people, same as when a moderator removes a model.
      await fetch(`${env.SUPABASE_URL}/rest/v1/comments?user_id=eq.${user.id}`, {
        method: "DELETE",
        headers: secretHeaders
      });

      await fetch(`${env.SUPABASE_URL}/rest/v1/models?creator_id=eq.${user.id}`, {
        method: "DELETE",
        headers: secretHeaders
      });

      await fetch(`${env.SUPABASE_URL}/rest/v1/requests?creator_id=eq.${user.id}`, {
        method: "DELETE",
        headers: secretHeaders
      });
    }

    // Reports are moderator-only visibility, not public content —
    // always anonymized regardless of the content choice above,
    // there's no "keep it credited" question for these.
    await fetch(`${env.SUPABASE_URL}/rest/v1/reports?reporter_id=eq.${user.id}`, {
      method: "PATCH",
      headers: secretHeaders,
      body: JSON.stringify({ reporter_id: null })
    });
  } catch {
    return jsonResponse(
      { error: "Failed to remove your content. Please try again or contact support." },
      500
    );
  }

  // ---- Delete the account itself -------------------------------
  // Cascades to profiles, favorites, comment_likes, and
  // request_votes — all already "on delete cascade" on their own
  // user_id column.
  let deleteResponse;

  try {
    deleteResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
      method: "DELETE",
      headers: secretHeaders
    });
  } catch {
    return jsonResponse(
      { error: "Your content was removed, but the account itself could not be deleted. Please contact support." },
      500
    );
  }

  if (!deleteResponse.ok) {
    return jsonResponse(
      { error: "Your content was removed, but the account itself could not be deleted. Please contact support." },
      500
    );
  }

  return jsonResponse({ ok: true }, 200);
}

// =======================================================
// 🔍 EXTERNAL MODELS (Cults3D discovery feed — home page only)
// Fills out the "Popular models" grid with FPV-relevant designs
// from Cults3D when the native catalog is still small — see
// script.js for how these get mixed in and badged. Deliberately
// NOT Thingiverse: their Developer Agreement bars using the API
// "in any manner that is competitive to Thingiverse," which a
// site that also hosts/shares 3D files plausibly is. Cults3D's own
// API page explicitly invites this exact use case ("Do you have a
// website [...] about 3D printing? [...] visitors will only have
// to click to be redirected to [Cults] to download") — no files
// are ever fetched or hosted here, only metadata, and every card
// links straight back to Cults3D for the actual download.
//
// CULTS_USERNAME/CULTS_API_KEY are Worker secrets (`wrangler secret
// put`), never written to wrangler.toml or exposed to the browser —
// this whole thing runs server-side, same as the image safety
// check above.
// =======================================================

const CULTS_SEARCH_KEYWORDS = [
  "fpv drone",
  "fpv frame",
  "tinywhoop",
  "cinewhoop",
  "fpv gopro mount",
  "fpv antenna mount",
  "quadcopter frame",
  "fpv canopy"
];

// Cached at the edge for an hour (Cache-Control below, read back via
// the Cache API) so a page load never waits on — or spams — Cults3D's
// API directly; results are near-identical run to run anyway.
const EXTERNAL_MODELS_CACHE_SECONDS = 60 * 60;
const EXTERNAL_MODELS_CACHE_KEY = "https://fpv-base.com/__cache/external-models-cults3d";

async function fetchCultsKeyword(keyword, env) {
  const auth = btoa(`${env.CULTS_USERNAME}:${env.CULTS_API_KEY}`);

  const query = `{
    creationsSearchBatch(query: ${JSON.stringify(keyword)}, onlySafe: true, limit: 4) {
      results {
        identifier
        name
        url
        illustrationImageUrl
        likesCount
        downloadsCount
        creator { nick }
      }
    }
  }`;

  const response = await fetch("https://cults3d.com/graphql", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) return [];

  const body = await response.json();
  const results = body.data && body.data.creationsSearchBatch && body.data.creationsSearchBatch.results;

  return results || [];
}

async function handleExternalModels(env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EXTERNAL_MODELS_CACHE_KEY);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  // No credentials configured: fail open with an empty list rather
  // than an error — the home page just shows native models only,
  // same as before this feature existed.
  if (!env.CULTS_USERNAME || !env.CULTS_API_KEY) {
    return jsonResponse([], 200);
  }

  let normalized = [];

  try {
    const perKeyword = await Promise.all(
      CULTS_SEARCH_KEYWORDS.map(keyword => fetchCultsKeyword(keyword, env).catch(() => []))
    );

    const seen = new Set();

    perKeyword.flat().forEach(item => {
      if (!item || !item.identifier || seen.has(item.identifier)) return;
      seen.add(item.identifier);

      normalized.push({
        id: `cults-${item.identifier}`,
        title: item.name,
        image: item.illustrationImageUrl || null,
        url: item.url,
        creator: item.creator ? item.creator.nick : "Cults3D creator",
        downloads: item.downloadsCount || 0,
        likes: item.likesCount || 0,
        source: "cults3d"
      });
    });
  } catch {
    normalized = [];
  }

  const response = jsonResponse(normalized, 200);
  response.headers.set("Cache-Control", `public, max-age=${EXTERNAL_MODELS_CACHE_SECONDS}`);

  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
