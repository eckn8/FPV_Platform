// =======================================================
// 🏠 script.js — Home page
// Models, saves and advanced search live in data.js (loaded
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
            <div class="model-image">${droneIconMarkup()}</div>
          `
      }

      <div class="model-content">

        <h3>${escapeHtml(model.title)}</h3>

        <p class="folder-path">
          📁 ${escapeHtml(getModelPath(model).join(" / "))}
        </p>

        <button class="download-btn">
          View model
        </button>

      </div>
    `;

    attachSaveButton(card, model.id, () => displayModels(currentDisplayedModels));

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
// ▲ SORT BY POPULARITY
// Wired to the "Most popular" button (index.html). Save counts
// must already be primed (see init()) — sorts whatever is
// currently displayed, so it composes with an active search.
// =======================

function sortByPopularity() {
  const sorted = [...currentDisplayedModels].sort(
    (a, b) => getSaveCount(b.id) - getSaveCount(a.id)
  );

  displayModels(sorted);
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

  await Promise.all([
    primeModelSaves(models.map(model => model.id)),
    primeFavorites()
  ]);

  displayModels(models);

  renderStats(stats);
}

function renderStats(stats) {
  renderCompactSevenSegment("statModelsCount", stats.modelsCount);
  renderCompactSevenSegment("statCreatorsCount", stats.creatorsCount);
  renderCompactSevenSegment("statDownloadsCount", stats.downloadsCount);
}
