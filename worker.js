// =======================================================
// 🌐 worker.js — Site entry point (Cloudflare Workers)
//
// This project is deployed as a real Worker (not classic "Pages")
// — the functions/api/*.js convention doesn't apply here, hence
// this single file. By default (see [assets] in wrangler.toml),
// Cloudflare serves static files (HTML/CSS/JS) directly when they
// match the request, and only invokes this script for what doesn't
// match any file — so in practice, only /api/upload,
// /api/delete-account and /api/fpv-catalog.
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

    // Renamed from /api/external-models: Cloudflare's own edge cache
    // had a stale copy of that exact URL pinned from before a filter
    // fix, and our cache-purge API scope isn't available on this
    // token — a URL nobody's ever cached is the reliable way around
    // that rather than depending on a purge that can't be issued.
    // Rename again if this ever needs a hard cache-bust in the future.
    if (url.pathname === "/api/fpv-catalog" && request.method === "GET") {
      return handleExternalModels(env, ctx);
    }

    if (url.pathname === "/api/fpv-item" && request.method === "GET") {
      return handleExternalModelDetail(url.searchParams.get("slug"), env, ctx);
    }

    if (url.pathname === "/api/fpv-find" && request.method === "GET") {
      return handleExternalSearch(url.searchParams.get("q"), env, ctx);
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

// Broad terms ("fpv drone") return thousands of Cults3D results —
// BY_LIKES sorting (see fetchCultsKeyword) keeps even those relevant
// by surfacing well-regarded designs first, so covering more of the
// FPV part space here (frame sizes, common accessories) is safe:
// more real matches without a wall of low-quality noise.
//
// Four groups, each targeting a different way someone actually
// searches Cults3D for FPV parts:
// - General: broad hobby terms/sizes.
// - By part (from FPVBase's own folder taxonomy — see
//   supabase_root_lock_migration.sql): the specific things a folder
//   is for (motor, GPS, VTX...) rather than the folder name itself,
//   since nobody actually searches Cults3D for the literal word
//   "Electronic".
// - By brand: real product names carry a LOT of Cults3D content
//   (mounts/frames/cases made specifically to fit them) that a
//   generic part search misses entirely.
// - By specific frame model: narrower still than a brand name —
//   catches mounts/bumpers/spares made for one exact frame that a
//   brand-only search's limit of 15 results might not surface.
//
// Capped at 46 total — NOT the ~500 a full "50 brands × 10 products"
// list would need, and smaller than a first attempt at "add 30 frame
// names on top" (74 total), which measured live turned out to
// exceed Cloudflare's real subrequest ceiling per invocation and
// intermittently emptied the entire catalog outright (confirmed via
// `wrangler tail`: "Too many subrequests by single Worker
// invocation" — a hard, cumulative-per-invocation limit, not
// something batching the requests over time gets around). Every
// keyword here earns its subrequest: the weakest general/by-part
// terms and the lowest-yield frame names (a handful matched under 10
// total Cults3D results each) were cut to make room for the 8
// highest-yield frame names instead of naively keeping all of them.
const CULTS_SEARCH_KEYWORDS = [
  // General
  "fpv drone",
  "fpv frame",
  "tinywhoop",
  "cinewhoop",
  "fpv freestyle",
  "long range fpv",
  "5 inch fpv frame",
  "3 inch fpv frame",
  // By part (Drone/Frame, Drone/Battery, Drone/Electronic, Camera,
  // Equipment — see supabase_root_lock_migration.sql)
  "fpv drone motor",
  "fpv propeller guard",
  "fpv canopy",
  "fpv landing gear",
  "fpv battery strap mount",
  "fpv vtx antenna mount",
  "fpv gps mount",
  "fpv led mount",
  "action camera mount fpv drone",
  "radio transmitter case",
  // By brand (frames, electronics, goggles/radio)
  "GEPRC",
  "iFlight",
  "TBS Team BlackSheep",
  "Armattan",
  "Diatone",
  "Flywoo",
  "Axisflying",
  "HGLRC",
  "BrotherHobby",
  "Holybro",
  "SpeedyBee",
  "Foxeer",
  "RunCam",
  "Caddx",
  "Walksnail",
  "HDZero",
  "Radiomaster",
  "ExpressLRS",
  "Fatshark",
  "BetaFPV",
  // By specific frame model — the 8 highest-yield of the ones
  // individually verified against the real API (see the note above);
  // the rest matched too few real Cults3D results (several under 10
  // total) to justify their own subrequest once the budget got tight.
  "TBS Source One",
  "TBS Source One V5",
  "ImpulseRC Apex",
  "GEPRC Mark4",
  "GEPRC Mark5",
  "iFlight XL5",
  "Diatone Roma",
  "Armattan Chameleon"
];

// Per keyword, not a global total — 20 keywords × 15 duplicates
// heavily (the same popular frame shows up for several searches),
// which is exactly why normalizing by `identifier` into a Set
// below matters: the deduped result lands in the low hundreds, not
// 300 near-copies.
const CULTS_SEARCH_LIMIT_PER_KEYWORD = 15;

// How many keywords' worth of Cults3D requests run at once — see the
// batching loop in handleExternalModels(). Kept comfortably under
// whatever the real concurrent-subrequest ceiling turns out to be,
// rather than the keyword count itself.
const CULTS_KEYWORD_BATCH_SIZE = 10;

// Cached at the edge for an hour (Cache-Control below, read back via
// the Cache API) so a page load never waits on — or spams — Cults3D's
// API directly; results are near-identical run to run anyway.
const EXTERNAL_MODELS_CACHE_SECONDS = 60 * 60;
// Versioned (v13): the actual root cause behind "Too many
// subrequests" turned out to be a non-ok Cults3D response never
// having its body read (fetchCultsKeyword and friends now always
// drain it, ok or not) — Cloudflare's own deadlock prevention starts
// canceling OTHER in-flight requests once too many unread bodies
// pile up, which is what was really emptying the catalog, not the
// keyword count on its own. Bumping forces a fresh fetch instead of
// continuing to serve the empty catalog v12 cached for up to an
// hour. Bump again any time the keywords or filter change.
const EXTERNAL_MODELS_CACHE_KEY = "https://fpv-base.com/__cache/external-models-cults3d-v13";

// Cults3D mixes the occasional video into "illustrations" (hosted on
// a different subdomain, e.g. videos.cults3d.com) — filtered out
// here since <img> can't render one and the detail page's gallery
// expects only images.
const IMAGE_URL_REGEX = /\.(png|jpe?g|gif|webp)$/i;

// FPVBase is a hobby FPV multirotor platform — broad keywords like
// "fpv drone" also pull in fixed-wing RC planes/gliders (a different
// hobby entirely), other RC vehicles entirely (boats, cars, tank
// rovers — Cults3D's own search is loose enough that a jetski or a
// paddle-board thruster shows up for "fpv drone"), and, since "FPV"
// is now widely used for war-context loitering munitions, the
// occasional combat-drone or replica-weapon design (real examples
// hit during testing: a frame tagged "kamikaze," a Su-75 fighter jet
// model, a G36 rifle turret). Keyword matching alone misses proper
// nouns (a jet named "Checkmate" doesn't say "military" anywhere) —
// combined with Cults3D's own subcategory tags below, which catch
// exactly those cases structurally instead of by vocabulary.
const EXCLUDED_TERMS_REGEX = new RegExp(
  [
    // Fixed-wing / RC plane — not a multirotor FPV drone.
    "flying wing", "fixed[- ]wing", "delta wing", "r\\/?c plane",
    "r\\/?c airplane", "glider", "warbird", "biplane", "sailplane",
    "foam(?:board)? plane", "airplane", "aeroplane", "\\baircraft",
    "fighter jet", "jet fighter",
    // Not a flying FPV drone at all — a different RC hobby entirely.
    "\\bairsoft", "\\bturret", "\\brifle", "\\bboat\\b", "zerobot",
    // Not FPV drone content at all — generic maker/tabletop-gaming
    // fare that a broad keyword's fuzzy match occasionally pulls in
    // (real example: a tabletop terrain piece, from "fpv drone").
    "table\\s?top",
    // ESP32-based builds are a DIY microcontroller hobby project, not
    // an actual FPV racing/freestyle drone — excluded per feedback
    // even though a couple are genuinely quadcopter-shaped.
    "esp32",
    // War/military — keep this strictly a hobby platform.
    "ukrain", "russia", "military", "\\bwar\\b", "kamikaze", "combat",
    "grenade", "munition", "\\bweapon", "warhead", "\\bbomb\\b",
    "explosive", "\\bied\\b", "artillery",
    // Real weaponized/war-drone names — generic terms above wouldn't
    // catch a proper noun like "Bayraktar" or "Shahed".
    "bayraktar", "switchblade", "\\bshahed", "su-?75", "su-?57",
    "\\bmig-?\\d", "\\bf-?16\\b", "\\bf-?22\\b", "\\bf-?35\\b",
    "predator drone", "reaper drone"
  ].join("|"),
  "i"
);

// Structural signal alongside the keyword list above: Cults3D lets
// creators tag a design with its own subcategories, and in practice
// "RC Vehicles"/"Auto & Moto" (cars, boats, tanks) and "Aircraft &
// Space" (planes, jets) reliably mark something that isn't a
// multirotor FPV drone — confirmed against real offenders (a jetski,
// a tank rover, the Su-75) during testing. Not used as a positive
// "must be tagged Drones" requirement instead, because plenty of
// legitimate FPV drones/accessories on Cults3D aren't tagged
// "Drones" at all (creator-chosen tags, not curated) — that would
// have thrown out real results, not just junk.
const EXCLUDED_SUBCATEGORY_SLUGS = new Set([
  "rc-vehicles", "auto-moto", "aircraft-space", "airsoft"
]);

function isExcludedCultsItem(item) {
  const haystack = `${item.name || ""} ${(item.tags || []).join(" ")} ${item.description || ""}`;

  if (EXCLUDED_TERMS_REGEX.test(haystack)) return true;

  const subCategorySlugs = (item.subCategories || []).map(sub => sub && sub.slug);

  return subCategorySlugs.some(slug => EXCLUDED_SUBCATEGORY_SLUGS.has(slug));
}

// Shared by the list (lean fields only, see fetchCultsKeyword) and
// the single-item detail fetch (full fields, see
// fetchCultsCreationDetail) — a list item run through this just ends
// up with empty description/images (tags still come through, needed
// for isExcludedCultsItem), which is exactly what the home page's
// cards need anyway.
function normalizeCultsItem(item) {
  const images = (item.illustrations || [])
    .map(illustration => illustration.imageUrl)
    .filter(url => url && IMAGE_URL_REGEX.test(url));

  return {
    id: `cults-${item.identifier}`,
    title: item.name,
    image: item.illustrationImageUrl || images[0] || null,
    images: images.length > 0 ? images : (item.illustrationImageUrl ? [item.illustrationImageUrl] : []),
    description: item.description || "",
    tags: Array.isArray(item.tags) ? item.tags : [],
    url: item.url,
    creator: item.creator ? item.creator.nick : "Cults3D creator",
    downloads: item.downloadsCount || 0,
    likes: item.likesCount || 0,
    // Same field name as a native model's own createdAt — lets
    // script.js sort native + external entries with one comparator
    // instead of two (see entryCreatedAtMs()).
    createdAt: item.publishedAt || null,
    source: "cults3d"
  };
}

// Real example hit during testing: the exact keyword "T-Motor" (a
// genuine FPV motor brand) came back with a `total` of 55,893 and
// its top BY_LIKES hit was a viral flexi-print toy with nothing to
// do with FPV — Cults3D's search apparently tokenizes the hyphen
// into something close to a wildcard match rather than the brand
// name. None of our real, deliberately broad keywords ("fpv drone")
// come anywhere near this — the biggest legitimate one sits at
// ~4,700. Above this threshold, a keyword isn't narrowing the
// catalog down at all and its "top liked" results are really just
// Cults3D's sitewide most-liked designs — discarded outright rather
// than trusted, so one bad keyword (now or added later) can't quietly
// flood the discovery feed with unrelated viral content.
const CULTS_KEYWORD_MAX_TOTAL = 8000;

async function fetchCultsKeyword(keyword, env) {
  const auth = btoa(`${env.CULTS_USERNAME}:${env.CULTS_API_KEY}`);

  // Lean on purpose — this feeds the home page's cards only, which
  // never show description/the full image gallery (those live
  // behind /api/fpv-item instead, fetched once per detail-page
  // view rather than bloating every home page load with hundreds of
  // descriptions nobody's reading yet). `tags` is the exception: it's
  // small, and isExcludedCultsItem() needs it to filter out fixed-
  // wing/war-related results before anything gets cached or shown.
  // BY_LIKES/DESC: these keywords are broad enough to return
  // thousands of matches, sorting by likes keeps what actually gets
  // fetched relevant.
  const query = `{
    creationsSearchBatch(
      query: ${JSON.stringify(keyword)}
      onlySafe: true
      limit: ${CULTS_SEARCH_LIMIT_PER_KEYWORD}
      sort: BY_LIKES
      direction: DESC
    ) {
      total
      results {
        identifier
        name
        url
        illustrationImageUrl
        tags
        subCategories { slug }
        likesCount
        downloadsCount
        publishedAt
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

  // Always drain the body, even on failure — an unread Response
  // left dangling (real culprit behind a live "Too many subrequests"
  // failure: Cloudflare's own deadlock-prevention starts canceling
  // OTHER in-flight requests once too many unread bodies pile up,
  // which is what actually emptied the catalog, not the keyword
  // count itself) rather than just letting the request count grow.
  if (!response.ok) {
    await response.text().catch(() => {});
    return [];
  }

  const body = await response.json();
  const batch = body.data && body.data.creationsSearchBatch;

  if (!batch) return [];

  if (batch.total > CULTS_KEYWORD_MAX_TOTAL) {
    console.error(`Discarding Cults3D keyword "${keyword}" — total ${batch.total} exceeds the sanity threshold, its results aren't actually specific to it.`);
    return [];
  }

  return batch.results || [];
}

