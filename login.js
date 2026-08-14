// =======================================================
// 🔑 login.js — Page de connexion / inscription
// Nécessite supabaseClient.js + auth.js chargés avant ce fichier.
// =======================================================

const params = new URLSearchParams(window.location.search);
const redirectTarget = params.get("redirect") || "index.html";

const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const tabLoginButton = document.getElementById("tabLoginButton");
const tabSignupButton = document.getElementById("tabSignupButton");
const authMessage = document.getElementById("authMessage");

// =======================
// 🔀 ONGLETS
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

// Déjà connecté ? Pas besoin de rester sur cette page.
authReady.then(() => {
  if (getCurrentUser()) {
    window.location.href = redirectTarget;
  }
});

// =======================
// 🤖 ANTI-ROBOT (Cloudflare Turnstile)
// Un seul widget partagé entre les deux onglets. Un jeton n'est
// utilisable qu'une fois : on le remet à zéro après chaque
// tentative (réussie ou non) pour que le prochain essai en
// redemande un frais.
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
// 🔓 CONNEXION
// =======================

document.getElementById("loginButton").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  if (!email || !password) {
    authMessage.textContent = "Renseigne ton email et ton mot de passe.";
    return;
  }

  if (!turnstileToken) {
    authMessage.textContent = "Merci de valider la vérification anti-robot.";
    return;
  }

  authMessage.textContent = "Connexion en cours...";

  const { error } = await signIn({ email, password, captchaToken: turnstileToken });

  resetTurnstile();

  if (error) {
    // Le message reste volontairement générique (Supabase ne dit
    // jamais si l'email existe ou non, pour éviter qu'on puisse
    // deviner qui a un compte) — on ajoute juste un rappel qu'il
    // faut peut-être en créer un, sans jamais confirmer/infirmer
    // l'existence du compte.
    authMessage.innerHTML = "";
    authMessage.appendChild(document.createTextNode(error + " "));

    const signupHint = document.createElement("button");
    signupHint.type = "button";
    signupHint.className = "auth-inline-link";
    signupHint.textContent = "Pas encore de compte ? Créer un compte";
    signupHint.addEventListener("click", showSignup);

    authMessage.appendChild(signupHint);
    return;
  }

  window.location.href = redirectTarget;
});

// =======================
// 🆕 INSCRIPTION
// =======================

document.getElementById("signupButton").addEventListener("click", async () => {
  const username = document.getElementById("signupUsername").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;

  if (!username || !email || !password) {
    authMessage.textContent = "Remplis le pseudo, l'email et le mot de passe.";
    return;
  }

  if (password.length < 6) {
    authMessage.textContent = "Le mot de passe doit faire au moins 6 caractères.";
    return;
  }

  if (!turnstileToken) {
    authMessage.textContent = "Merci de valider la vérification anti-robot.";
    return;
  }

  authMessage.textContent = "Création du compte...";

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
      "Compte créé ✅ Vérifie tes emails pour confirmer ton adresse avant de te connecter.";
    return;
  }

  window.location.href = redirectTarget;
});
