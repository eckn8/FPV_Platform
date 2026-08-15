// =======================================================
// 🧭 explore.js — Folder explorer
// Models, folders and advanced search live in data.js (loaded
// before this file), now backed by Supabase.
// =======================================================

let models = [];

// =======================
// 📦 HTML ELEMENTS
// =======================

const breadcrumb = document.getElementById("breadcrumb");

const foldersGrid = document.getElementById("foldersGrid");

const modelsGrid = document.getElementById("modelsGrid");

const folderSearchInput = document.getElementById(
  "folderSearchInput"
);

// =======================
// 📁 CURRENT PATH
// =======================

let currentPath = [];

// =======================
// 📁 SUBFOLDERS
// Includes folders created from upload/requests even if they don't
// contain any model yet.
// =======================

async function getSubfolders() {
  return getSubfoldersAt(await getAllFolderPaths(), currentPath);
}

// =======================
// 📦 MODELS IN FOLDER
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
// 📁 FOLDER DISPLAY
// =======================

async function renderFolders() {
  foldersGrid.innerHTML = "";

  const searchValue = normalizeText(
    folderSearchInput.value.trim()
  );

  // =======================
  // 🔍 NORMAL MODE
  // =======================

  if (!searchValue) {

    const folders = await getSubfolders();

    if (folders.length === 0) {
      foldersGrid.innerHTML =
        "<p>No subfolders.</p>";
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
          <p>Open folder</p>
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
  // 🔍 FOLDER SEARCH
  // =======================

  const matchingFolders =
    await getMatchingFoldersInCurrentPath(searchValue);

  if (matchingFolders.length === 0) {
    foldersGrid.innerHTML =
      "<p>No folder found.</p>";
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
// 📦 MODEL DISPLAY
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
    modelsGrid.innerHTML = "<p>No models found in this folder.</p>";
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

        <p><strong>Creator:</strong> ${escapeHtml(model.creator || "User")}</p>

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
          View model
        </button>
      </div>
    `;

    modelsGrid.appendChild(card);
  });
}

// =======================
// 🚀 GLOBAL RENDER
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
// 🔍 FOLDER SEARCH
// =======================

folderSearchInput.addEventListener("input", async () => {
  await renderFolders();
  renderModels();
});

// =======================
// 🚀 INITIALIZATION
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

    // If the model matches the search, show the folder that
    // contains it
    if (score > 0 && path.length > currentPath.length) {
      folders.set(path.join("/"), path);
    }

    // If a folder's own name matches directly, show it too
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

  // Manually created folders (with no model inside yet) that also
  // match the search.
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