// Cloudflare's own zone-level "Browser Cache TTL" setting rewrites
// whatever max-age we set below into a much longer value for what
// browsers actually receive (observed live: rewritten to 4h) —
// completely independent of the versioned caches.default keys above,
// and outside anything worker.js controls directly. Left alone, a
// browser would keep serving its own stale copy of a filtered
// list/search for hours after any change here, no matter how
// aggressively the internal cache key gets bumped. Every response
// actually handed back to a client goes through this first — only
// OUR OWN edge cache (caches.default, still governed by the max-age
// set before storing) gets to benefit from a long TTL; browsers
// never get the chance to cache these themselves.
function noBrowserCache(response) {
  const copy = new Response(response.body, response);
  copy.headers.set("Cache-Control", "no-store");
  return copy;
}

async function handleExternalModels(env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(EXTERNAL_MODELS_CACHE_KEY);

  const cached = await cache.match(cacheKey);
  if (cached) return noBrowserCache(cached);

  // No credentials configured: fail open with an empty list rather
  // than an error — the home page just shows native models only,
  // same as before this feature existed.
  if (!env.CULTS_USERNAME || !env.CULTS_API_KEY) {
    return jsonResponse([], 200);
  }

  let normalized = [];

  try {
    // Batched, not one giant Promise.all over every keyword. The
    // real fix for "Too many subrequests" (see CULTS_SEARCH_KEYWORDS
    // above) was cutting the keyword list back under Cloudflare's
    // actual per-invocation ceiling — that error message names it as
    // a cumulative total, not a concurrency limit, and batching alone
    // doesn't reduce a total. Kept anyway as a second line of
    // defense (staggering requests can't hurt, and protects against
    // this list growing again later without someone re-deriving the
    // hard limit the hard way).
    const perKeyword = [];

    for (let i = 0; i < CULTS_SEARCH_KEYWORDS.length; i += CULTS_KEYWORD_BATCH_SIZE) {
      const batch = CULTS_SEARCH_KEYWORDS.slice(i, i + CULTS_KEYWORD_BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(keyword => fetchCultsKeyword(keyword, env).catch(() => []))
      );

      perKeyword.push(...batchResults);
    }

    const seen = new Set();

    perKeyword.flat().forEach(item => {
      if (!item || !item.identifier || seen.has(item.identifier)) return;
      if (isExcludedCultsItem(item)) return;
      seen.add(item.identifier);

      normalized.push(normalizeCultsItem(item));
    });
  } catch {
    normalized = [];
  }

  const response = jsonResponse(normalized, 200);
  response.headers.set("Cache-Control", `public, max-age=${EXTERNAL_MODELS_CACHE_SECONDS}`);

  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return noBrowserCache(response);
}

