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
// network latency) — the likes used for the popularity bonus are
// therefore cached in memory via primeModelLikes() once per page
// load, never fetched on the fly.
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
// Common engine for: model likes, request votes, comment likes —
// same table shape every time (item_id, user_id). Synchronous
// reads from an in-memory cache filled by primeXxx(), direct
// writes to Supabase.
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

// ---- Model likes -------------------------------------

async function primeModelLikes(modelIds) {
  return _primeVotes("model_likes", "model_id", modelIds);
}

function getLikes(modelId) {
  return _getVoteCount("model_likes", modelId);
}

function hasUserLikedModel(modelId) {
  return _hasVoted("model_likes", modelId);
}

async function toggleModelLike(modelId) {
  return _toggleVote("model_likes", "model_id", modelId);
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
// ❤️ FAVORITES
// Always for the LOGGED-IN USER — there's no case in this app
// where we need to read someone else's favorites, hence no public
// RLS policy on this table (unlike likes).
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

// Returns false if no one is logged in (nothing is changed).
async function toggleSavedModel(modelId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  if (!_favoriteIdsCache) {
    await primeFavorites();
  }

  if (_favoriteIdsCache.has(modelId)) {
    const { error } = await supabaseClient
      .from("favorites")
      .delete()
      .eq("model_id", modelId)
      .eq("user_id", userId);

    if (error) return false;

    _favoriteIdsCache.delete(modelId);
  } else {
    const { error } = await supabaseClient
      .from("favorites")
      .insert({ model_id: modelId, user_id: userId });

    if (error && error.code !== "23505") return false;

    _favoriteIdsCache.add(modelId);
  }

  return true;
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
// No moderator role yet — everyone can currently only see (and
// therefore only cancel) their own reports (see the RLS policies
// in supabase_content_schema.sql), but they're now centralized in
// the database instead of everyone's own localStorage.
// =======================

async function hasUserReported(targetType, targetId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  const { data, error } = await supabaseClient
    .from("reports")
    .select("id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("reporter_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Error checking report status:", error.message);
    return false;
  }

  return !!data;
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

  return !error;
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
  // (primeModelLikes must have been called first, otherwise this
  // is just 0 everywhere).
  score += Math.min(getLikes(model.id), 10);

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
