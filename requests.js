// =======================================================
// 💡 requests.js — Community requests
// Models, folders and requests live in data.js (loaded before
// this file), now backed by Supabase.
// =======================================================

// =======================
// 📦 HTML ELEMENTS
// =======================

const requestTitle = document.getElementById("requestTitle");
const requestDescription = document.getElementById("requestDescription");

const createRequestButton = document.getElementById("createRequestButton");
const requestMessage = document.getElementById("requestMessage");
const requestsGrid = document.getElementById("requestsGrid");

const requestBreadcrumb = document.getElementById("requestBreadcrumb");
const requestFoldersGrid = document.getElementById("requestFoldersGrid");
const selectedRequestPathText = document.getElementById("selectedRequestPathText");

// =======================
// 📁 CURRENT PATH
// =======================

let currentPath = [];

// =======================
// 📦 DATA
// =======================

let requests = [];

// =======================
// 📁 REQUEST FOLDER PICKER
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
      "<p>No subfolders here yet. You can create one.</p>";
    return;
  }

  folders.forEach(folder => {
    const folderCard = document.createElement("div");
    folderCard.className = "folder-card";

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

    requestFoldersGrid.appendChild(folderCard);
  });
}

function renderSelectedPath() {
  selectedRequestPathText.textContent =
    currentPath.length > 0 ? currentPath.join(" / ") : "None";
}

async function renderFolderPicker() {
  renderBreadcrumb(requestBreadcrumb, currentPath, newPath => {
    currentPath = newPath;
    renderFolderPicker();
  });

  await renderRequestFolders();
  renderSelectedPath();
}

// =======================
// 👍 VOTES
// =======================

async function voteRequest(id) {
  if (!requireAuth()) return;

  await toggleRequestVote(id);
  displayRequests();
}

// =======================
// 🎨 REQUEST DISPLAY
// =======================

function displayRequests() {
  requestsGrid.innerHTML = "";

  const openRequests = requests
    .filter(request => request.status !== "closed")
    .sort((a, b) => getRequestVotes(b.id) - getRequestVotes(a.id));

  if (openRequests.length === 0) {
    requestsGrid.innerHTML = "<p>No active requests right now.</p>";
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

        <p><strong>Requested by:</strong> ${escapeHtml(request.creator || "Unknown user")}</p>

        <p class="folder-path">
          📁 ${escapeHtml((request.path || ["Uncategorized"]).join(" / "))}
        </p>

        <div class="tags">
          <span class="tag">Request</span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin:14px 0;">
          <button class="vote-btn"></button>
          <span class="vote-count"></span>
        </div>

        <button class="download-btn" data-request-id="${request.id}">
          Answer this request
        </button>
      </div>
    `;

    const voteButton = card.querySelector(".vote-btn");

    voteButton.textContent = hasUserVotedRequest(request.id)
      ? "❌ Remove vote"
      : "👍 Vote";

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
// ➕ CREATE REQUEST
// =======================

createRequestButton.addEventListener("click", async () => {
  const user = requireAuth();
  if (!user) return;

  const title = requestTitle.value.trim();
  const description = requestDescription.value.trim();

  if (!title || !description || currentPath.length === 0) {
    requestMessage.textContent =
      "Please fill in the title, the description and choose a folder.";
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
      error.message || "Failed to create the request. Please try again.";
    return;
  }

  requests.push(newRequest);

  requestTitle.value = "";
  requestDescription.value = "";
  currentPath = [];

  requestMessage.textContent = "Request created successfully ✅";

  await renderFolderPicker();
  displayRequests();
});

// =======================
// 🚀 INITIALIZATION
// =======================

init();

async function init() {
  await authReady;

  requests = await getRequests();

  await primeRequestVotes(requests.map(request => request.id));

  await renderFolderPicker();
  displayRequests();
}