// =======================================================
// 🔎 EXTERNAL MODEL DETAIL (single Cults3D item, on demand)
// The list above is intentionally lean (see fetchCultsKeyword) — a
// Cults3D detail page (model.js, "cults-" ids) calls this instead to
// get the full description/tags/image gallery for the ONE item
// being viewed, rather than every visitor's home page paying for
// hundreds of descriptions at once. `slug` is just the last segment
// of the item's own Cults3D url (e.g. "fpv-drone-frame-kit") — that's
// literally what Cults3D's own `creation(slug:)` query expects,
// confirmed by testing against the real API.
// =======================================================

const EXTERNAL_MODEL_DETAIL_CACHE_SECONDS = 60 * 60;

async function fetchCultsCreationDetail(slug, env) {
  const auth = btoa(`${env.CULTS_USERNAME}:${env.CULTS_API_KEY}`);

  const query = `{
    creation(slug: ${JSON.stringify(slug)}) {
      identifier
      name
      url
      illustrationImageUrl
      description
      tags
      subCategories { slug }
      illustrations { imageUrl }
      likesCount
      downloadsCount
      publishedAt
      creator { nick }
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

  // See the matching comment in fetchCultsKeyword — always drain the
  // body, even on failure.
  if (!response.ok) {
    await response.text().catch(() => {});
    return null;
  }

  const body = await response.json();
  return (body.data && body.data.creation) || null;
}

async function handleExternalModelDetail(slug, env, ctx) {
  if (!slug) return jsonResponse(null, 400);

  const cache = caches.default;
  // v2: now filtered (see isExcludedCultsItem) — a slug cached under
  // the old, unfiltered key before this change would otherwise keep
  // serving for up to an hour.
  // v5: clears out a handful of bad cached nulls from while the
  // catalog fetch above was intermittently blowing through
  // Cloudflare's concurrent-subrequest limit (see EXTERNAL_MODELS_
  // CACHE_KEY) — unrelated code, but real Cults3D items got cached
  // as "not found" during that window.
  const cacheKey = new Request(`https://fpv-base.com/__cache/external-model-detail-v6-${encodeURIComponent(slug)}`);

  const cached = await cache.match(cacheKey);
  if (cached) return noBrowserCache(cached);

  if (!env.CULTS_USERNAME || !env.CULTS_API_KEY) {
    return jsonResponse(null, 200);
  }

  let normalized = null;

  try {
    const item = await fetchCultsCreationDetail(slug, env);
    // A direct/stale link to something the list filter would have
    // excluded (see isExcludedCultsItem) — treated as "not found"
    // rather than exposing it through a slug someone already had.
    normalized = item && !isExcludedCultsItem(item) ? normalizeCultsItem(item) : null;
  } catch {
    normalized = null;
  }

  const response = jsonResponse(normalized, 200);
  response.headers.set("Cache-Control", `public, max-age=${EXTERNAL_MODEL_DETAIL_CACHE_SECONDS}`);

  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return noBrowserCache(response);
}

