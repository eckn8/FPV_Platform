// =======================================================
// 📄 model.js — Page détail d'un modèle
// Les modèles, likes, favoris et l'échappement HTML vivent
// dans data.js (chargé avant ce fichier).
// =======================================================

// =======================
// 🔗 ID URL
// =======================

const params = new URLSearchParams(window.location.search);
const id = params.get("id");

const model = findModelById(id);

// =======================
// ❌ MODÈLE INTROUVABLE
// =======================

if (!model) {
  document.body.innerHTML = `
    <main style="padding:40px;">
      <h1>Modèle introuvable</h1>
      <p>Ce modèle n’existe pas ou a été supprimé.</p>
      <button onclick="window.location.href='index.html'">
        Retour à l’accueil
      </button>
    </main>
  `;
} else {
  // Tout le reste de la page ne s'exécute que si le modèle
  // existe réellement — avant ce correctif, le script continuait
  // après le remplacement du body et plantait sur `model.xxx`
  // (ça "marchait" seulement parce que l'exception coupait le
  // script après coup, par accident).
  renderModelPage(model);
}

function renderModelPage(model) {

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
  // 📝 CONTENU PRINCIPAL
  // =======================

  document.getElementById("title").textContent =
    model.title;

  document.getElementById("description").textContent =
    model.description;

  document.getElementById("modelPath").textContent =
    `📁 ${getModelPath(model).join(" / ")}`;

  document.getElementById("tested").textContent =
    model.tested || "Non précisé";

  document.getElementById("printNotes").textContent =
    model.printNotes || "Non précisé";

  document.getElementById("fileName").textContent =
    model.fileName || "Fichier inconnu";

  // =======================
  // ⬇️ TÉLÉCHARGEMENT
  // Pointe vers le premier fichier de la version actuelle (celui
  // affiché juste au-dessus). Les modèles publiés avant le
  // stockage réel (R2) n'ont pas d'URL : le bouton l'explique au
  // clic plutôt que de mener vers une page cassée.
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
        "Ce fichier n'est pas disponible au téléchargement — publié avant la mise en place du stockage réel des fichiers."
      );
    });
  }

  // =======================
  // 🆕 VERSIONS
  // =======================

  renderVersions(model);

  // =======================
  // 👤 CRÉATEUR
  // =======================

  const creatorLink =
    document.getElementById("creator");

  const creatorName =
    model.creator || "Utilisateur inconnu";

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
    .addEventListener("click", () => {

      if (!requireAuth()) return;

      toggleModelLike(model.id);
      updateLikeDisplay();
    });

  updateLikeDisplay();

  // =======================
  // ❤️ FAVORIS
  // =======================

  function updateSaveButton() {
    const saveButton =
      document.getElementById("saveButton");

    saveButton.textContent =
      isModelSaved(model.id)
        ? "❌ Retirer des favoris"
        : "❤️ Sauvegarder";
  }

  document
    .getElementById("saveButton")
    .addEventListener("click", () => {

      if (!requireAuth()) return;

      toggleSavedModel(model.id);
      updateSaveButton();
    });

  updateSaveButton();

  // =======================
  // 🚩 SIGNALEMENT
  // Stockage local pour l'instant (voir data.js) : ça pose la
  // brique UI/données, mais un signalement n'est visible que dans
  // le navigateur de la personne qui l'a fait tant qu'il n'y a pas
  // de backend pour les centraliser. Une seule modale, réutilisée
  // pour le modèle et pour chaque commentaire.
  // =======================

  const reportModal = document.getElementById("reportModal");
  const reportModalTitle = document.getElementById("reportModalTitle");
  const reportReasonsList = document.getElementById("reportReasonsList");
  const reportDetails = document.getElementById("reportDetails");
  const reportModalMessage = document.getElementById("reportModalMessage");

  // Ce que la modale est en train de signaler, rempli à l'ouverture.
  let reportTarget = null;

  // targetType/targetId de la cible en cours + callback à rappeler
  // une fois le signalement envoyé, pour rafraîchir le bon bouton
  // (le bouton du modèle, ou toute la liste des commentaires).
  function openReportModal(targetType, targetId, label, onChange) {
    reportTarget = { targetType, targetId, onChange };

    reportModalTitle.textContent = `Signaler ${label}`;

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

  // Bouton "Signaler" = un vrai toggle, comme Like/Favoris : un
  // second clic sur un contenu déjà signalé propose de l'annuler
  // (avec confirmation, pour éviter un clic accidentel).
  function reportContent(targetType, targetId, label, onChange) {
    if (!requireAuth()) return;

    if (hasUserReported(targetType, targetId)) {
      const confirmCancel = confirm(`Annuler ton signalement pour ${label} ?`);
      if (!confirmCancel) return;

      removeReport(targetType, targetId);

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
    .addEventListener("click", () => {

      if (!reportTarget) return;

      const selectedReasons = Array.from(
        reportReasonsList.querySelectorAll("input[type=checkbox]:checked")
      ).map(checkbox => checkbox.value);

      if (selectedReasons.length === 0) {
        reportModalMessage.textContent = "Sélectionne au moins une raison.";
        return;
      }

      const result = addReport(reportTarget.targetType, reportTarget.targetId, {
        modelId: model.id,
        reasons: selectedReasons,
        details: reportDetails.value.trim()
      });

      if (!result.ok) {
        reportModalMessage.textContent = "Tu as déjà signalé ce contenu.";
        return;
      }

      const onChange = reportTarget.onChange;

      closeReportModal();

      if (onChange) onChange();

      alert("Signalement envoyé. Merci de contribuer à garder la plateforme saine.");
    });

  function updateReportModelButton() {
    const reportModelButton = document.getElementById("reportModelButton");
    const reported = hasUserReported("model", model.id);

    reportModelButton.textContent = reported
      ? "🚩 Signalé (annuler)"
      : "🚩 Signaler";

    reportModelButton.classList.toggle("reported", reported);
  }

  document
    .getElementById("reportModelButton")
    .addEventListener("click", () => {
      reportContent("model", model.id, "ce modèle", updateReportModelButton);
    });

  updateReportModelButton();

  // =======================
  // 🛠 ACTIONS CRÉATEUR
  // =======================

  const creatorActions =
    document.getElementById("creatorActions");

  const archiveButton =
    document.getElementById("archiveButton");

  const addVersionButton =
    document.getElementById("addVersionButton");

  const archivedWarning =
    document.getElementById("archivedWarning");

  // Les modèles publiés depuis l'arrivée de l'auth ont un
  // `creatorId` (uuid Supabase, non falsifiable) : on l'utilise en
  // priorité. Les modèles plus anciens / de démo n'en ont pas —
  // pour eux uniquement, on retombe sur la comparaison de pseudo
  // (ex : les 2 modèles de démo "FPV Print Hub", qu'aucun vrai
  // compte ne peut posséder).
  function isCreator() {
    const user = getCurrentUser();
    if (!user) return false;

    if (model.creatorId) {
      return model.creatorId === user.id;
    }

    return model.creator === user.username;
  }

  function updateArchiveButton() {
    archiveButton.textContent = model.archived
      ? "♻️ Désarchiver ce modèle"
      : "📦 Archiver ce modèle";
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

  archiveButton.addEventListener("click", () => {
    if (!isCreator()) {
      alert("Seul le créateur peut modifier l'archivage de ce modèle.");
      return;
    }

    const newArchivedState = !model.archived;

    const confirmMessage = newArchivedState
      ? "Archiver ce modèle ? Il ne sera plus mis en avant, mais restera consultable."
      : "Désarchiver ce modèle ? Il pourra à nouveau être affiché normalement.";

    const confirmArchive = confirm(confirmMessage);

    if (!confirmArchive) return;

    const updatedModels = getUploadedModels().map(item => {
      if (String(item.id) === String(model.id)) {
        return {
          ...item,
          archived: newArchivedState
        };
      }

      return item;
    });

    saveUploadedModels(updatedModels);

    alert(
      newArchivedState
        ? "Modèle archivé."
        : "Modèle désarchivé."
    );

    window.location.reload();
  });

  // =======================
  // 🆕 FORMULAIRE NOUVELLE VERSION
  // Publier une nouvelle version = nouveaux fichiers STL + un
  // changelog. Modifier juste le titre/la description/les tags ne
  // crée pas de version (voir doc projet, §38).
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
      alert("Seul le créateur peut ajouter une version.");
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
        alert("Seul le créateur peut ajouter une version.");
        return;
      }

      const version = newVersionNumber.value.trim();
      const changelog = newVersionChangelog.value.trim();
      const files = Array.from(newVersionFiles.files);

      if (!version) {
        newVersionMessage.textContent = "Indique un numéro de version.";
        return;
      }

      const alreadyUsed = getModelVersions(model)
        .some(v => v.version === version);

      if (alreadyUsed) {
        newVersionMessage.textContent =
          `La version "${version}" existe déjà pour ce modèle.`;
        return;
      }

      if (!changelog) {
        newVersionMessage.textContent =
          "Décris ce qui a changé (changelog).";
        return;
      }

      if (files.length === 0) {
        newVersionMessage.textContent =
          "Ajoute au moins un fichier STL.";
        return;
      }

      const invalidFile = files.find(
        file => !file.name.toLowerCase().endsWith(".stl")
      );

      if (invalidFile) {
        newVersionMessage.textContent =
          "Tous les fichiers doivent être des STL.";
        return;
      }

      const MAX_STL_BYTES = 50 * 1024 * 1024;

      const oversizedFile = files.find(file => file.size > MAX_STL_BYTES);

      if (oversizedFile) {
        newVersionMessage.textContent =
          `"${oversizedFile.name}" dépasse 50 Mo — fichier trop lourd.`;
        return;
      }

      // Envoi réel vers R2 — si ça échoue, on ne crée pas de
      // version à moitié publiée.
      newVersionMessage.textContent = "Envoi des fichiers...";

      let uploadedFiles;

      try {
        uploadedFiles = await Promise.all(
          files.map(async file => ({
            name: file.name,
            url: await uploadFileToStorage(file, "stl")
          }))
        );
      } catch (error) {
        newVersionMessage.textContent =
          error.message || "Échec de l'envoi des fichiers. Réessaie.";
        return;
      }

      addModelVersion(model.id, {
        version,
        changelog,
        files: uploadedFiles
      });

      newVersionMessage.textContent = "Version publiée ✅";

      window.location.reload();
    });

  updateCreatorActions();

  // =======================
  // 💬 COMMENTAIRES
  // =======================

  const commentsContainer =
    document.getElementById("comments");

  const storageKey =
    `comments_model_${model.id}`;

  let comments = JSON.parse(
    localStorage.getItem(storageKey) || "[]"
  );

  let showAllComments = false;

  // Convertir les anciens commentaires si besoin
  comments = comments.map(comment => {
    if (typeof comment === "string") {
      return {
        id: Date.now() + Math.random(),
        user: "Anonyme",
        text: comment
      };
    }

    if (!comment.id) {
      return {
        ...comment,
        id: Date.now() + Math.random()
      };
    }

    return comment;
  });

  saveComments();

  function saveComments() {
    localStorage.setItem(
      storageKey,
      JSON.stringify(comments)
    );
  }

  function displayComments() {
    commentsContainer.innerHTML = "";

    if (comments.length === 0) {
      commentsContainer.innerHTML =
        "<p>Aucun commentaire pour le moment.</p>";
      return;
    }

    const sortedComments = [...comments].sort((a, b) => {
      return getCommentLikes(model.id, b.id) - getCommentLikes(model.id, a.id);
    });

    const commentsToShow = showAllComments
      ? sortedComments
      : sortedComments.slice(0, 2);

    commentsToShow.forEach(comment => {
      const bubble = document.createElement("div");

      bubble.className = "comment-bubble";

      bubble.innerHTML = `
        <div class="comment-header">
          <strong>${escapeHtml(comment.user || "Anonyme")}</strong>
        </div>

        <p class="comment-text">
          ${escapeHtml(comment.text)}
        </p>

        <div class="comment-actions">
          <button class="comment-like-btn"></button>
          <button class="comment-report-btn"></button>
        </div>
      `;

      const likeButton = bubble.querySelector(".comment-like-btn");

      likeButton.textContent =
        `${hasUserLikedComment(model.id, comment.id) ? "❌ Unlike" : "👍 Like"} · ${getCommentLikes(model.id, comment.id)}`;

      likeButton.addEventListener("click", () => {
        if (!requireAuth()) return;

        toggleCommentLike(model.id, comment.id);
        displayComments();
      });

      const commentReportButton = bubble.querySelector(".comment-report-btn");
      const commentReported = hasUserReported("comment", comment.id);

      commentReportButton.textContent = "🚩";
      commentReportButton.title = commentReported
        ? "Annuler le signalement"
        : "Signaler ce commentaire";
      commentReportButton.classList.toggle("reported", commentReported);

      commentReportButton.addEventListener("click", () => {
        reportContent("comment", comment.id, "ce commentaire", displayComments);
      });

      commentsContainer.appendChild(bubble);
    });

    if (comments.length > 2) {
      const showMoreButton = document.createElement("button");

      showMoreButton.className = "show-more-comments-btn";

      showMoreButton.textContent = showAllComments
        ? "Voir moins"
        : `Voir plus de commentaires (${comments.length - 2})`;

      showMoreButton.onclick = () => {
        showAllComments = !showAllComments;
        displayComments();
      };

      commentsContainer.appendChild(showMoreButton);
    }
  }

  window.addComment = function addComment() {
    const user = requireAuth();
    if (!user) return;

    const input =
      document.getElementById("commentInput");

    if (input.value.trim() === "") return;

    comments.push({
      id: Date.now(),
      user: user.username,
      text: input.value.trim()
    });

    saveComments();

    input.value = "";

    displayComments();
  };

  displayComments();

  // Le rendu ci-dessus part du principe que personne n'est connecté
  // (pour ne jamais retarder l'affichage de la page derrière un
  // appel réseau à Supabase). Dès que l'état réel est connu, on
  // rafraîchit uniquement ce qui en dépend.
  authReady.then(() => {
    updateLikeDisplay();
    updateSaveButton();
    updateCreatorActions();
    displayComments();
  });
}

