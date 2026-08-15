// =======================================================
// 🔐 auth.js — Shared authentication state
//
// Requires supabaseClient.js loaded before this file.
//
// Product rule: browsing / exploring / searching / downloading do
// NOT require an account. Liking, saving favorites, commenting,
// voting and publishing do. This file therefore NEVER blocks a
// page's rendering — it just exposes a state that updates as soon
// as the Supabase session is known, and a guard (requireAuth) that
// actions needing it call at click time.
// =======================================================

// Synchronous cache: { id, email, username } once known, else null.
let currentUser = null;

// Current Supabase access token — needed to prove identity to
// worker.js (POST /api/upload), in addition to currentUser which
// is only used for display/client-side checks. See storage.js.
let currentAccessToken = null;

let _authReadyResolve;

// Resolved once the initial connection state is known. Pages that
// display something dependent on the user (already liked? already
// saved to favorites?) do `authReady.then(() => ...)` to refresh
// once ready, WITHOUT ever delaying the page's first render.
const authReady = new Promise(resolve => {
  _authReadyResolve = resolve;
});

async function _loadProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("username, is_moderator")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Could not load profile:", error.message);
    return null;
  }

  return data;
}

async function _refreshCurrentUser(session) {
  if (!session || !session.user) {
    currentUser = null;
    currentAccessToken = null;
    return;
  }

  const profile = await _loadProfile(session.user.id);

  currentUser = {
    id: session.user.id,
    email: session.user.email,
    username: (profile && profile.username) || session.user.email,
    isModerator: !!(profile && profile.is_moderator)
  };

  currentAccessToken = session.access_token;
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

// Keeps the cache up to date if the session changes in another
// tab, expires, or is refreshed automatically by the library.
supabaseClient.auth.onAuthStateChange(async (_event, session) => {
  await _refreshCurrentUser(session);
  renderAuthStatus();
});

function getCurrentUser() {
  return currentUser;
}

function getAccessToken() {
  return currentAccessToken;
}

// =======================
// 🔑 SIGN UP / LOG IN / LOG OUT
// Supabase itself handles password hashing, session tokens and
// their renewal — none of that is reimplemented here.
// =======================

function _translateAuthError(error) {
  const message = (error && error.message) || "";

  if (message.includes("already registered")) {
    return "An account already exists with this email.";
  }

  if (message.includes("Invalid login credentials")) {
    return "Incorrect email or password.";
  }

  if (message.includes("Password should be at least")) {
    return "Password must be at least 6 characters long.";
  }

  if (message.includes("duplicate key value") && message.includes("profiles_username")) {
    return "This username is already taken.";
  }

  if (message.toLowerCase().includes("captcha")) {
    return "Missing or expired anti-bot verification, please try again.";
  }

  return message || "Something went wrong.";
}

async function signUp({ email, password, username, captchaToken }) {
  const cleanUsername = (username || "").trim();

  if (!cleanUsername) {
    return { error: "Choose a username." };
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

  // If email confirmation is enabled on the project, `data.session`
  // stays null until the link has been clicked.
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
// 🚧 LOGIN GUARD
// Call at the moment someone clicks an action that requires an
// account (like, favorite, comment, vote, publish). Returns the
// current user, or redirects to login.html and returns null if no
// one is logged in.
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
// 🧭 LOGIN STATUS IN THE HEADER
// Fills <span id="authStatus"></span> if the page has one.
// =======================

function renderAuthStatus() {
  const container = document.getElementById("authStatus");

  if (!container) return;

  container.innerHTML = "";

  if (currentUser) {
    // Only rendered for moderators — the real protection is the
    // RLS policies on reports/models/comments (see
    // supabase_moderation.sql), not this link's visibility.
    if (currentUser.isModerator) {
      const moderationLink = document.createElement("a");
      moderationLink.href = "moderation.html";
      moderationLink.textContent = "🛡️ Moderation";
      container.appendChild(moderationLink);
    }

    const link = document.createElement("a");
    link.href = `profile.html?user=${encodeURIComponent(currentUser.username)}`;
    link.textContent = `👤 ${currentUser.username}`;
    container.appendChild(link);

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className = "auth-logout-btn";
    logoutButton.textContent = "Log out";

    logoutButton.addEventListener("click", async () => {
      await signOut();
      window.location.href = "index.html";
    });

    container.appendChild(logoutButton);
  } else {
    const link = document.createElement("a");
    link.href = "login.html";
    link.textContent = "Log in";
    container.appendChild(link);
  }
}

// Kicks off resolving the login state as soon as this file loads,
// on every page — so no page script needs to think about it.
initAuth();
