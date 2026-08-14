// =======================================================
// 💡 requests.js — Demandes communautaires
// Les modèles, dossiers et demandes vivent dans data.js
// (chargé avant ce fichier).
// =======================================================

// =======================
// 👤 UTILISATEUR
// =======================

const currentUsername = getCurrentUsername();

// =======================
// 📦 ÉLÉMENTS HTML
// =======================

const requestTitle = document.getElementById("requestTitle");
const requestDescription = document.getElementById("requestDescription");

const createRequestButton = document.getElementById("createRequestButton");
const requestMessage = document.getElementById("requestMessage");
const requestsGrid = document.getElementById("requestsGrid");

const requestBreadcrumb = document.getElementById("requestBreadcrumb");
const requestFoldersGrid = document.getElementById("requestFoldersGrid");
const selectedRequestPathText = document.getElementById("selectedRequestPathText");

const newRequestFolderInput = document.getElementById("newRequestFolderInput");
const addRequestFolderButton = document.getElementById("addRequestFolderButton");

// =======================
// 📁 CHEMIN ACTUEL
// =======================

let currentPath = [];

// =======================
// 📦 DONNÉES
// =======================

let requests = getRequests();

// =======================
// 📁 FOLDER PICKER DEMANDE
// =======================

function getSubfolders() {
  return getSubfoldersAt(
    getAllFolderPaths({ includeRequests: true }),
    currentPath
  );
}

function renderRequestFolders() {
  requestFoldersGrid.innerHTML = "";

  const folders = getSubfolders();

  if (folders.length === 0) {
    requestFoldersGrid.innerHTML =
      "<p>Aucun sous-dossier ici. Tu peux en créer un.</p>";
    return;
  }

  folders.forEach(folder => {
    const folderCard = document.createElement("div");
    folderCard.className = "folder-card";

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

    requestFoldersGrid.appendChild(folderCard);
  });
}

function renderSelectedPath() {
  selectedRequestPathText.textContent =
    currentPath.length > 0 ? currentPath.join(" / ") : "Aucun";
}

function renderFolderPicker() {
  renderBreadcrumb(requestBreadcrumb, currentPath, newPath => {
    currentPath = newPath;
    renderFolderPicker();
  });

  renderRequestFolders();
  renderSelectedPath();
}

addRequestFolderButton.addEventListener("click", () => {
  const folderName = newRequestFolderInput.value.trim();

  if (!folderName) return;

  const newPath = [...currentPath, folderName];

  const folders = getCustomFolders();

  const alreadyExists = folders.some(path =>
    JSON.stringify(path) === JSON.stringify(newPath)
  );

  if (!alreadyExists) {
    folders.push(newPath);
    saveCustomFolders(folders);
  }

  currentPath = newPath;
  newRequestFolderInput.value = "";

  renderFolderPicker();
});

// =======================
// 👍 VOTES
// =======================

function voteRequest(id) {
  if (!requireAuth()) return;

  toggleRequestVote(id);
  displayRequests();
}

// =======================
// 🎨 AFFICHAGE DES DEMANDES
// =======================

function displayRequests() {
  requestsGrid.innerHTML = "";

  const openRequests = requests
    .filter(request => request.status !== "closed")
    .sort((a, b) => getRequestVotes(b.id) - getRequestVotes(a.id));

  if (openRequests.length === 0) {
    requestsGrid.innerHTML = "<p>Aucune demande active pour le moment.</p>";
    return;
  }

  openRequests.forEach(request => {
    const card = document.createElement("div");
    card.className = "model-card";

    card.innerHTML = `
      <div class="model-image">💡</div>

      <div class="model-content">
        <h3>${escapeHtml(request.title)}</h3>

        <p>${escapeHtml(request.description)}</p>

        <p><strong>Demandé par :</strong> ${escapeHtml(request.creator || "Utilisateur inconnu")}</p>

        <p class="folder-path">
          📁 ${escapeHtml((request.path || ["Non classé"]).join(" / "))}
        </p>

        <div class="tags">
          <span class="tag">Demande</span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin:14px 0;">
          <button class="vote-btn"></button>
          <span class="vote-count"></span>
        </div>

        <button class="download-btn" data-request-id="${request.id}">
          Répondre à cette demande
        </button>
      </div>
    `;

    const voteButton = card.querySelector(".vote-btn");

    voteButton.textContent = hasUserVotedRequest(request.id)
      ? "❌ Retirer vote"
      : "👍 Voter";

    voteButton.addEventListener("click", event => {
      event.stopPropagation();
      voteRequest(request.id);
    });

    card.querySelector(".vote-count").textContent =
      `${getRequestVotes(request.id)} votes`;

    card.querySelector(".download-btn").addEventListener("click", () => {
      window.location.href = `upload.html?requestId=${request.id}`;
    });

    requestsGrid.appendChild(card);
  });
}

// =======================
// ➕ CRÉATION DEMANDE
// =======================

createRequestButton.addEventListener("click", () => {
  const user = requireAuth();
  if (!user) return;

  const title = requestTitle.value.trim();
  const description = requestDescription.value.trim();

  if (!title || !description || currentPath.length === 0) {
    requestMessage.textContent =
      "Merci de remplir le titre, la description et de choisir un dossier.";
    return;
  }

  const newRequest = {
    id: Date.now(),
    title,
    description,
    path: currentPath,
    creator: user.username,
    creatorId: user.id,
    status: "open",
    createdAt: new Date().toISOString()
  };

  requests.push(newRequest);
  saveRequests(requests);

  requestTitle.value = "";
  requestDescription.value = "";
  currentPath = [];

  requestMessage.textContent = "Demande créée avec succès ✅";

  renderFolderPicker();
  displayRequests();
});

// =======================
// 🚀 INITIALISATION
// =======================

renderFolderPicker();
displayRequests();

// Rafraîchit les boutons de vote une fois l'état de connexion connu
// (le premier rendu ci-dessus suppose "pas connecté" pour ne jamais
// retarder l'affichage de la page derrière un appel à Supabase).
authReady.then(() => displayRequests());
