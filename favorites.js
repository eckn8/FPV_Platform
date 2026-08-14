// =======================================================
// ❤️ favorites.js — Mes favoris
// Les modèles et favoris vivent dans data.js, l'identité dans
// auth.js (chargés avant ce fichier). Voir favoris = il faut un
// compte, donc tout le rendu attend authReady (contrairement aux
// pages de navigation, qui ne doivent jamais attendre Supabase).
// =======================================================

const allModels = getAllModels();

const grid = document.getElementById("favoritesGrid");

function displayFavorites() {
  grid.innerHTML = "";

  if (!getCurrentUser()) {
    grid.innerHTML = `
      <p>
        Connecte-toi pour retrouver tes modèles sauvegardés.
        <a href="login.html?redirect=favorites.html">Se connecter</a>
      </p>
    `;
    return;
  }

  const userSavedIds = getSavedModelIds();

  const favoriteModels = allModels.filter(model =>
    userSavedIds.includes(String(model.id))
  );

  if (favoriteModels.length === 0) {
    grid.innerHTML = "<p>Tu n’as encore aucun modèle sauvegardé.</p>";
    return;
  }

  favoriteModels.forEach(model => {
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
        <p><strong>Créateur :</strong> ${escapeHtml(model.creator || "Utilisateur inconnu")}</p>

        <div class="tags">
          <span class="tag">${escapeHtml(model.subcategory || "Général")}</span>
          ${(model.tags || [])
            .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("")}
        </div>

        <button class="download-btn">Voir le modèle</button>
      </div>
    `;

    grid.appendChild(card);
  });
}

// On attend de connaître l'état de connexion avant d'afficher quoi
// que ce soit : contrairement aux autres pages, il n'y a rien de
// pertinent à montrer ici tant qu'on ne sait pas qui est connecté.
grid.innerHTML = "<p>Chargement...</p>";
authReady.then(displayFavorites);
