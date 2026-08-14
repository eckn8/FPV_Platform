// =======================================================
// 🏠 script.js — Page d'accueil
// Les modèles, likes et la recherche avancée vivent dans data.js
// (chargé avant ce fichier), maintenant branché sur Supabase.
// =======================================================

let models = [];
let currentDisplayedModels = [];

// =======================
// 📦 ÉLÉMENTS HTML
// =======================

const grid = document.getElementById("modelsGrid");

const searchInput = document.getElementById("searchInput");

// =======================
// 👍 LIKES
// =======================

async function likeModel(id) {
  // Redirige vers login.html si personne n'est connecté — liker
  // nécessite un compte, mais parcourir/rechercher n'en a pas besoin.
  if (!requireAuth()) return;

  await toggleModelLike(id);
  displayModels(currentDisplayedModels);
}

// =======================
// 🔍 SUGGESTION DE DEMANDE
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
      <h2>Aucun modèle trouvé</h2>

      <p>Une demande proche existe :</p>

      <h3>${escapeHtml(closestRequest.title)}</h3>

      <p>${escapeHtml(closestRequest.description)}</p>

      <button onclick="window.location.href='requests.html'">
        Voir les demandes
      </button>
    `;
  } else {
    suggestionBox.style.display = "block";

    suggestionBox.innerHTML = `
      <h2>Aucun modèle trouvé</h2>

      <p>
        Tu peux créer une demande pour ce modèle.
      </p>

      <button onclick="window.location.href='requests.html'">
        Créer une demande
      </button>
    `;
  }
}

// =======================
// 🎨 AFFICHAGE MODÈLES
// =======================

function displayModels(list) {
  currentDisplayedModels = list;

  grid.innerHTML = "";

  if (list.length === 0) {
    grid.innerHTML = "<p>Aucun modèle pour l’instant.</p>";
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
          <strong>Créateur :</strong>
          ${escapeHtml(model.creator || "Utilisateur")}
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
          Voir le modèle
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
// 📄 PAGE MODÈLE
// =======================

function goToModel(id) {
  window.location.href = `model.html?id=${id}`;
}

// =======================
// 🔍 RECHERCHE
// =======================

searchInput.addEventListener("input", async () => {
  const value = searchInput.value.trim();

  const results = advancedSearch(value, models);

  displayModels(results);

  await showRequestSuggestion(value, results.length);
});

// =======================
// 🚀 INITIALISATION
// Le premier rendu attend l'état de connexion (rapide, local) pour
// ne pas afficher un état "pas connecté" qui clignote immédiatement
// après vers l'état réel — contrairement à une page modèle, ici la
// liste elle-même vient de toute façon de Supabase, donc il n'y a
// aucun affichage "instantané" possible à préserver.
// =======================

init();

async function init() {
  await authReady;

  models = await getAllModels();

  await primeModelLikes(models.map(model => model.id));

  displayModels(models);
}
