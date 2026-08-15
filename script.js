// =======================================================
// 🏠 script.js — Home page
// Models, likes and advanced search live in data.js (loaded
// before this file), now backed by Supabase.
// =======================================================

let models = [];
let currentDisplayedModels = [];

// =======================
// 📦 HTML ELEMENTS
// =======================

const grid = document.getElementById("modelsGrid");

const searchInput = document.getElementById("searchInput");

// =======================
// 👍 LIKES
// =======================

async function likeModel(id) {
  // Redirects to login.html if no one is logged in — liking
  // requires an account, but browsing/searching doesn't.
  if (!requireAuth()) return;

  await toggleModelLike(id);
  displayModels(currentDisplayedModels);
}

// =======================
// 🔍 REQUEST SUGGESTION
// =======================

async function findClosestRequest(searchValue) {
  if (!searchValue) return null;

  const requests = (await getRequests()).filter(
    request => request.status !== "closed"
  );

  const value = searchValue.toLowerCase();

  return requests.find(request =>
    request.title.toLowerCase().includes(value) ||
    value.includes(request.title.toLowerCase()) ||
    request.description.toLowerCase().includes(value)
  );
}

async function showRequestSuggestion(searchValue, resultsCount) {
  const suggestionBox = document.getElementById("requestSuggestion");

  if (!suggestionBox) return;

  if (!searchValue || resultsCount > 0) {
    suggestionBox.style.display = "none";
    suggestionBox.innerHTML = "";
    return;
  }

  const closestRequest = await findClosestRequest(searchValue);

  if (closestRequest) {
    suggestionBox.style.display = "block";

    suggestionBox.innerHTML = `
      <h2>No model found</h2>

      <p>A similar request already exists:</p>

      <h3>${escapeHtml(closestRequest.title)}</h3>

      <p>${escapeHtml(closestRequest.description)}</p>

      <button onclick="window.location.href='requests.html'">
        View requests
      </button>
    `;
  } else {
    suggestionBox.style.display = "block";

    suggestionBox.innerHTML = `
      <h2>No model found</h2>

      <p>
        You can create a request for this model.
      </p>

      <button onclick="window.location.href='requests.html'">
        Create a request
      </button>
    `;
  }
}

// =======================
// 🎨 MODEL DISPLAY
// =======================

function displayModels(list) {
  currentDisplayedModels = list;

  grid.innerHTML = "";

  if (list.length === 0) {
    grid.innerHTML = "<p>No models yet.</p>";
    return;
  }

  list.forEach(model => {
    const card = document.createElement("div");

    card.className = "model-card";

    card.onclick = () => goToModel(model.id);

    card.innerHTML = `
      ${
        model.image
          ? `
            <img
              class="model-img"
              src="${model.image}"
              alt="${escapeHtml(model.title)}"
            >
          `
          : `
            <div class="model-image">🛸</div>
          `
      }

      <div class="model-content">

        <h3>${escapeHtml(model.title)}</h3>

        <p>${escapeHtml(model.description)}</p>

        <p>
          <strong>Creator:</strong>
          ${escapeHtml(model.creator || "User")}
        </p>

        <p class="folder-path">
          📁 ${escapeHtml(getModelPath(model).join(" / "))}
        </p>

        <div class="tags">
          ${(model.tags || [])
            .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("")}
        </div>

        <div
          style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            margin:14px 0;
          "
        >
          <button class="like-btn"></button>
          <span class="like-count"></span>
        </div>

        <button class="download-btn">
          View model
        </button>

      </div>
    `;

    const likeButton = card.querySelector(".like-btn");

    likeButton.textContent = hasUserLikedModel(model.id)
      ? "❌ Unlike"
      : "👍 Like";

    likeButton.addEventListener("click", event => {
      event.stopPropagation();
      likeModel(model.id);
    });

    card.querySelector(".like-count").textContent =
      `${getLikes(model.id)} likes`;

    grid.appendChild(card);
  });
}

// =======================
// 📄 MODEL PAGE
// =======================

function goToModel(id) {
  window.location.href = `model.html?id=${id}`;
}

// =======================
// 🔍 SEARCH
// =======================

searchInput.addEventListener("input", async () => {
  const value = searchInput.value.trim();

  const results = advancedSearch(value, models);

  displayModels(results);

  await showRequestSuggestion(value, results.length);
});

// =======================
// 🚀 INITIALIZATION
// The first render waits for the login state (fast, local) to
// avoid showing a "logged out" state that immediately flickers to
// the real one afterward — unlike a model page, here the list
// itself comes from Supabase anyway, so there's no "instant"
// display to preserve.
// =======================

init();

async function init() {
  await authReady;

  // Loaded in parallel: the stats query is independent of the
  // models grid, no reason to make one wait on the other.
  const [loadedModels, stats] = await Promise.all([
    getAllModels(),
    getPlatformStats()
  ]);

  models = loadedModels;

  await primeModelLikes(models.map(model => model.id));

  displayModels(models);

  renderStats(stats);
}

function renderStats(stats) {
  document.getElementById("statModelsCount").textContent = stats.modelsCount;
  document.getElementById("statCreatorsCount").textContent = stats.creatorsCount;
  document.getElementById("statDownloadsCount").textContent = stats.downloadsCount;
}
