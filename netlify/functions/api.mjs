// MealPilot API — accounts, households, the shared household data (menus, recipes, shopping list, prices),
// recipe import from web pages, and recipe search on TheMealDB / Spoonacular.
//
// Storage: Netlify Blobs. Passwords are hashed with scrypt; sessions are signed cookies.
//
// Environment variables (Netlify → Project configuration → Environment variables, scope must include Functions):
//   SESSION_SECRET   – long random string (32+ characters) used to sign login cookies          [required]
//   ADMIN_USERNAME   – the SITE admin's login name                                              [required]
//   ADMIN_PASSWORD   – the site admin's password (always works; your recovery key)              [required]
//   ADMIN_HOUSEHOLD  – name for the site admin's own household (default "<username>-home")      [optional]
//   EMAIL_FROM       – sender, e.g. "MealPilot <noreply@yourdomain.com>"                        [for email]
//   RESEND_API_KEY   – Resend API key (needs a verified domain to email other people)    } one of these
//   BREVO_API_KEY    – Brevo API key (can send from a single verified sender address)    } for email
//   ADMIN_EMAIL      – where to tell the site admin about new households                       [optional]
//   SITE_URL         – public address used in email links (defaults to the address in use)     [optional]
//   VERIFY_EMAIL     – set to "on" to require email verification codes at registration (off by default)
//   MEALDB_API_KEY   – TheMealDB key (optional; the free test key "1" is used otherwise — fine for trying it out)
//   SPOONACULAR_API_KEY – Spoonacular key (optional; turns on Spoonacular recipe search)
// Email is used for password-reset links and notifications. Without a provider, the app works the same
// minus emails (forgotten passwords then go to the household admin).

import { getStore } from "@netlify/blobs";
import { scrypt, randomBytes, randomInt, timingSafeEqual, createHmac } from "node:crypto";
import { promisify } from "node:util";
import { applyOp, normalizeDoc, freshDoc, uid, searchTokens, hash52 } from "../../public/core.js";
import { gunzipSync } from "node:zlib";

const scryptAsync = promisify(scrypt);
const COOKIE = "mp_session";
const SESSION_DAYS = 7;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const CODE_MINUTES = 15;
const USER_RE = /^[a-zA-Z0-9._-]{3,30}$/;
const HH_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/;       // one word: letters, numbers, - and _
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;

/* ---------- helpers ---------- */
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const env = (k) => (globalThis.Netlify?.env?.get(k) ?? process.env[k] ?? "").trim();
const store = () => getStore({ name: "mp-auth", consistency: "strong" });
const dataStore = () => getStore({ name: "mp-data", consistency: "strong" });
const lc = (v) => String(v || "").trim().toLowerCase();
const userKey = (u) => "user:" + lc(u);
const emailKey = (e) => "em:" + lc(e);
const hhKey = (h) => "hh:" + lc(h);
const memberIdx = (hid, u) => `hhu:${hid}:${lc(u)}`;
const inviteKey = (c) => "inv:" + String(c || "").trim().toUpperCase();
const docKey = (hid) => "doc:" + hid;
const nowIso = () => new Date().toISOString();
let ORIGIN = "";                                               // set per request; used in email links
const siteUrl = () => (env("SITE_URL") || ORIGIN).replace(/\/+$/, "");
const verifyOn = () => lc(env("VERIFY_EMAIL")) === "on";
const RESET_MINUTES = 60;

function secret() {
  const s = env("SESSION_SECRET");
  if (s.length < 16) throw new Error("SESSION_SECRET is missing or too short (use 32+ characters).");
  return s;
}
function strEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); }
async function hashPassword(pw, salt = randomBytes(16).toString("hex")) { const buf = await scryptAsync(pw, salt, 64); return `${salt}:${buf.toString("hex")}`; }
async function checkPassword(pw, stored) {
  if (!stored) { await hashPassword(pw); return false; }
  const [salt, h] = stored.split(":"); const buf = await scryptAsync(pw, salt, 64); const want = Buffer.from(h, "hex");
  return want.length === buf.length && timingSafeEqual(want, buf);
}
function randomFrom(chars, n) { let s = ""; for (let i = 0; i < n; i++) s += chars[randomInt(chars.length)]; return s; }
const tempPassword = () => randomFrom("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789", 10);
const inviteCode = () => randomFrom("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
const codeHash = (username, code) => createHmac("sha256", secret()).update(lc(username) + ":" + code).digest("hex");

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
function readToken(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig || !strEq(sig, createHmac("sha256", secret()).update(body).digest("base64url"))) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function sessionCookie(u) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const token = sign({ u: u.username, hid: u.hid, r: u.hrole, sa: !!u.siteAdmin, mc: !!u.mustChange, pv: u.pv, exp });
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

const getUser = (s, u) => s.get(userKey(u), { type: "json" });
const putUser = (s, u) => s.setJSON(userKey(u.username), u);
const getHH = (s, h) => s.get(hhKey(h), { type: "json" });
const putHH = (s, h) => s.setJSON(hhKey(h.id), h);

function publicUser(u) {
  return {
    username: u.username, displayName: u.displayName, email: u.email || "", emailVerified: !!u.emailVerified,
    role: u.hrole || "member", siteAdmin: !!u.siteAdmin, status: u.status, membership: u.membership || "active",
    mustChange: !!u.mustChange, createdAt: u.createdAt, lastLogin: u.lastLogin || null,
    resetRequested: !!u.resetRequested, resetRequestedAt: u.resetRequestedAt || null, resetNote: u.resetNote || "",
    locked: (u.lockedUntil || 0) > Date.now(), hid: u.hid || null,
  };
}
const publicHH = (h) => ({ id: h.id, name: h.name, status: h.status, owner: h.owner, createdAt: h.createdAt, approvedAt: h.approvedAt || null });

// The signed-in user, checked against storage on every request (disabled / removed / suspended take effect at once).
async function currentUser(req, s) {
  const t = readToken(req);
  if (!t) return null;
  const u = await getUser(s, t.u);
  if (!u || u.status !== "active" || u.pv !== t.pv || (u.membership || "active") !== "active") return null;
  const hh = u.hid ? await getHH(s, u.hid) : null;
  if (!u.siteAdmin && (!hh || hh.status !== "active")) return null;
  return { u, hh };
}

/* ---------- email ---------- */
const emailConfigured = () => !!(env("EMAIL_FROM") && (env("RESEND_API_KEY") || env("BREVO_API_KEY")));
async function sendEmail(to, subject, text) {
  if (!emailConfigured()) return false;
  const from = env("EMAIL_FROM");
  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1f2421">${
    text.split("\n").map((l) => l.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))).join("<br>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2f6b4f;font-weight:600">$1</a>')
      .replace(/\b(\d{6})\b/, '<b style="font-size:28px;letter-spacing:4px">$1</b>')}</div>`;
  try {
    let res;
    if (env("RESEND_API_KEY")) {
      res = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { authorization: `Bearer ${env("RESEND_API_KEY")}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: [to], subject, text, html }),
      });
    } else {
      const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
      const sender = m ? { name: m[1] || "MealPilot", email: m[2] } : { name: "MealPilot", email: from };
      res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST", headers: { "api-key": env("BREVO_API_KEY"), "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ sender, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
      });
    }
    if (!res.ok) console.error("email failed", res.status, (await res.text()).slice(0, 300));
    return res.ok;
  } catch (err) { console.error("email error", err); return false; }
}
// Best-effort notification: never blocks or fails the action that triggered it.
async function notify(to, subject, text) {
  if (!to || !emailConfigured()) return;
  try { await sendEmail(to, subject, text + `\n\nMealPilot: ${siteUrl()}/`); } catch {}
}
async function ownerEmail(s, hh) { const o = hh && (await getUser(s, hh.owner)); return o && o.email ? o : null; }
// Issue a verification code or a password-reset link, rate-limited per user.
async function issueCode(s, u, purpose) {
  const now = Date.now();
  const sends = ((u.code && u.code.sends) || []).filter((t) => now - t < 3600e3);
  if (sends.length && now - sends[sends.length - 1] < 60e3) return { ok: false, error: "Please wait a minute before asking for another code." };
  if (sends.length >= 5) return { ok: false, error: "Too many codes requested. Try again in an hour." };
  const reset = purpose === "reset";
  const code = reset ? randomFrom("abcdefghijkmnpqrstuvwxyz23456789", 32) : String(randomInt(0, 1e6)).padStart(6, "0");
  u.code = { hash: codeHash(u.username, code), purpose, exp: now + (reset ? RESET_MINUTES : CODE_MINUTES) * 60e3, tries: 0, sends: sends.concat(now) };
  await putUser(s, u);
  const link = `${siteUrl()}/login.html?mode=reset&u=${encodeURIComponent(u.username)}&t=${code}`;
  const subject = reset ? "Reset your MealPilot password" : "Verify your email for MealPilot";
  const text = reset
    ? `Hi ${u.displayName},\n\nSomeone (hopefully you) asked to reset the password for your MealPilot account “${u.username}”.\n\nChoose a new password here:\n${link}\n\nThe link works once and expires in ${RESET_MINUTES} minutes. If you didn't ask for this, you can ignore this email — your password won't change.`
    : `Hi ${u.displayName},\n\nWelcome to MealPilot! Your verification code is:\n\n${code}\n\nIt expires in ${CODE_MINUTES} minutes.`;
  const sent = u.email ? await sendEmail(u.email, subject, text) : false;
  return { ok: true, sent };
}
async function checkCode(s, u, purpose, code) {
  const c = u.code;
  if (!c || c.purpose !== purpose || Date.now() > c.exp) return purpose === "reset" ? "That reset link has expired or was already used. Ask for a new one." : "That code has expired. Ask for a new one.";
  if (c.tries >= 5) return "Too many wrong codes. Ask for a new one.";
  if (!strEq(c.hash, codeHash(u.username, String(code || "").trim()))) { c.tries++; await putUser(s, u);
    return purpose === "reset" ? "That reset link isn’t valid. Ask for a new one." : "That code isn’t right. Check the email and try again."; }
  return null;
}