// =======================================================
// 🔎 EXTERNAL SEARCH (live Cults3D lookup — home page search only)
// The discovery feed above (handleExternalModels) only ever covers
// ~20 broad category keywords — searching a specific part by name
// (e.g. "TBS Source One V5") can legitimately exist on Cults3D
// without ever surfacing in that curated feed. This runs the
// visitor's own search term against Cults3D directly instead of the
// pre-fetched list, same filtering (isExcludedCultsItem) applied.
// =======================================================

const EXTERNAL_SEARCH_LIMIT = 20;
const EXTERNAL_SEARCH_CACHE_SECONDS = 60 * 60;
const EXTERNAL_SEARCH_MIN_LENGTH = 2;

async function fetchCultsSearchQuery(searchTerm, env) {
  const auth = btoa(`${env.CULTS_USERNAME}:${env.CULTS_API_KEY}`);

  // No explicit sort — Cults3D's own relevance ranking (its default)
  // is what you want for "does this specific part exist," unlike the
  // BY_LIKES override used for the broad category keywords above.
  const query = `{
    creationsSearchBatch(query: ${JSON.stringify(searchTerm)}, onlySafe: true, limit: ${EXTERNAL_SEARCH_LIMIT}) {
      results {
        identifier
        name
        url
        illustrationImageUrl
        tags
        subCategories { slug }
        likesCount
        downloadsCount
        publishedAt
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

  // See the matching comment in fetchCultsKeyword — always drain the
  // body, even on failure.
  if (!response.ok) {
    await response.text().catch(() => {});
    return [];
  }

  const body = await response.json();
  const results = body.data && body.data.creationsSearchBatch && body.data.creationsSearchBatch.results;

  return results || [];
}

async function handleExternalSearch(rawQuery, env, ctx) {
  const searchTerm = (rawQuery || "").trim();

  if (searchTerm.length < EXTERNAL_SEARCH_MIN_LENGTH) {
    return jsonResponse([], 200);
  }

  if (!env.CULTS_USERNAME || !env.CULTS_API_KEY) {
    return jsonResponse([], 200);
  }

  const cache = caches.default;
  const cacheKey = new Request(
    `https://fpv-base.com/__cache/external-search-v3-${encodeURIComponent(searchTerm.toLowerCase())}`
  );

  const cached = await cache.match(cacheKey);
  if (cached) return noBrowserCache(cached);

  let normalized = [];

  try {
    const results = await fetchCultsSearchQuery(searchTerm, env);

    normalized = results
      .filter(item => item && item.identifier && !isExcludedCultsItem(item))
      .map(normalizeCultsItem);
  } catch {
    normalized = [];
  }

  const response = jsonResponse(normalized, 200);
  response.headers.set("Cache-Control", `public, max-age=${EXTERNAL_SEARCH_CACHE_SECONDS}`);

  ctx.waitUntil(cache.put(cacheKey, response.clone()));

  return noBrowserCache(response);
}
