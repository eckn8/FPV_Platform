// =======================================================
// 🏠 script.js — Page d'accueil
// Les modèles par défaut, l'accès localStorage, les likes et
// la recherche avancée vivent maintenant dans data.js (chargé
// avant ce fichier) pour éviter que les copies divergent.
// =======================================================

const models = getAllModels();

// =======================
// 📦 ÉLÉMENTS HTML
// =======================

const grid = document.getElementById("modelsGrid");

const searchInput = document.getElementById("searchInput");

// =======================
// 👍 LIKES
// =======================

function likeModel(id) {
  // Redirige vers login.html si personne n'est connecté — liker
  // nécessite un compte, mais parcourir/rechercher n'en a pas besoin.
  if (!requireAuth()) return;

  toggleModelLike(id);
  displayModels(currentDisplayedModels);
}

// =======================
// 🔍 SUGGESTION DE DEMANDE
// =======================

function findClosestRequest(searchValue) {
  const requests = getRequests().filter(
    request => request.status !== "closed"
  );

  if (!searchValue) return null;

  const value = searchValue.toLowerCase();

  return requests.find(request =>
    request.title.toLowerCase().includes(value) ||
    value.includes(request.title.toLowerCase()) ||
    request.description.toLowerCase().includes(value)
  );
}

function showRequestSuggestion(searchValue, resultsCount) {
  const suggestionBox = document.getElementById("requestSuggestion");

  if (!suggestionBox) return;

  if (!searchValue || resultsCount > 0) {
    suggestionBox.style.display = "none";
    suggestionBox.innerHTML = "";
    return;
  }

  const closestRequest = findClosestRequest(searchValue);

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

let currentDisplayedModels = models;

function displayModels(list) {
  currentDisplayedModels = list;

  grid.innerHTML = "";

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

searchInput.addEventListener("input", () => {
  const value = searchInput.value.trim();

  const results = advancedSearch(value, models);

  displayModels(results);

  showRequestSuggestion(value, results.length);
});

// =======================
// 🚀 INITIALISATION
// =======================

displayModels(models);

// Le premier rendu ci-dessus part du principe que personne n'est
// connecté (pour ne jamais retarder l'affichage de la page derrière
// un appel réseau à Supabase). Dès que l'état réel est connu, on
// rafraîchit juste les boutons like / compteurs concernés.
authReady.then(() => displayModels(currentDisplayedModels));
