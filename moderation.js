// =======================================================
// 🛡️ moderation.js — Report moderation
// Only really reachable by moderators — enforced by RLS (see
// supabase_moderation.sql). This page just redirects everyone else
// away so they don't land on a confusing empty screen; it's not
// where the actual protection lives.
// =======================================================

const reportsContainer = document.getElementById("reportsContainer");

function formatReportedContent(report) {
  if (report.targetType === "model") {
    return {
      label: report.modelTitle || "Unknown model",
      detail: report.modelPath ? report.modelPath.join(" / ") : "",
      link: `model.html?id=${report.targetId}`
    };
  }

  return {
    label: "Comment",
    detail: report.commentText || "(comment no longer exists)",
    link: report.modelId ? `model.html?id=${report.modelId}` : null
  };
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

      <p class="folder-path">Reported by: ${escapeHtml(report.reporterUsername)}</p>

      <div class="form-actions">
        <button type="button" class="dismiss-btn">Dismiss</button>
        <button type="button" class="remove-content-btn">Remove content</button>
      </div>
    `;

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
