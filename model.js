// =======================================================
// 📄 model.js — Model detail page
// Models, likes, favorites, comments and reports now live in
// Supabase (see data.js) — this entire file is therefore
// structured around an asynchronous initial load, rather than
// reading data already available in memory.
// =======================================================

const params = new URLSearchParams(window.location.search);
const id = params.get("id");

init();

async function init() {
  // We wait for the login state before loading anything: unlike
  // navigation pages, a model page has nothing to display anyway
  // before querying Supabase (the model itself comes from there),
  // so there's nothing lost by waiting for this first, fast, local
  // call.
  await authReady;

  const model = await findModelById(id);

  if (!model) {
    document.body.innerHTML = `
      <main style="padding:40px;">
        <h1>Model not found</h1>
        <p>This model doesn't exist or has been removed.</p>
        <button onclick="window.location.href='index.html'">
          Back to home
        </button>
      </main>
    `;
    return;
  }

  await renderModelPage(model);
}

async function renderModelPage(model) {

  // =======================
  // 🖼 IMAGE
  // =======================

  const modelImageContainer =
    document.getElementById("modelImageContainer");

  const modelImages =
    model.images && model.images.length > 0
      ? model.images
      : model.image
        ? [model.image]
        : [];

  renderGallery(modelImageContainer, modelImages, model.title);

  // =======================
  // 📝 MAIN CONTENT
  // =======================

  document.getElementById("title").textContent =
    model.title;

  document.getElementById("description").textContent =
    model.description;

  document.getElementById("modelPath").textContent =
    `📁 ${getModelPath(model).join(" / ")}`;

  document.getElementById("tested").textContent =
    model.tested || "Not specified";

  document.getElementById("printNotes").textContent =
    model.printNotes || "Not specified";

  document.getElementById("fileName").textContent =
    model.fileName || "Unknown file";

  // =======================
  // ⬇️ DOWNLOAD
  // Points to the first file of the current version (the one shown
  // just above). Models published before real storage (R2) don't
  // have a URL: the button explains this on click instead of
  // leading to a broken page.
  // =======================

  const downloadMainButton = document.getElementById("downloadMainButton");
  const primaryFile = model.files && model.files[0];

  if (primaryFile && primaryFile.url) {
    downloadMainButton.href = primaryFile.url;
  } else {
    downloadMainButton.href = "#";
    downloadMainButton.addEventListener("click", event => {
      event.preventDefault();
      alert(
        "This file is not available for download — it was published before real file storage was set up."
      );
    });
  }

  // =======================
  // 🆕 VERSIONS
  // =======================

  renderVersions(model);

  // =======================
  // 👤 CREATOR
  // =======================

  const creatorLink =
    document.getElementById("creator");

  const creatorName =
    model.creator || "Unknown user";

  creatorLink.textContent = creatorName;

  creatorLink.href =
    `profile.html?user=${encodeURIComponent(creatorName)}`;

  // =======================
  // 🏷 TAGS
  // =======================

  const tagsContainer =
    document.getElementById("tags");

  tagsContainer.innerHTML = "";

  (model.tags || []).forEach(tag => {
    const span = document.createElement("span");

    span.className = "tag";

    span.textContent = tag;

    tagsContainer.appendChild(span);
  });

  // =======================
  // ☁️ LOADING DEPENDENT DATA
  // Everything below (likes, favorites, comments) needs Supabase
  // to have been queried at least once. We do it in a single wave,
  // in parallel, so the rest of the rendering can stay synchronous
  // (reading from the caches filled by primeModelLikes()/
  // primeFavorites()/primeCommentLikes()).
  // =======================

  // `let` (not const): reassigned on the fly when removing a
  // deleted comment, see further below.
  let [comments] = await Promise.all([
    getModelComments(model.id),
    primeModelLikes([model.id]),
    primeFavorites()
  ]);

  // =======================
  // 👍 LIKES
  // =======================

  function updateLikeDisplay() {
    const likeButton =
      document.getElementById("likeButton");

    document.getElementById("likeCount").textContent =
      `${getLikes(model.id)} likes`;

    likeButton.textContent =
      hasUserLikedModel(model.id)
        ? "❌ Unlike"
        : "👍 Like";
  }

  document
    .getElementById("likeButton")
    .addEventListener("click", async () => {

      if (!requireAuth()) return;

      await toggleModelLike(model.id);
      updateLikeDisplay();
    });

  updateLikeDisplay();

  // =======================
  // ❤️ FAVORITES
  // =======================

  function updateSaveButton() {
    const saveButton =
      document.getElementById("saveButton");

    saveButton.textContent =
      isModelSaved(model.id)
        ? "❌ Remove from favorites"
        : "❤️ Save";
  }

  document
    .getElementById("saveButton")
    .addEventListener("click", async () => {

      if (!requireAuth()) return;

      await toggleSavedModel(model.id);
      updateSaveButton();
    });

  updateSaveButton();

  // =======================
  // 🚩 REPORTING
  // Reports are now centralized in Supabase — everyone can see
  // (and therefore cancel) their own reports from any device.
  // Still no moderator role to act on them, that's the logical
  // next step on the moderation side. A single modal, reused for
  // the model and for each comment.
  // =======================

  const reportModal = document.getElementById("reportModal");
  const reportModalTitle = document.getElementById("reportModalTitle");
  const reportReasonsList = document.getElementById("reportReasonsList");
  const reportDetails = document.getElementById("reportDetails");
  const reportModalMessage = document.getElementById("reportModalMessage");

  // What the modal is currently reporting, filled in when it opens.
  let reportTarget = null;

  function openReportModal(targetType, targetId, label, onChange) {
    reportTarget = { targetType, targetId, onChange };

    reportModalTitle.textContent = `Report ${label}`;

    reportReasonsList
      .querySelectorAll("input[type=checkbox]")
      .forEach(checkbox => { checkbox.checked = false; });

    reportDetails.value = "";
    reportModalMessage.textContent = "";

    reportModal.style.display = "flex";
  }

  function closeReportModal() {
    reportModal.style.display = "none";
    reportTarget = null;
  }

  // "Report" button = a real toggle, like Like/Favorite: a second
  // click on already-reported content offers to cancel it (with a
  // confirmation, to avoid an accidental click).
  async function reportContent(targetType, targetId, label, onChange) {
    if (!requireAuth()) return;

    if (await hasUserReported(targetType, targetId)) {
      const confirmCancel = confirm(`Cancel your report for ${label}?`);
      if (!confirmCancel) return;

      await removeReport(targetType, targetId);

      if (onChange) onChange();
      return;
    }

    openReportModal(targetType, targetId, label, onChange);
  }

  document
    .getElementById("cancelReportButton")
    .addEventListener("click", closeReportModal);

  document
    .getElementById("submitReportButton")
    .addEventListener("click", async () => {

      if (!reportTarget) return;

      const selectedReasons = Array.from(
        reportReasonsList.querySelectorAll("input[type=checkbox]:checked")
      ).map(checkbox => checkbox.value);

      if (selectedReasons.length === 0) {
        reportModalMessage.textContent = "Select at least one reason.";
        return;
      }

      const result = await addReport(reportTarget.targetType, reportTarget.targetId, {
        modelId: model.id,
        reasons: selectedReasons,
        details: reportDetails.value.trim()
      });

      if (!result.ok) {
        reportModalMessage.textContent =
          result.reason === "already-reported"
            ? "You've already reported this content."
            : "Failed to send the report. Please try again.";
        return;
      }

      const onChange = reportTarget.onChange;

      closeReportModal();

      if (onChange) onChange();

      alert("Report sent. Thank you for helping keep the platform healthy.");
    });

  async function updateReportModelButton() {
    const reportModelButton = document.getElementById("reportModelButton");
    const reported = await hasUserReported("model", model.id);

    reportModelButton.textContent = reported
      ? "🚩 Reported (cancel)"
      : "🚩 Report";

    reportModelButton.classList.toggle("reported", reported);
  }

  document
    .getElementById("reportModelButton")
    .addEventListener("click", () => {
      reportContent("model", model.id, "this model", updateReportModelButton);
    });

  await updateReportModelButton();

  // =======================
  // 🛠 CREATOR ACTIONS
  // =======================

  const creatorActions =
    document.getElementById("creatorActions");

  const archiveButton =
    document.getElementById("archiveButton");

  const addVersionButton =
    document.getElementById("addVersionButton");

  const archivedWarning =
    document.getElementById("archivedWarning");

  function isCreator() {
    const user = getCurrentUser();
    if (!user) return false;

    return model.creatorId === user.id;
  }

  function updateArchiveButton() {
    archiveButton.textContent = model.archived
      ? "♻️ Unarchive this model"
      : "📦 Archive this model";
  }

  function updateCreatorActions() {
    archivedWarning.style.display = model.archived
      ? "block"
      : "none";

    creatorActions.style.display = isCreator()
      ? "block"
      : "none";

    updateArchiveButton();
  }

  archiveButton.addEventListener("click", async () => {
    if (!isCreator()) {
      alert("Only the creator can change this model's archive status.");
      return;
    }

    const newArchivedState = !model.archived;

    const confirmMessage = newArchivedState
      ? "Archive this model? It will no longer be featured, but will remain viewable."
      : "Unarchive this model? It will be displayed normally again.";

    const confirmArchive = confirm(confirmMessage);

    if (!confirmArchive) return;

    try {
      await setModelArchived(model.id, newArchivedState);
    } catch (error) {
      alert(error.message || "Update failed. Please try again.");
      return;
    }

    alert(
      newArchivedState
        ? "Model archived."
        : "Model unarchived."
    );

    window.location.reload();
  });

  // =======================
  // 🆕 NEW VERSION FORM
  // Publishing a new version = new STL files + a changelog. Just
  // editing the title/description/tags does not create a version
  // (see project doc, §38).
  // =======================

  const newVersionForm =
    document.getElementById("newVersionForm");

  const newVersionNumber =
    document.getElementById("newVersionNumber");

  const newVersionChangelog =
    document.getElementById("newVersionChangelog");

  const newVersionFiles =
    document.getElementById("newVersionFiles");

  const newVersionFilesPreview =
    document.getElementById("newVersionFilesPreview");

  const newVersionMessage =
    document.getElementById("newVersionMessage");

  addVersionButton.addEventListener("click", () => {
    if (!isCreator()) {
      alert("Only the creator can add a version.");
      return;
    }

    const isOpen = newVersionForm.style.display !== "none";

    if (isOpen) {
      newVersionForm.style.display = "none";
      return;
    }

    newVersionNumber.value = suggestNextVersion(model);
    newVersionChangelog.value = "";
    newVersionFiles.value = "";
    newVersionFilesPreview.innerHTML = "";
    newVersionMessage.textContent = "";
    newVersionForm.style.display = "block";
  });

  document
    .getElementById("cancelVersionButton")
    .addEventListener("click", () => {
      newVersionForm.style.display = "none";
    });

  newVersionFiles.addEventListener("change", () => {
    newVersionFilesPreview.innerHTML = "";

    Array.from(newVersionFiles.files).forEach(file => {
      const item = document.createElement("div");
      item.className = "file-preview-item";
      item.textContent = "📦 " + file.name;
      newVersionFilesPreview.appendChild(item);
    });
  });

  document
    .getElementById("submitVersionButton")
    .addEventListener("click", async () => {

      if (!isCreator()) {
        alert("Only the creator can add a version.");
        return;
      }

      const version = newVersionNumber.value.trim();
      const changelog = newVersionChangelog.value.trim();
      const files = Array.from(newVersionFiles.files);

      if (!version) {
        newVersionMessage.textContent = "Enter a version number.";
        return;
      }

      const alreadyUsed = getModelVersions(model)
        .some(v => v.version === version);

      if (alreadyUsed) {
        newVersionMessage.textContent =
          `Version "${version}" already exists for this model.`;
        return;
      }

      if (!changelog) {
        newVersionMessage.textContent =
          "Describe what changed (changelog).";
        return;
      }

      if (files.length === 0) {
        newVersionMessage.textContent =
          "Add at least one STL file.";
        return;
      }

      const invalidFile = files.find(
        file => !file.name.toLowerCase().endsWith(".stl")
      );

      if (invalidFile) {
        newVersionMessage.textContent =
          "All files must be STL files.";
        return;
      }

      const MAX_STL_BYTES = 50 * 1024 * 1024;

      const oversizedFile = files.find(file => file.size > MAX_STL_BYTES);

      if (oversizedFile) {
        newVersionMessage.textContent =
          `"${oversizedFile.name}" exceeds 50 MB — file too large.`;
        return;
      }

      // Real upload to R2 — if it fails, no half-published version
      // is created. A single file: its name takes the model's
      // title (same logic as the initial publish, see upload.js);
      // several files: original names are kept so they stay
      // distinguishable.
      newVersionMessage.textContent = "Uploading files...";

      const stlFilenameOverride = files.length === 1 ? model.title : undefined;

      let uploadedFiles;

      try {
        uploadedFiles = await Promise.all(
          files.map(file =>
            uploadFileToStorage(file, "stl", stlFilenameOverride)
          )
        );

        await addModelVersion(model.id, {
          version,
          changelog,
          files: uploadedFiles
        });
      } catch (error) {
        newVersionMessage.textContent =
          error.message || "Failed to upload the files. Please try again.";
        return;
      }

      newVersionMessage.textContent = "Version published ✅";

      window.location.reload();
    });

  updateCreatorActions();

  // =======================
  // 💬 COMMENTS
  // `comments` was already loaded above (at the same time as
  // likes/favorites) — their likes are also primed in a single
  // request before the first render.
  // =======================

  const commentsContainer =
    document.getElementById("comments");

  let showAllComments = false;

  await primeCommentLikes(comments.map(comment => comment.id));

  function displayComments() {
    commentsContainer.innerHTML = "";

    if (comments.length === 0) {
      commentsContainer.innerHTML =
        "<p>No comments yet.</p>";
      return;
    }

    const sortedComments = [...comments].sort((a, b) => {
      return getCommentLikes(b.id) - getCommentLikes(a.id);
    });

    const commentsToShow = showAllComments
      ? sortedComments
      : sortedComments.slice(0, 2);

    commentsToShow.forEach(comment => {
      const bubble = document.createElement("div");

      bubble.className = "comment-bubble";

      const currentUser = getCurrentUser();
      const isOwnComment = !!currentUser && comment.userId === currentUser.id;

      bubble.innerHTML = `
        <div class="comment-header">
          <strong>${escapeHtml(comment.user || "Anonymous")}</strong>
        </div>

        <p class="comment-text">
          ${escapeHtml(comment.text)}
        </p>

        <div class="comment-actions">
          <button class="comment-like-btn"></button>
          <button class="comment-report-btn" title="Report this comment">🚩</button>
          ${isOwnComment
            ? '<button class="comment-delete-btn" title="Delete this comment">🗑️</button>'
            : ""}
        </div>
      `;

      const likeButton = bubble.querySelector(".comment-like-btn");

      likeButton.textContent =
        `${hasUserLikedComment(comment.id) ? "❌ Unlike" : "👍 Like"} · ${getCommentLikes(comment.id)}`;

      likeButton.addEventListener("click", async () => {
        if (!requireAuth()) return;

        await toggleCommentLike(comment.id);
        displayComments();
      });

      bubble
        .querySelector(".comment-report-btn")
        .addEventListener("click", () => {
          reportContent("comment", comment.id, "this comment", displayComments);
        });

      if (isOwnComment) {
        bubble
          .querySelector(".comment-delete-btn")
          .addEventListener("click", async () => {
            if (!confirm("Delete this comment?")) return;

            try {
              await deleteComment(comment.id);
            } catch (error) {
              alert(error.message || "Failed to delete. Please try again.");
              return;
            }

            comments = comments.filter(item => item.id !== comment.id);
            displayComments();
          });
      }

      commentsContainer.appendChild(bubble);
    });

    if (comments.length > 2) {
      const showMoreButton = document.createElement("button");

      showMoreButton.className = "show-more-comments-btn";

      showMoreButton.textContent = showAllComments
        ? "Show less"
        : `Show more comments (${comments.length - 2})`;

      showMoreButton.onclick = () => {
        showAllComments = !showAllComments;
        displayComments();
      };

      commentsContainer.appendChild(showMoreButton);
    }
  }

  window.addComment = async function addCommentHandler() {
    const user = requireAuth();
    if (!user) return;

    const input =
      document.getElementById("commentInput");

    if (input.value.trim() === "") return;

    let newComment;

    try {
      newComment = await createComment(model.id, input.value.trim());
    } catch (error) {
      alert(error.message || "Failed to post the comment. Please try again.");
      return;
    }

    comments.push(newComment);

    input.value = "";

    displayComments();
  };

  displayComments();
}

