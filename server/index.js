/* Piscineo — backend d'authentification (MVP)
 * Inscription/connexion SANS mot de passe : email → code de vérification à 6 chiffres → session.
 * Essai gratuit de 30 jours ouvert à la vérification. PAS de paiement (phase ultérieure).
 *
 * Fonctionne dès le déploiement, même sans base ni email :
 *  - Sans DATABASE_URL  → stockage EN MÉMOIRE (⚠️ perdu au redémarrage : ajouter Postgres pour garder les inscriptions).
 *  - Sans SMTP_*        → mode DEV : le code est écrit dans les logs au lieu d'être envoyé par email.
 * Variables d'env (Render → Environment) : DATABASE_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, ADMIN_TOKEN, APP_URL
 */
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const TRIAL_DAYS = 30;
const CODE_TTL = 10 * 60 * 1000; // 10 min
const APP_URL = process.env.APP_URL || "https://piscineo.onrender.com";
const BRAND = process.env.BRAND || "Piscineo"; // marque affichée dans les emails (mettre "Devizio" pour le produit multi-métiers)

/* ---------------- Email (nodemailer si SMTP configuré, sinon DEV log) ---------------- */
let transporter = null;
try {
  if (process.env.SMTP_HOST) {
    const nodemailer = require("nodemailer");
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure: String(process.env.SMTP_PORT) === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD }
    });
  }
} catch (e) { console.error("SMTP init:", e.message); }

async function sendCode(email, code) {
  if (!transporter) { console.log(`[DEV] Code de connexion pour ${email} : ${code}`); return "dev"; }
  await transporter.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_FROM || `${BRAND} <no-reply@piscineo.fr>`,
    to: email,
    subject: `Votre code ${BRAND} : ${code}`,
    text: `Votre code de connexion ${BRAND} est : ${code}\n\nIl est valable 10 minutes.\n\n${APP_URL}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:440px;margin:auto">
      <h2 style="color:#0e7490">Votre code de connexion</h2>
      <p>Saisissez ce code dans Piscineo pour accéder à votre compte :</p>
      <div style="font-size:34px;font-weight:800;letter-spacing:6px;color:#0891b2;background:#e0f7fb;border-radius:10px;padding:16px;text-align:center">${code}</div>
      <p style="color:#5c6b60;font-size:13px">Valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>
    </div>`
  });
  return "sent";
}

/* ---------------- Stockage (Postgres si DATABASE_URL, sinon mémoire) ---------------- */
function makeMemoryDb() {
  const users = new Map(); // email -> { email, code, code_expires, verified, trial_ends, session_token, created_at }
  const metrics = {};
  return {
    mode: "memory",
    async init() {},
    async track(k) { metrics[k] = (metrics[k] || 0) + 1; },
    async getMetrics() { return Object.assign({ visit_home: 0, visit_signup: 0 }, metrics); },
    async listUsers() { return [...users.values()]; },
    async setCode(email, code, expires, trade) {
      let u = users.get(email);
      if (!u) { u = { email, verified: false, trial_ends: null, session_token: null, created_at: Date.now(), trade: trade || null }; users.set(email, u); }
      u.code = code; u.code_expires = expires; return u;
    },
    async getUser(email) { return users.get(email) || null; },
    async verify(email, trialEnds, token) {
      const u = users.get(email); if (!u) return null;
      u.verified = true; u.code = null; u.code_expires = null;
      if (!u.trial_ends) u.trial_ends = trialEnds;
      u.session_token = token; return u;
    },
    async getBySession(token) { for (const u of users.values()) if (u.session_token === token) return u; return null; },
    async stats() {
      let verified = 0; for (const u of users.values()) if (u.verified) verified++;
      return { signups: users.size, verified };
    }
  };
}

function makePgDb() {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false }
  });
  return {
    mode: "postgres",
    async init() {
      await pool.query(`create table if not exists users (
        email text primary key, code text, code_expires bigint,
        verified boolean default false, trial_ends bigint, session_token text, created_at bigint)`);
      await pool.query(`create table if not exists metrics (key text primary key, count bigint default 0)`);
      await pool.query(`alter table users add column if not exists trade text`);
    },
    async track(k) { await pool.query(`insert into metrics(key,count) values($1,1) on conflict(key) do update set count=metrics.count+1`, [k]); },
    async getMetrics() { const r = await pool.query(`select key, count from metrics`); const o = { visit_home: 0, visit_signup: 0 }; r.rows.forEach(x => o[x.key] = Number(x.count)); return o; },
    async listUsers() { const r = await pool.query(`select email, created_at, verified, trial_ends, trade from users order by created_at desc`); return r.rows; },
    async setCode(email, code, expires, trade) {
      await pool.query(
        `insert into users (email, code, code_expires, created_at, trade) values ($1,$2,$3,$4,$5)
         on conflict (email) do update set code=$2, code_expires=$3`,
        [email, code, expires, Date.now(), trade || null]);
      return (await pool.query(`select * from users where email=$1`, [email])).rows[0];
    },
    async getUser(email) { return (await pool.query(`select * from users where email=$1`, [email])).rows[0] || null; },
    async verify(email, trialEnds, token) {
      await pool.query(
        `update users set verified=true, code=null, code_expires=null,
         trial_ends=coalesce(trial_ends,$2), session_token=$3 where email=$1`,
        [email, trialEnds, token]);
      return (await pool.query(`select * from users where email=$1`, [email])).rows[0] || null;
    },
    async getBySession(token) { return (await pool.query(`select * from users where session_token=$1`, [token])).rows[0] || null; },
    async stats() {
      const r = await pool.query(`select count(*)::int signups, count(*) filter (where verified)::int verified from users`);
      return r.rows[0];
    }
  };
}

