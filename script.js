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

// Fills the grid out with Cults3D picks (see externalModels/init())
// only when the native catalog is still small, interleaved at a
// regular interval rather than dumped at the end — genuinely
// "mixed in," not just appended. Caps at MAX_EXTERNAL regardless of
// how sparse the native catalog is, so the grid is never ALL
// external. Returns { model, external }[] either way.
const HOME_GRID_TARGET_SIZE = 12;
const MAX_EXTERNAL_CARDS = 8;

function mixInExternalModels(nativeList) {
  const entries = nativeList.map(model => ({ model, external: false }));

  const externalCount = Math.min(
    MAX_EXTERNAL_CARDS,
    Math.max(0, HOME_GRID_TARGET_SIZE - nativeList.length),
    externalModels.length
  );

  if (externalCount === 0) return entries;

  const chosen = externalModels.slice(0, externalCount);
  const interval = Math.max(1, Math.round((entries.length + 1) / (chosen.length + 1)));

  const merged = [];
  let chosenIndex = 0;

  entries.forEach((entry, i) => {
    merged.push(entry);

    if ((i + 1) % interval === 0 && chosenIndex < chosen.length) {
      merged.push({ model: chosen[chosenIndex], external: true });
      chosenIndex++;
    }
  });

  while (chosenIndex < chosen.length) {
    merged.push({ model: chosen[chosenIndex], external: true });
    chosenIndex++;
  }

  return merged;
}

// Same meta-row look as cardMetaMarkup() (data.js), but pulling the
// creator/download numbers straight off the Cults3D result itself
// instead of FPVBase's own primed caches, which obviously don't
// know anything about a design that was never uploaded here.
function externalCardMetaMarkup(model) {
  const { digits, suffix } = formatCompactValue(model.downloads);

  return `
    <div class="card-meta">
      <span class="card-creator">${escapeHtml(model.creator)}</span>
      <span class="card-downloads" title="${model.downloads} downloads on Cults3D">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 3v12m0 0l-5-5m5 5l5-5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M4 20h16" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
        </svg>
        ${digits}${suffix}
      </span>
    </div>
  `;
}

// mixExternal: only the default (unsearched) home view mixes in
// Cults3D picks — search results stay native-only, since "search"
// reads as "search FPVBase's own catalog," not the wider web.
function displayModels(list, { mixExternal = false } = {}) {
  currentDisplayedModels = list;

  grid.innerHTML = "";

  const sorted = sortModels(list);
  const entries = mixExternal ? mixInExternalModels(sorted) : sorted.map(model => ({ model, external: false }));

  if (entries.length === 0) {
    grid.innerHTML = "<p>No models yet.</p>";
    return;
  }

  entries.forEach(({ model, external }) => {
    if (external) {
      const card = document.createElement("a");

      card.className = "model-card external";
      card.href = model.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";

      card.innerHTML = `
        <span class="external-badge">via Cults3D</span>
        ${
          model.image
            ? `<img class="model-img" src="${model.image}" alt="${escapeHtml(model.title)}">`
            : `<div class="model-image">${droneIconMarkup()}</div>`
        }
        <div class="model-content">
          <h3>${escapeHtml(model.title)}</h3>
          ${externalCardMetaMarkup(model)}
        </div>
      `;

      grid.appendChild(card);
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
    primeFavorites()
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
