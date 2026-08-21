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
const popularModelsHeader = document.getElementById("popularModelsHeader");

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

  const sorted = sortModels(list);

  if (sorted.length === 0) {
    grid.innerHTML = "<p>No models yet.</p>";
    return;
  }

  sorted.forEach(model => {
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

        <h3><a href="model.html?id=${model.id}">${escapeHtml(model.title)}</a></h3>

        <p class="folder-path">
          📁 ${escapeHtml(getModelPath(model).join(" / "))}
        </p>

        ${cardMetaMarkup(model)}

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
// ▲ SORT CONTROLS (Trending / Most Downloaded / Recent)
// "Trending" blends recency + download count into one score, each
// normalized to 0-1 first so neither dominates just because of its
// raw scale (a handful of downloads vs. milliseconds of age). Most
// Downloaded/Recent sort on a single signal, always highest-first —
// no direction toggle. Applied inside displayModels() itself, so
// it composes automatically with an active search — no need to
// re-sort by hand after every render.
// =======================

let currentSort = "all"; // "all" | "popular" | "recent"

const sortButtons = {
  all: document.getElementById("sortAllButton"),
  popular: document.getElementById("sortPopularButton"),
  recent: document.getElementById("sortRecentButton")
};

const sortLabels = { all: "Trending", popular: "Most Downloaded", recent: "Recent" };

function updateSortButtons() {
  Object.entries(sortButtons).forEach(([key, button]) => {
    button.classList.toggle("active", key === currentSort);
    button.textContent = sortLabels[key];
  });
}

function setSort(sort) {
  currentSort = sort;
  updateSortButtons();
  displayModels(currentDisplayedModels);
}

sortButtons.all.addEventListener("click", () => setSort("all"));
sortButtons.popular.addEventListener("click", () => setSort("popular"));
sortButtons.recent.addEventListener("click", () => setSort("recent"));

function sortModels(list) {
  if (list.length === 0) return list;

  if (currentSort === "popular") {
    return [...list].sort(
      (a, b) => getDownloadCount(b.id) - getDownloadCount(a.id)
    );
  }

  if (currentSort === "recent") {
    return [...list].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
  }

  // "all" (Trending) — a simple blended score, not a full "hotness"
  // curve with time decay: this catalog is small enough that a
  // plain sum of two normalized signals is plenty.
  const maxDownloads = Math.max(1, ...list.map(model => getDownloadCount(model.id)));

  const times = list.map(model => new Date(model.createdAt).getTime());
  const oldest = Math.min(...times);
  const span = Math.max(1, Math.max(...times) - oldest);

  function score(model) {
    const popularity = getDownloadCount(model.id) / maxDownloads;
    const recency = (new Date(model.createdAt).getTime() - oldest) / span;
    return popularity + recency;
  }

  return [...list].sort((a, b) => score(b) - score(a));
}

// =======================
// 🔍 SEARCH
// Below the header's mobile breakpoint (1000px), the "Popular
// models" header (title/subtitle/sort buttons) hides itself the
// moment you start typing in the search bar — screen space is
// tighter there, and search results matter more than the sort
// controls while you're actively typing. It reappears once you stop
// typing for a beat, NOT tied to clearing the box — every keystroke
// restarts the idle timer, so it only comes back once you actually
// pause.
// =======================

const POPULAR_HEADER_IDLE_DELAY = 2000; // ms of no typing before it reappears
let popularHeaderIdleTimer = null;

function hidePopularModelsHeaderWhileTyping() {
  if (!popularModelsHeader) return;

  clearTimeout(popularHeaderIdleTimer);

  if (window.matchMedia("(max-width: 1000px)").matches) {
    popularModelsHeader.style.display = "none";
  }

  popularHeaderIdleTimer = setTimeout(() => {
    popularModelsHeader.style.display = "";
  }, POPULAR_HEADER_IDLE_DELAY);
}

// Widening past the breakpoint mid-search should reveal it right
// away, not wait out the idle timer.
window.addEventListener("resize", () => {
  if (!popularModelsHeader) return;

  if (!window.matchMedia("(max-width: 1000px)").matches) {
    clearTimeout(popularHeaderIdleTimer);
    popularModelsHeader.style.display = "";
  }
});

searchInput.addEventListener("input", async () => {
  const value = searchInput.value.trim();

  const results = advancedSearch(value, models);

  displayModels(results);
  hidePopularModelsHeaderWhileTyping();

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
    primeModelDownloads(models.map(model => model.id)),
    primeFavorites()
  ]);

  updateSortButtons();
  displayModels(models);

  renderStats(stats);
}

function renderStats(stats) {
  renderCompactSevenSegment("statModelsCount", stats.modelsCount);
  renderCompactSevenSegment("statCreatorsCount", stats.creatorsCount);
  renderCompactSevenSegment("statDownloadsCount", stats.downloadsCount);
}
