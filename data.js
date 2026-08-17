// =======================================================
// 📦 data.js — Shared data source
//
// Supabase version: models/likes/favorites/comments/requests/
// reports/folders now live in real Postgres tables (see
// supabase_content_schema.sql), not in localStorage. Still groups
// everything that needs to stay common to script.js / explore.js /
// upload.js / requests.js / model.js / profile.js / favorites.js:
//   - data access (models, folders, requests)
//   - likes / votes / favorites / comments / reports
//   - advanced search (scoring + synonyms)
//   - folder breadcrumb rendering
//   - anti-XSS HTML escaping
//
// Requires supabaseClient.js + auth.js loaded before this file.
// Loaded itself BEFORE each page's script.
//
// Important note: getSearchScore()/advancedSearch() MUST stay
// synchronous (search has to respond on every keystroke with no
// network latency) — the save counts used for the popularity bonus
// are therefore cached in memory via primeModelSaves() once per
// page load, never fetched on the fly.
// =======================================================

// =======================
// 📦 MODELS
// =======================

let _modelsCache = null;

function _normalizeModelRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    path: row.path,
    tags: row.tags || [],
    tested: row.tested,
    printNotes: row.print_notes,
    creatorId: row.creator_id,
    creator: row.creator_username,
    requestId: row.request_id,
    archived: row.archived,
    images: row.images || [],
    image: row.image,
    files: row.files || [],
    fileName: row.file_name,
    versions: row.versions || [],
    currentVersion: row.current_version,
    createdAt: row.created_at
  };
}

// In-memory cache (see note at the top of the file) — reset on
// every page load, never stale across two different pages.
async function getAllModels() {
  if (_modelsCache) return _modelsCache;

  const { data, error } = await supabaseClient
    .from("models")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading models:", error.message);
    return [];
  }

  _modelsCache = data.map(_normalizeModelRow);
  return _modelsCache;
}

// Targeted query (no need to load the whole catalog just to show
// a single model page).
async function findModelById(id) {
  const { data, error } = await supabaseClient
    .from("models")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Error loading model:", error.message);
    return null;
  }

  return data ? _normalizeModelRow(data) : null;
}

function getModelPath(model) {
  return model.path && model.path.length > 0
    ? model.path
    : ["Uncategorized"];
}

