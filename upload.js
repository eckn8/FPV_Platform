// =======================================================
// 📤 upload.js — Publish a model
// Models, folders and requests live in Supabase (see data.js) —
// this page waits for the login state then loads everything it
// needs asynchronously before rendering.
// =======================================================

// =======================
// 🔗 URL PARAMETERS
// =======================

const params = new URLSearchParams(window.location.search);

const linkedRequestId = params.get("requestId");

// =======================
// 📦 HTML ELEMENTS
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

const currentFolderContainer =
  document.getElementById(
    "currentFolderContainer"
  );

const filesPreview =
  document.getElementById("filesPreview");

// =======================
// 🖼 COMPRESSED IMAGES
// =======================

let compressedImages = [];
let isCompressingImages = false;

// =======================
// 📁 CURRENT FOLDER
// =======================

let currentPath = [];

// =======================
// 📁 FOLDERS
// =======================

async function getSubfolders() {
  return getSubfoldersAt(await getAllFolderPaths(), currentPath);
}

// =======================
// 📁 FOLDER DISPLAY
// =======================

async function renderUploadFolders() {

  uploadFoldersGrid.innerHTML = "";

  currentFolderContainer.innerHTML = "";

  // =======================
  // 📁 CURRENT FOLDER
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
        <p>Selected folder</p>
      </div>
    `;

    currentFolderContainer.appendChild(
      currentFolderCard
    );
  }

  // =======================
  // 📁 SUBFOLDERS
  // =======================

  const folders = await getSubfolders();

  if (folders.length === 0) {

    if (currentPath.length === 0) {

      uploadFoldersGrid.innerHTML =
        "<p>No folder available.</p>";
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
        <p>Choose this folder</p>
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
// 🚀 GLOBAL RENDER
// =======================

async function renderFolderPicker() {

  renderBreadcrumb(uploadBreadcrumb, currentPath, newPath => {
    currentPath = newPath;
    renderFolderPicker();
  });

  await renderUploadFolders();
}

// =======================
// 📸 IMAGE PREVIEW
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
      alert("All files must be images.");
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
          `${compressedImages.length} image(s) ready to publish.`;
      }
    });
  });
});

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
        file.name;

      filesPreview.appendChild(item);
    });
  }
);

// =======================
// 🚀 PUBLISHING
// =======================

uploadButton.addEventListener(
  "click",
  async () => {

    // Anti double-click: a click while the publish is already in
    // progress must not create a duplicate.
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
    // ✈️ FLIGHT TESTED
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
       "Images are still being prepared. Try again in a second.";
       return;
     }

     if (!title) {
       uploadMessage.textContent = "The model title is missing.";
       return;
      }

     if (!description) {
       uploadMessage.textContent = "The model description is missing.";
       return;
      }

     if (files.length === 0) {
       uploadMessage.textContent = "The STL file is missing.";
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
        "All files must be STL files.";
        return;
      }

      const MAX_STL_BYTES = 50 * 1024 * 1024;

      const oversizedFile = files.find(
        file => file.size > MAX_STL_BYTES
      );

      if (oversizedFile) {
        uploadMessage.textContent =
        `"${oversizedFile.name}" exceeds 50 MB — file too large.`;
        return;
      }

     if (compressedImages.length === 0) {
       uploadMessage.textContent =
       "At least one image of the model is required.";
      return;
      }

     if (currentPath.length === 0) {
       uploadMessage.textContent =
       "Choose a folder before publishing.";
      return;
      }

    uploadButton.disabled = true;

    // =======================
    // ☁️ SENDING FILES TO R2
    // Images are already compressed (see compressImage()) but
    // still local base64 at this point — we convert them to real
    // files to send them. If an upload fails (network issue,
    // rejected file...), the model is NOT saved: no half-published
    // model.
    // =======================

    uploadMessage.textContent = "Uploading files...";

    let uploadedImageUrls;
    let uploadedFiles;

    // A single STL file: its name (at upload and download time)
    // takes the model's title instead of the name picked on the
    // computer — more readable for whoever downloads it. With
    // several files, original names are kept: they each describe a
    // different part ("Camera_mount.stl", "GPS_mount.stl"...),
    // replacing them all with the same title would make them
    // indistinguishable.
    const stlFilenameOverride = files.length === 1 ? title : undefined;

    try {
      uploadedImageUrls = (await Promise.all(
        compressedImages.map(dataUrl =>
          uploadFileToStorage(dataUrlToBlob(dataUrl), "image")
        )
      )).map(result => result.url);

      uploadedFiles = await Promise.all(
        files.map(file =>
          uploadFileToStorage(file, "stl", stlFilenameOverride)
        )
      );
    } catch (error) {
      uploadMessage.textContent =
        error.message || "Failed to upload the files. Please try again.";
      uploadButton.disabled = false;
      return;
    }

    // =======================
    // 🆕 CREATE IN THE DATABASE
    // Note: user-entered tags stay on their own in `tags` (no
    // automatic "User upload"/"STL" tag added — it used to pollute
    // the display and search scoring for nothing, since every
    // model would match).
    // =======================

    let newModel;

    try {
      newModel = await createModel({
        title,
        description,
        path: currentPath,
        tags: customTags,
        tested,
        printNotes: printNotes || "Not specified",
        creatorId: user.id,
        creatorUsername: user.username,
        requestId: linkedRequestId || null,
        images: uploadedImageUrls,
        files: uploadedFiles
      });
    } catch (error) {
      uploadMessage.textContent =
        error.message || "Failed to publish. Please try again.";
      uploadButton.disabled = false;
      return;
    }

    // =======================
    // 🔒 CLOSE REQUEST
    // =======================

    if (linkedRequestId) {
      await resolveRequest(linkedRequestId, newModel.id);
    }

    // =======================
    // ✅ MESSAGE
    // =======================

    uploadMessage.textContent =
      "Model published successfully.";

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
    ).value = "Not specified";

    document.getElementById(
      "uploadPrintNotes"
    ).value = "";

    uploadFile.value = "";

    uploadImage.value = "";

    imagesPreview.innerHTML = "";
    compressedImages = [];

    currentPath = [];

    await renderFolderPicker();

    // =======================
    // ↩ REDIRECT
    // =======================

    setTimeout(() => {

      window.location.href =
        "index.html";

    }, 1000);
  }
);

// =======================
// 🚀 INITIALIZATION
// Publishing has no reason to be used without an account (unlike
// browsing/downloading) — redirect right away if no one is logged
// in, before loading anything else.
// =======================

init();

async function init() {
  await authReady;

  const user = getCurrentUser();

  if (!user) {
    window.location.href =
      "login.html?redirect=" + encodeURIComponent("upload.html" + window.location.search);
    return;
  }

  // Real enforcement is the "models" insert RLS policy (see
  // supabase_user_restrictions.sql) — this is just clearer
  // messaging than letting them fill out the whole form and hit a
  // raw policy error on submit.
  if (user.isRestricted) {
    document.querySelector(".upload-section").innerHTML = `
      <p>
        Your account is currently restricted from publishing
        ${user.restrictedUntil ? `until ${user.restrictedUntil.toLocaleString("en-US")}` : ""}.
      </p>
    `;
    return;
  }

  if (linkedRequestId && linkedRequestInfo) {
    const requests = await getRequests();

    const linkedRequest = requests.find(
      request => String(request.id) === String(linkedRequestId)
    );

    if (linkedRequest) {
      linkedRequestInfo.textContent =
        `This model answers the request: ${linkedRequest.title}`;
    }
  }

  await renderFolderPicker();
}
