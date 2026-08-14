// =======================================================
// 🌐 worker.js — Point d'entrée du site (Cloudflare Workers)
//
// Ce projet est déployé comme un vrai Worker (pas la "Pages"
// classique) — la convention functions/api/*.js ne s'applique pas
// ici, d'où ce fichier unique. Par défaut (voir [assets] dans
// wrangler.toml), Cloudflare sert directement les fichiers
// statiques (HTML/CSS/JS) quand ils correspondent à la requête et
// n'invoque ce script QUE pour ce qui ne correspond à aucun
// fichier — donc uniquement /api/upload en pratique.
// =======================================================

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 Mo
const MAX_STL_BYTES = 50 * 1024 * 1024;    // 50 Mo

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/upload" && request.method === "POST") {
      return handleUpload(request, env);
    }

    // Tout le reste : fichiers statiques (filet de sécurité — en
    // pratique Cloudflare les sert déjà avant même d'appeler ce
    // script quand un fichier correspond).
    return env.ASSETS.fetch(request);
  }
};

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

// Vérifie le jeton Supabase auprès de Supabase lui-même plutôt que
// de réimplémenter la vérification du JWT ici — plus simple, et ça
// gère correctement l'expiration/révocation côté Supabase.
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

// Regex construite dynamiquement (plutôt qu'un littéral \uXXXX)
// pour matcher les marques diacritiques combinantes après une
// normalisation NFD — même technique que dans data.js.
const COMBINING_MARKS_REGEX = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);

function sanitizeFileName(name) {
  return String(name || "fichier")
    .normalize("NFD")
    .replace(COMBINING_MARKS_REGEX, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(-100);
}

async function handleUpload(request, env) {
  // ---- Authentification -----------------------------------
  // Publier nécessite un compte (voir auth.js/requireAuth côté
  // client) — mais la vraie vérification doit se faire ICI, côté
  // serveur : un contrôle uniquement côté navigateur se contourne
  // trivialement.
  const user = await verifyUser(request, env);

  if (!user) {
    return jsonResponse({ error: "Connexion requise." }, 401);
  }

  // ---- Lecture du fichier envoyé -----------------------------
  let formData;

  try {
    formData = await request.formData();
  } catch {
    return jsonResponse({ error: "Requête invalide." }, 400);
  }

  const file = formData.get("file");
  const kind = formData.get("kind"); // "image" | "stl"

  if (!(file instanceof File)) {
    return jsonResponse({ error: "Aucun fichier reçu." }, 400);
  }

  // ---- Validation par type ------------------------------------
  if (kind === "image") {
    if (!file.type.startsWith("image/")) {
      return jsonResponse({ error: "Le fichier doit être une image." }, 400);
    }

    if (file.size > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "Image trop lourde (8 Mo maximum)." }, 400);
    }
  } else if (kind === "stl") {
    if (!file.name.toLowerCase().endsWith(".stl")) {
      return jsonResponse({ error: "Le fichier doit être un .stl." }, 400);
    }

    if (file.size > MAX_STL_BYTES) {
      return jsonResponse({ error: "Fichier STL trop lourd (50 Mo maximum)." }, 400);
    }
  } else {
    return jsonResponse({ error: "Type de fichier non reconnu." }, 400);
  }

  // ---- Écriture dans R2 ---------------------------------------
  const key = `${kind}/${user.id}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;

  await env.BUCKET.put(key, file, {
    httpMetadata: { contentType: file.type || "application/octet-stream" }
  });

  const url = `${env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}`;

  return jsonResponse({ url, key }, 200);
}
