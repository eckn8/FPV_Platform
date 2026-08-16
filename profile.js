// =======================================================
// 👤 profile.js — Public profile page
// Models live in data.js (loaded before this file), now backed
// by Supabase.
// =======================================================

const params = new URLSearchParams(window.location.search);
const username = params.get("user");

const grid = document.getElementById("profileModels");

function displayModels(list) {
  grid.innerHTML = "";

  if (list.length === 0) {
    grid.innerHTML = "<p>No models published by this user yet.</p>";
    return;
  }

  list.forEach(model => {
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

// =======================
// 🗑 ACCOUNT DELETION
// Only shown/wired when viewing your own profile — see init().
// =======================

function setupAccountDeletion() {
  const section = document.getElementById("accountDeletionSection");
  const deleteAccountButton = document.getElementById("deleteAccountButton");
  const panel = document.getElementById("deleteAccountPanel");
  const confirmButton = document.getElementById("confirmDeleteAccountButton");
  const cancelButton = document.getElementById("cancelDeleteAccountButton");
  const message = document.getElementById("deleteAccountMessage");

  section.style.display = "block";

  deleteAccountButton.addEventListener("click", () => {
    message.textContent = "";
    panel.style.display = panel.style.display === "none" ? "block" : "none";
  });

  cancelButton.addEventListener("click", () => {
    panel.style.display = "none";
  });

  confirmButton.addEventListener("click", async () => {
    const contentChoice = document.querySelector(
      'input[name="deleteContentChoice"]:checked'
    ).value;

    const confirmMessage = contentChoice === "delete"
      ? "This will permanently delete your account AND everything you've published. This cannot be undone. Continue?"
      : "This will permanently delete your account. This cannot be undone. Continue?";

    if (!confirm(confirmMessage)) return;

    confirmButton.disabled = true;
    message.textContent = "Deleting your account...";

    try {
      await deleteMyAccount(contentChoice);
    } catch (error) {
      message.textContent = error.message || "Failed to delete your account. Please try again.";
      confirmButton.disabled = false;
      return;
    }

    await signOut();

    window.location.href = "index.html";
  });
}

init();

async function init() {
  document.getElementById("profileName").textContent = username || "Unknown user";

  const models = await getAllModels();

  const userModels = models.filter(model => model.creator === username);

  document.getElementById("profileInfo").textContent =
    `${userModels.length} model(s) published`;

  displayModels(userModels);

  await authReady;

  const currentUser = getCurrentUser();

  if (currentUser && currentUser.username === username) {
    setupAccountDeletion();
  }
}
