// =======================================================
// 👤 profile.js — Public profile page
// Models live in data.js (loaded before this file), now backed
// by Supabase. Follows/bio/avatar are new — see the corresponding
// sections in data.js.
// =======================================================

const params = new URLSearchParams(window.location.search);
const username = params.get("user");

const grid = document.getElementById("profileModels");

// Set once init() resolves the profile; used by the tab buttons and
// the edit flows below.
let profile = null;
let currentIsOwner = false;
let activeTab = "publications";
let userModels = [];
let savedModels = [];

function displayModels(list) {
  grid.innerHTML = "";

  if (list.length === 0) {
    grid.innerHTML = activeTab === "saved"
      ? "<p>You haven't saved any models yet.</p>"
      : "<p>No models published by this user yet.</p>";
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
        ${cardMetaMarkup(model, { showCreator: activeTab === "saved" })}
      </div>
    `;

    attachSaveButton(card, model.id, () => renderActiveTab());

    grid.appendChild(card);
  });
}

function renderActiveTab() {
  displayModels(activeTab === "saved" ? savedModels : userModels);
}

function setTab(tab) {
  activeTab = tab;
  document.getElementById("tabPublicationsButton").classList.toggle("active", tab === "publications");
  document.getElementById("tabSavedButton").classList.toggle("active", tab === "saved");
  renderActiveTab();
}

// =======================
// 🖼 AVATAR
// Placeholder shown until a real photo is set: the username's
// first letter, same "hand-built, not a stock icon" spirit as the
// rest of the Flight Deck kit.
// =======================

function renderAvatar() {
  const img = document.getElementById("profileAvatar");
  const placeholder = document.getElementById("profileAvatarPlaceholder");

  if (profile.avatarUrl) {
    img.src = profile.avatarUrl;
    img.style.display = "block";
    placeholder.style.display = "none";
  } else {
    img.style.display = "none";
    placeholder.style.display = "flex";
    placeholder.textContent = (profile.username || "?").charAt(0).toUpperCase();
  }
}

function setupAvatarEditing() {
  const editButton = document.getElementById("editAvatarButton");
  const fileInput = document.getElementById("avatarInput");

  editButton.style.display = "flex";
  editButton.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;

    editButton.disabled = true;
    editButton.textContent = "Uploading...";

    compressImageSquare(file, 400, 0.85, async dataUrl => {
      try {
        const { url } = await uploadFileToStorage(dataUrlToBlob(dataUrl), "avatar");
        const updated = await updateMyProfile({ avatarUrl: url });
        profile.avatarUrl = updated.avatarUrl;
        renderAvatar();
      } catch (error) {
        alert(error.message || "Failed to update your photo.");
      }

      editButton.disabled = false;
      editButton.textContent = "Change photo";
      fileInput.value = "";
    });
  });
}

// =======================
// 📝 BIO
// =======================

function setupBioEditing() {
  const bioText = document.getElementById("profileBio");
  const editButton = document.getElementById("editBioButton");
  const editPanel = document.getElementById("profileBioEdit");
  const bioInput = document.getElementById("profileBioInput");
  const bioCount = document.getElementById("profileBioCount");
  const saveButton = document.getElementById("saveBioButton");
  const cancelButton = document.getElementById("cancelBioButton");

  editButton.style.display = "inline-block";

  function openEditor() {
    bioInput.value = profile.bio || "";
    bioCount.textContent = `${bioInput.value.length} / 200`;
    editPanel.style.display = "block";
    editButton.style.display = "none";
    bioText.style.display = "none";
    bioInput.focus();
  }

  function closeEditor() {
    editPanel.style.display = "none";
    editButton.style.display = "inline-block";
    bioText.style.display = "block";
  }

  editButton.addEventListener("click", openEditor);
  cancelButton.addEventListener("click", closeEditor);

  bioInput.addEventListener("input", () => {
    bioCount.textContent = `${bioInput.value.length} / 200`;
  });

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;

    try {
      const updated = await updateMyProfile({ bio: bioInput.value.trim() });
      profile.bio = updated.bio;
      bioText.textContent = profile.bio || "No bio yet.";
      closeEditor();
    } catch (error) {
      alert(error.message || "Failed to update your bio.");
    }

    saveButton.disabled = false;
  });
}

// =======================
// 🧑‍🤝‍🦳 FOLLOW BUTTON
// Only shown when viewing someone ELSE's profile — see init().
// Visible (and clickable, triggering the login redirect via
// requireAuth) even when logged out, same as the card save button.
// =======================

async function setupFollow() {
  const followButton = document.getElementById("followButton");
  followButton.style.display = "inline-flex";

  let following = await isFollowingUser(profile.id);
  updateFollowButton();

  function updateFollowButton() {
    followButton.classList.toggle("following", following);
    followButton.textContent = following ? "Following" : "Follow";
  }

  followButton.addEventListener("click", async () => {
    if (!requireAuth()) return;

    followButton.disabled = true;

    const ok = await toggleFollowUser(profile.id, following);

    if (ok) {
      following = !following;
      updateFollowButton();

      const count = await getFollowerCount(profile.id);
      renderSevenSegment("followerCount", String(count));
    }

    followButton.disabled = false;
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

  if (!username) return;

  await authReady;

  // No profile row doesn't necessarily mean "not found" — models
  // anonymized to "Community" on account deletion have no real
  // account behind them, but still need a working (read-only) page
  // to link to from model.js. Treat a missing row as a minimal
  // display-only profile rather than a hard error.
  profile = await getProfileByUsername(username) || {
    id: null,
    username,
    bio: "",
    avatarUrl: null,
    createdAt: null
  };

  renderAvatar();

  const currentUser = getCurrentUser();
  currentIsOwner = !!(currentUser && profile.id && currentUser.id === profile.id);

  document.getElementById("profileBio").textContent = profile.bio || (
    currentIsOwner
      ? "Add a short bio to introduce yourself."
      : "This pilot hasn't written a bio yet."
  );

  const models = await getAllModels();
  userModels = models.filter(model => model.creator === username);

  await primeFavorites();

  if (currentIsOwner) {
    const savedIds = getSavedModelIds().map(String);
    savedModels = models.filter(model => savedIds.includes(String(model.id)));
  }

  const relevantIds = [...new Set([
    ...userModels.map(model => model.id),
    ...savedModels.map(model => model.id)
  ])];

  await primeModelDownloads(relevantIds);

  const totalDownloads = userModels.reduce(
    (sum, model) => sum + getDownloadCount(model.id),
    0
  );

  renderSevenSegment("profileModelsCount", String(userModels.length));
  renderCompactSevenSegment("profileDownloadsCount", totalDownloads);

  renderActiveTab();

  document.getElementById("tabPublicationsButton").addEventListener("click", () => setTab("publications"));

  if (profile.id) {
    const followerCount = await getFollowerCount(profile.id);
    renderSevenSegment("followerCount", String(followerCount));
  } else {
    document.querySelector(".follower-readout").style.display = "none";
  }

  if (currentIsOwner) {
    setupAccountDeletion();
    setupBioEditing();
    setupAvatarEditing();

    const savedTabButton = document.getElementById("tabSavedButton");
    savedTabButton.style.display = "inline-block";
    savedTabButton.addEventListener("click", () => setTab("saved"));
  } else if (profile.id) {
    setupFollow();
  }
}