/* ---------- household data (one document per household) ---------- */
async function readDoc(ds, hid) {
  const r = await ds.getWithMetadata(docKey(hid), { type: "json" });
  return r && r.data ? { doc: normalizeDoc(r.data), etag: r.etag } : { doc: freshDoc(), etag: null };
}
async function writeDoc(ds, hid, doc, etag) {
  doc.updatedAt = nowIso();
  const w = await ds.setJSON(docKey(hid), doc, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
  return w.modified !== false;
}
async function mutateDoc(hid, fn) {
  const ds = dataStore();
  for (let attempt = 0; attempt < 8; attempt++) {
    const { doc, etag } = await readDoc(ds, hid);
    const out = fn(doc);
    if (await writeDoc(ds, hid, doc, etag)) return { doc, out };
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 160 * (attempt + 1)));
  }
  throw new Error("Your household’s data is busy. Please try again.");
}
// Everyone with an account is also one of the people the household cooks for (they can change their portion and diet).
async function addPerson(hid, name, username) {
  await mutateDoc(hid, (doc) => {
    if (doc.diners.some((d) => (username && lc(d.username) === lc(username)) || (!d.username && lc(d.name) === lc(name)))) return;
    doc.diners.push({ id: "p" + uid(), name, age: null, portion: 1, diet: "any", goals: [], avoid: [], username: username || "", createdBy: username || "" });
  });
}
const publicDoc = (doc) => doc;
const opUser = (u) => ({ username: u.username, displayName: u.displayName, role: u.hrole === "admin" ? "admin" : "member" });

/* ---------- site admin bootstrap ---------- */
async function ensureSiteAdmin(s, adminU, password) {
  let u = await getUser(s, adminU);
  if (!u) u = { username: adminU, displayName: adminU.charAt(0).toUpperCase() + adminU.slice(1), pv: 1, createdAt: nowIso(), passwordHash: await hashPassword(password) };
  Object.assign(u, { siteAdmin: true, status: "active", membership: "active", emailVerified: true, mustChange: false, failed: 0, lockedUntil: 0 });
  if (!u.hid || !(await getHH(s, u.hid))) {
    let name = env("ADMIN_HOUSEHOLD") || `${adminU}-home`;
    if (!HH_RE.test(name)) name = "home";
    let hh = await getHH(s, name);
    if (!hh) {
      hh = { id: lc(name), name, status: "active", owner: u.username, createdAt: nowIso(), approvedAt: nowIso(), inviteCode: inviteCode() };
      await putHH(s, hh); await s.setJSON(inviteKey(hh.inviteCode), hh.id);
    }
    u.hid = hh.id; u.hrole = "admin";
    await s.setJSON(memberIdx(hh.id, u.username), 1);
  }
  u.hrole = u.hrole || "admin";
  await putUser(s, u);
  await addPerson(u.hid, u.displayName, u.username);
  return u;
}

