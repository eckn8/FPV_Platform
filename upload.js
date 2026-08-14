// =======================================================
// 📤 upload.js — Publication d'un modèle
// Les modèles, dossiers et demandes vivent dans data.js
// (chargé avant ce fichier).
// =======================================================

// =======================
// 🔗 PARAMÈTRES URL
// =======================

const params = new URLSearchParams(window.location.search);

const linkedRequestId = params.get("requestId");

// =======================
// 👤 CONNEXION REQUISE
// Publier est une des rares pages qui n'a aucune raison d'être
// utilisée sans compte (contrairement à parcourir/télécharger) —
// on redirige donc directement si personne n'est connecté.
// =======================

authReady.then(() => {
  if (!getCurrentUser()) {
    window.location.href =
      "login.html?redirect=" + encodeURIComponent("upload.html" + window.location.search);
  }
});

// =======================
// 📦 ÉLÉMENTS HTML
// =======================

const uploadButton =
  document.getElementById("uploadButton");

const uploadImage =
  document.getElementById("uploadImage");

const uploadFile =
  document.getElementById("uploadFile");

const imagesPreview = document.getElementById("imagesPreview");

const linkedRequestInfo =
  document.getElementById("linkedRequestInfo");

const uploadMessage =
  document.getElementById("uploadMessage");

const uploadBreadcrumb =
  document.getElementById("uploadBreadcrumb");

const uploadFoldersGrid =
  document.getElementById("uploadFoldersGrid");

const newFolderInput =
  document.getElementById("newFolderInput");

const addFolderButton =
  document.getElementById("addFolderButton");

const currentFolderContainer =
  document.getElementById(
    "currentFolderContainer"
  );

const filesPreview =
  document.getElementById("filesPreview");

// =======================
// 🖼 IMAGE COMPRESSÉE
// =======================

let compressedImages = [];
let isCompressingImages = false;

// =======================
// 📁 DOSSIER ACTUEL
// =======================

let currentPath = [];

// =======================
// 📁 DOSSIERS
// =======================

function getSubfolders() {
  return getSubfoldersAt(getAllFolderPaths(), currentPath);
}

// =======================
// 📁 AFFICHAGE DOSSIERS
// =======================

function renderUploadFolders() {

  uploadFoldersGrid.innerHTML = "";

  currentFolderContainer.innerHTML = "";

  // =======================
  // 📁 DOSSIER ACTUEL
  // =======================

  if (currentPath.length > 0) {

    const currentFolder =
      currentPath[currentPath.length - 1];

    const currentFolderCard =
      document.createElement("div");

    currentFolderCard.className =
      "folder-card active-folder current-folder-big";

    currentFolderCard.innerHTML = `
      <div class="folder-icon">📁</div>

      <div>
        <h3>${escapeHtml(currentFolder)}</h3>
        <p>Dossier sélectionné</p>
      </div>
    `;

    currentFolderContainer.appendChild(
      currentFolderCard
    );
  }

  // =======================
  // 📁 SOUS-DOSSIERS
  // =======================

  const folders = getSubfolders();

  if (folders.length === 0) {

    if (currentPath.length === 0) {

      uploadFoldersGrid.innerHTML =
        "<p>Aucun dossier disponible.</p>";
    }

    return;
  }

  folders.forEach(folder => {

    const folderCard =
      document.createElement("div");

    folderCard.className =
      "folder-card";

    folderCard.innerHTML = `
      <div class="folder-icon">📁</div>

      <div>
        <h3>${escapeHtml(folder)}</h3>
        <p>Choisir ce dossier</p>
      </div>
    `;

    folderCard.onclick = () => {

      currentPath.push(folder);

      renderFolderPicker();
    };

    uploadFoldersGrid.appendChild(
      folderCard
    );
  });
}

// =======================
// 🚀 RENDER GLOBAL
// =======================

function renderFolderPicker() {

  renderBreadcrumb(uploadBreadcrumb, currentPath, newPath => {
    currentPath = newPath;
    renderFolderPicker();
  });

  renderUploadFolders();
}

