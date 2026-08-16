// =======================================================
// 🛡️ moderation.js — Report moderation
// Only really reachable by moderators — enforced by RLS (see
// supabase_moderation.sql). This page just redirects everyone else
// away so they don't land on a confusing empty screen; it's not
// where the actual protection lives.
// =======================================================

const reportsContainer = document.getElementById("reportsContainer");
const restrictedUsersContainer = document.getElementById("restrictedUsersContainer");
const bannedWordsContainer = document.getElementById("bannedWordsContainer");
const newBannedWordInput = document.getElementById("newBannedWordInput");
const addBannedWordButton = document.getElementById("addBannedWordButton");
const bannedWordsMessage = document.getElementById("bannedWordsMessage");
const allowedPhrasesContainer = document.getElementById("allowedPhrasesContainer");
const newAllowedPhraseInput = document.getElementById("newAllowedPhraseInput");
const addAllowedPhraseButton = document.getElementById("addAllowedPhraseButton");
const allowedPhrasesMessage = document.getElementById("allowedPhrasesMessage");

// =======================
// 🔀 TABS
// Restricted users (and now banned words) used to live below the
// reports list — with many pending reports, finding them meant a
// lot of scrolling. Same tab pattern as login.html.
// =======================

const tabReportsButton = document.getElementById("tabReportsButton");
const tabRestrictedButton = document.getElementById("tabRestrictedButton");
const tabBannedWordsButton = document.getElementById("tabBannedWordsButton");
const reportsPanel = document.getElementById("reportsPanel");
const restrictedPanel = document.getElementById("restrictedPanel");
const bannedWordsPanel = document.getElementById("bannedWordsPanel");

function showTab(activeButton, activePanel) {
  [reportsPanel, restrictedPanel, bannedWordsPanel].forEach(panel => {
    panel.style.display = panel === activePanel ? "block" : "none";
  });

  [tabReportsButton, tabRestrictedButton, tabBannedWordsButton].forEach(button => {
    button.classList.toggle("active", button === activeButton);
  });
}

tabReportsButton.addEventListener("click", () => showTab(tabReportsButton, reportsPanel));
tabRestrictedButton.addEventListener("click", () => showTab(tabRestrictedButton, restrictedPanel));
tabBannedWordsButton.addEventListener("click", () => showTab(tabBannedWordsButton, bannedWordsPanel));

// The link carries the report along (modReportId/modType/
// modCommentId) so model.js can show a small floating panel with
// the same Dismiss/Remove actions right there, instead of forcing
// a trip back to this page just to act on it.
function formatReportedContent(report) {
  if (report.targetType === "model") {
    return {
      label: report.modelTitle || "Unknown model",
      detail: report.modelPath ? report.modelPath.join(" / ") : "",
      link: `model.html?id=${report.targetId}&modReportId=${report.id}&modType=model`
    };
  }

  return {
    label: "Comment",
    detail: report.commentText || "(comment no longer exists)",
    link: report.modelId
      ? `model.html?id=${report.modelId}&modReportId=${report.id}&modType=comment&modCommentId=${report.targetId}`
      : null
  };
}

// Publishing/commenting only — see supabase_user_restrictions.sql
// for why a real account ban isn't implemented (it would need the
// service_role key, deliberately never used in this project).
function formatUserRestrictionBox(report) {
  if (!report.authorId) return "";

  const isTemporarilyRestricted =
    report.authorRestrictedUntil && new Date(report.authorRestrictedUntil) > new Date();

  if (report.authorBanned) {
    return `
      <div class="user-restriction-box">
        <p>🚫 This user is permanently banned from publishing/commenting.</p>
        <button type="button" class="lift-restriction-btn">Lift ban</button>
      </div>
    `;
  }

  if (isTemporarilyRestricted) {
    return `
      <div class="user-restriction-box">
        <p>⏳ Restricted from publishing/commenting until ${new Date(report.authorRestrictedUntil).toLocaleString("en-US")}.</p>
        <button type="button" class="lift-restriction-btn">Lift restriction</button>
      </div>
    `;
  }

  return `
    <div class="user-restriction-box">
      <select class="restrict-duration-select">
        <option value="1">1 day</option>
        <option value="3">3 days</option>
        <option value="7">7 days</option>
        <option value="30">30 days</option>
      </select>
      <button type="button" class="restrict-user-btn">Restrict</button>
      <button type="button" class="ban-user-btn">Ban permanently</button>
    </div>
  `;
}

