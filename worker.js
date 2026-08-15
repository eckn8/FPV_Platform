// =======================================================
// 🌐 worker.js — Site entry point (Cloudflare Workers)
//
// This project is deployed as a real Worker (not classic "Pages")
// — the functions/api/*.js convention doesn't apply here, hence
// this single file. By default (see [assets] in wrangler.toml),
// Cloudflare serves static files (HTML/CSS/JS) directly when they
// match the request, and only invokes this script for what doesn't
// match any file — so in practice, only /api/upload.
// =======================================================

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 MB
const MAX_STL_BYTES = 50 * 1024 * 1024;    // 50 MB

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
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
  const kind = formData.get("kind"); // "image" | "stl"
  const filenameOverride = formData.get("filename"); // optional

  if (!(file instanceof File)) {
    return jsonResponse({ error: "No file received." }, 400);
  }

  // ---- Validation by type ------------------------------------
  if (kind === "image") {
    if (!file.type.startsWith("image/")) {
      return jsonResponse({ error: "The file must be an image." }, 400);
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "Image too large (8 MB maximum)." }, 400);
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
