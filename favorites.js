// =======================================================
// ❤️ favorites.js — My favorites
// Models and favorites live in data.js, now backed by Supabase.
// Seeing favorites requires an account, so all rendering waits
// for authReady (unlike navigation pages, which must never wait
// on Supabase).
// =======================================================

const grid = document.getElementById("favoritesGrid");

async function displayFavorites() {
  grid.innerHTML = "";

  if (!getCurrentUser()) {
    grid.innerHTML = `
      <p>
        Log in to find your saved models.
        <a href="login.html?redirect=favorites.html">Log in</a>
      </p>
    `;
    return;
  }

  grid.innerHTML = "<p>Loading...</p>";

  const [allModels] = await Promise.all([
    getAllModels(),
    primeFavorites()
  ]);

  const userSavedIds = getSavedModelIds();

  const favoriteModels = allModels.filter(model =>
    userSavedIds.includes(String(model.id))
  );

  grid.innerHTML = "";

  if (favoriteModels.length === 0) {
    grid.innerHTML = "<p>You haven't saved any models yet.</p>";
    return;
  }

  favoriteModels.forEach(model => {
    const card = document.createElement("div");
    card.className = "model-card";
    card.onclick = () => {
      window.location.href = `model.html?id=${model.id}`;
    };

    card.innerHTML = `
      ${
        model.image
          ? `<img class="model-img" src="${model.image}" alt="${escapeHtml(model.title)}">`
          : `<div class="model-image">${droneIconMarkup()}</div>`
      }
      <div class="model-content">
        <h3>${escapeHtml(model.title)}</h3>
        <p>${escapeHtml(model.description)}</p>
        <p><strong>Creator:</strong> ${escapeHtml(model.creator || "Unknown user")}</p>

        <div class="tags">
          ${(model.tags || [])
            .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
            .join("")}
        </div>

        <button class="download-btn">View model</button>
      </div>
    `;

    grid.appendChild(card);
  });
}

// We wait to know the login state before displaying anything:
// unlike other pages, there's nothing relevant to show here until
// we know who's logged in.
grid.innerHTML = "<p>Loading...</p>";
authReady.then(displayFavorites);
