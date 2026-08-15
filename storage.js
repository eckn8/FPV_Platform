// =======================================================
// 🪣 storage.js — Upload files to real storage (R2)
// Requires auth.js loaded before this file (for the access token).
//
// Files no longer go through localStorage: they're sent to
// POST /api/upload (see worker.js), which verifies the user with
// Supabase and then writes to R2. We get back a real public URL,
// visible to everyone — not just to the person who published it.
// =======================================================

// Sends a file to /api/upload and returns { url, name } (the final
// name chosen by the server — see worker.js, it can differ from
// file.name if filenameOverride is provided). kind: "image" | "stl".
// filenameOverride is optional — useful so a single STL file
// carries the model's title instead of the name picked on the
// computer (see upload.js). Throws a readable error message on
// failure (missing auth, rejected file, network failure...) — to
// be caught by the caller.
async function uploadFileToStorage(file, kind, filenameOverride) {
  const token = getAccessToken();

  if (!token) {
    throw new Error("You must be logged in to publish a file.");
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("kind", kind);

  if (filenameOverride) {
    formData.append("filename", filenameOverride);
  }

  let response;

  try {
    response = await fetch("/api/upload", {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}` },
      body: formData
    });
  } catch {
    throw new Error("Could not reach the server — check your connection.");
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Failed to upload the file.");
  }

  return { url: result.url, name: result.name };
}

// Converts a base64 data URL (an image already compressed in the
// browser, see compressImage() in upload.js) into a Blob, so it
// can be sent as a real file to /api/upload.
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