// Creates a model in the database — the caller (upload.js) has
// already checked the user is logged in and uploaded the files to R2.
async function createModel({
  title,
  description,
  path,
  tags,
  tested,
  printNotes,
  creatorId,
  creatorUsername,
  requestId,
  images,
  files
}) {
  const { data, error } = await supabaseClient
    .from("models")
    .insert({
      title,
      description,
      path,
      tags,
      tested,
      print_notes: printNotes,
      creator_id: creatorId,
      creator_username: creatorUsername,
      request_id: requestId || null,
      images,
      image: images[0] || null,
      files,
      file_name: files[0] ? files[0].name : null,
      versions: [{
        version: "1.0",
        changelog: "Initial version",
        files,
        createdAt: new Date().toISOString()
      }],
      current_version: "1.0"
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  _modelsCache = null;
  return _normalizeModelRow(data);
}

// The caller must have already checked that the current user is
// really the creator (see isCreator() in model.js) — the real
// protection comes from the "update" RLS policy (creator_id =
// auth.uid()), not this client-side check.
async function setModelArchived(modelId, archived) {
  const { error } = await supabaseClient
    .from("models")
    .update({ archived })
    .eq("id", modelId);

  if (error) throw new Error(error.message);

  _modelsCache = null;
}

// Edits the model's metadata: title/description/tags/tested/
// printNotes/path/images. Deliberately does NOT touch files/
// versions — changing the actual STL files only happens through
// addModelVersion(), so the version history stays meaningful. The
// caller must have already checked the current user is really the
// creator; the real protection is the "update" RLS policy
// (creator_id = auth.uid()), not this client-side check.
async function updateModel(modelId, { title, description, path, tags, tested, printNotes, images }) {
  const { data, error } = await supabaseClient
    .from("models")
    .update({
      title,
      description,
      path,
      tags,
      tested,
      print_notes: printNotes,
      images,
      image: images[0] || null
    })
    .eq("id", modelId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  _modelsCache = null;
  return _normalizeModelRow(data);
}

// =======================
// 🆕 MODEL VERSIONS
// =======================

function getModelVersions(model) {
  if (Array.isArray(model.versions) && model.versions.length > 0) {
    return model.versions;
  }

  return [{
    version: "1.0",
    changelog: "Initial version",
    files: model.files && model.files.length > 0 ? model.files : [],
    createdAt: model.createdAt || null
  }];
}

function getCurrentVersionLabel(model) {
  const versions = getModelVersions(model);
  return model.currentVersion || versions[versions.length - 1].version;
}

// Suggests the next version number by incrementing the last
// numeric segment (1.0 -> 1.1, 2 -> 3, 1.9 -> 1.10...). Still
// editable by the creator, it's only a suggestion.
function suggestNextVersion(model) {
  const versions = getModelVersions(model);
  const last = String(versions[versions.length - 1].version || "1.0");

  const parts = last.split(".");
  const lastPart = parseInt(parts[parts.length - 1], 10);

  if (Number.isNaN(lastPart)) {
    return last + ".1";
  }

  parts[parts.length - 1] = String(lastPart + 1);
  return parts.join(".");
}

// Also updates `files`/`fileName` at the model level so the rest
// of the code (which reads them directly) always shows the latest
// version. The caller must have already checked that the current
// user is really the creator.
async function addModelVersion(modelId, { version, changelog, files }) {
  const model = await findModelById(modelId);
  if (!model) throw new Error("Model not found.");

  const newVersion = {
    version,
    changelog,
    files,
    createdAt: new Date().toISOString()
  };

  const updatedVersions = [...getModelVersions(model), newVersion];

  const { data, error } = await supabaseClient
    .from("models")
    .update({
      versions: updatedVersions,
      current_version: version,
      files,
      file_name: files[0] ? files[0].name : model.fileName
    })
    .eq("id", modelId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  _modelsCache = null;
  return _normalizeModelRow(data);
}

// =======================
// 📁 CUSTOM FOLDERS
// =======================

async function getCustomFolders() {
  const { data, error } = await supabaseClient
    .from("custom_folders")
    .select("path");

  if (error) {
    console.error("Error loading custom folders:", error.message);
    return [];
  }

  return data.map(row => row.path);
}

// The folder tree is a fixed, curated taxonomy (Drone / Camera /
// Equipment and everything below) seeded once via
// supabase_root_lock_migration.sql. There is deliberately no
// client-side way to create a folder anymore — publishing/
// requesting only ever *picks* an existing folder (see
// getSubfoldersAt() below). New categories are added directly in
// the database as the catalog grows.

// =======================
// 💡 COMMUNITY REQUESTS
// =======================

function _normalizeRequestRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    path: row.path,
    creator: row.creator_username,
    creatorId: row.creator_id,
    status: row.status,
    resolvedByModelId: row.resolved_by_model_id,
    createdAt: row.created_at
  };
}

async function getRequests() {
  const { data, error } = await supabaseClient
    .from("requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading requests:", error.message);
    return [];
  }

  return data.map(_normalizeRequestRow);
}

async function createRequest({ title, description, path, creatorId, creatorUsername }) {
  const { data, error } = await supabaseClient
    .from("requests")
    .insert({
      title,
      description,
      path,
      creator_id: creatorId,
      creator_username: creatorUsername,
      status: "open"
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return _normalizeRequestRow(data);
}

// Allowed for any logged-in user, not just the request's creator —
// publishing a model that answers it must be able to close it
// (same rule enforced on the RLS side, see the SQL schema).
async function resolveRequest(requestId, modelId) {
  const { error } = await supabaseClient
    .from("requests")
    .update({ status: "closed", resolved_by_model_id: modelId })
    .eq("id", requestId);

  if (error) {
    console.error("Error closing request:", error.message);
  }
}

// =======================
// 📁 COMBINED FOLDER PATHS
// Used to populate the folder pickers (upload, requests,
// explorer): models + manually created folders, and optionally
// the folders targeted by open requests.
// =======================

async function getAllFolderPaths(options = {}) {
  const [models, customFolders] = await Promise.all([
    getAllModels(),
    getCustomFolders()
  ]);

  const modelPaths = models
    .map(model => model.path)
    .filter(path => Array.isArray(path));

  const paths = [...modelPaths, ...customFolders];

  if (options.includeRequests) {
    const requests = await getRequests();

    const requestPaths = requests
      .map(request => request.path)
      .filter(path => Array.isArray(path));

    paths.push(...requestPaths);
  }

  return paths;
}

function getSubfoldersAt(paths, currentPath) {
  const subfolders = new Set();

  paths.forEach(path => {
    const isInCurrentPath = currentPath.every(
      (folder, index) => path[index] === folder
    );

    if (!isInCurrentPath) return;

    const nextFolder = path[currentPath.length];

    if (nextFolder) {
      subfolders.add(nextFolder);
    }
  });

  return Array.from(subfolders).sort();
}

// =======================
// 🧭 GENERIC BREADCRUMB
// container: target HTML element
// currentPath: array of folder names
// onNavigate: function called with the new currentPath
// =======================

function renderBreadcrumb(container, currentPath, onNavigate) {
  container.innerHTML = "";

  const homeButton = document.createElement("button");
  homeButton.textContent = "Home";
  homeButton.onclick = () => onNavigate([]);
  container.appendChild(homeButton);

  currentPath.forEach((folder, index) => {
    const separator = document.createElement("span");
    separator.textContent = " / ";
    container.appendChild(separator);

    const folderButton = document.createElement("button");
    folderButton.textContent = folder;
    folderButton.onclick = () => onNavigate(currentPath.slice(0, index + 1));
    container.appendChild(folderButton);
  });
}

// =======================
// 👤 CURRENT USER
// Identity comes from auth.js (real Supabase session).
// getCurrentUsername() is for display (e.g. "published by...");
// any permission check or write key must use getCurrentUserId()
// (stable uuid), never the username.
// =======================

function getCurrentUsername() {
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  return user ? user.username : "";
}

function getCurrentUserId() {
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  return user ? user.id : null;
}

// =======================
// 🔒 HTML ESCAPING (anti-XSS)
// Any data that comes from a user (title, description, tags,
// comment, folder name, username...) must go through escapeHtml()
// before being inserted via innerHTML.
// =======================

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value === undefined || value === null ? "" : String(value);
  return div.innerHTML;
}

// =======================
// 👍 GENERIC LIKES / VOTES
// Common engine for: model saves (favorites, doubling as the public
// popularity signal — see FAVORITES below), request votes, comment
// likes — same table shape every time (item_id, user_id).
// Synchronous reads from an in-memory cache filled by primeXxx(),
// direct writes to Supabase.
// =======================

const _voteCache = new Map(); // `${table}:${itemId}` -> { count, likedByMe }

function _voteCacheKey(table, itemId) {
  return `${table}:${itemId}`;
}

// Call once (with every relevant id) before rendering like/vote
// buttons — without this, getXxxLikes()/hasUserXxx() just return
// "0 / not liked" by default.
async function _primeVotes(table, idColumn, itemIds) {
  itemIds.forEach(id => {
    _voteCache.set(_voteCacheKey(table, id), { count: 0, likedByMe: false });
  });

  if (itemIds.length === 0) return;

  const { data, error } = await supabaseClient
    .from(table)
    .select(`${idColumn}, user_id`)
    .in(idColumn, itemIds);

  if (error) {
    console.error(`Error loading ${table}:`, error.message);
    return;
  }

  const userId = getCurrentUserId();

  data.forEach(row => {
    const key = _voteCacheKey(table, row[idColumn]);
    const entry = _voteCache.get(key) || { count: 0, likedByMe: false };

    entry.count += 1;

    if (userId && row.user_id === userId) {
      entry.likedByMe = true;
    }

    _voteCache.set(key, entry);
  });
}

function _getVoteCount(table, itemId) {
  const entry = _voteCache.get(_voteCacheKey(table, itemId));
  return entry ? entry.count : 0;
}

function _hasVoted(table, itemId) {
  const entry = _voteCache.get(_voteCacheKey(table, itemId));
  return entry ? entry.likedByMe : false;
}

// Returns false if no one is logged in (nothing is changed). The
// caller should go through requireAuth() in that case (see auth.js).
// Also updates the in-memory cache for instant visual feedback,
// without an extra request just for display.
async function _toggleVote(table, idColumn, itemId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  const key = _voteCacheKey(table, itemId);
  const entry = _voteCache.get(key) || { count: 0, likedByMe: false };

  if (entry.likedByMe) {
    const { error } = await supabaseClient
      .from(table)
      .delete()
      .eq(idColumn, itemId)
      .eq("user_id", userId);

    if (error) return false;

    entry.likedByMe = false;
    entry.count = Math.max(0, entry.count - 1);
  } else {
    const { error } = await supabaseClient
      .from(table)
      .insert({ [idColumn]: itemId, user_id: userId });

    // 23505 = already liked (fast double-click): not a real error,
    // the intended state is already reached.
    if (error && error.code !== "23505") return false;

    entry.likedByMe = true;
    entry.count += 1;
  }

  _voteCache.set(key, entry);
  return true;
}

// ---- Request votes --------------------------------------

async function primeRequestVotes(requestIds) {
  return _primeVotes("request_votes", "request_id", requestIds);
}

function getRequestVotes(requestId) {
  return _getVoteCount("request_votes", requestId);
}

function hasUserVotedRequest(requestId) {
  return _hasVoted("request_votes", requestId);
}

async function toggleRequestVote(requestId) {
  return _toggleVote("request_votes", "request_id", requestId);
}

// ---- Comment likes -----------------------------------

async function primeCommentLikes(commentIds) {
  return _primeVotes("comment_likes", "comment_id", commentIds);
}

function getCommentLikes(commentId) {
  return _getVoteCount("comment_likes", commentId);
}

function hasUserLikedComment(commentId) {
  return _hasVoted("comment_likes", commentId);
}

async function toggleCommentLike(commentId) {
  return _toggleVote("comment_likes", "comment_id", commentId);
}

// =======================
// ❤️ FAVORITES (saves)
// Doubles as what used to be "likes": there's no separate like
// button anymore, saving a model IS the public popularity signal
// now (powers "Most popular" and the search ranking bonus), so the
// table is publicly readable — see supabase_merge_like_into_save.sql.
//
// Two different access patterns on the same table, so two caches:
// - _favoriteIdsCache: "which models has THE CURRENT USER saved" —
//   discovered without knowing candidate ids upfront, needed to
//   build the My Favorites page and to render each save button's
//   initial saved/unsaved state.
// - _voteCache (generic engine, further up): "how many people in
//   total saved model X" — a public count, only computed for a
//   known set of ids (primeModelSaves()).
// toggleSavedModel() keeps both in sync.
// =======================

let _favoriteIdsCache = null;

// Call once before reading isModelSaved()/getSavedModelIds().
async function primeFavorites() {
  const userId = getCurrentUserId();

  if (!userId) {
    _favoriteIdsCache = new Set();
    return;
  }

  const { data, error } = await supabaseClient
    .from("favorites")
    .select("model_id")
    .eq("user_id", userId);

  if (error) {
    console.error("Error loading favorites:", error.message);
    _favoriteIdsCache = new Set();
    return;
  }

  _favoriteIdsCache = new Set(data.map(row => row.model_id));
}

function isModelSaved(modelId) {
  return _favoriteIdsCache ? _favoriteIdsCache.has(modelId) : false;
}

function getSavedModelIds() {
  return _favoriteIdsCache ? Array.from(_favoriteIdsCache) : [];
}

// Returns false if no one is logged in (nothing is changed). Also
// updates the public-count cache (_voteCache) if it was already
// primed for this model, so a save count shown elsewhere on the
// page stays correct without needing a re-prime.
async function toggleSavedModel(modelId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  if (!_favoriteIdsCache) {
    await primeFavorites();
  }

  const countKey = _voteCacheKey("favorites", modelId);
  const countEntry = _voteCache.get(countKey);

  if (_favoriteIdsCache.has(modelId)) {
    const { error } = await supabaseClient
      .from("favorites")
      .delete()
      .eq("model_id", modelId)
      .eq("user_id", userId);

    if (error) return false;

    _favoriteIdsCache.delete(modelId);

    if (countEntry) {
      countEntry.likedByMe = false;
      countEntry.count = Math.max(0, countEntry.count - 1);
      _voteCache.set(countKey, countEntry);
    }
  } else {
    const { error } = await supabaseClient
      .from("favorites")
      .insert({ model_id: modelId, user_id: userId });

    if (error && error.code !== "23505") return false;

    _favoriteIdsCache.add(modelId);

    if (countEntry) {
      countEntry.likedByMe = true;
      countEntry.count += 1;
      _voteCache.set(countKey, countEntry);
    }
  }

  return true;
}

// ---- Public save count (the old "likes" role) ----------------

async function primeModelSaves(modelIds) {
  return _primeVotes("favorites", "model_id", modelIds);
}

function getSaveCount(modelId) {
  return _getVoteCount("favorites", modelId);
}

// Small hover-reveal bookmark button, positioned over a card's
// image corner by style.css (.card-save-btn) — shared by every
// page that renders model cards (home, explore, profile,
// favorites). `card` must support .appendChild (plain element or
// DocumentFragment). `onToggled`, if given, runs after a
// successful toggle — used by favorites.html to drop the card
// once it's been un-saved.
function attachSaveButton(card, modelId, onToggled) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card-save-btn";
  button.title = "Save";

  function updateIcon() {
    const saved = isModelSaved(modelId);
    button.textContent = saved ? "◆" : "◇";
    button.classList.toggle("saved", saved);
  }

  updateIcon();

  button.addEventListener("click", async event => {
    event.stopPropagation();
    if (!requireAuth()) return;

    await toggleSavedModel(modelId);
    updateIcon();

    if (onToggled) onToggled();
  });

  card.appendChild(button);
}

// =======================
// 💬 COMMENTS
// =======================

async function getModelComments(modelId) {
  const { data, error } = await supabaseClient
    .from("comments")
    .select("*")
    .eq("model_id", modelId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error loading comments:", error.message);
    return [];
  }

  return data.map(row => ({
    id: row.id,
    user: row.username,
    userId: row.user_id,
    text: row.text,
    createdAt: row.created_at
  }));
}

// Deliberately named createComment (not addComment): the model
// page exposes a window.addComment tied to the form button — using
// the same name on both sides made the internal call to
// "addComment(...)" inside that handler resolve back to the
// handler itself, causing infinite recursion (lived experience:
// "Maximum call stack size exceeded").
async function createComment(modelId, text) {
  const userId = getCurrentUserId();
  const username = getCurrentUsername();

  if (!userId) throw new Error("You must be logged in.");

  const { data, error } = await supabaseClient
    .from("comments")
    .insert({ model_id: modelId, user_id: userId, username, text })
    .select()
    .single();

  if (error) throw new Error(error.message);

  return {
    id: data.id,
    user: data.username,
    userId: data.user_id,
    text: data.text,
    createdAt: data.created_at
  };
}

// The caller must have already checked that the current user is
// really the author (see isOwnComment in model.js) — the real
// protection comes from the "delete" RLS policy (user_id =
// auth.uid()), not this client-side check.
async function deleteComment(commentId) {
  const { error } = await supabaseClient
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (error) throw new Error(error.message);
}

// =======================
// 🚩 REPORTS
// Everyone can currently only see (and therefore only cancel) their
// own reports client-side — moderators see everything, but through
// moderation.html, not this cache (see the RLS policies in
// supabase_content_schema.sql / supabase_moderation.sql).
//
// _reportedCache mirrors the vote/like cache pattern used elsewhere
// in this file: primed once per page load so hasUserReported() can
// be read synchronously, which lets model.js/comment rendering
// blur out content the *current viewer* already reported (a purely
// personal "hide until I un-report it" cue — nobody else's view is
// affected) without an async check per comment on every render.
// =======================

let _reportedCache = null;

async function primeReports() {
  const userId = getCurrentUserId();

  if (!userId) {
    _reportedCache = new Set();
    return;
  }

  const { data, error } = await supabaseClient
    .from("reports")
    .select("target_type, target_id")
    .eq("reporter_id", userId);

  if (error) {
    console.error("Error loading reports:", error.message);
    _reportedCache = new Set();
    return;
  }

  _reportedCache = new Set(data.map(row => `${row.target_type}:${row.target_id}`));
}

function hasUserReported(targetType, targetId) {
  if (!_reportedCache) return false;
  return _reportedCache.has(`${targetType}:${targetId}`);
}

// Never throws — returns { ok, reason } to keep usage simple in an
// if statement. `reason` (singular, error code) is
// "not-authenticated" or "already-reported" when ok is false.
async function addReport(targetType, targetId, { modelId, reasons, details } = {}) {
  const userId = getCurrentUserId();

  if (!userId) {
    return { ok: false, reason: "not-authenticated" };
  }

  const { error } = await supabaseClient
    .from("reports")
    .insert({
      target_type: targetType,
      target_id: targetId,
      model_id: modelId || null,
      reporter_id: userId,
      reasons: Array.isArray(reasons) ? reasons : [],
      details: (details || "").trim()
    });

  if (error) {
    // Unique constraint (target_type, target_id, reporter_id):
    // already reported.
    if (error.code === "23505") {
      return { ok: false, reason: "already-reported" };
    }

    return { ok: false, reason: error.message };
  }

  if (_reportedCache) _reportedCache.add(`${targetType}:${targetId}`);

  return { ok: true };
}

async function removeReport(targetType, targetId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  const { error } = await supabaseClient
    .from("reports")
    .delete()
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("reporter_id", userId);

  if (!error && _reportedCache) {
    _reportedCache.delete(`${targetType}:${targetId}`);
  }

  return !error;
}

// =======================
// 🛡 MODERATION
// Everything below is only reachable if the "moderator" RLS
// policies let it through (see supabase_moderation.sql) —
// isCurrentUserModerator() only controls whether the UI is shown,
// never the real permission.
// =======================

function isCurrentUserModerator() {
  const user = getCurrentUser();
  return !!(user && user.isModerator);
}

// Loads every report, most recent first, with the reporter's
// username and (for model reports) the model's title/path/creator
// already embedded via PostgREST foreign-key joins. Comment reports
// have no join available (target_id is polymorphic, not a real
// foreign key), so their text + author info are fetched separately
// and merged in. authorUsername (who POSTED the reported content)
// is deliberately kept distinct from reporterUsername (who FLAGGED
// it) — a moderator needs both: usernames themselves can be the
// actual problem even when the report was filed over something
// else.
//
// The `!<constraint>` suffixes are required, not decorative:
// models/comments each have more than one relationship to
// `profiles` (creator vs. likers/favoriters/commenters), so
// PostgREST can't infer which one to embed without it.
async function getAllReports() {
  const { data, error } = await supabaseClient
    .from("reports")
    .select(`
      *,
      reporter:profiles(username),
      model:models(
        title, path, creator_id, creator_username,
        creator:profiles!models_creator_id_fkey(is_banned, restricted_until)
      )
    `)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error loading reports:", error.message);
    return [];
  }

  const commentReportIds = data
    .filter(row => row.target_type === "comment")
    .map(row => row.target_id);

  let commentsById = {};

  if (commentReportIds.length > 0) {
    const { data: comments, error: commentsError } = await supabaseClient
      .from("comments")
      .select(`
        id, text, model_id, user_id, username,
        author:profiles!comments_user_id_fkey(is_banned, restricted_until)
      `)
      .in("id", commentReportIds);

    if (!commentsError) {
      commentsById = Object.fromEntries(comments.map(comment => [comment.id, comment]));
    }
  }

  return data.map(row => {
    const isModelReport = row.target_type === "model";
    const comment = commentsById[row.target_id];
    const authorProfile = isModelReport
      ? (row.model ? row.model.creator : null)
      : (comment ? comment.author : null);

    return {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      modelId: row.model_id,
      reasons: row.reasons || [],
      details: row.details,
      createdAt: row.created_at,
      reporterUsername: row.reporter ? row.reporter.username : "Unknown user",
      modelTitle: row.model ? row.model.title : null,
      modelPath: row.model ? row.model.path : null,
      commentText: isModelReport ? null : (comment ? comment.text : null),
      authorUsername: isModelReport
        ? (row.model ? row.model.creator_username : null)
        : (comment ? comment.username : null),
      authorId: isModelReport
        ? (row.model ? row.model.creator_id : null)
        : (comment ? comment.user_id : null),
      authorBanned: authorProfile ? authorProfile.is_banned : false,
      authorRestrictedUntil: authorProfile ? authorProfile.restricted_until : null
    };
  });
}