// =======================
// 🆕 HISTORIQUE DES VERSIONS
// Visible par tout le monde (pas que le créateur) — la plus
// récente en premier.
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

    // Chaque fichier est son propre lien de téléchargement — une
    // version peut contenir plusieurs STL, un seul bouton par
    // version serait ambigu. Les fichiers publiés avant le
    // stockage réel (R2) n'ont pas d'URL : on les affiche quand
    // même, mais non cliquables, plutôt que de les faire
    // disparaître silencieusement.
    const filesHtml = (version.files || [])
      .map(file => {
        if (file.url) {
          return `<a class="version-file-link" href="${escapeHtml(file.url)}">📦 ${escapeHtml(file.name)}</a>`;
        }

        return `<span class="version-file-link version-file-unavailable" title="Publié avant le stockage réel des fichiers — indisponible">📦 ${escapeHtml(file.name)}</span>`;
      })
      .join("");

    entry.innerHTML = `
      <div class="version-entry-header">
        <span class="version-number">${escapeHtml(version.version)}</span>
        <span class="version-date">
          ${version.createdAt
            ? new Date(version.createdAt).toLocaleDateString("fr-FR")
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
// 🖼 GALERIE D'IMAGES
// Construite via le DOM plutôt qu'en injectant les data URLs
// (potentiellement énormes) dans des attributs onclick="".
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
