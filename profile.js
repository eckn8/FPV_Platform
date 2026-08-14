// =======================================================
// 👤 profile.js — Page profil public
// Les modèles vivent dans data.js (chargé avant ce fichier),
// maintenant branché sur Supabase.
// =======================================================

const params = new URLSearchParams(window.location.search);
const username = params.get("user");

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

init();

async function init() {
  document.getElementById("profileName").textContent = username || "Utilisateur inconnu";

  const models = await getAllModels();

  const userModels = models.filter(model => model.creator === username);

  document.getElementById("profileInfo").textContent =
    `${userModels.length} modèle(s) publié(s)`;

  displayModels(userModels);
}
