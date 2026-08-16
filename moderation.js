// =======================================================
// 🛡️ moderation.js — Report moderation
// Only really reachable by moderators — enforced by RLS (see
// supabase_moderation.sql). This page just redirects everyone else
// away so they don't land on a confusing empty screen; it's not
// where the actual protection lives.
// =======================================================

const reportsContainer = document.getElementById("reportsContainer");

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
        await restrictUser(report.authorId, days);
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await loadAndRenderReports();
    });
  }

  const banButton = card.querySelector(".ban-user-btn");

  if (banButton) {
    banButton.addEventListener("click", async () => {
      if (!confirm(`Permanently restrict ${report.authorUsername} from publishing/commenting? This can be lifted later.`)) {
        return;
      }

      try {
        await banUser(report.authorId);
      } catch (error) {
        alert(error.message || "Failed. Please try again.");
        return;
      }

      await loadAndRenderReports();
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

      await loadAndRenderReports();
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
}

init();

async function init() {
  await authReady;

  if (!isCurrentUserModerator()) {
    window.location.href = "index.html";
    return;
  }

  await loadAndRenderReports();
}