const db = process.env.DATABASE_URL ? makePgDb() : makeMemoryDb();

/* ---------------- Helpers ---------------- */
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");
const gen6 = () => String(Math.floor(100000 + Math.random() * 900000));
const token = () => crypto.randomBytes(24).toString("hex");
function publicUser(u) {
  const now = Date.now();
  const daysLeft = u.trial_ends ? Math.max(0, Math.ceil((Number(u.trial_ends) - now) / 86400000)) : 0;
  return {
    email: u.email, verified: !!u.verified,
    trial_ends: u.trial_ends ? Number(u.trial_ends) : null,
    days_left: daysLeft,
    plan: !u.trial_ends ? "none" : (Number(u.trial_ends) > now ? "trial" : "expired")
  };
}

/* ---------------- Routes ---------------- */
app.get("/health", async (req, res) => {
  res.json({ ok: true, store: db.mode, email: transporter ? "smtp" : "dev-log" });
});

// Inscription / demande de code
app.post("/api/auth/signup", async (req, res) => {
  const email = String((req.body.email || "")).trim().toLowerCase();
  if (!emailOk(email)) return res.status(400).json({ error: "email_invalide" });
  const code = gen6();
  const trade = String((req.body && req.body.trade) || "").trim().slice(0, 40) || null;
  await db.setCode(email, code, Date.now() + CODE_TTL, trade);
  try { const mode = await sendCode(email, code); res.json({ ok: true, sent: mode }); }
  catch (e) { console.error("sendCode:", e.message); res.status(500).json({ error: "envoi_impossible" }); }
});

// Vérification du code → session + démarrage de l'essai
app.post("/api/auth/verify", async (req, res) => {
  const email = String((req.body.email || "")).trim().toLowerCase();
  const code = String((req.body.code || "")).trim();
  const u = await db.getUser(email);
  if (!u || !u.code) return res.status(400).json({ error: "aucun_code" });
  if (Date.now() > Number(u.code_expires)) return res.status(400).json({ error: "code_expire" });
  if (code !== u.code) return res.status(400).json({ error: "code_invalide" });
  const t = token();
  const updated = await db.verify(email, Date.now() + TRIAL_DAYS * 86400000, t);
  res.json({ ok: true, token: t, user: publicUser(updated) });
});

app.post("/api/auth/resend", async (req, res) => {
  const email = String((req.body.email || "")).trim().toLowerCase();
  if (!emailOk(email)) return res.status(400).json({ error: "email_invalide" });
  const code = gen6();
  await db.setCode(email, code, Date.now() + CODE_TTL);
  try { await sendCode(email, code); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: "envoi_impossible" }); }
});

// Session courante
app.get("/api/me", async (req, res) => {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!t) return res.status(401).json({ error: "non_connecte" });
  const u = await db.getBySession(t);
  if (!u) return res.status(401).json({ error: "session_invalide" });
  res.json({ user: publicUser(u) });
});

// Compteur d'inscriptions (protégé par ADMIN_TOKEN)
app.get("/api/stats", async (req, res) => {
  const admin = process.env.ADMIN_TOKEN;
  const given = req.query.token || (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (admin && given !== admin) return res.status(403).json({ error: "interdit" });
  res.json(await db.stats());
});

// Suivi anonyme de l'entonnoir (aucune donnée perso)
app.post("/api/track", async (req, res) => {
  const ev = String((req.body && req.body.event) || "").trim();
  if (ev === "home") await db.track("visit_home");
  else if (ev === "signup") await db.track("visit_signup");
  res.json({ ok: true });
});

// Espace admin — réservé à ADMIN_EMAIL (l'admin se connecte via le code email normal)
app.get("/api/admin", async (req, res) => {
  const t = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!t) return res.status(401).json({ error: "non_connecte" });
  const me = await db.getBySession(t);
  if (!me) return res.status(401).json({ error: "session_invalide" });
  const admin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!admin) return res.status(403).json({ error: "admin_non_configure" });
  if ((me.email || "").toLowerCase() !== admin) return res.status(403).json({ error: "acces_refuse" });
  const now = Date.now();
  const all = await db.listUsers();
  const users = all.filter(u => (u.email || "").toLowerCase() !== admin); // exclut le compte admin des stats
  const m = await db.getMetrics();
  const verified = users.filter(u => u.verified).length;
  const trialActive = users.filter(u => u.trial_ends && Number(u.trial_ends) > now).length;
  res.json({
    kpis: { signups: users.length, verified: verified, trial_active: trialActive, paid: 0, revenue: 0 },
    funnel: { home: m.visit_home || 0, signup_page: m.visit_signup || 0, completed: verified, abandons: Math.max(0, (m.visit_signup || 0) - verified) },
    users: users.map(u => ({
      email: u.email, trade: u.trade || null, created_at: Number(u.created_at) || null, verified: !!u.verified,
      trial_ends: u.trial_ends ? Number(u.trial_ends) : null,
      days_left: u.trial_ends ? Math.max(0, Math.ceil((Number(u.trial_ends) - now) / 86400000)) : 0,
      plan: !u.trial_ends ? "none" : (Number(u.trial_ends) > now ? "trial" : "expired")
    }))
  });
});

app.get("/", (req, res) => res.type("html").send("<h1>Piscineo API</h1><p>Auth email + code, essai 30 jours. Endpoints : /health, /api/auth/*, /api/me, /api/admin.</p>"));

db.init().then(() => {
  app.listen(PORT, () => console.log(`Piscineo API (${db.mode}, email:${transporter ? "smtp" : "dev-log"}) sur le port ${PORT}`));
}).catch((e) => { console.error("DB init échec:", e.message); process.exit(1); });
