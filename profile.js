// =======================================================
// 👤 profile.js — Page profil public
// Les modèles vivent dans data.js (chargé avant ce fichier).
// Avant ce correctif, cette page utilisait sa propre copie de
// `defaultModels` (4 entrées, ancien schéma `category`) au lieu
// de celle de model.js/explore.js (2 entrées, schéma `path`) :
// les cartes id 2 et 3 s'affichaient ici mais menaient à un
// "Modèle introuvable" en cliquant, puisque model.js ne les
// connaissait pas. getAllModels() élimine cette divergence.
// =======================================================

const params = new URLSearchParams(window.location.search);
const username = params.get("user");

const models = getAllModels();

document.getElementById("profileName").textContent = username || "Utilisateur inconnu";

const userModels = models.filter(model => model.creator === username);

document.getElementById("profileInfo").textContent =
  `${userModels.length} modèle(s) publié(s)`;

const grid = document.getElementById("profileModels");

function displayModels(list) {
  grid.innerHTML = "";

  if (list.length === 0) {
    grid.innerHTML = "<p>Aucun modèle publié pour cet utilisateur.</p>";
    return;
  }

  list.forEach(model => {
    const card = document.createElement("div");
    card.className = "model-card";
    card.onclick = () => {
      window.location.href = `model.html?id=${model.id}`;
    };

    card.innerHTML = `
      <div class="model-image">🛸</div>
      <div class="model-content">
        <h3>${escapeHtml(model.title)}</h3>
        <p>${escapeHtml(model.description)}</p>
        <div class="tags">
          ${(model.tags || [])
            .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("")}
        </div>
      </div>
    `;

    grid.appendChild(card);
  });
}

displayModels(userModels);