/* ---------- registration, verification, login ---------- */
async function register(s, b) {
  const mode = ["create", "invite", "request"].includes(b.mode) ? b.mode : "create";
  const username = String(b.username || "").trim(), displayName = String(b.displayName || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const email = lc(b.email), password = String(b.password || "");
  if (!USER_RE.test(username)) return json(400, { error: "Username must be 3–30 characters: letters, numbers, dot, dash or underscore." });
  if (!displayName) return json(400, { error: "Please enter your name." });
  if (email && !EMAIL_RE.test(email)) return json(400, { error: "That email address doesn’t look right — check it, or leave it blank and add it later." });
  if (!email && verifyOn()) return json(400, { error: "Please enter your email address." });
  if (password.length < 8) return json(400, { error: "Password must be at least 8 characters." });
  if (lc(username) === lc(env("ADMIN_USERNAME")) || (await getUser(s, username))) return json(409, { error: "That username is taken." });
  if (email && (await s.get(emailKey(email)))) return json(409, { error: "That email address is already registered. Try logging in or resetting your password." });

  let hh, hrole = "member", membership = "active";
  if (mode === "create") {
    const name = String(b.household || "").trim();
    if (!HH_RE.test(name)) return json(400, { error: "Household name must be one word, 3–30 characters: letters, numbers, - or _ (no spaces)." });
    if (await getHH(s, name)) return json(409, { error: "That household name is taken. Try another, or join it instead." });
    hh = { id: lc(name), name, status: "unverified", owner: username, createdAt: nowIso(), inviteCode: inviteCode() };
    hrole = "admin";
  } else if (mode === "invite") {
    const hid = await s.get(inviteKey(b.invite));
    hh = hid && (await getHH(s, hid));
    if (!hh || hh.status !== "active") return json(400, { error: "That invite code isn’t valid. Ask your household admin for a new one." });
  } else {
    hh = await getHH(s, String(b.household || "").trim());
    if (!hh || hh.status !== "active") return json(404, { error: "No active household with that name. Check the spelling (it’s one word), or ask for an invite link." });
    membership = "pending";
  }
  const u = { username, displayName, email, emailVerified: false, status: "unverified", hid: hh.id, hrole, membership, mode,
    pv: 1, passwordHash: await hashPassword(password), createdAt: nowIso() };
  if (mode === "create") { await putHH(s, hh); await s.setJSON(inviteKey(hh.inviteCode), hh.id); }
  await putUser(s, u);
  if (email) await s.setJSON(emailKey(email), username);
  await s.setJSON(memberIdx(hh.id, username), 1);
  if (verifyOn()) {
    const r = await issueCode(s, u, "verify");
    return json(200, { ok: true, next: "verify", username, emailSent: !!r.sent, emailEnabled: emailConfigured(),
      message: r.sent ? `We’ve emailed a 6-digit code to ${email}.` : "Email isn’t set up on this site yet, so the site admin will verify your account." });
  }
  const message = await activate(s, u, false);
  return json(200, { ok: true, next: "login", username, message });
}
// What happens once an account's email is confirmed (by code or by the site admin).
async function activate(s, u, verified = true) {
  if (verified) u.emailVerified = true;
  u.status = "active"; delete u.code;
  await putUser(s, u);
  const hh = await getHH(s, u.hid);
  if (u.mode === "create" && hh && hh.status === "unverified") {
    hh.status = "pending"; await putHH(s, hh);
    await notify(env("ADMIN_EMAIL"), `New household waiting for approval: ${hh.name}`,
      `${u.displayName} (${u.email}) registered the household “${hh.name}”.\n\nApprove or reject it here:\n${siteUrl()}/admin.html`);
  }
  if (u.membership === "active" && hh && hh.status === "active") await addPerson(hh.id, u.displayName, u.username);
  if (u.membership === "pending" && hh) {
    for (const a of await householdUsers(s, hh.id)) if (a.hrole === "admin" && a.status === "active" && a.email)
      await notify(a.email, `${u.displayName} wants to join ${hh.name}`,
        `Hi ${a.displayName},\n\n${u.displayName} (${u.email}) asked to join your household “${hh.name}” on MealPilot.\n\nApprove or reject the request here:\n${siteUrl()}/admin.html`);
  }
  const lead = verified ? "Email verified. " : "";
  const tell = u.email && emailConfigured();
  if (u.mode === "create") return `${lead}Your household is waiting for the site admin’s approval — ${tell ? "we’ll email you when it’s approved, then you can log in." : "try logging in again a little later."}`;
  if (u.membership === "pending") return `${lead}Your request to join ${hh ? hh.name : "the household"} is waiting for its admin’s approval — ${tell ? "we’ll email you when you’re in." : "try logging in again once they’ve approved it."}`;
  return `${lead}You’re in! Log in below.`;
}
async function verify(s, b) {
  const u = await getUser(s, b.username);
  if (!u) return json(400, { error: "That code isn’t right." });
  if (u.emailVerified) return json(200, { ok: true, message: "Already verified — you can log in." });
  const err = await checkCode(s, u, "verify", b.code);
  if (err) return json(400, { error: err });
  return json(200, { ok: true, message: await activate(s, u) });
}
async function resendCode(s, b) {
  const u = await getUser(s, b.username);
  if (!u || u.emailVerified) return json(200, { ok: true, message: "If that account needs verifying, a new code is on its way." });
  if (!emailConfigured()) return json(400, { error: "Email isn’t set up on this site yet. The site admin can verify your account." });
  const r = await issueCode(s, u, "verify");
  if (!r.ok) return json(429, { error: r.error });
  return json(200, { ok: true, message: r.sent ? "A new code is on its way." : "We couldn’t send the email. Please try again later." });
}

async function login(s, b) {
  let id = String(b.username || "").trim();
  const password = String(b.password || "");
  if (!id || !password) return json(400, { error: "Enter your username (or email) and password." });
  const adminU = env("ADMIN_USERNAME"), adminP = env("ADMIN_PASSWORD");
  if (adminU && adminP && lc(id) === lc(adminU) && strEq(password, adminP)) {      // site admin: always works
    const u = await ensureSiteAdmin(s, adminU, adminP);
    u.lastLogin = nowIso(); await putUser(s, u);
    return json(200, { ok: true, user: publicUser(u) }, { "set-cookie": sessionCookie(u) });
  }
  if (id.includes("@")) id = (await s.get(emailKey(id))) || id;
  const u = await getUser(s, id), now = Date.now();
  if (!u) { await checkPassword(password, null); return json(401, { error: "Wrong username or password." }); }
  if ((u.lockedUntil || 0) > now) {
    const mins = Math.ceil((u.lockedUntil - now) / 60000);
    return json(429, { error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}, or use “Forgot password”.` });
  }
  if (!(await checkPassword(password, u.passwordHash))) {
    u.failed = (u.failed || 0) + 1;
    if (u.failed >= MAX_FAILS) { u.lockedUntil = now + LOCK_MINUTES * 60000; u.failed = 0; }
    await putUser(s, u);
    return json(401, { error: "Wrong username or password." });
  }
  if (u.status === "unverified") return json(403, { error: "Please verify your email first.", verify: true, username: u.username, emailEnabled: emailConfigured() });
  if (u.status !== "active") return json(403, { error: "This account has been disabled. Contact your household admin." });
  if ((u.membership || "active") === "pending") return json(403, { error: "Your request to join is waiting for the household admin’s approval." });
  const hh = await getHH(s, u.hid);
  if (!u.siteAdmin) {
    if (!hh) return json(403, { error: "This account isn’t part of a household any more. Contact the site admin." });
    if (hh.status === "pending" || hh.status === "unverified") return json(403, { error: `Your household “${hh.name}” is waiting for the site admin’s approval.` });
    if (hh.status !== "active") return json(403, { error: `The household “${hh.name}” has been suspended. Contact the site admin.` });
  }
  Object.assign(u, { failed: 0, lockedUntil: 0, resetRequested: false, lastLogin: nowIso() });
  await putUser(s, u);
  return json(200, { ok: true, user: publicUser(u) }, { "set-cookie": sessionCookie(u) });
}

// Forgot password: emails a reset code when email is set up; otherwise asks the household admin.
async function forgot(s, b) {
  let id = String(b.username || "").trim();
  if (!id) return json(400, { error: "Enter your username or email." });
  if (id.includes("@")) id = (await s.get(emailKey(id))) || id;
  const u = await getUser(s, id);
  if (emailConfigured()) {
    if (u && u.email && u.status === "active") {
      const r = await issueCode(s, u, "reset");
      if (!r.ok) return json(429, { error: r.error });
    } else if (u && u.status !== "disabled") {          // no email on the account: ask the household admin instead
      Object.assign(u, { resetRequested: true, resetRequestedAt: nowIso(), resetNote: String(b.note || "").trim().slice(0, 200) });
      await putUser(s, u);
    }
    return json(200, { ok: true, next: "sent",
      message: `If that account has an email address, we’ve sent it a link to reset your password (it works for ${RESET_MINUTES} minutes — check spam if it doesn’t arrive). If it has no email, your household admin has been asked to give you a temporary password.` });
  }
  if (u && u.status !== "disabled") {
    Object.assign(u, { resetRequested: true, resetRequestedAt: nowIso(), resetNote: String(b.note || "").trim().slice(0, 200) });
    await putUser(s, u);
  }
  return json(200, { ok: true, message: "If that account exists, your household admin has been asked to reset your password. They’ll give you a temporary password." });
}
// Add, change or remove the email on your own account.
async function updateAccount(s, req, b) {
  const cu = await currentUser(req, s);
  if (!cu) return json(401, { error: "Please log in again." });
  const u = cu.u, email = lc(b.email);
  if (email && !EMAIL_RE.test(email)) return json(400, { error: "That email address doesn’t look right." });
  if (email === lc(u.email)) return json(200, { ok: true, user: publicUser(u), message: "No change." });
  if (email) { const owner = await s.get(emailKey(email)); if (owner && lc(owner) !== lc(u.username)) return json(409, { error: "That email address is already used by another account." }); }
  if (u.email) { const owner = await s.get(emailKey(u.email)); if (lc(owner) === lc(u.username)) await s.delete(emailKey(u.email)); }
  u.email = email; u.emailVerified = false;
  if (email) await s.setJSON(emailKey(email), u.username);
  await putUser(s, u);
  if (email) await notify(email, "Your MealPilot email address", `Hi ${u.displayName},\n\nThis email address is now on your MealPilot account “${u.username}”. We’ll use it for password resets and household updates.`);
  return json(200, { ok: true, user: publicUser(u), message: email ? "Email saved." : "Email removed." });
}
async function resetWithCode(s, b) {
  const u = await getUser(s, b.username);
  if (!u) return json(400, { error: "That code isn’t right." });
  const err = await checkCode(s, u, "reset", b.code);
  if (err) return json(400, { error: err });
  const pw = String(b.password || "");
  if (pw.length < 8) return json(400, { error: "New password must be at least 8 characters." });
  Object.assign(u, { passwordHash: await hashPassword(pw), pv: (u.pv || 1) + 1, mustChange: false, failed: 0, lockedUntil: 0, resetRequested: false });
  delete u.code;
  await putUser(s, u);
  return json(200, { ok: true, message: "Password changed. You can log in now." });
}
async function changePassword(s, req, b) {
  const cu = await currentUser(req, s);
  if (!cu) return json(401, { error: "Please log in again." });
  const u = cu.u, current = String(b.current || ""), next = String(b.next || "");
  if (!(await checkPassword(current, u.passwordHash))) return json(400, { error: "Your current password is incorrect." });
  if (next.length < 8) return json(400, { error: "New password must be at least 8 characters." });
  if (next === current) return json(400, { error: "Choose a password different from the current one." });
  Object.assign(u, { passwordHash: await hashPassword(next), pv: (u.pv || 1) + 1, mustChange: false, resetRequested: false });
  await putUser(s, u);
  return json(200, { ok: true, user: publicUser(u) }, { "set-cookie": sessionCookie(u) });
}

/* ---------- household admin ---------- */
async function householdUsers(s, hid) {
  const { blobs } = await s.list({ prefix: `hhu:${hid}:` });
  const users = (await Promise.all(blobs.map((x) => getUser(s, x.key.split(":").slice(2).join(":"))))).filter((u) => u && u.hid === hid);
  return users.sort((a, b) => a.username.localeCompare(b.username));
}
async function deleteUser(s, u) {
  await s.delete(userKey(u.username));
  if (u.email) { const owner = await s.get(emailKey(u.email)); if (lc(owner) === lc(u.username)) await s.delete(emailKey(u.email)); }
  if (u.hid) await s.delete(memberIdx(u.hid, u.username));
}
async function householdInfo(s, cu) {
  const users = await householdUsers(s, cu.hh.id);
  return json(200, { household: Object.assign(publicHH(cu.hh), { inviteCode: cu.hh.inviteCode }), users: users.map(publicUser), emailEnabled: emailConfigured() });
}
async function householdAction(s, cu, b) {
  const hh = cu.hh, me = cu.u, action = String(b.action || "");
  if (action === "newInvite") {
    if (hh.inviteCode) await s.delete(inviteKey(hh.inviteCode));
    hh.inviteCode = inviteCode(); await putHH(s, hh); await s.setJSON(inviteKey(hh.inviteCode), hh.id);
    return json(200, { ok: true, inviteCode: hh.inviteCode });
  }
  if (action === "createMember") {
    const username = String(b.username || "").trim(), displayName = String(b.displayName || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (!USER_RE.test(username)) return json(400, { error: "Username must be 3–30 characters: letters, numbers, dot, dash or underscore." });
    if (!displayName) return json(400, { error: "Please enter their name." });
    if (lc(username) === lc(env("ADMIN_USERNAME")) || (await getUser(s, username))) return json(409, { error: "That username is taken." });
    const temp = tempPassword();
    const u = { username, displayName, email: "", emailVerified: false, status: "active", hid: hh.id, hrole: "member", membership: "active",
      mode: "created", createdBy: me.username, mustChange: true, pv: 1, passwordHash: await hashPassword(temp), createdAt: nowIso() };
    await putUser(s, u); await s.setJSON(memberIdx(hh.id, username), 1);
    await addPerson(hh.id, displayName, username);
    return json(200, { ok: true, tempPassword: temp, user: publicUser(u) });
  }
  const u = await getUser(s, b.username);
  if (!u || u.hid !== hh.id) return json(404, { error: "That person isn’t in your household." });
  const self = lc(u.username) === lc(me.username), owner = lc(u.username) === lc(hh.owner);
  if ((self || owner) && ["remove", "reject", "setRole", "disable"].includes(action))
    return json(400, { error: self ? "You can’t do that to your own account." : "The household’s creator can’t be removed or demoted." });
  switch (action) {
    case "approve":
      if (u.membership !== "pending") return json(400, { error: "That request has already been handled." });
      u.membership = "active"; await putUser(s, u);
      await notify(u.email, `You’re in: ${hh.name} on MealPilot`,
        `Hi ${u.displayName},\n\n${me.displayName} approved your request to join “${hh.name}”. You can log in now:\n${siteUrl()}/login.html`);
      if (u.status === "active") await addPerson(hh.id, u.displayName, u.username);
      break;
    case "reject":
      if (u.membership !== "pending") return json(400, { error: "Only pending requests can be rejected." });
      await deleteUser(s, u);
      await notify(u.email, `Your request to join ${hh.name}`, `Hi ${u.displayName},\n\nYour request to join “${hh.name}” on MealPilot wasn’t approved. If you think this is a mistake, ask the household for an invite link.`);
      return json(200, { ok: true });
    case "remove": await deleteUser(s, u); return json(200, { ok: true });
    case "disable": u.status = "disabled"; u.pv = (u.pv || 1) + 1; await putUser(s, u); break;
    case "enable": u.status = u.emailVerified || u.mode === "created" ? "active" : "unverified"; await putUser(s, u); break;
    case "unlock": u.lockedUntil = 0; u.failed = 0; await putUser(s, u); break;
    case "dismissReset": u.resetRequested = false; await putUser(s, u); break;
    case "setRole":
      if (!["admin", "member"].includes(b.role)) return json(400, { error: "Invalid role." });
      u.hrole = b.role; u.pv = (u.pv || 1) + 1; await putUser(s, u); break;
    case "reset": {
      const temp = tempPassword();
      Object.assign(u, { passwordHash: await hashPassword(temp), pv: (u.pv || 1) + 1, mustChange: true, resetRequested: false, failed: 0, lockedUntil: 0 });
      await putUser(s, u);
      return json(200, { ok: true, tempPassword: temp, user: publicUser(u) });
    }
    default: return json(400, { error: "Unknown action." });
  }
  return json(200, { ok: true, user: publicUser(u) });
}

/* ---------- contact the site admin ---------- */
const HELP_TOPICS = { approval: "Household approval", login: "Can’t log in / password", household: "My household", bug: "Something isn’t working", other: "Something else" };
async function helpRequest(s, req, b) {
  if (String(b.website || "").trim()) return json(200, { ok: true, message: "Thanks — your message has been sent." });   // bot trap
  const message = String(b.message || "").trim().slice(0, 1500);
  const name = String(b.name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const email = lc(b.email).slice(0, 200);
  const topic = HELP_TOPICS[b.topic] ? b.topic : "other";
  if (message.length < 5) return json(400, { error: "Please write a short message so the site admin knows how to help." });
  if (email && !EMAIL_RE.test(email)) return json(400, { error: "That email address doesn’t look right — leave it blank if you’d rather not share one." });
  const ip = req.headers.get("x-nf-client-connection-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const hourKey = `hrl:${ip}:${new Date().toISOString().slice(0, 13)}`;
  const sent = Number((await s.get(hourKey)) || 0);
  if (sent >= 5) return json(429, { error: "You’ve sent several messages already. Please try again in an hour." });
  await s.set(hourKey, String(sent + 1));
  const cu = await currentUser(req, s).catch(() => null);
  const item = { id: Date.now().toString(36) + randomBytes(4).toString("hex"), at: nowIso(), topic, status: "open", message,
    name: name || (cu ? cu.u.displayName : ""), email: email || (cu ? cu.u.email || "" : ""),
    username: cu ? cu.u.username : String(b.username || "").trim().slice(0, 30), household: cu && cu.hh ? cu.hh.name : String(b.household || "").trim().slice(0, 30) };
  await s.setJSON("help:" + item.id, item);
  await notify(env("ADMIN_EMAIL"), `MealPilot help request: ${HELP_TOPICS[topic]}`,
    `From: ${item.name || "(no name)"}${item.email ? " <" + item.email + ">" : ""}${item.username ? " · @" + item.username : ""}${item.household ? " · household " + item.household : ""}\n\n${message}\n\nSee all requests: ${siteUrl()}/admin.html`);
  return json(200, { ok: true, message: "Thanks — your message has been sent to the site admin." + (item.email ? " They can reply by email." : "") });
}
async function helpList(s) {
  const { blobs } = await s.list({ prefix: "help:" });
  const items = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter(Boolean);
  items.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1) || b.at.localeCompare(a.at));
  return items.slice(0, 200).map((h) => Object.assign({}, h, { topicLabel: HELP_TOPICS[h.topic] || h.topic }));
}

/* ---------- site admin ---------- */
async function siteInfo(s) {
  const { blobs } = await s.list({ prefix: "hh:" });
  const hhs = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter(Boolean);
  const out = [];
  for (const h of hhs) {
    const users = await householdUsers(s, h.id);
    const owner = users.find((u) => lc(u.username) === lc(h.owner));
    out.push(Object.assign(publicHH(h), { members: users.filter((u) => u.status === "active" && (u.membership || "active") === "active").length,
      ownerName: owner ? owner.displayName : h.owner, ownerEmail: owner ? owner.email : "", ownerVerified: owner ? !!owner.emailVerified : false }));
  }
  const { blobs: ub } = await s.list({ prefix: "user:" });
  const unverified = (await Promise.all(ub.map((x) => s.get(x.key, { type: "json" })))).filter((u) => u && u.status === "unverified").map(publicUser);
  out.sort((a, b) => ({ pending: 0, unverified: 1, active: 2, suspended: 3 }[a.status] - { pending: 0, unverified: 1, active: 2, suspended: 3 }[b.status]) || a.name.localeCompare(b.name));
  return json(200, { households: out, unverified, emailEnabled: emailConfigured(), help: await helpList(s) });
}
async function siteAction(s, cu, b) {
  const action = String(b.action || "");
  if (action === "verifyUser") {
    const u = await getUser(s, b.username);
    if (!u || u.status !== "unverified") return json(400, { error: "That account doesn’t need verifying." });
    return json(200, { ok: true, message: await activate(s, u) });
  }
  if (["resolveHelp", "reopenHelp", "deleteHelp"].includes(action)) {
    const k = "help:" + String(b.id || ""), h = await s.get(k, { type: "json" });
    if (!h) return json(404, { error: "That request no longer exists." });
    if (action === "deleteHelp") { await s.delete(k); return json(200, { ok: true }); }
    h.status = action === "resolveHelp" ? "resolved" : "open"; h.resolvedAt = action === "resolveHelp" ? nowIso() : undefined;
    await s.setJSON(k, h);
    return json(200, { ok: true });
  }
  if (action === "deleteUser") {
    const u = await getUser(s, b.username);
    if (!u || u.siteAdmin) return json(400, { error: "That account can’t be deleted here." });
    const hh = u.hid && (await getHH(s, u.hid));
    if (hh && lc(hh.owner) === lc(u.username) && hh.status !== "active") {      // abandoned sign-up: free the household name too
      if (hh.inviteCode) await s.delete(inviteKey(hh.inviteCode));
      await s.delete(hhKey(hh.id));
    }
    await deleteUser(s, u);
    return json(200, { ok: true });
  }
  if (action === "resetUser") {
    const u = await getUser(s, b.username); if (!u) return json(404, { error: "User not found." });
    if (u.siteAdmin) return json(400, { error: "Use ADMIN_PASSWORD for the site admin account." });
    const temp = tempPassword();
    Object.assign(u, { passwordHash: await hashPassword(temp), pv: (u.pv || 1) + 1, mustChange: true, failed: 0, lockedUntil: 0 });
    await putUser(s, u);
    return json(200, { ok: true, tempPassword: temp });
  }
  const hh = await getHH(s, b.hid);
  if (!hh) return json(404, { error: "Household not found." });
  if (hh.id === cu.u.hid && ["suspend", "delete", "reject"].includes(action)) return json(400, { error: "That’s your own household." });
  switch (action) {
    case "approve": {
      if (hh.status !== "pending" && hh.status !== "unverified") return json(400, { error: "That household is already approved." });
      hh.status = "active"; hh.approvedAt = nowIso(); await putHH(s, hh);
      for (const u of await householdUsers(s, hh.id)) if (u.status === "active" && (u.membership || "active") === "active") await addPerson(hh.id, u.displayName, u.username);
      const o = await ownerEmail(s, hh);
      if (o) await notify(o.email, `${hh.name} is approved — welcome to MealPilot`,
        `Hi ${o.displayName},\n\nGood news: your household “${hh.name}” has been approved. Log in here:\n${siteUrl()}/login.html\n\nTo bring the rest of the household in, open Admin → My household and share your invite link.`);
      return json(200, { ok: true });
    }
    case "suspend": {
      hh.status = "suspended"; await putHH(s, hh);
      const o = await ownerEmail(s, hh);
      if (o) await notify(o.email, `${hh.name} has been suspended`, `Hi ${o.displayName},\n\nYour household “${hh.name}” has been suspended on MealPilot, so nobody in it can log in for now. Reply to the site admin if you think this is a mistake.`);
      return json(200, { ok: true });
    }
    case "reactivate": {
      hh.status = "active"; await putHH(s, hh);
      const o = await ownerEmail(s, hh);
      if (o) await notify(o.email, `${hh.name} is active again`, `Hi ${o.displayName},\n\nYour household “${hh.name}” is active again on MealPilot. Log in here:\n${siteUrl()}/login.html`);
      return json(200, { ok: true });
    }
    case "reject": case "delete": {
      const o = await ownerEmail(s, hh);
      if (o && action === "reject") await notify(o.email, `Your MealPilot household ${hh.name}`, `Hi ${o.displayName},\n\nSorry — the household “${hh.name}” wasn’t approved on MealPilot.`);
      for (const u of await householdUsers(s, hh.id)) if (!u.siteAdmin) await deleteUser(s, u);
      if (hh.inviteCode) await s.delete(inviteKey(hh.inviteCode));
      await s.delete(hhKey(hh.id));
      await dataStore().delete(docKey(hh.id));
      return json(200, { ok: true });
    }
    default: return json(400, { error: "Unknown action." });
  }
}

/* ---------- household data ---------- */
async function getData(req, s) {
  const cu = await currentUser(req, s);
  if (!cu) return json(401, { error: "Please log in again." });
  const { doc } = await readDoc(dataStore(), cu.u.hid);
  return json(200, { doc: publicDoc(doc) });
}
async function postData(req, s, b) {
  const cu = await currentUser(req, s);
  if (!cu) return json(401, { error: "Please log in again." });
  const ops = Array.isArray(b.ops) ? b.ops.slice(0, 60) : [];
  if (!ops.length) return json(400, { error: "Nothing to save." });
  const ds = dataStore(), hid = cu.u.hid, user = opUser(cu.u);
  for (let attempt = 0; attempt < 8; attempt++) {
    const { doc, etag } = await readDoc(ds, hid);
    const results = [];
    try { for (const op of ops) results.push(applyOp(doc, op, user) ?? null); }
    catch (err) { if (!err.user) throw err; return json(400, { error: err.message, doc: publicDoc(doc) }); }
    if (await writeDoc(ds, hid, doc, etag)) return json(200, { ok: true, doc: publicDoc(doc), results });
    await new Promise((r) => setTimeout(r, 40 + Math.random() * 160 * (attempt + 1)));
  }
  return json(503, { error: "Your household’s data is busy. Please try again." });
}

/* ---------- recipes from the web ---------- */
// Simple per-user hourly limit for outside requests.
async function underLimit(s, key, max) {
  const k = `rl:${key}:${new Date().toISOString().slice(0, 13)}`;
  const n = Number((await s.get(k)) || 0);
  if (n >= max) return false;
  await s.set(k, String(n + 1));
  return true;
}
function blockedHost(h) {
  h = lc(h).replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b2] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b2 === 254) || (a === 172 && b2 >= 16 && b2 <= 31) || (a === 192 && b2 === 168) || a >= 224 || (a === 100 && b2 >= 64 && b2 <= 127);
  }
  return h.includes(":");                                          // raw IPv6 addresses
}
async function fetchText(url, { timeout = 10000, max = 4e6, headers = {} } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: Object.assign({ "user-agent": "Mozilla/5.0 (compatible; MealPilot/1.0; household recipe import)", accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "accept-language": "en-GB,en;q=0.9" }, headers), redirect: "follow", signal: ctrl.signal });
    const finalHost = new URL(res.url || url).hostname;
    if (blockedHost(finalHost)) throw Object.assign(new Error("blocked"), { status: 400 });
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    let text = "";
    if (reader) {
      const dec = new TextDecoder(); let got = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; got += value.length; text += dec.decode(value, { stream: true }); if (got > max) { ctrl.abort(); break; } }
    } else text = await res.text();
    return { ok: res.ok, status: res.status, text, url: res.url || url };
  } finally { clearTimeout(t); }
}
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", frac12: "½", frac14: "¼", frac34: "¾", deg: "°", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", eacute: "é", egrave: "è", times: "×" };
function decodeHtml(v) {
  return String(v ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENT[n.toLowerCase()] ?? m).replace(/[ \t]+/g, " ").trim();
}
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
function isoMinutes(v) {
  const m = String(v || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m || !String(v).startsWith("P")) { const n = parseInt(v, 10); return isFinite(n) ? n : null; }
  const mins = (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  return mins || null;
}
function findRecipeNode(node, depth = 0) {
  if (!node || depth > 8) return null;
  if (Array.isArray(node)) { for (const x of node) { const r = findRecipeNode(x, depth + 1); if (r) return r; } return null; }
  if (typeof node !== "object") return null;
  if (arr(node["@type"]).some((t) => /recipe$/i.test(String(t)))) return node;
  for (const k of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) { const r = findRecipeNode(node[k], depth + 1); if (r) return r; }
  return null;
}
function instructionsOf(v) {
  const out = [];
  const walk = (x) => {
    if (x == null) return;
    if (typeof x === "string") { decodeHtml(x).split(/\n+|(?<=\.)\s+(?=\d+\.\s)/).map((t) => t.replace(/^\s*(step\s*)?\d+[.):]\s*/i, "").trim()).filter(Boolean).forEach((t) => out.push(t)); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (typeof x === "object") {
      if (x.itemListElement) { walk(x.itemListElement); return; }
      if (x.text) { walk(String(x.text)); return; }
      if (x.name && !x.url) walk(String(x.name));
    }
  };
  walk(v);
  return out.filter((t, i) => t.length > 2 && out.indexOf(t) === i).slice(0, 60);
}
function imageOf(v) {
  for (const x of arr(v)) { const u = typeof x === "string" ? x : x && (x.url || x.contentUrl); if (u && /^https:\/\//.test(u)) return u; }
  return "";
}
function extractRecipe(html, pageUrl) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  let node = null;
  for (const raw of blocks) {
    let data = null;
    const txt = raw.replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "").trim();
    try { data = JSON.parse(txt); } catch { try { data = JSON.parse(txt.replace(/,\s*([}\]])/g, "$1").replace(/[\u0000-\u001f]+/g, " ")); } catch { continue; } }
    node = findRecipeNode(data);
    if (node) break;
  }
  if (!node) return null;
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const yieldNum = arr(node.recipeYield).map((y) => parseInt(String(y).match(/\d+/)?.[0] || "", 10)).find((n) => n > 0 && n < 100);
  const author = arr(node.author).map((a) => (typeof a === "string" ? a : a && a.name)).filter(Boolean)[0] || "";
  const site = (node.publisher && (node.publisher.name || (Array.isArray(node.publisher) && node.publisher[0]?.name))) || host;
  return {
    name: decodeHtml(node.name || node.headline || "").slice(0, 100),
    description: decodeHtml(node.description || "").slice(0, 400),
    ingredients: arr(node.recipeIngredient || node.ingredients).map((x) => decodeHtml(typeof x === "string" ? x : x && (x.text || x.name))).filter(Boolean).slice(0, 80),
    steps: instructionsOf(node.recipeInstructions),
    prep: isoMinutes(node.prepTime), cook: isoMinutes(node.cookTime), total: isoMinutes(node.totalTime),
    servings: yieldNum || null,
    cuisine: decodeHtml(arr(node.recipeCuisine)[0] || ""), category: decodeHtml(arr(node.recipeCategory).join(", ")),
    keywords: decodeHtml(arr(node.keywords).join(", ")).slice(0, 300),
    image: imageOf(node.image),
    source: { type: "link", url: pageUrl, site: decodeHtml(site).slice(0, 80), author: decodeHtml(author).slice(0, 80) },
  };
}
async function importUrl(s, cu, b) {
  let u;
  try { u = new URL(String(b.url || "").trim()); } catch { return json(400, { error: "That doesn’t look like a web address. Copy the full link from your browser (it starts with https://)." }); }
  if (!/^https?:$/.test(u.protocol) || blockedHost(u.hostname)) return json(400, { error: "That address can’t be used. Paste a link to a recipe page on a public website." });
  if (!(await underLimit(s, "imp:" + cu.u.username, 40))) return json(429, { error: "You’ve imported a lot of recipes this hour. Try again later." });
  let page;
  try { page = await fetchText(u.href); }
  catch (err) { return json(502, { error: err.name === "AbortError" ? "That site took too long to answer. Try again, or use “Paste the recipe text”." : "Couldn’t reach that site. Check the link, or use “Paste the recipe text”." }); }
  if (!page.ok) return json(502, { error: `That site wouldn’t share the page (error ${page.status}) — some sites block apps. Open the recipe yourself and use “Paste the recipe text” instead.` });
  const recipe = extractRecipe(page.text, page.url);
  if (!recipe || !recipe.ingredients.length) {
    const title = decodeHtml((page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 80);
    return json(422, { error: `Couldn’t find recipe details on ${title ? "“" + title + "”" : "that page"}. Use “Paste the recipe text” and copy the ingredients and method from the page.` });
  }
  return json(200, { recipe });
}

// TheMealDB: free to search; the test key "1" is for development — buy a supporter key for a public app.
const MEALDB_AREAS = { "South Indian": "Indian", "North Indian": "Indian", "West Indian": "Indian", "Indo-Chinese": "Chinese", Italian: "Italian", British: "British", Mexican: "Mexican",
  Chinese: "Chinese", Thai: "Thai", Japanese: "Japanese", Korean: "Korean", Mediterranean: "Greek", "Middle Eastern": "Turkish", Spanish: "Spanish", French: "French", American: "American" };
const mealdbBase = () => `https://www.themealdb.com/api/json/v1/${encodeURIComponent(env("MEALDB_API_KEY") || "1")}/`;
async function mealdb(path) {
  const r = await fetchText(mealdbBase() + path, { timeout: 8000, max: 2e6, headers: { accept: "application/json" } });
  if (!r.ok) throw new Error("TheMealDB answered with error " + r.status);
  return JSON.parse(r.text || "{}");
}
function mealdbRecipe(m) {
  const ingredients = [];
  for (let i = 1; i <= 20; i++) {
    const name = (m["strIngredient" + i] || "").trim(), meas = (m["strMeasure" + i] || "").trim();
    if (name) ingredients.push(`${meas} ${name}`.trim());
  }
  return {
    name: m.strMeal, description: "", ingredients, steps: instructionsOf(String(m.strInstructions || "").replace(/\r/g, "")),
    prep: null, cook: null, total: null, servings: null, cuisine: m.strArea || "", category: m.strCategory || "", keywords: m.strTags || "",
    image: /^https:/.test(m.strMealThumb || "") ? m.strMealThumb : "",
    source: { type: "mealdb", url: m.strSource || `https://www.themealdb.com/meal/${m.idMeal}`, site: m.strSource ? new URL(m.strSource).hostname.replace(/^www\./, "") : "TheMealDB", author: "" },
    youtube: m.strYoutube || "",
  };
}
async function discover(s, cu, q) {
  const source = q.get("source") || "mealdb", text = String(q.get("q") || "").trim().slice(0, 80), cuisine = q.get("cuisine") || "";
  if (!(await underLimit(s, "disc:" + cu.u.username, 300))) return json(429, { error: "Lots of searches this hour — try again later." });
  try {
    if (source === "spoonacular") {
      const key = env("SPOONACULAR_API_KEY");
      if (!key) return json(400, { error: "Spoonacular search isn’t set up on this site (needs SPOONACULAR_API_KEY)." });
      const p = new URLSearchParams({ query: text, number: "24", apiKey: key });
      if (cuisine) p.set("cuisine", ({ "South Indian": "Indian", "North Indian": "Indian", "West Indian": "Indian", "Indo-Chinese": "Chinese", "Middle Eastern": "Middle Eastern" })[cuisine] || cuisine);
      const r = await fetchText("https://api.spoonacular.com/recipes/complexSearch?" + p, { timeout: 9000, headers: { accept: "application/json" } });
      if (!r.ok) return json(502, { error: r.status === 402 ? "Today’s Spoonacular allowance is used up. Try again tomorrow." : "Spoonacular search failed (" + r.status + ")." });
      const data = JSON.parse(r.text);
      return json(200, { source, results: (data.results || []).map((x) => ({ id: String(x.id), name: x.title, image: x.image || "", cuisine: cuisine || "" })) });
    }
    let meals = [];
    if (text) meals = (await mealdb("search.php?s=" + encodeURIComponent(text))).meals || [];
    else if (cuisine && MEALDB_AREAS[cuisine]) meals = (await mealdb("filter.php?a=" + encodeURIComponent(MEALDB_AREAS[cuisine]))).meals || [];
    else { const rs = await Promise.all([0, 1, 2, 3, 4, 5].map(() => mealdb("random.php").catch(() => ({ meals: [] })))); meals = rs.flatMap((x) => x.meals || []); }
    if (text && cuisine && MEALDB_AREAS[cuisine]) meals = meals.filter((m) => !m.strArea || m.strArea === MEALDB_AREAS[cuisine]);
    const seen = new Set();
    return json(200, { source: "mealdb", results: meals.filter((m) => !seen.has(m.idMeal) && seen.add(m.idMeal)).slice(0, 40)
      .map((m) => ({ id: String(m.idMeal), name: m.strMeal, image: m.strMealThumb || "", cuisine: m.strArea || "" })) });
  } catch (err) { console.error(err); return json(502, { error: "Recipe search isn’t answering right now. Try again in a minute." }); }
}
async function discoverItem(s, cu, q) {
  const source = q.get("source") || "mealdb", id = String(q.get("id") || "");
  if (!/^\d{1,12}$/.test(id)) return json(400, { error: "Unknown recipe." });
  try {
    if (source === "spoonacular") {
      // Spoonacular's terms only allow keeping a recipe's ID, title and picture, so we only fetch where the recipe
      // came from; the app then imports it from that original page like any other link.
      const key = env("SPOONACULAR_API_KEY");
      if (!key) return json(400, { error: "Spoonacular isn’t set up on this site." });
      const r = await fetchText(`https://api.spoonacular.com/recipes/${id}/information?includeNutrition=false&apiKey=${encodeURIComponent(key)}`, { timeout: 9000, headers: { accept: "application/json" } });
      if (!r.ok) return json(502, { error: "Spoonacular didn’t answer (" + r.status + ")." });
      const d = JSON.parse(r.text);
      return json(200, { source, sourceUrl: d.sourceUrl || d.spoonacularSourceUrl || "", sourceName: d.sourceName || "", name: d.title || "", image: d.image || "", readyInMinutes: d.readyInMinutes || null, servings: d.servings || null });
    }
    const m = ((await mealdb("lookup.php?i=" + id)).meals || [])[0];
    if (!m) return json(404, { error: "That recipe isn’t on TheMealDB any more." });
    return json(200, { source: "mealdb", recipe: mealdbRecipe(m) });
  } catch (err) { console.error(err); return json(502, { error: "Recipe search isn’t answering right now. Try again in a minute." }); }
}

/* ---------- the shared recipe library (built by tools/library, stored in Netlify Blobs) ---------- */
const libStore = () => getStore({ name: "mp-library", consistency: "eventual" });
const libCache = new Map();                                  // small in-memory cache per function instance
async function libGet(key, { cache = true } = {}) {
  if (cache && libCache.has(key)) { const v = libCache.get(key); libCache.delete(key); libCache.set(key, v); return v; }
  const buf = await libStore().get(key, { type: "arrayBuffer" });
  if (!buf) return null;
  let text;
  try { text = gunzipSync(Buffer.from(buf)).toString("utf8"); } catch { text = Buffer.from(buf).toString("utf8"); }
  if (cache) { libCache.set(key, text); if (libCache.size > 300) libCache.delete(libCache.keys().next().value); }
  return text;
}
let metaCache = { at: 0, v: null };
async function libMeta() {
  if (Date.now() - metaCache.at < 60000) return metaCache.v;
  const cur = await libStore().get("current", { type: "text" });
  const meta = cur ? JSON.parse((await libGet(`${cur}/meta.json`, { cache: false })) || "null") : null;
  metaCache = { at: Date.now(), v: meta };
  return meta;
}
const forever = { "cache-control": "private, max-age=31536000, immutable" };
const raw = (text, headers = {}) => new Response(text, { status: 200, headers: { "content-type": "application/json", ...headers } });
async function libRoute(path, q) {
  const meta = await libMeta();
  if (path === "/api/lib/meta") return json(200, meta ? { version: meta.version, library: meta.library, archive: { count: meta.archive.count }, linkOnly: meta.linkOnly } : { version: null });
  if (!meta) return json(404, { error: "The recipe library hasn't been set up yet." });
  const v = q.get("v") || meta.version;
  if (!/^\d{8,14}$/.test(v)) return json(400, { error: "Bad version." });
  if (path === "/api/lib/head" || path === "/api/lib/index" || path === "/api/lib/rec") {
    const key = path === "/api/lib/head" ? "library/head.json" : path === "/api/lib/index" ? `library/index-${Number(q.get("p")) || 0}.json` : `library/rec-${Number(q.get("s")) || 0}.json`;
    const text = await libGet(`${v}/${key}`, { cache: path !== "/api/lib/index" });
    return text ? raw(text, forever) : json(404, { error: "Not found — the library may have been updated. Reload the app." });
  }
  if (path === "/api/lib/search") return libSearch(meta, q);
  if (path === "/api/lib/arc") {
    const k = Number(q.get("k"));
    if (!(k >= 0 && k < meta.archive.count)) return json(404, { error: "Recipe not found." });
    const shard = JSON.parse(await libGet(`${meta.version}/archive/rec-${Math.floor(k / meta.archive.shardSize)}.json`) || "[]");
    const r = shard[k % meta.archive.shardSize];
    return r ? json(200, { recipe: r, linkOnly: !!r.lo }) : json(404, { error: "Recipe not found." });
  }
  return json(404, { error: "Not found." });
}
// Title search over the whole archive: every word must match; if that finds little, closest matches follow.
async function libSearch(meta, q) {
  const toks = searchTokens(String(q.get("q") || "").slice(0, 100)).slice(0, 6);
  if (!toks.length) return json(400, { error: "Type a dish or ingredient to search for." });
  const offset = Math.max(0, Number(q.get("o")) || 0), cuisine = String(q.get("cu") || "");
  const A = meta.archive, lists = [];
  for (const t of toks) {
    const shard = JSON.parse(await libGet(`${meta.version}/archive/post-${hash52(t) % A.postShards}.json`) || "{}");
    const d = shard[t];
    if (!d) { lists.push([]); continue; }
    let acc = 0; lists.push(d.map((x) => (acc += x)));
  }
  const count = new Map();
  for (const l of lists) for (const id of l) count.set(id, (count.get(id) || 0) + 1);
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const all = ranked.filter(([, c]) => c === toks.length).length;
  const pick = ranked.slice(offset, offset + (cuisine ? 120 : 24));
  const shards = new Map();
  await Promise.all([...new Set(pick.map(([id]) => Math.floor(id / A.shardSize)))].map(async (s) => shards.set(s, JSON.parse(await libGet(`${meta.version}/archive/rec-${s}.json`) || "[]"))));
  let items = pick.map(([id, c]) => { const r = (shards.get(Math.floor(id / A.shardSize)) || [])[id % A.shardSize]; return r && { k: id, all: c === toks.length, t: r.t, s: r.s, cu: r.cu || "", time: r.T || (r.p != null && r.c != null ? r.p + r.c : null), v: r.v || null, lo: !!r.lo, nq: !!r.nq, n: (r.l || []).length, site: r.u ? (() => { try { return new URL(r.u).hostname.replace(/^www\./, ""); } catch { return ""; } })() : "", preview: (r.l || []).slice(0, 5) }; }).filter(Boolean);
  if (cuisine) items = items.filter((x) => x.cu === cuisine).slice(0, 24);
  return json(200, { total: all, approx: all === 0, items, more: offset + pick.length < ranked.length, next: offset + pick.length });
}

/* ---------- router ---------- */
export default async (req) => {
  try {
    secret();
    const reqUrl = new URL(req.url);
    ORIGIN = reqUrl.origin;
    const path = reqUrl.pathname.replace(/\/+$/, "");
    const s = store();

    if (req.method === "GET") {
      if (path === "/api/config") return json(200, { emailEnabled: emailConfigured(), verifyEmail: verifyOn(), spoonacular: !!env("SPOONACULAR_API_KEY"), mealdbTestKey: !env("MEALDB_API_KEY") });
      if (path === "/api/me") {
        const cu = await currentUser(req, s);
        return cu ? json(200, { user: publicUser(cu.u), household: cu.hh ? publicHH(cu.hh) : null })
          : json(401, { error: "Not logged in." }, { "set-cookie": clearCookie });
      }
      if (path === "/api/household") {
        const cu = await currentUser(req, s);
        if (!cu || cu.u.hrole !== "admin") return json(403, { error: "Household admins only." });
        return householdInfo(s, cu);
      }
      if (path === "/api/site") {
        const cu = await currentUser(req, s);
        if (!cu || !cu.u.siteAdmin) return json(403, { error: "Site admin only." });
        return siteInfo(s);
      }
      if (path === "/api/data") return getData(req, s);
      if (path.startsWith("/api/lib/")) {
        const cu = await currentUser(req, s);
        if (!cu) return json(401, { error: "Please log in again." });
        return libRoute(path, reqUrl.searchParams);
      }
      if (path === "/api/discover" || path === "/api/discover/item") {
        const cu = await currentUser(req, s);
        if (!cu) return json(401, { error: "Please log in again." });
        return path === "/api/discover" ? discover(s, cu, reqUrl.searchParams) : discoverItem(s, cu, reqUrl.searchParams);
      }
      const inv = path.match(/^\/api\/invite\/([A-Za-z0-9]{4,12})$/);
      if (inv) {                                   // lets the sign-up page show which household an invite is for
        const hid = await s.get(inviteKey(inv[1])); const hh = hid && (await getHH(s, hid));
        return hh && hh.status === "active" ? json(200, { household: hh.name }) : json(404, { error: "That invite isn’t valid any more." });
      }
      return json(404, { error: "Not found." });
    }

    if (req.method !== "POST") return json(405, { error: "Method not allowed." });
    if (!(req.headers.get("content-type") || "").includes("application/json")) return json(415, { error: "Expected JSON." });   // blocks CSRF form posts
    let b = {};
    try { b = await req.json(); } catch { return json(400, { error: "Invalid request." }); }

    switch (path) {
      case "/api/register": return register(s, b);
      case "/api/verify": return verify(s, b);
      case "/api/verify/resend": return resendCode(s, b);
      case "/api/login": return login(s, b);
      case "/api/logout": return json(200, { ok: true }, { "set-cookie": clearCookie });
      case "/api/forgot": return forgot(s, b);
      case "/api/reset": return resetWithCode(s, b);
      case "/api/change-password": return changePassword(s, req, b);
      case "/api/account": return updateAccount(s, req, b);
      case "/api/help": return helpRequest(s, req, b);
      case "/api/data": return postData(req, s, b);
      case "/api/import/url": {
        const cu = await currentUser(req, s);
        if (!cu) return json(401, { error: "Please log in again." });
        return importUrl(s, cu, b);
      }
      case "/api/household/action": {
        const cu = await currentUser(req, s);
        if (!cu || cu.u.hrole !== "admin") return json(403, { error: "Household admins only." });
        return householdAction(s, cu, b);
      }
      case "/api/site/action": {
        const cu = await currentUser(req, s);
        if (!cu || !cu.u.siteAdmin) return json(403, { error: "Site admin only." });
        return siteAction(s, cu, b);
      }
      default: return json(404, { error: "Not found." });
    }
  } catch (err) {
    console.error(err);
    return json(500, { error: err.message?.includes("SESSION_SECRET") ? err.message : "Server error. Please try again." });
  }
};

export const config = { path: "/api/*" };
