// =======================================================
// 🪣 storage.js — Upload de fichiers vers le stockage réel (R2)
// Nécessite auth.js chargé avant ce fichier (pour le jeton d'accès).
//
// Les fichiers ne transitent plus par localStorage : ils sont
// envoyés à POST /api/upload (voir worker.js), qui vérifie
// l'utilisateur auprès de Supabase puis écrit dans R2. On récupère
// en retour une vraie URL publique, visible par tout le monde —
// pas juste par la personne qui a publié.
// =======================================================

// Envoie un fichier vers /api/upload et renvoie son URL publique.
// kind : "image" | "stl". Lance une erreur au message lisible en
// cas d'échec (auth manquante, fichier refusé, panne réseau...) —
// à catcher côté appelant pour l'afficher à l'utilisateur.
async function uploadFileToStorage(file, kind) {
  const token = getAccessToken();

  if (!token) {
    throw new Error("Tu dois être connecté pour publier un fichier.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind);

  let response;

  try {
    response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: formData
    });
  } catch {
    throw new Error("Impossible de contacter le serveur — vérifie ta connexion.");
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Échec de l'envoi du fichier.");
  }

  return result.url;
}

// Convertit un data URL base64 (image déjà compressée côté
// navigateur, voir compressImage() dans upload.js) en Blob, pour
// pouvoir l'envoyer comme un vrai fichier à /api/upload.
function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(",");
  const mimeMatch = header.match(/data:(.*?);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}
