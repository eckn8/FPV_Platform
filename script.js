// =======================================================
// 🏠 script.js — Home page
// Models, saves and advanced search live in data.js (loaded
// before this file), now backed by Supabase.
// =======================================================

let models = [];
let currentDisplayedModels = [];
let externalModels = [];

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

// mixExternal: only the default (unsearched) home view mixes in
// Cults3D picks — search results stay native-only, since "search"
// reads as "search FPVBase's own catalog," not the wider web. Native
// and external entries are merged into ONE list before sorting (see
// sortEntries() below) rather than sorted separately and interleaved
// afterward — that older approach placed external cards at a fixed
// position regardless of the chosen sort, so "Most Downloaded" could
// show a 900-download Cults3D pick near the bottom. Sorting the
// merged list means every card, native or external, competes on the
// same real numbers.
function displayModels(list, { mixExternal = false } = {}) {
  currentDisplayedModels = list;

  grid.innerHTML = "";

  const merged = [
    ...list.map(model => ({ model, external: false })),
    ...(mixExternal ? externalModels.map(model => ({ model, external: true })) : [])
  ];

  const entries = sortEntries(merged);

  if (entries.length === 0) {
    grid.innerHTML = "<p>No models yet.</p>";
    return;
  }

  entries.forEach(({ model, external }) => {
    if (external) {
      grid.appendChild(
        createExternalModelCard(model, () => displayModels(currentDisplayedModels, { mixExternal }))
      );
      return;
    }

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

    attachSaveButton(card, model.id, () => displayModels(currentDisplayedModels, { mixExternal }));

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
  displayModels(currentDisplayedModels, { mixExternal: !searchActive });
}

sortButtons.all.addEventListener("click", () => setSort("all"));
sortButtons.popular.addEventListener("click", () => setSort("popular"));
sortButtons.recent.addEventListener("click", () => setSort("recent"));

// A native model's download count lives in the primed cache
// (getDownloadCount); an external one already carries its own
// Cults3D download count directly on the object — no priming needed
// for that half.
function entryDownloadCount(entry) {
  return entry.external ? (entry.model.downloads || 0) : getDownloadCount(entry.model.id);
}

// Native models always have createdAt; external ones only do if
// Cults3D's publishedAt came through (see worker.js) — null when
// unknown, handled below rather than sorting on an "Invalid Date".
function entryCreatedAtMs(entry) {
  return entry.model.createdAt ? new Date(entry.model.createdAt).getTime() : null;
}

function sortEntries(entries) {
  if (entries.length === 0) return entries;

  if (currentSort === "popular") {
    return [...entries].sort(
      (a, b) => entryDownloadCount(b) - entryDownloadCount(a)
    );
  }

  if (currentSort === "recent") {
    // Unknown dates sort last rather than crashing the comparison.
    return [...entries].sort(
      (a, b) => (entryCreatedAtMs(b) ?? -Infinity) - (entryCreatedAtMs(a) ?? -Infinity)
    );
  }

  // "all" (Trending) — a simple blended score, not a full "hotness"
  // curve with time decay: this catalog is small enough that a
  // plain sum of two normalized signals is plenty.
  const maxDownloads = Math.max(1, ...entries.map(entryDownloadCount));

  const knownTimes = entries.map(entryCreatedAtMs).filter(ms => ms !== null);
  const oldest = knownTimes.length > 0 ? Math.min(...knownTimes) : 0;
  const span = Math.max(1, (knownTimes.length > 0 ? Math.max(...knownTimes) : 0) - oldest);

  function score(entry) {
    const popularity = entryDownloadCount(entry) / maxDownloads;
    const createdAtMs = entryCreatedAtMs(entry);
    // No known date (external item Cults3D didn't give a
    // publishedAt for): treated as recency-neutral rather than
    // dropped to the bottom purely for a missing field.
    const recency = createdAtMs === null ? 0.5 : (createdAtMs - oldest) / span;
    return popularity + recency;
  }

  return [...entries].sort((a, b) => score(b) - score(a));
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

// Tracked so setSort() (further up) knows whether to keep mixing in
// Cults3D picks — "search" means "search FPVBase's own catalog,"
// external cards have no business showing up in search results.
let searchActive = false;

searchInput.addEventListener("input", async () => {
  const value = searchInput.value.trim();
  searchActive = value.length > 0;

  const results = advancedSearch(value, models);

  displayModels(results, { mixExternal: !searchActive });
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

// Cults3D picks for the home page only (see mixInExternalModels
// above) — a slow or unavailable external API must never block or
// break the page, so any failure here just means no external cards
// this load, same as before this feature existed.
async function fetchExternalModels() {
  try {
    const response = await fetch("/api/external-models");
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

async function init() {
  await authReady;

  // Loaded in parallel: the stats query and the external-models
  // fetch are both independent of the native models grid, no
  // reason to make any of them wait on each other.
  const [loadedModels, stats, loadedExternalModels] = await Promise.all([
    getAllModels(),
    getPlatformStats(),
    fetchExternalModels()
  ]);

  models = loadedModels;
  externalModels = loadedExternalModels;

  await Promise.all([
    primeModelDownloads(models.map(model => model.id)),
    primeFavorites(),
    primeExternalFavorites()
  ]);

  updateSortButtons();
  displayModels(models, { mixExternal: true });

  renderStats(stats);
}

function renderStats(stats) {
  renderCompactSevenSegment("statModelsCount", stats.modelsCount);
  renderCompactSevenSegment("statCreatorsCount", stats.creatorsCount);
  renderCompactSevenSegment("statDownloadsCount", stats.downloadsCount);
}