// =======================
// 🆕 VERSION HISTORY
// Visible to everyone (not just the creator) — most recent first.
// =======================

function renderVersions(model) {
  document.getElementById("currentVersionLabel").textContent =
    getCurrentVersionLabel(model);

  const container = document.getElementById("versionHistory");
  container.innerHTML = "";

  const versions = [...getModelVersions(model)].reverse();

  versions.forEach(version => {
    const entry = document.createElement("div");
    entry.className = "version-entry";

    // Each file is its own download link — a version can contain
    // several STL files, a single button per version would be
    // ambiguous. Files published before real storage (R2) have no
    // URL: they're still shown, but not clickable, rather than
    // silently disappearing.
    const filesHtml = (version.files || [])
      .map(file => {
        if (file.url) {
          return `<a class="version-file-link" href="${escapeHtml(file.url)}">📦 ${escapeHtml(file.name)}</a>`;
        }

        return `<span class="version-file-link version-file-unavailable" title="Published before real file storage — unavailable">📦 ${escapeHtml(file.name)}</span>`;
      })
      .join("");

    entry.innerHTML = `
      <div class="version-entry-header">
        <span class="version-number">${escapeHtml(version.version)}</span>
        <span class="version-date">
          ${version.createdAt
            ? new Date(version.createdAt).toLocaleDateString("en-US")
            : ""}
        </span>
      </div>

      <p class="version-changelog">${escapeHtml(version.changelog || "")}</p>

      ${filesHtml
        ? `<p class="version-files">${filesHtml}</p>`
        : ""}
    `;

    container.appendChild(entry);
  });
}

// =======================
// 🖼 IMAGE GALLERY
// Built via the DOM rather than injecting data URLs (potentially
// huge) into onclick="" attributes.
// =======================

function renderGallery(container, images, title) {
  container.innerHTML = "";

  if (images.length === 0) {
    container.innerHTML = `
      <div class="model-detail-placeholder">
        🛸
      </div>
    `;
    return;
  }

  const mainImage = document.createElement("img");
  mainImage.className = "model-detail-image";
  mainImage.src = images[0];
  mainImage.alt = title;
  container.appendChild(mainImage);

  {
    const thumbnails = document.createElement("div");
    thumbnails.className = "model-thumbnails";

    images.forEach((image, index) => {
      const thumb = document.createElement("img");
      thumb.className = `model-thumbnail ${index === 0 ? "active-thumbnail" : ""}`;
      thumb.src = image;

      thumb.addEventListener("click", () => {
        mainImage.src = image;

        thumbnails
          .querySelectorAll(".model-thumbnail")
          .forEach(el => el.classList.remove("active-thumbnail"));

        thumb.classList.add("active-thumbnail");
      });

      thumbnails.appendChild(thumb);
    });

    container.appendChild(thumbnails);
  }
}
