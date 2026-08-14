// =======================================================
// 📦 data.js — Source unique de données partagées
//
// Version Supabase : les modèles/likes/favoris/commentaires/
// demandes/signalements/dossiers vivent maintenant dans de vraies
// tables Postgres (voir supabase_content_schema.sql), plus dans
// localStorage. Regroupe toujours ce qui doit rester commun à
// script.js / explore.js / upload.js / requests.js / model.js /
// profile.js / favorites.js :
//   - accès aux données (modèles, dossiers, demandes)
//   - likes / votes / favoris / commentaires / signalements
//   - recherche avancée (scoring + synonymes)
//   - le rendu du breadcrumb de dossiers
//   - l'échappement HTML anti-XSS
//
// Nécessite supabaseClient.js + auth.js chargés avant ce fichier.
// Chargé lui-même AVANT le script de chaque page.
//
// Point important : getSearchScore()/advancedSearch() DOIVENT
// rester synchrones (la recherche doit répondre à chaque frappe
// sans latence réseau) — les likes utilisés pour le score de
// popularité sont donc mis en cache en mémoire via primeModelLikes()
// une fois par chargement de page, pas requêtés à la volée.
// =======================================================

// =======================
// 📦 MODÈLES
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

// Mise en cache mémoire (voir note en haut de fichier) — remise à
// zéro à chaque chargement de page, jamais périmée entre deux
// pages différentes.
async function getAllModels() {
  if (_modelsCache) return _modelsCache;

  const { data, error } = await supabaseClient
    .from("models")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erreur de chargement des modèles :", error.message);
    return [];
  }

  _modelsCache = data.map(_normalizeModelRow);
  return _modelsCache;
}

// Requête ciblée (pas besoin de charger tout le catalogue pour
// afficher une seule page modèle).
async function findModelById(id) {
  const { data, error } = await supabaseClient
    .from("models")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Erreur de chargement du modèle :", error.message);
    return null;
  }

  return data ? _normalizeModelRow(data) : null;
}

function getModelPath(model) {
  return model.path && model.path.length > 0
    ? model.path
    : ["Non classé"];
}

// Crée un modèle en base — l'appelant (upload.js) a déjà vérifié
// que l'utilisateur est connecté et uploadé les fichiers vers R2.
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
        changelog: "Version initiale",
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

// L'appelant doit avoir déjà vérifié que l'utilisateur courant est
// bien le créateur (voir isCreator() dans model.js) — la vraie
// protection vient de la policy RLS "update" (creator_id =
// auth.uid()), pas de ce contrôle côté client.
async function setModelArchived(modelId, archived) {
  const { error } = await supabaseClient
    .from("models")
    .update({ archived })
    .eq("id", modelId);

  if (error) throw new Error(error.message);

  _modelsCache = null;
}

// =======================
// 🆕 VERSIONS DE MODÈLE
// =======================

function getModelVersions(model) {
  if (Array.isArray(model.versions) && model.versions.length > 0) {
    return model.versions;
  }

  return [{
    version: "1.0",
    changelog: "Version initiale",
    files: model.files && model.files.length > 0 ? model.files : [],
    createdAt: model.createdAt || null
  }];
}

function getCurrentVersionLabel(model) {
  const versions = getModelVersions(model);
  return model.currentVersion || versions[versions.length - 1].version;
}

// Suggère un numéro de version suivant en incrémentant le dernier
// segment numérique (1.0 -> 1.1, 2 -> 3, 1.9 -> 1.10...). Reste
// modifiable par le créateur, ce n'est qu'une suggestion.
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