// =======================
// ➕ NOUVEAU DOSSIER
// Rappel produit : c'est une option de secours, pas le chemin
// recommandé. Utiliser un dossier existant évite de finir avec
// "Support GPS" / "Supports GPS" / "GPS mounts"... qui désignent
// tous la même chose.
// =======================

addFolderButton.addEventListener(
  "click",
  () => {

    const folderName =
      newFolderInput.value.trim();

    if (!folderName) return;

    const newPath = [
      ...currentPath,
      folderName
    ];

    const folders =
      getCustomFolders();

    const alreadyExists =
      folders.some(
        path =>
          JSON.stringify(path) ===
          JSON.stringify(newPath)
      );

    if (!alreadyExists) {

      folders.push(newPath);

      saveCustomFolders(folders);
    }

    currentPath = newPath;

    newFolderInput.value = "";

    renderFolderPicker();
  }
);

// =======================
// 🔔 DEMANDE LIÉE
// =======================

if (
  linkedRequestId &&
  linkedRequestInfo
) {

  const linkedRequest =
    getRequests().find(
      request =>
        String(request.id) ===
        String(linkedRequestId)
    );

  if (linkedRequest) {

    linkedRequestInfo.textContent =
      `Ce modèle répond à la demande : ${linkedRequest.title}`;
  }
}

// =======================
// 📸 PREVIEW IMAGE
// =======================

uploadImage.addEventListener("change", () => {
  const images = Array.from(uploadImage.files);

  compressedImages = [];
  imagesPreview.innerHTML = "";

  if (images.length === 0) {
    isCompressingImages = false;
    return;
  }

  isCompressingImages = true;

  let processedImages = 0;

  images.forEach(image => {
    if (!image.type.startsWith("image/")) {
      alert("Tous les fichiers doivent être des images.");
      uploadImage.value = "";
      compressedImages = [];
      imagesPreview.innerHTML = "";
      isCompressingImages = false;
      return;
    }

    compressImage(image, 900, 0.75, compressedDataUrl => {
      compressedImages.push(compressedDataUrl);

      const img = document.createElement("img");
      img.src = compressedDataUrl;
      img.className = "image-preview-thumb";

      imagesPreview.appendChild(img);

      processedImages++;

      if (processedImages === images.length) {
        isCompressingImages = false;
        uploadMessage.textContent =
          `${compressedImages.length} image(s) prête(s) pour la publication.`;
      }
    });
  });
});

// =======================
// 🗜 COMPRESSION IMAGE
// =======================

