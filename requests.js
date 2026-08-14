// =======================================================
// 💡 requests.js — Demandes communautaires
// Les modèles, dossiers et demandes vivent dans data.js (chargé
// avant ce fichier), maintenant branché sur Supabase.
// =======================================================

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

let requests = [];

// =======================
// 📁 FOLDER PICKER DEMANDE
// =======================

async function getSubfolders() {
  return getSubfoldersAt(
    await getAllFolderPaths({ includeRequests: true }),
    currentPath
  );
}

async function renderRequestFolders() {
  requestFoldersGrid.innerHTML = "";

  const folders = await getSubfolders();

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

async function renderFolderPicker() {
  renderBreadcrumb(requestBreadcrumb, currentPath, newPath => {
    currentPath = newPath;
    renderFolderPicker();
  });

  await renderRequestFolders();
  renderSelectedPath();
}

addRequestFolderButton.addEventListener("click", async () => {
  const folderName = newRequestFolderInput.value.trim();

  if (!folderName) return;

  const newPath = [...currentPath, folderName];

  // Idempotent côté données : si le dossier existe déjà, ce n'est
  // pas une erreur (voir createCustomFolder dans data.js).
  try {
    await createCustomFolder(newPath);
  } catch (error) {
    requestMessage.textContent =
      error.message || "Impossible de créer ce dossier. Réessaie.";
    return;
  }

  currentPath = newPath;
  newRequestFolderInput.value = "";

  await renderFolderPicker();
});

// =======================
// 👍 VOTES
// =======================

async function voteRequest(id) {
  if (!requireAuth()) return;

  await toggleRequestVote(id);
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

createRequestButton.addEventListener("click", async () => {
  const user = requireAuth();
  if (!user) return;

  const title = requestTitle.value.trim();
  const description = requestDescription.value.trim();

  if (!title || !description || currentPath.length === 0) {
    requestMessage.textContent =
      "Merci de remplir le titre, la description et de choisir un dossier.";
    return;
  }

  let newRequest;

  try {
    newRequest = await createRequest({
      title,
      description,
      path: currentPath,
      creatorId: user.id,
      creatorUsername: user.username
    });
  } catch (error) {
    requestMessage.textContent =
      error.message || "Échec de la création de la demande. Réessaie.";
    return;
  }

  requests.push(newRequest);

  requestTitle.value = "";
  requestDescription.value = "";
  currentPath = [];

  requestMessage.textContent = "Demande créée avec succès ✅";

  await renderFolderPicker();
  displayRequests();
});

// =======================
// 🚀 INITIALISATION
// =======================

init();

async function init() {
  await authReady;

  requests = await getRequests();

  await primeRequestVotes(requests.map(request => request.id));

  await renderFolderPicker();
  displayRequests();
}
