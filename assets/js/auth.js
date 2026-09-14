/* Piscineo — porte d'authentification (email + code, essai 30 jours).
   Chargé AVANT app.js. Gère l'écran de connexion, la session, et la bannière d'essai. */
(function () {
  "use strict";

  // URL du backend Piscineo (Render). Mise à jour après déploiement du service.
  var API_BASE = "https://piscineo-api.onrender.com";
  var TKEY = "piscineo_token";

  function esc(s) { return (s == null ? "" : String(s)).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function api(path, opts) {
    opts = opts || {};
    var h = { "Content-Type": "application/json" };
    var t = localStorage.getItem(TKEY);
    if (t) h.Authorization = "Bearer " + t;
    opts.headers = h;
    return fetch(API_BASE + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; });
    });
  }

  var root;
  function ensureRoot() { root = document.getElementById("auth-root"); if (root) root.hidden = false; }

  /* ---------- Bannière d'essai + déconnexion ---------- */
  function renderTrial(user) {
    var foot = document.querySelector(".side-foot");
    if (!foot || !user) return;
    var el = document.getElementById("trial-info");
    if (!el) { el = document.createElement("div"); el.id = "trial-info"; foot.appendChild(el); }
    var txt = user.plan === "trial" ? ("Essai gratuit — <strong>" + user.days_left + " j</strong> restants")
      : (user.plan === "expired" ? "Essai terminé" : "");
    el.innerHTML = '<div style="margin-top:12px;font-size:12px;color:#9fc7d6;line-height:1.5">' +
      esc(user.email) + '<br>' + txt +
      '<br><a href="#" id="logout" style="color:#9fc7d6;text-decoration:underline">se déconnecter</a></div>';
    var lo = document.getElementById("logout");
    if (lo) lo.onclick = function (e) { e.preventDefault(); localStorage.removeItem(TKEY); location.reload(); };
  }

  /* ---------- Écran de connexion ---------- */
  function renderLogin() {
    ensureRoot();
    if (!root) return;
    root.innerHTML =
      '<div class="auth-overlay"><div class="auth-card">' +
        '<div class="auth-logo"><img src="assets/img/logo-mark.svg" alt=""><span>Piscineo</span></div>' +
        '<div id="auth-step1">' +
          '<h2>Connexion / Inscription</h2>' +
          '<p class="auth-sub">Entrez votre email, on vous envoie un code. Pas de mot de passe.</p>' +
          '<div class="auth-field"><input type="email" id="auth-email" placeholder="vous@exemple.fr" autocomplete="email"></div>' +
          '<button class="btn btn-primary btn-block" id="auth-send">Recevoir mon code par email</button>' +
          '<p class="auth-note">🎁 Essai gratuit 30 jours · sans carte bancaire</p>' +
          '<p class="auth-msg" id="auth-msg1"></p>' +
        '</div>' +
        '<div id="auth-step2" hidden>' +
          '<h2>Entrez votre code</h2>' +
          '<p class="auth-sub">Nous avons envoyé un code à 6 chiffres à <strong id="auth-email-echo"></strong>.</p>' +
          '<div class="auth-field"><input type="text" id="auth-code" inputmode="numeric" maxlength="6" placeholder="123456" style="text-align:center;font-size:24px;letter-spacing:6px"></div>' +
          '<button class="btn btn-primary btn-block" id="auth-verify">Valider mon code</button>' +
          '<p class="auth-msg" id="auth-msg2"></p>' +
          '<p class="auth-note"><a href="#" id="auth-resend">Renvoyer le code</a> · <a href="#" id="auth-back">changer d\'email</a></p>' +
        '</div>' +
      '</div></div>';

    var email = "";
    var msg1 = document.getElementById("auth-msg1");
    var msg2 = document.getElementById("auth-msg2");

    document.getElementById("auth-send").onclick = function () {
      email = (document.getElementById("auth-email").value || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg1.textContent = "Email invalide."; return; }
      var b = document.getElementById("auth-send"); b.disabled = true; b.textContent = "Envoi…";
      api("/api/auth/signup", { method: "POST", body: JSON.stringify({ email: email }) }).then(function (r) {
        b.disabled = false; b.textContent = "Recevoir mon code par email";
        if (!r.ok) { msg1.textContent = "Erreur : réessayez dans un instant."; return; }
        document.getElementById("auth-step1").hidden = true;
        document.getElementById("auth-step2").hidden = false;
        document.getElementById("auth-email-echo").textContent = email;
        if (r.body.sent === "dev") msg2.textContent = "(Mode démo : le code est dans les logs du serveur.)";
        document.getElementById("auth-code").focus();
      }).catch(function () { b.disabled = false; b.textContent = "Recevoir mon code par email"; msg1.textContent = "Serveur injoignable (il se réveille peut-être, réessayez dans 30 s)."; });
    };

    function doVerify() {
      var code = (document.getElementById("auth-code").value || "").trim();
      if (code.length < 6) { msg2.textContent = "Entrez le code à 6 chiffres."; return; }
      var b = document.getElementById("auth-verify"); b.disabled = true; b.textContent = "Vérification…";
      api("/api/auth/verify", { method: "POST", body: JSON.stringify({ email: email, code: code }) }).then(function (r) {
        if (!r.ok) { b.disabled = false; b.textContent = "Valider mon code"; msg2.textContent = { code_invalide: "Code incorrect.", code_expire: "Code expiré, renvoyez-en un.", aucun_code: "Demandez d'abord un code." }[r.body.error] || "Erreur."; return; }
        localStorage.setItem(TKEY, r.body.token);
        location.reload();
      }).catch(function () { b.disabled = false; b.textContent = "Valider mon code"; msg2.textContent = "Serveur injoignable."; });
    }
    document.getElementById("auth-verify").onclick = doVerify;
    document.getElementById("auth-code").addEventListener("keydown", function (e) { if (e.key === "Enter") doVerify(); });
    document.getElementById("auth-resend").onclick = function (e) { e.preventDefault(); api("/api/auth/resend", { method: "POST", body: JSON.stringify({ email: email }) }); msg2.textContent = "Nouveau code envoyé."; };
    document.getElementById("auth-back").onclick = function (e) { e.preventDefault(); document.getElementById("auth-step2").hidden = true; document.getElementById("auth-step1").hidden = false; };
  }

  function lock() { document.body.classList.add("locked"); renderLogin(); }
  function unlock(user) {
    document.body.classList.remove("locked");
    if (root) root.hidden = true;
    renderTrial(user);
  }

  /* ---------- Init ---------- */
  var token = localStorage.getItem(TKEY);
  function start() {
    if (!token) { lock(); return; }
    document.body.classList.remove("locked"); // optimiste : on a un token
    api("/api/me").then(function (r) {
      if (r.ok) unlock(r.body.user);
      else { localStorage.removeItem(TKEY); lock(); }
    }).catch(function () { /* backend endormi : on laisse l'app (données locales) */ });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
