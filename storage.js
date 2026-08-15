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

// Resizes + re-encodes an image in the browser (canvas) before it
// ever reaches the network — keeps uploads fast and R2 usage low.
// Shared by upload.js (new model) and model.js (editing a model's
// images). callback receives a base64 data URL.
function compressImage(file, maxWidth, quality, callback) {
  const reader = new FileReader();

  reader.onload = function (event) {
    const img = new Image();

    img.onload = function () {
      const canvas = document.createElement("canvas");

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      callback(canvas.toDataURL("image/jpeg", quality));
    };

    img.src = event.target.result;
  };

  reader.readAsDataURL(file);
}

// Converts a base64 data URL (an image already compressed via
// compressImage() above) into a Blob, so it can be sent as a real
// file to /api/upload.
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