// Met aussi à jour `files`/`fileName` au niveau du modèle pour que
// le reste du code (qui les lit directement) affiche toujours la
// dernière version. L'appelant doit avoir déjà vérifié que
// l'utilisateur courant est bien le créateur.
async function addModelVersion(modelId, { version, changelog, files }) {
  const model = await findModelById(modelId);
  if (!model) throw new Error("Modèle introuvable.");

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
// 📁 DOSSIERS PERSONNALISÉS
// =======================

async function getCustomFolders() {
  const { data, error } = await supabaseClient
    .from("custom_folders")
    .select("path");

  if (error) {
    console.error("Erreur dossiers personnalisés :", error.message);
    return [];
  }

  return data.map(row => row.path);
}

// Idempotent : si le dossier existe déjà (contrainte unique sur
// `path`), on considère juste que c'est réussi plutôt que
// d'afficher une erreur — c'est exactement l'état voulu.
async function createCustomFolder(path) {
  const userId = getCurrentUserId();

  const { error } = await supabaseClient
    .from("custom_folders")
    .insert({ path, created_by: userId });

  if (error && error.code !== "23505") {
    throw new Error(error.message);
  }
}

// =======================
// 💡 DEMANDES COMMUNAUTAIRES
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
    console.error("Erreur de chargement des demandes :", error.message);
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

// Autorisé pour n'importe quel utilisateur connecté, pas juste le
// créateur de la demande — publier un modèle qui y répond doit
// pouvoir la fermer (même règle que côté RLS, voir le schéma SQL).
async function resolveRequest(requestId, modelId) {
  const { error } = await supabaseClient
    .from("requests")
    .update({ status: "closed", resolved_by_model_id: modelId })
    .eq("id", requestId);

  if (error) {
    console.error("Erreur de fermeture de la demande :", error.message);
  }
}

// =======================
// 📁 CHEMINS DE DOSSIERS COMBINÉS
// Utilisé pour peupler les folder-pickers (upload, demandes,
// explorateur) : modèles + dossiers créés à la main, et
// éventuellement les dossiers visés par des demandes ouvertes.
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
// 🧭 BREADCRUMB GÉNÉRIQUE
// container : élément HTML cible
// currentPath : tableau de noms de dossiers
// onNavigate : fonction appelée avec le nouveau currentPath
// =======================

function renderBreadcrumb(container, currentPath, onNavigate) {
  container.innerHTML = "";

  const homeButton = document.createElement("button");
  homeButton.textContent = "Accueil";
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
// 👤 UTILISATEUR COURANT
// L'identité vient de auth.js (session Supabase réelle).
// getCurrentUsername() sert à l'affichage (ex : "publié par ...")
// ; toute vérification de permission ou clé d'écriture doit
// utiliser getCurrentUserId() (uuid stable), jamais le pseudo.
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
// 🔒 ÉCHAPPEMENT HTML (anti-XSS)
// Toute donnée qui vient d'un utilisateur (titre, description,
// tags, commentaire, nom de dossier, pseudo...) doit passer par
// escapeHtml() avant d'être insérée via innerHTML.
// =======================

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value === undefined || value === null ? "" : String(value);
  return div.innerHTML;
}

// =======================
// 👍 LIKES / VOTES GÉNÉRIQUES
// Moteur commun pour : likes de modèles, votes de demandes, likes
// de commentaires — même forme de table à chaque fois
// (item_id, user_id). Lecture synchrone depuis un cache mémoire
// rempli par primeXxx(), écriture directe vers Supabase.
// =======================

const _voteCache = new Map(); // `${table}:${itemId}` -> { count, likedByMe }

function _voteCacheKey(table, itemId) {
  return `${table}:${itemId}`;
}

// À appeler une fois (avec tous les ids concernés) avant de rendre
// des boutons like/vote — sans ça, getXxxLikes()/hasUserXxx()
// renvoient juste "0 / pas liké" par défaut.
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
    console.error(`Erreur ${table} :`, error.message);
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

// Retourne false si personne n'est connecté (rien n'est modifié).
// L'appelant doit alors passer par requireAuth() (voir auth.js).
// Met aussi à jour le cache en mémoire pour un retour visuel
// immédiat, sans refaire de requête juste pour l'affichage.
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

    // 23505 = déjà liké (double-clic rapide) : pas une vraie
    // erreur, l'état voulu est déjà atteint.
    if (error && error.code !== "23505") return false;

    entry.likedByMe = true;
    entry.count += 1;
  }

  _voteCache.set(key, entry);
  return true;
}

// ---- Likes de modèles -------------------------------------

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

// ---- Votes de demandes --------------------------------------

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

