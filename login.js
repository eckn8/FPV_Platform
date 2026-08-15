// =======================================================
// 🔑 login.js — Login / sign-up page
// Requires supabaseClient.js + auth.js loaded before this file.
// =======================================================

const params = new URLSearchParams(window.location.search);
const redirectTarget = params.get("redirect") || "index.html";

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const tabLoginButton = document.getElementById("tabLoginButton");
const tabSignupButton = document.getElementById("tabSignupButton");
const authMessage = document.getElementById("authMessage");

// =======================
// 🔀 TABS
// =======================

function showLogin() {
  loginForm.style.display = "block";
  signupForm.style.display = "none";
  tabLoginButton.classList.add("active");
  tabSignupButton.classList.remove("active");
  authMessage.textContent = "";
}

function showSignup() {
  signupForm.style.display = "block";
  loginForm.style.display = "none";
  tabSignupButton.classList.add("active");
  tabLoginButton.classList.remove("active");
  authMessage.textContent = "";
}

tabLoginButton.addEventListener("click", showLogin);
tabSignupButton.addEventListener("click", showSignup);

// Already logged in? No need to stay on this page.
authReady.then(() => {
  if (getCurrentUser()) {
    window.location.href = redirectTarget;
  }
});

// =======================
// 🤖 ANTI-BOT (Cloudflare Turnstile)
// A single widget shared between both tabs. A token can only be
// used once: we reset it after each attempt (successful or not)
// so the next attempt requests a fresh one.
// =======================

let turnstileToken = null;

window.onTurnstileSuccess = function (token) {
  turnstileToken = token;
};

window.onTurnstileExpired = function () {
  turnstileToken = null;
};

function resetTurnstile() {
  turnstileToken = null;

  if (window.turnstile) {
    turnstile.reset();
  }
}

// =======================
// 🔓 LOGIN
// =======================

document.getElementById("loginButton").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    authMessage.textContent = "Enter your email and password.";
    return;
  }

  if (!turnstileToken) {
    authMessage.textContent = "Please complete the anti-bot check.";
    return;
  }

  authMessage.textContent = "Logging in...";

  const { error } = await signIn({ email, password, captchaToken: turnstileToken });

  resetTurnstile();

  if (error) {
    // The message stays deliberately generic (Supabase never
    // reveals whether an email exists, to prevent guessing who
    // has an account) — we just add a reminder that an account
    // may need to be created, without ever confirming/denying
    // its existence.
    authMessage.innerHTML = "";
    authMessage.appendChild(document.createTextNode(error + " "));

    const signupHint = document.createElement("button");
    signupHint.type = "button";
    signupHint.className = "auth-inline-link";
    signupHint.textContent = "No account yet? Create one";
    signupHint.addEventListener("click", showSignup);

    authMessage.appendChild(signupHint);
    return;
  }

  window.location.href = redirectTarget;
});

// =======================
// 🆕 SIGN UP
// =======================

document.getElementById("signupButton").addEventListener("click", async () => {
  const username = document.getElementById("signupUsername").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  if (!username || !email || !password) {
    authMessage.textContent = "Fill in the username, email and password.";
    return;
  }

  if (password.length < 6) {
    authMessage.textContent = "Password must be at least 6 characters.";
    return;
  }

  if (!turnstileToken) {
    authMessage.textContent = "Please complete the anti-bot check.";
    return;
  }

  authMessage.textContent = "Creating account...";

  const { error, needsEmailConfirmation } = await signUp({
    email,
    password,
    username,
    captchaToken: turnstileToken
  });

  resetTurnstile();

  if (error) {
    authMessage.textContent = error;
    return;
  }

  if (needsEmailConfirmation) {
    authMessage.textContent =
      "Account created ✅ Check your email to confirm your address before logging in.";
    return;
  }

  window.location.href = redirectTarget;
});