// A snapshot of what led to the restriction — stored on the profile
// (see restrictUser()/banUser() in data.js) so it's still readable
// later in the "Restricted / banned users" section, after this
// report itself has been dismissed or acted on and is gone from
// the queue above.
function buildRestrictionReason(report) {
  const content = formatReportedContent(report);
  const kind = report.targetType === "model" ? "Model" : "Comment";

  return `${kind}: "${content.label}" — ${report.reasons.join(", ")}` +
    (report.details ? ` (${report.details})` : "");
}

function wireUserRestrictionBox(card, report) {
  if (!report.authorId) return;

  const restrictButton = card.querySelector(".restrict-user-btn");

  if (restrictButton) {
    restrictButton.addEventListener("click", async () => {
      const days = parseInt(card.querySelector(".restrict-duration-select").value, 10);

      if (!confirm(`Restrict ${report.authorUsername} from publishing/commenting for ${days} day(s)?`)) {
        return;
      }

      try {
        await restrictUser(report.authorId, days, buildRestrictionReason(report));
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await refreshModerationView();
    });
  }

  const banButton = card.querySelector(".ban-user-btn");

  if (banButton) {
    banButton.addEventListener("click", async () => {
      if (!confirm(`Permanently restrict ${report.authorUsername} from publishing/commenting? This can be lifted later.`)) {
        return;
      }

      try {
        await banUser(report.authorId, buildRestrictionReason(report));
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await refreshModerationView();
    });
  }

  const liftButton = card.querySelector(".lift-restriction-btn");

  if (liftButton) {
    liftButton.addEventListener("click", async () => {
      try {
        await liftUserRestriction(report.authorId);
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await refreshModerationView();
    });
  }
}

function renderReports(reports) {
  reportsContainer.innerHTML = "";

  if (reports.length === 0) {
    reportsContainer.innerHTML = "<p>No pending reports. 🎉</p>";
    return;
  }

  reports.forEach(report => {
    const content = formatReportedContent(report);

    const card = document.createElement("div");
    card.className = "report-card";

    card.innerHTML = `
      <div class="report-card-header">
        <span class="tag">${report.targetType === "model" ? "📦 Model" : "💬 Comment"}</span>
        <span class="report-date">${new Date(report.createdAt).toLocaleDateString("en-US")}</span>
      </div>

      <h3>
        ${content.link
          ? `<a href="${content.link}">${escapeHtml(content.label)}</a>`
          : escapeHtml(content.label)}
      </h3>

      ${content.detail ? `<p class="folder-path">${escapeHtml(content.detail)}</p>` : ""}

      <div class="tags">
        ${report.reasons.map(reason => `<span class="tag">${escapeHtml(reason)}</span>`).join("")}
      </div>

      ${report.details ? `<p>${escapeHtml(report.details)}</p>` : ""}

      <p class="folder-path">
        Posted by:
        ${report.authorUsername
          ? `<a href="profile.html?user=${encodeURIComponent(report.authorUsername)}">${escapeHtml(report.authorUsername)}</a>`
          : "Unknown user"}
      </p>

      <p class="folder-path">Reported by: ${escapeHtml(report.reporterUsername)}</p>

      ${formatUserRestrictionBox(report)}

      <div class="form-actions">
        <button type="button" class="dismiss-btn">Dismiss</button>
        <button type="button" class="remove-content-btn">Remove content</button>
      </div>
    `;

    wireUserRestrictionBox(card, report);

    card.querySelector(".dismiss-btn").addEventListener("click", async () => {
      await dismissReport(report.id);
      await loadAndRenderReports();
    });

    card.querySelector(".remove-content-btn").addEventListener("click", async () => {
      const confirmMessage = report.targetType === "model"
        ? "Remove this model? It will be hidden from the site."
        : "Delete this comment? This cannot be undone.";

      if (!confirm(confirmMessage)) return;

      try {
        if (report.targetType === "model") {
          await removeReportedModel(report.targetId);
        } else {
          await removeReportedComment(report.targetId);
        }
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await loadAndRenderReports();
    });

    reportsContainer.appendChild(card);
  });
}

async function loadAndRenderReports() {
  reportsContainer.innerHTML = "<p>Loading...</p>";
  const reports = await getAllReports();
  renderReports(reports);
  tabReportsButton.textContent = `📋 Reports (${reports.length})`;
}

function formatTimeRemaining(restrictedUntil) {
  const diffMs = new Date(restrictedUntil) - new Date();

  if (diffMs <= 0) return "expiring shortly";

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

  if (days > 0) return `${days}d ${hours}h remaining`;

  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return hours > 0 ? `${hours}h ${minutes}m remaining` : `${minutes}m remaining`;
}

function renderRestrictedUsers(users) {
  restrictedUsersContainer.innerHTML = "";

  if (users.length === 0) {
    restrictedUsersContainer.innerHTML = "<p>No restricted or banned users right now.</p>";
    return;
  }

  users.forEach(user => {
    const card = document.createElement("div");
    card.className = "report-card";

    card.innerHTML = `
      <h3>
        <a href="profile.html?user=${encodeURIComponent(user.username)}">${escapeHtml(user.username)}</a>
      </h3>

      <p class="folder-path">
        ${user.is_banned
          ? "🚫 Permanently banned from publishing/commenting"
          : `⏳ Restricted from publishing/commenting — ${formatTimeRemaining(user.restricted_until)} (until ${new Date(user.restricted_until).toLocaleString("en-US")})`}
      </p>

      ${user.restriction_reason ? `<p>${escapeHtml(user.restriction_reason)}</p>` : ""}

      <div class="form-actions">
        <button type="button" class="lift-restriction-btn">Lift restriction</button>
      </div>
    `;

    card.querySelector(".lift-restriction-btn").addEventListener("click", async () => {
      try {
        await liftUserRestriction(user.id);
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await refreshModerationView();
    });

    restrictedUsersContainer.appendChild(card);
  });
}

async function loadAndRenderRestrictedUsers() {
  restrictedUsersContainer.innerHTML = "<p>Loading...</p>";
  const users = await getRestrictedUsers();
  renderRestrictedUsers(users);
  tabRestrictedButton.textContent = `🚫 Restricted users (${users.length})`;
}

function renderBannedWords(words) {
  bannedWordsContainer.innerHTML = "";

  if (words.length === 0) {
    bannedWordsContainer.innerHTML = "<p>No banned words yet.</p>";
    return;
  }

  const list = document.createElement("div");
  list.className = "tags";

  words.forEach(word => {
    const chip = document.createElement("span");
    chip.className = "tag banned-word-chip";

    chip.innerHTML = `
      ${escapeHtml(word.word)}
      <button type="button" class="remove-banned-word-btn" title="Remove this word">✕</button>
    `;

    chip.querySelector(".remove-banned-word-btn").addEventListener("click", async () => {
      try {
        await removeBannedWord(word.id);
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await loadAndRenderBannedWords();
    });

    list.appendChild(chip);
  });

  bannedWordsContainer.appendChild(list);
}

async function loadAndRenderBannedWords() {
  bannedWordsContainer.innerHTML = "<p>Loading...</p>";
  const words = await getBannedWords();
  renderBannedWords(words);
  tabBannedWordsButton.textContent = `🔤 Banned words (${words.length})`;
}

addBannedWordButton.addEventListener("click", async () => {
  bannedWordsMessage.textContent = "";

  try {
    await addBannedWord(newBannedWordInput.value);
  } catch (error) {
    bannedWordsMessage.textContent = error.message || "Failed. Please try again.";
    return;
  }

  newBannedWordInput.value = "";
  await loadAndRenderBannedWords();
});

function renderAllowedPhrases(phrases) {
  allowedPhrasesContainer.innerHTML = "";

  if (phrases.length === 0) {
    allowedPhrasesContainer.innerHTML = "<p>No exceptions yet.</p>";
    return;
  }

  const list = document.createElement("div");
  list.className = "tags";

  phrases.forEach(phrase => {
    const chip = document.createElement("span");
    chip.className = "tag banned-word-chip";

    chip.innerHTML = `
      ${escapeHtml(phrase.phrase)}
      <button type="button" class="remove-allowed-phrase-btn" title="Remove this exception">✕</button>
    `;

    chip.querySelector(".remove-allowed-phrase-btn").addEventListener("click", async () => {
      try {
        await removeAllowedPhrase(phrase.id);
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await loadAndRenderAllowedPhrases();
    });

    list.appendChild(chip);
  });

  allowedPhrasesContainer.appendChild(list);
}

async function loadAndRenderAllowedPhrases() {
  allowedPhrasesContainer.innerHTML = "<p>Loading...</p>";
  const phrases = await getAllowedPhrases();
  renderAllowedPhrases(phrases);
}

addAllowedPhraseButton.addEventListener("click", async () => {
  allowedPhrasesMessage.textContent = "";

  try {
    await addAllowedPhrase(newAllowedPhraseInput.value);
  } catch (error) {
    allowedPhrasesMessage.textContent = error.message || "Failed. Please try again.";
    return;
  }

  newAllowedPhraseInput.value = "";
  await loadAndRenderAllowedPhrases();
});

async function refreshModerationView() {
  await Promise.all([
    loadAndRenderReports(),
    loadAndRenderRestrictedUsers(),
    loadAndRenderBannedWords(),
    loadAndRenderAllowedPhrases()
  ]);
}

init();

async function init() {
  await authReady;

  if (!isCurrentUserModerator()) {
    window.location.href = "index.html";
    return;
  }

  await refreshModerationView();
}
