// =======================================================
// 🔐 auth.js — État d'authentification partagé
//
// Nécessite supabaseClient.js chargé avant ce fichier.
//
// Règle produit : browser / explorer / rechercher / télécharger
// ne nécessitent PAS de compte. Liker, sauvegarder, commenter,
// voter et publier en nécessitent un. Ce fichier ne bloque donc
// JAMAIS le rendu d'une page — il expose juste un état qui se met
// à jour dès que la session Supabase est connue, et un garde-fou
// (requireAuth) que les actions qui en ont besoin appellent au
// moment du clic.
// =======================================================

// Cache synchrone : { id, email, username } une fois connu, sinon null.
let currentUser = null;

let _authReadyResolve;

// Résolu une première fois dès que l'état de connexion initial est
// connu. Les pages qui affichent quelque chose de dépendant de
// l'utilisateur (like déjà mis ? favoris déjà sauvegardé ?) font
// `authReady.then(() => ...)` pour se rafraîchir une fois prêt,
// SANS jamais retarder le premier rendu de la page.
const authReady = new Promise(resolve => {
  _authReadyResolve = resolve;
});

async function _loadProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("username")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Impossible de charger le profil :", error.message);
    return null;
  }

  return data;
}

async function _refreshCurrentUser(session) {
  if (!session || !session.user) {
    currentUser = null;
    return;
  }

  const profile = await _loadProfile(session.user.id);

  currentUser = {
    id: session.user.id,
    email: session.user.email,
    username: (profile && profile.username) || session.user.email
  };
}

async function initAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();

  await _refreshCurrentUser(session);

  renderAuthStatus();

  if (_authReadyResolve) {
    _authReadyResolve();
    _authReadyResolve = null;
  }

  return currentUser;
}

// Tient le cache à jour si la session change dans un autre onglet,
// expire, ou est rafraîchie automatiquement par la librairie.
supabaseClient.auth.onAuthStateChange(async (_event, session) => {
  await _refreshCurrentUser(session);
  renderAuthStatus();
});

function getCurrentUser() {
  return currentUser;
}

// =======================
// 🔑 INSCRIPTION / CONNEXION / DÉCONNEXION
// Supabase gère lui-même le hashage du mot de passe, les tokens
// de session et leur renouvellement — rien de tout ça n'est
// réimplémenté ici.
// =======================

function _translateAuthError(error) {
  const message = (error && error.message) || "";

  if (message.includes("already registered")) {
    return "Un compte existe déjà avec cet email.";
  }

  if (message.includes("Invalid login credentials")) {
    return "Email ou mot de passe incorrect.";
  }

  if (message.includes("Password should be at least")) {
    return "Le mot de passe doit faire au moins 6 caractères.";
  }

  if (message.includes("duplicate key value") && message.includes("profiles_username")) {
    return "Ce pseudo est déjà pris.";
  }

  if (message.toLowerCase().includes("captcha")) {
    return "Vérification anti-robot manquante ou expirée, réessaie.";
  }

  return message || "Une erreur est survenue.";
}

async function signUp({ email, password, username, captchaToken }) {
  const cleanUsername = (username || "").trim();

  if (!cleanUsername) {
    return { error: "Choisis un pseudo." };
  }

  const { data, error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { username: cleanUsername },
      captchaToken
    }
  });

  if (error) {
    return { error: _translateAuthError(error) };
  }

  // Si la confirmation par email est activée sur le projet,
  // `data.session` est null tant que le lien n'a pas été cliqué.
  const needsEmailConfirmation = !data.session;

  return { data, needsEmailConfirmation };
}

async function signIn({ email, password, captchaToken }) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken }
  });

  if (error) {
    return { error: _translateAuthError(error) };
  }

  await _refreshCurrentUser(data.session);
  renderAuthStatus();

  return { data };
}

async function signOut() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  renderAuthStatus();
}

// =======================
// 🚧 GARDE-FOU CONNEXION
// À appeler au moment du clic sur une action qui nécessite un
// compte (like, favoris, commentaire, vote, publication). Renvoie
// l'utilisateur courant, ou redirige vers login.html et renvoie
// null si personne n'est connecté.
// =======================

function requireAuth() {
  const user = getCurrentUser();

  if (!user) {
    const here = window.location.pathname.split("/").pop() + window.location.search;

    window.location.href = `login.html?redirect=${encodeURIComponent(here)}`;
    return null;
  }

  return user;
}

// =======================
// 🧭 STATUT DE CONNEXION DANS LE HEADER
// Alimente <span id="authStatus"></span> si la page en a un.
// =======================

function renderAuthStatus() {
  const container = document.getElementById("authStatus");

  if (!container) return;

  container.innerHTML = "";

  if (currentUser) {
    const link = document.createElement("a");
    link.href = `profile.html?user=${encodeURIComponent(currentUser.username)}`;
    link.textContent = `👤 ${currentUser.username}`;
    container.appendChild(link);

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className = "auth-logout-btn";
    logoutButton.textContent = "Se déconnecter";

    logoutButton.addEventListener("click", async () => {
      await signOut();
      window.location.href = "index.html";
    });

    container.appendChild(logoutButton);
  } else {
    const link = document.createElement("a");
    link.href = "login.html";
    link.textContent = "Connexion";
    container.appendChild(link);
  }
}

// Lance la résolution de l'état de connexion dès que ce fichier
// est chargé, sur chaque page — sans que chaque script de page
// ait besoin d'y penser.
initAuth();