function compressImage(
  file,
  maxWidth,
  quality,
  callback
) {

  const reader =
    new FileReader();

  reader.onload = function (event) {

    const img = new Image();

    img.onload = function () {

      const canvas =
        document.createElement("canvas");

      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {

        height = Math.round(
          (height * maxWidth) / width
        );

        width = maxWidth;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx =
        canvas.getContext("2d");

      ctx.drawImage(
        img,
        0,
        0,
        width,
        height
      );

      callback(
        canvas.toDataURL(
          "image/jpeg",
          quality
        )
      );
    };

    img.src =
      event.target.result;
  };

  reader.readAsDataURL(file);
}

// =======================
// stl preview
// =======================

uploadFile.addEventListener(
  "change",
  () => {

    filesPreview.innerHTML = "";

    const files =
      Array.from(uploadFile.files);

    files.forEach(file => {

      const item =
        document.createElement("div");

      item.className =
        "file-preview-item";

      item.textContent =
        "📦 " + file.name;

      filesPreview.appendChild(item);
    });
  }
);

// =======================
// 🚀 PUBLICATION
// =======================

uploadButton.addEventListener(
  "click",
  () => {

    // Anti double-clic : un clic pendant que la publication est
    // déjà en cours de traitement ne doit pas créer un doublon.
    if (uploadButton.disabled) return;

    const user = requireAuth();
    if (!user) return;

    const title =
      document.getElementById(
        "uploadTitle"
      ).value.trim();

    const description =
      document.getElementById(
        "uploadDescription"
      ).value.trim();

    const files =
      Array.from(uploadFile.files);

    // =======================
    // 🏷 TAGS
    // =======================

    const tagsInput =
      document.getElementById(
        "uploadTags"
      ).value.trim();

    const customTags =
      tagsInput
        .split(",")
        .map(tag => tag.trim())
        .filter(
          tag => tag.length > 0
        );

    // =======================
    // ✈️ TESTÉ EN VOL
    // =======================

    const tested =
      document.getElementById(
        "uploadTested"
      ).value;

    // =======================
    // 📝 NOTES
    // =======================

    const printNotes =
      document.getElementById(
        "uploadPrintNotes"
      ).value.trim();

    // =======================
    // VALIDATION
    // =======================


     if (isCompressingImages) {
      uploadMessage.textContent =
       "Les images sont encore en préparation. Réessaie dans une seconde.";
       return;
     }

     if (!title) {
       uploadMessage.textContent = "Il manque le titre du modèle.";
       return;
      }

     if (!description) {
       uploadMessage.textContent = "Il manque la description du modèle.";
       return;
      }

     if (files.length === 0) {
       uploadMessage.textContent = "Il manque le fichier STL.";
       return;
      }

      const invalidFile =
      files.find(
        file =>
          !file.name
        .toLowerCase()
        .endsWith(".stl")
      );

      if (invalidFile) {
        uploadMessage.textContent =
        "Tous les fichiers doivent être des STL.";
        return;
      }

     if (compressedImages.length === 0) {
       uploadMessage.textContent =
       "Il manque au moins une image du modèle.";
      return;
      }

     if (currentPath.length === 0) {
       uploadMessage.textContent =
       "Il faut choisir un dossier avant de publier.";
      return;
      }

    uploadButton.disabled = true;

    // =======================
    // 💾 MODÈLES EXISTANTS
    // =======================

    const savedModels = getUploadedModels();

    // =======================
    // 🆕 NOUVEAU MODÈLE
    // Note : les tags saisis par l'utilisateur restent seuls
    // dans `tags` (pas de tag "Upload utilisateur"/"STL" ajouté
    // automatiquement — ça polluait l'affichage et le scoring
    // de recherche pour rien, tous les modèles matchant).
    // =======================

    const newModel = {

      id: Date.now(),

      title,

      description,

      path: currentPath,

      tags: customTags,

      images: compressedImages,
      image: compressedImages[0],

      files: files.map(file => ({
        name: file.name
      })),

      fileName: files[0].name,

      tested,

      printNotes:
        printNotes ||
        "Non précisé",

      creator:
        user.username,

      // Le vrai lien de propriété : un uuid Supabase, jamais un
      // pseudo modifiable. `creator` (pseudo) ne sert plus qu'à
      // l'affichage — voir isCreator() dans model.js.
      creatorId:
        user.id,

      requestId:
        linkedRequestId
          ? String(linkedRequestId)
          : null
    };

    savedModels.push(newModel);

    saveUploadedModels(savedModels);

    // =======================
    // 🔒 FERMER DEMANDE
    // =======================

    if (linkedRequestId) {

      const updatedRequests =
        getRequests().map(request => {

          if (
            String(request.id) ===
            String(linkedRequestId)
          ) {

            return {
              ...request,
              status: "closed",
              resolvedByModelId:
                newModel.id
            };
          }

          return request;
        });

      saveRequests(updatedRequests);
    }

    // =======================
    // ✅ MESSAGE
    // =======================

    uploadMessage.textContent =
      "Modèle publié avec succès ✅";

    // =======================
    // 🔄 RESET
    // =======================

    document.getElementById(
      "uploadTitle"
    ).value = "";

    document.getElementById(
      "uploadDescription"
    ).value = "";

    document.getElementById(
      "uploadTags"
    ).value = "";

    document.getElementById(
      "uploadTested"
    ).value = "Non précisé";

    document.getElementById(
      "uploadPrintNotes"
    ).value = "";

    uploadFile.value = "";

    uploadImage.value = "";

    imagesPreview.innerHTML = "";
    compressedImages = [];

    currentPath = [];

    renderFolderPicker();

    // =======================
    // ↩ REDIRECTION
    // =======================

    setTimeout(() => {

      window.location.href =
        "index.html";

    }, 1000);
  }
);

// =======================
// 🚀 INITIALISATION
// =======================

renderFolderPicker();
