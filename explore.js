// =======================================================
// 🧭 explore.js — Explorateur de dossiers
// Les modèles, dossiers et la recherche avancée vivent dans
// data.js (chargé avant ce fichier), maintenant branché sur
// Supabase.
// =======================================================

let models = [];

// =======================
// 📦 ÉLÉMENTS HTML
// =======================

const breadcrumb = document.getElementById("breadcrumb");

const foldersGrid = document.getElementById("foldersGrid");

const modelsGrid = document.getElementById("modelsGrid");

const folderSearchInput = document.getElementById(
  "folderSearchInput"
);

// =======================
// 📁 CHEMIN ACTUEL
// =======================

let currentPath = [];

// =======================
// 📁 SOUS-DOSSIERS
// Inclut les dossiers créés depuis l'upload/les demandes même
// s'ils ne contiennent encore aucun modèle.
// =======================

async function getSubfolders() {
  return getSubfoldersAt(await getAllFolderPaths(), currentPath);
}

// =======================
// 📦 MODÈLES DOSSIER
// =======================

function getModelsInCurrentFolder() {
  return models.filter(model => {
    const path = getModelPath(model);

    if (path.length !== currentPath.length) {
      return false;
    }

    return currentPath.every(
      (folder, index) =>
        path[index] === folder
    );
  });
}

function getModelsInCurrentFolderAndSubfolders() {
  return models.filter(model => {
    const path = getModelPath(model);

    return currentPath.every(
      (folder, index) =>
        path[index] === folder
    );
  });
}

// =======================
// 📁 AFFICHAGE DOSSIERS
// =======================

async function renderFolders() {
  foldersGrid.innerHTML = "";

  const searchValue = normalizeText(
    folderSearchInput.value.trim()
  );

  // =======================
  // 🔍 MODE NORMAL
  // =======================

  if (!searchValue) {

    const folders = await getSubfolders();

    if (folders.length === 0) {
      foldersGrid.innerHTML =
        "<p>Aucun sous-dossier.</p>";
      return;
    }

    folders.forEach(folder => {

      const folderCard =
        document.createElement("div");

      folderCard.className = "folder-card";

      folderCard.innerHTML = `
        <div class="folder-icon">📁</div>

        <div>
          <h3>${escapeHtml(folder)}</h3>
          <p>Ouvrir le dossier</p>
        </div>
      `;

      folderCard.onclick = () => {
        currentPath.push(folder);
        renderExplorer();
      };

      foldersGrid.appendChild(folderCard);

    });

    return;
  }

  // =======================
  // 🔍 RECHERCHE DOSSIERS
  // =======================

  const matchingFolders =
    await getMatchingFoldersInCurrentPath(searchValue);

  if (matchingFolders.length === 0) {
    foldersGrid.innerHTML =
      "<p>Aucun dossier trouvé.</p>";
    return;
  }

  matchingFolders.forEach(folderPath => {

    const folderCard =
      document.createElement("div");

    folderCard.className = "folder-card";

    folderCard.innerHTML = `
      <div class="folder-icon">📁</div>

      <div>
        <h3>
          ${escapeHtml(folderPath[folderPath.length - 1])}
        </h3>

        <p>
          ${escapeHtml(folderPath.join(" / "))}
        </p>
      </div>
    `;

    folderCard.onclick = () => {

      currentPath = folderPath;

      renderExplorer();
    };

    foldersGrid.appendChild(folderCard);

  });
}

// =======================
// 📦 AFFICHAGE MODÈLES
// =======================

function renderModels() {
  modelsGrid.innerHTML = "";

  const searchValue = folderSearchInput.value.toLowerCase().trim();

  let folderModels = searchValue
    ? getModelsInCurrentFolderAndSubfolders()
    : getModelsInCurrentFolder();

  if (searchValue) {
    folderModels = advancedSearch(searchValue, folderModels);
  }

  if (folderModels.length === 0) {
    modelsGrid.innerHTML = "<p>Aucun modèle trouvé dans ce dossier.</p>";
    return;
  }

  folderModels.forEach(model => {
    const card = document.createElement("div");

    card.className = "model-card";

    card.onclick = () => {
      window.location.href = `model.html?id=${model.id}`;
    };

    card.innerHTML = `
      ${
        model.image
          ? `<img class="model-img" src="${model.image}" alt="${escapeHtml(model.title)}">`
          : `<div class="model-image">🛸</div>`
      }

      <div class="model-content">
        <h3>${escapeHtml(model.title)}</h3>

        <p>${escapeHtml(model.description)}</p>

        <p><strong>Créateur :</strong> ${escapeHtml(model.creator || "Utilisateur")}</p>

        <p class="folder-path">
          📁 ${escapeHtml(getModelPath(model).join(" / "))}
        </p>

        <div class="tags">
          ${(model.tags || [])
            .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("")}
        </div>

        <p style="margin-top:12px;">
          👍 ${getLikes(model.id)} likes
        </p>

        <button class="download-btn">
          Voir le modèle
        </button>
      </div>
    `;

    modelsGrid.appendChild(card);
  });
}

// =======================
// 🚀 RENDER GLOBAL
// =======================

async function renderExplorer() {
  folderSearchInput.value = "";

  renderBreadcrumb(breadcrumb, currentPath, newPath => {
    currentPath = newPath;
    renderExplorer();
  });

  await renderFolders();

  renderModels();
}

// =======================
// 🔍 RECHERCHE DOSSIER
// =======================

folderSearchInput.addEventListener("input", async () => {
  await renderFolders();
  renderModels();
});

// =======================
// 🚀 INITIALISATION
// =======================

init();

async function init() {
  await authReady;

  models = await getAllModels();

  await primeModelLikes(models.map(model => model.id));

  await renderExplorer();
}

async function getMatchingFoldersInCurrentPath(searchValue) {
  const folders = new Map();

  models.forEach(model => {
    const path = getModelPath(model);

    const isInsideCurrentPath = currentPath.every(
      (folder, index) => path[index] === folder
    );

    if (!isInsideCurrentPath) return;

    const score = getSearchScore(model, searchValue);

    // Si le modèle correspond à la recherche,
    // on affiche le dossier qui le contient
    if (score > 0 && path.length > currentPath.length) {
      folders.set(path.join("/"), path);
    }

    // Si le nom d’un dossier correspond directement,
    // on l’affiche aussi
    for (let i = currentPath.length; i < path.length; i++) {
      const folderPath = path.slice(0, i + 1);
      const folderName = normalizeText(path[i]);
      const fullFolderPath = normalizeText(folderPath.join(" / "));

      if (
        folderName.includes(searchValue) ||
        fullFolderPath.includes(searchValue)
      ) {
        folders.set(folderPath.join("/"), folderPath);
      }
    }
  });

  // Dossiers créés manuellement (sans modèle dedans pour l'instant)
  // qui correspondent aussi à la recherche.
  const customFolders = await getCustomFolders();

  customFolders.forEach(path => {
    const isInsideCurrentPath = currentPath.every(
      (folder, index) => path[index] === folder
    );

    if (!isInsideCurrentPath) return;

    for (let i = currentPath.length; i < path.length; i++) {
      const folderPath = path.slice(0, i + 1);
      const folderName = normalizeText(path[i]);
      const fullFolderPath = normalizeText(folderPath.join(" / "));

      if (
        folderName.includes(searchValue) ||
        fullFolderPath.includes(searchValue)
      ) {
        folders.set(folderPath.join("/"), folderPath);
      }
    }
  });

  return Array.from(folders.values());
}
