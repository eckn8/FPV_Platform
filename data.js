// =======================================================
// 📦 data.js — Source unique de données partagées
//
// Regroupe ce qui était dupliqué (et donc désynchronisé)
// dans script.js / explore.js / upload.js / requests.js /
// model.js / profile.js / favorites.js :
//   - le catalogue de modèles par défaut
//   - les accès localStorage (modèles, dossiers, demandes)
//   - les likes / votes (modèles, demandes, commentaires)
//   - les favoris
//   - la recherche avancée (scoring + synonymes)
//   - le rendu du breadcrumb de dossiers
//   - l'échappement HTML anti-XSS
//
// Ce fichier doit être chargé AVANT le script de chaque
// page (voir la balise <script src="data.js"> dans les .html).
// Le jour où les modèles viendront d'une API au lieu de
// localStorage, c'est ICI et seulement ici que ça change.
// =======================================================

// =======================
// 📦 MODÈLES PAR DÉFAUT
// (seule version qui fait foi — ne plus dupliquer ailleurs)
// =======================

const defaultModels = [
  {
    id: 0,
    title: "Support GoPro Hero 12 - Nazgul5",
    description: "Support TPU incliné à 25° pour freestyle.",
    path: ["Impression 3D", "Drone FPV", "5 pouces", "Supports caméra"],
    tags: ["5 pouces", "TPU", "GoPro", "Freestyle"],
    files: [{ name: "gopro-nazgul5.stl" }],
    fileName: "gopro-nazgul5.stl",
    image: null,
    images: [],
    tested: "Oui",
    printNotes: "Impression recommandée en TPU. Supports non nécessaires.",
    creator: "FPV Print Hub"
  },
  {
    id: 1,
    title: "Support antenne RX",
    description: "Support léger pour antenne RX en TPU.",
    path: ["Impression 3D", "Drone FPV", "5 pouces", "Antennes"],
    tags: ["TPU", "RX", "Lightweight"],
    files: [{ name: "support-antenne-rx.stl" }],
    fileName: "support-antenne-rx.stl",
    image: null,
    images: [],
    tested: "Oui",
    printNotes: "Impression TPU recommandée.",
    creator: "FPV Print Hub"
  }
];

// =======================
// 💾 MODÈLES (défauts + uploadés en localStorage)
// =======================

function getUploadedModels() {
  return JSON.parse(localStorage.getItem("uploadedModels") || "[]");
}

function saveUploadedModels(models) {
  localStorage.setItem("uploadedModels", JSON.stringify(models));
}

function getAllModels() {
  return [...defaultModels, ...getUploadedModels()];
}

function findModelById(id) {
  return getAllModels().find(model => String(model.id) === String(id));
}

function getModelPath(model) {
  return model.path && model.path.length > 0
    ? model.path
    : ["Non classé"];
}

// =======================
// 🆕 VERSIONS DE MODÈLE
// Un modèle créé avant cette fonctionnalité (ou l'un des 2
// modèles de démo) n'a pas de champ `versions` : on le traite
// comme s'il n'avait qu'une "1.0" reconstituée depuis ses champs
// actuels, sans jamais l'écrire en dur tant que personne n'a
// réellement publié de nouvelle version.
// =======================

// Les modèles uploadés ont un id = Date.now() au moment de la
// publication (voir upload.js) — un vrai timestamp exploitable
// pour dater leur "1.0" reconstituée. Les 2 modèles de démo ont
// des id fixes (0, 1) qui ne sont PAS des dates : ce garde-fou
// évite d'afficher "1er janvier 1970" pour eux.
function _looksLikeTimestamp(value) {
  return typeof value === "number" && value > 1600000000000;
}

