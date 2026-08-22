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
    primeFavorites(),
    primeExternalFavorites()
  ]);

  const savedExternalModels = await getSavedExternalModels();

  const userSavedIds = getSavedModelIds();

  const favoriteModels = allModels.filter(model =>
    userSavedIds.includes(String(model.id))
  );

  await primeModelDownloads(favoriteModels.map(model => model.id));

  grid.innerHTML = "";

  if (favoriteModels.length === 0 && savedExternalModels.length === 0) {
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
        <h3><a href="model.html?id=${model.id}">${escapeHtml(model.title)}</a></h3>

        ${cardMetaMarkup(model)}
      </div>
    `;

    // Un-saving from this page removes the card immediately — the
    // list is exactly "what's saved," so there's nothing else to
    // show it as.
    attachSaveButton(card, model.id, displayFavorites);

    grid.appendChild(card);
  });

  // Saved Cults3D picks — same "un-saving removes it immediately"
  // behavior as native cards above.
  savedExternalModels.forEach(model => {
    grid.appendChild(createExternalModelCard(model, displayFavorites));
  });
}

// We wait to know the login state before displaying anything:
// unlike other pages, there's nothing relevant to show here until
// we know who's logged in.
grid.innerHTML = "<p>Loading...</p>";
authReady.then(displayFavorites);