// ---- Likes de commentaires -----------------------------------

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
// ❤️ FAVORIS
// Toujours pour L'UTILISATEUR CONNECTÉ — pas de cas où on a besoin
// de lire les favoris de quelqu'un d'autre dans cette app, donc
// pas de policy RLS publique dessus (contrairement aux likes).
// =======================

let _favoriteIdsCache = null;

// À appeler une fois avant de lire isModelSaved()/getSavedModelIds().
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
    console.error("Erreur favoris :", error.message);
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

// Retourne false si personne n'est connecté (rien n'est modifié).
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
// 💬 COMMENTAIRES
// =======================

async function getModelComments(modelId) {
  const { data, error } = await supabaseClient
    .from("comments")
    .select("*")
    .eq("model_id", modelId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Erreur de chargement des commentaires :", error.message);
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

// Nommée createComment (et pas addComment) volontairement : la
// page modèle expose un window.addComment lié au bouton du
// formulaire — même nom des deux côtés aurait fait que l'appel à
// "addComment(...)" dans ce handler se rappelle lui-même à l'infini
// au lieu d'atteindre cette fonction-ci (vécu : "Maximum call stack
// size exceeded").
async function createComment(modelId, text) {
  const userId = getCurrentUserId();
  const username = getCurrentUsername();

  if (!userId) throw new Error("Connexion requise.");

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

// L'appelant doit avoir déjà vérifié que l'utilisateur courant est
// bien l'auteur (voir isOwnComment dans model.js) — la vraie
// protection vient de la policy RLS "delete" (user_id =
// auth.uid()), pas de ce contrôle côté client.
async function deleteComment(commentId) {
  const { error } = await supabaseClient
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (error) throw new Error(error.message);
}

// =======================
// 🚩 SIGNALEMENTS
// Pas encore de rôle modérateur — chacun ne voit (et ne peut donc
// vérifier) que ses propres signalements pour l'instant (voir RLS
// dans supabase_content_schema.sql), mais ils sont désormais
// centralisés en base plutôt que dans le localStorage de chacun.
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
    console.error("Erreur signalement :", error.message);
    return false;
  }

  return !!data;
}

// Ne throw jamais — renvoie { ok, reason } pour rester simple à
// utiliser dans un if. `reason` (singulier, code d'erreur) vaut
// "not-authenticated" ou "already-reported" quand ok est false.
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
    // Contrainte unique (target_type, target_id, reporter_id) :
    // déjà signalé.
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
// 🔍 RECHERCHE AVANCÉE
// Reste 100% synchrone (voir note en haut de fichier) — opère sur
// des modèles déjà chargés en mémoire.
// =======================

const synonymMap = {
  camera: ["caméra", "cam", "gopro", "action cam", "dji action", "insta360"],
  caméra: ["camera", "cam", "gopro", "action cam", "dji action", "insta360"],
  gps: ["gnss", "beidou", "galileo", "module gps"],
  antenne: ["antenna", "rx", "elrs", "crossfire", "tbs", "receiver", "récepteur"],
  rx: ["receiver", "récepteur", "elrs", "crossfire", "antenne"],
  vtx: ["video transmitter", "émetteur vidéo", "analogique", "walksnail", "hdzero", "dji"],
  o3: ["dji o3", "air unit", "dji"],
  o4: ["dji o4", "air unit", "dji"],
  tpu: ["flexible", "souple", "impression flexible"],
  frame: ["châssis", "chassis", "structure"],
  protection: ["guard", "bumper", "protector"],
  support: ["mount", "holder", "fixation"],
  batterie: ["battery", "lipo", "strap"],
  gopro: ["camera", "caméra", "action cam"],
  cinewhoop: ["whoop", "duct", "ducted"],
  longrange: ["long range", "lr", "gps"],
  "long range": ["longrange", "lr", "gps"]
};

// Regex construite dynamiquement (plutôt qu'un littéral \uXXXX)
// pour matcher les marques diacritiques combinantes après une
// normalisation NFD — sert à retirer les accents dans la recherche.
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

  // Bonus si tous les mots de la recherche sont trouvés quelque part
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

  // Bonus popularité — lu depuis le cache mémoire (primeModelLikes
  // doit avoir été appelé avant, sinon vaut juste 0 partout).
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