function getModelVersions(model) {
  if (Array.isArray(model.versions) && model.versions.length > 0) {
    return model.versions;
  }

  return [{
    version: "1.0",
    changelog: "Version initiale",
    files: model.files && model.files.length > 0
      ? model.files
      : model.fileName
        ? [{ name: model.fileName }]
        : [],
    createdAt: _looksLikeTimestamp(model.id)
      ? new Date(model.id).toISOString()
      : null
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

// Ajoute une nouvelle version à un modèle uploadé. L'appelant doit
// avoir déjà vérifié que l'utilisateur courant est bien le
// créateur (voir isCreator() dans model.js) — ceci n'est qu'un
// accès aux données, pas une vérification de permission.
// Met aussi à jour `files`/`fileName` au niveau du modèle pour que
// le reste du code (qui les lit directement) affiche toujours la
// dernière version sans avoir besoin de connaître `versions`.
function addModelVersion(modelId, { version, changelog, files }) {
  const uploadedModels = getUploadedModels();

  const updatedModels = uploadedModels.map(item => {
    if (String(item.id) !== String(modelId)) return item;

    const newVersion = {
      version,
      changelog,
      files,
      createdAt: new Date().toISOString()
    };

    return {
      ...item,
      versions: [...getModelVersions(item), newVersion],
      currentVersion: version,
      files,
      fileName: files[0] ? files[0].name : item.fileName
    };
  });

  saveUploadedModels(updatedModels);

  return updatedModels.find(item => String(item.id) === String(modelId));
}

// =======================
// 🚩 SIGNALEMENTS
// Stockage 100% local pour l'instant : un signalement n'est
// visible que dans le navigateur de la personne qui l'a fait, tant
// qu'il n'y a pas de backend pour les centraliser et un rôle
// modérateur pour les traiter. Ça reste la structure de données
// qui sera branchée sur un vrai système de modération plus tard —
// voir [[project-fpv-print-hub]] pour le contexte.
// =======================

function getReports() {
  return JSON.parse(localStorage.getItem("reports") || "[]");
}

function saveReports(reports) {
  localStorage.setItem("reports", JSON.stringify(reports));
}

function hasUserReported(targetType, targetId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  return getReports().some(report =>
    report.targetType === targetType &&
    String(report.targetId) === String(targetId) &&
    report.reporterId === userId
  );
}

// Retire le signalement de l'utilisateur courant sur cette cible
// (permet d'annuler une erreur de clic). Ne touche jamais aux
// signalements des autres utilisateurs. Ne fait rien si personne
// n'est connecté ou si aucun signalement n'existe pour lui.
function removeReport(targetType, targetId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  const reports = getReports().filter(report => !(
    report.targetType === targetType &&
    String(report.targetId) === String(targetId) &&
    report.reporterId === userId
  ));

  saveReports(reports);
  return true;
}

// Ne throw jamais — renvoie { ok, reason } pour rester simple à
// utiliser dans un if. `reason` (au singulier, code d'erreur) vaut
// "not-authenticated" ou "already-reported" quand ok est false.
// `reasons` (au pluriel) est la liste des cases cochées par
// l'utilisateur dans la modale de signalement.
function addReport(targetType, targetId, { modelId, reasons, details } = {}) {
  const userId = getCurrentUserId();

  if (!userId) {
    return { ok: false, reason: "not-authenticated" };
  }

  if (hasUserReported(targetType, targetId)) {
    return { ok: false, reason: "already-reported" };
  }

  const reports = getReports();

  reports.push({
    id: Date.now(),
    targetType,
    targetId: String(targetId),
    modelId: modelId !== undefined && modelId !== null ? String(modelId) : null,
    reporterId: userId,
    reporterUsername: getCurrentUsername(),
    reasons: Array.isArray(reasons) ? reasons : [],
    details: (details || "").trim(),
    createdAt: new Date().toISOString()
  });

  saveReports(reports);

  return { ok: true };
}

// =======================
// 📁 DOSSIERS PERSONNALISÉS
// =======================

function getCustomFolders() {
  return JSON.parse(localStorage.getItem("customFolders") || "[]");
}

function saveCustomFolders(folders) {
  localStorage.setItem("customFolders", JSON.stringify(folders));
}

// =======================
// 💡 DEMANDES COMMUNAUTAIRES
// =======================

function getRequests() {
  return JSON.parse(localStorage.getItem("requests") || "[]");
}

function saveRequests(requests) {
  localStorage.setItem("requests", JSON.stringify(requests));
}

// =======================
// 📁 CHEMINS DE DOSSIERS COMBINÉS
// Utilisé pour peupler les folder-pickers (upload, demandes,
// explorateur) : modèles + dossiers créés à la main, et
// éventuellement les dossiers visés par des demandes ouvertes.
// =======================

function getAllFolderPaths(options = {}) {
  const modelPaths = getAllModels()
    .map(model => model.path)
    .filter(path => Array.isArray(path));

  const customFolders = getCustomFolders();

  const paths = [...modelPaths, ...customFolders];

  if (options.includeRequests) {
    const requestPaths = getRequests()
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
// (toujours juste un pseudo local pour l'instant — voir la
// note "identité utilisateur" du plan de reprise du projet)
// L'identité vient maintenant de auth.js (session Supabase réelle)
// et non plus d'un pseudo libre en localStorage — voir auth.js
// pour le détail. getCurrentUsername() reste dispo pour l'affichage
// (ex : "publié par ..."), mais toute vérification de permission ou
// clé de stockage doit utiliser getCurrentUserId() (uuid stable,
// impossible à falsifier en éditant le localStorage), jamais le pseudo.
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
// Moteur commun pour : likes de modèles, votes de demandes,
// likes de commentaires. Le stockage reste { [itemId]: [usernames] }
// sous la clé localStorage passée en paramètre.
// =======================

function _getLikeStore(storageKey) {
  return JSON.parse(localStorage.getItem(storageKey) || "{}");
}

function _saveLikeStore(storageKey, store) {
  localStorage.setItem(storageKey, JSON.stringify(store));
}

function _getLikeCount(storageKey, itemId) {
  const store = _getLikeStore(storageKey);
  return Array.isArray(store[itemId]) ? store[itemId].length : 0;
}

function _hasUserLiked(storageKey, itemId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  const store = _getLikeStore(storageKey);
  return Array.isArray(store[itemId]) && store[itemId].includes(userId);
}

// Retourne false si personne n'est connecté (rien n'est modifié).
// L'appelant doit alors passer par requireAuth() (voir auth.js).
function _toggleLike(storageKey, itemId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  const store = _getLikeStore(storageKey);

  if (!Array.isArray(store[itemId])) {
    store[itemId] = [];
  }

  const index = store[itemId].indexOf(userId);

  if (index === -1) {
    store[itemId].push(userId);
  } else {
    store[itemId].splice(index, 1);
  }

  _saveLikeStore(storageKey, store);
  return true;
}

// ---- Likes de modèles -------------------------------------

function getLikes(modelId) {
  return _getLikeCount("likes", modelId);
}

function hasUserLikedModel(modelId) {
  return _hasUserLiked("likes", modelId);
}

function toggleModelLike(modelId) {
  return _toggleLike("likes", modelId);
}

// ---- Votes de demandes --------------------------------------

function getRequestVotes(requestId) {
  return _getLikeCount("requestVotes", requestId);
}

function hasUserVotedRequest(requestId) {
  return _hasUserLiked("requestVotes", requestId);
}

function toggleRequestVote(requestId) {
  return _toggleLike("requestVotes", requestId);
}

// ---- Likes de commentaires (clé dynamique par modèle) --------

function getCommentLikes(modelId, commentId) {
  return _getLikeCount(`commentLikes_model_${modelId}`, commentId);
}

function hasUserLikedComment(modelId, commentId) {
  return _hasUserLiked(`commentLikes_model_${modelId}`, commentId);
}

function toggleCommentLike(modelId, commentId) {
  return _toggleLike(`commentLikes_model_${modelId}`, commentId);
}

// =======================
// ❤️ FAVORIS
// Stockage inversé par rapport aux likes : { [userId]: [modelIds] }
// Toujours pour L'UTILISATEUR CONNECTÉ — il n'y a pas de cas où on
// a besoin de lire les favoris de quelqu'un d'autre dans cette app.
// =======================

function getSavedModelIds() {
  const userId = getCurrentUserId();
  if (!userId) return [];

  const saved = JSON.parse(localStorage.getItem("savedModels") || "{}");
  return (saved[userId] || []).map(String);
}

function isModelSaved(modelId) {
  if (!getCurrentUserId()) return false;
  return getSavedModelIds().includes(String(modelId));
}

// Retourne false si personne n'est connecté (rien n'est modifié).
// L'appelant doit alors passer par requireAuth() (voir auth.js).
function toggleSavedModel(modelId) {
  const userId = getCurrentUserId();
  if (!userId) return false;

  const saved = JSON.parse(localStorage.getItem("savedModels") || "{}");
  const modelIdStr = String(modelId);

  const current = (saved[userId] || []).map(String);

  saved[userId] = current.includes(modelIdStr)
    ? current.filter(id => id !== modelIdStr)
    : [...current, modelIdStr];

  localStorage.setItem("savedModels", JSON.stringify(saved));
  return true;
}

// =======================
// 🔍 RECHERCHE AVANCÉE
// (version fusionnée la plus complète — accueil et explorateur
// utilisaient deux listes de synonymes différentes)
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

  // Bonus popularité
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