// =======================
// 🚫 USER RESTRICTIONS
// Blocks publishing/commenting while restricted — real enforcement
// is the RLS policies (see supabase_user_restrictions.sql), these
// just perform the update; the account can still log in and browse.
//
// `reason` is a free-text snapshot (what was reported + why) built
// by the caller (see moderation.js) — kept so a restriction can
// still be understood later, after the report that led to it has
// been dismissed or acted on and is gone from the queue.
// =======================

async function restrictUser(userId, days, reason) {
  const restrictedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabaseClient
    .from("profiles")
    .update({
      restricted_until: restrictedUntil,
      is_banned: false,
      restriction_reason: reason || null
    })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

async function banUser(userId, reason) {
  const { error } = await supabaseClient
    .from("profiles")
    .update({
      is_banned: true,
      restricted_until: null,
      restriction_reason: reason || null
    })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

async function liftUserRestriction(userId) {
  const { error } = await supabaseClient
    .from("profiles")
    .update({ is_banned: false, restricted_until: null, restriction_reason: null })
    .eq("id", userId);

  if (error) throw new Error(error.message);
}

// restriction_reason (and is_banned/restricted_until, for
// consistency) are only exposed through this security-definer
// function, not a plain `.from("profiles").select(...)` — see
// supabase_restriction_reasons.sql for why direct column access is
// revoked. Returns [] for a non-moderator (the function re-checks
// that itself server-side) rather than erroring.
async function getRestrictedUsers() {
  const { data, error } = await supabaseClient.rpc("get_restricted_users");

  if (error) {
    console.error("Error loading restricted users:", error.message);
    return [];
  }

  return data;
}

// =======================
// 🔤 BANNED WORDS
// The list itself is moderator-only (RLS), and the real block on
// publishing/commenting is a database trigger, not this — see
// supabase_banned_words.sql. This is just CRUD for managing the
// list from moderation.html.
// =======================

async function getBannedWords() {
  const { data, error } = await supabaseClient
    .from("banned_words")
    .select("id, word")
    .order("word", { ascending: true });

  if (error) {
    console.error("Error loading banned words:", error.message);
    return [];
  }

  return data;
}

async function addBannedWord(word) {
  const cleanWord = (word || "").trim().toLowerCase();

  if (!cleanWord) throw new Error("Enter a word.");

  const { error } = await supabaseClient
    .from("banned_words")
    .insert({ word: cleanWord });

  if (error) {
    if (error.code === "23505") throw new Error("This word is already on the list.");
    throw new Error(error.message);
  }
}

async function removeBannedWord(id) {
  const { error } = await supabaseClient
    .from("banned_words")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

// =======================
// ✅ ALLOWED PHRASES (banned-word exceptions)
// Takes priority over banned_words — a phrase here is stripped out
// of the text before the banned-word check runs, so a banned single
// word inside it (e.g. "kill" inside "kill switch") never matches.
// See supabase_banned_words.sql.
// =======================

async function getAllowedPhrases() {
  const { data, error } = await supabaseClient
    .from("allowed_phrases")
    .select("id, phrase")
    .order("phrase", { ascending: true });

  if (error) {
    console.error("Error loading allowed phrases:", error.message);
    return [];
  }

  return data;
}

async function addAllowedPhrase(phrase) {
  const cleanPhrase = (phrase || "").trim().toLowerCase();

  if (!cleanPhrase) throw new Error("Enter a phrase.");

  const { error } = await supabaseClient
    .from("allowed_phrases")
    .insert({ phrase: cleanPhrase });

  if (error) {
    if (error.code === "23505") throw new Error("This phrase is already on the list.");
    throw new Error(error.message);
  }
}

async function removeAllowedPhrase(id) {
  const { error } = await supabaseClient
    .from("allowed_phrases")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

// Dismissing = "reviewed, no action needed". Doesn't touch the
// reported content, just this one report.
async function dismissReport(reportId) {
  const { error } = await supabaseClient
    .from("reports")
    .delete()
    .eq("id", reportId);

  if (error) throw new Error(error.message);
}

// Soft delete (same mechanism used everywhere else — never a
// physical deletion) + clears out any other pending report on the
// same model, since there's nothing left to review once it's gone.
async function removeReportedModel(modelId) {
  const { error } = await supabaseClient
    .from("models")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", modelId);

  if (error) throw new Error(error.message);

  _modelsCache = null;

  await supabaseClient
    .from("reports")
    .delete()
    .eq("target_type", "model")
    .eq("target_id", modelId);
}

// Hard delete, same as a user deleting their own comment — a
// comment has no soft-delete concept. Also clears any other pending
// report on the same comment.
async function removeReportedComment(commentId) {
  const { error } = await supabaseClient
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (error) throw new Error(error.message);

  await supabaseClient
    .from("reports")
    .delete()
    .eq("target_type", "comment")
    .eq("target_id", commentId);
}

// =======================
// 📥 DOWNLOADS
// Downloading never requires an account (see access rules), so
// downloads can't always be deduped by a real user id the way
// likes/favorites are — see supabase_downloads.sql for how
// downloader_key covers both cases.
// =======================

function _getDownloadIdentityKey() {
  const user = getCurrentUser();
  if (user) return `user:${user.id}`;

  let anonId = localStorage.getItem("fpv_anon_id");

  if (!anonId) {
    anonId = crypto.randomUUID();
    localStorage.setItem("fpv_anon_id", anonId);
  }

  return `anon:${anonId}`;
}

// Fire-and-forget: called on click, right alongside the real
// download link — never blocks or breaks the download itself. A
// repeat download by the same identity silently no-ops (unique
// constraint on model_id + downloader_key), which is exactly the
// intended "don't double count" behavior, not an error.
async function recordDownload(modelId) {
  const { error } = await supabaseClient
    .from("model_downloads")
    .insert({ model_id: modelId, downloader_key: _getDownloadIdentityKey() });

  if (error && error.code !== "23505") {
    console.error("Error recording download:", error.message);
  }
}

// =======================
// 📊 PLATFORM STATS (home page)
// creatorsCount is the number of distinct people who have actually
// published a model — not every registered account, which would
// count people who signed up but never posted anything as
// "creators". Small enough scale that deduping the creator ids in
// JS is simpler than a dedicated SQL view.
// =======================

async function getPlatformStats() {
  const [modelsResult, creatorRowsResult, downloadsResult] = await Promise.all([
    supabaseClient.from("models").select("id", { count: "exact", head: true }).is("deleted_at", null),
    supabaseClient.from("models").select("creator_id").is("deleted_at", null),
    supabaseClient.from("model_downloads").select("model_id", { count: "exact", head: true })
  ]);

  return {
    modelsCount: modelsResult.count || 0,
    creatorsCount: creatorRowsResult.data
      ? new Set(creatorRowsResult.data.map(row => row.creator_id)).size
      : 0,
    downloadsCount: downloadsResult.count || 0
  };
}

// =======================
// 🔍 ADVANCED SEARCH
// Stays 100% synchronous (see the note at the top of the file) —
// operates on models already loaded in memory.
// =======================

const synonymMap = {
  camera: ["cam", "gopro", "action cam", "dji action", "insta360"],
  gps: ["gnss", "beidou", "galileo", "gps module"],
  antenna: ["rx", "elrs", "crossfire", "tbs", "receiver"],
  rx: ["receiver", "elrs", "crossfire", "antenna"],
  vtx: ["video transmitter", "analog", "walksnail", "hdzero", "dji"],
  o3: ["dji o3", "air unit", "dji"],
  o4: ["dji o4", "air unit", "dji"],
  tpu: ["flexible", "soft", "flexible print"],
  frame: ["chassis", "structure"],
  protection: ["guard", "bumper", "protector"],
  support: ["mount", "holder", "fixture"],
  mount: ["support", "holder", "fixture"],
  battery: ["lipo", "strap"],
  gopro: ["camera", "action cam"],
  cinewhoop: ["whoop", "duct", "ducted"],
  longrange: ["long range", "lr", "gps"],
  "long range": ["longrange", "lr", "gps"]
};

// Dynamically built regex (rather than a literal \uXXXX) to match
// combining diacritical marks after an NFD normalization — used to
// strip accents in search.
const COMBINING_MARKS_REGEX = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g"
);

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_MARKS_REGEX, "");
}

function getSearchTerms(query) {
  const normalizedQuery = normalizeText(query);

  const baseTerms = normalizedQuery
    .split(/\s+/)
    .map(term => term.trim())
    .filter(term => term.length > 0);

  const expandedTerms = [...baseTerms];

  baseTerms.forEach(term => {
    const synonyms = synonymMap[term] || [];

    synonyms.forEach(synonym => {
      expandedTerms.push(normalizeText(synonym));
    });
  });

  return [...new Set(expandedTerms)];
}

function getModelSearchText(model) {
  return {
    title: normalizeText(model.title),
    description: normalizeText(model.description),
    creator: normalizeText(model.creator),
    tags: normalizeText((model.tags || []).join(" ")),
    path: normalizeText((model.path || []).join(" "))
  };
}

function getSearchScore(model, query) {
  const terms = getSearchTerms(query);

  if (terms.length === 0) return 0;

  const text = getModelSearchText(model);

  let score = 0;

  terms.forEach(term => {
    if (text.title.includes(term)) score += 10;
    if (text.tags.includes(term)) score += 8;
    if (text.path.includes(term)) score += 6;
    if (text.description.includes(term)) score += 4;
    if (text.creator.includes(term)) score += 2;
  });

  // Bonus if every search word is found somewhere
  const originalTerms = normalizeText(query)
    .split(/\s+/)
    .filter(term => term.length > 0);

  const fullSearchText = [
    text.title,
    text.description,
    text.creator,
    text.tags,
    text.path
  ].join(" ");

  const allOriginalTermsFound = originalTerms.every(term =>
    fullSearchText.includes(term)
  );

  if (allOriginalTermsFound) {
    score += 15;
  }

  // Popularity bonus — read from the in-memory cache
  // (primeModelSaves must have been called first, otherwise this
  // is just 0 everywhere).
  score += Math.min(getSaveCount(model.id), 10);

  return score;
}

function advancedSearch(query, modelsList) {
  const value = query.trim();

  if (!value) {
    return modelsList;
  }

  return modelsList
    .map(model => ({
      model,
      score: getSearchScore(model, value)
    }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(result => result.model);
}

// =======================
// 🎛 UI KIT — icons & seven-segment digits
// Shared rendering helpers for the "Flight Deck" design system:
// a hand-drawn placeholder icon for models/requests without a
// photo, and a real seven-segment digit readout (built from on/off
// segments, not a font) for purely numeric values — likes, votes,
// download counts, stats.
// =======================

// Placeholder shown instead of a photo on a model card/detail page
// when no image was uploaded.
function droneIconMarkup() {
  return `
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="thumb-icon">
      <line x1="10" y1="10" x2="38" y2="38" stroke="var(--cream)" stroke-width="2"/>
      <line x1="38" y1="10" x2="10" y2="38" stroke="var(--cream)" stroke-width="2"/>
      <rect x="19" y="19" width="10" height="10" fill="var(--blue)" stroke="var(--cream)" stroke-width="1.5"/>
      <circle cx="10" cy="10" r="5" fill="none" stroke="var(--scarlet)" stroke-width="2"/>
      <circle cx="38" cy="10" r="5" fill="none" stroke="var(--scarlet)" stroke-width="2"/>
      <circle cx="10" cy="38" r="5" fill="none" stroke="var(--scarlet)" stroke-width="2"/>
      <circle cx="38" cy="38" r="5" fill="none" stroke="var(--scarlet)" stroke-width="2"/>
    </svg>
  `;
}

// Placeholder for a community request (nothing built yet) — a
// dashed outline instead of the solid drone icon, so a request
// card never reads as a real published model at a glance.
function requestIconMarkup() {
  return `
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" class="thumb-icon">
      <rect x="9" y="9" width="30" height="30" fill="none" stroke="var(--lilac)" stroke-width="2" stroke-dasharray="4 3"/>
      <line x1="24" y1="16" x2="24" y2="32" stroke="var(--lilac)" stroke-width="2"/>
      <line x1="16" y1="24" x2="32" y2="24" stroke="var(--lilac)" stroke-width="2"/>
    </svg>
  `;
}

// Classic 7-segment encoding (which segments a-g are lit per digit).
const SEVEN_SEG_MAP = {
  "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd",
  "4": "fgbc", "5": "afgcd", "6": "afgecd", "7": "abc",
  "8": "abcdefg", "9": "abcdfg"
};

// Renders `text` (digits, plus "," "." ":") as real on/off segments
// inside the element with id `elementId` — including the faint
// "ghost" of unlit segments, the same way an actual calculator/LCD
// readout works. Give the container class="seven-seg" in the HTML.
function renderSevenSegment(elementId, text) {
  const container = document.getElementById(elementId);
  if (!container) return;
  container.innerHTML = "";

  for (const ch of String(text)) {
    if (ch === ":") {
      const colon = document.createElement("span");
      colon.className = "seg-colon";
      container.appendChild(colon);
      continue;
    }
    if (ch === "," || ch === ".") {
      const dot = document.createElement("span");
      dot.className = "seg-dot";
      container.appendChild(dot);
      continue;
    }
    const digit = document.createElement("span");
    digit.className = "digit";
    const litSegments = SEVEN_SEG_MAP[ch] || "";
    ["a", "b", "c", "d", "e", "f", "g"].forEach(seg => {
      const el = document.createElement("span");
      el.className = `seg seg-${seg}${litSegments.includes(seg) ? " on" : ""}`;
      digit.appendChild(el);
    });
    container.appendChild(digit);
  }
}

// =======================
// 🗑 ACCOUNT DELETION
// The actual deletion needs the Supabase secret key, which only
// ever lives server-side (see handleDeleteAccount() in worker.js) —
// this just calls that endpoint with the current session's own
// token. contentChoice: "anonymize" | "delete".
// =======================

async function deleteMyAccount(contentChoice) {
  const token = getAccessToken();

  if (!token) {
    throw new Error("You must be logged in.");
  }

  let response;

  try {
    response = await fetch("/api/delete-account", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ contentChoice })
    });
  } catch {
    throw new Error("Could not reach the server — check your connection.");
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(result.error || "Failed to delete your account.");
  }

  return true;
}
