// Shared app state, syncing with the server, and small UI helpers used by every screen.
import * as C from "./core.js";
import { INGREDIENTS, AISLES, AISLE_ORDER, BUILTIN_RECIPES, CURRENCIES, FX_FROM_GBP } from "./data/index.js";

export { C, AISLES, CURRENCIES };
export const S = {
  user: null, household: null, local: false, config: {}, doc: C.freshDoc(),
  cat: null, recipes: [], byId: new Map(), pricer: null, builtIns: [],
  tab: "plan", online: navigator.onLine !== false, syncing: false, lastSync: 0,
};
export const ACT = {};          // click handlers by data-act name
export const ON = {};           // change/input handlers by data-on name
const RENDER = {};              // screen renderers by tab name
export function screen(name, fn) { RENDER[name] = fn; }

/* ---------- storage that may be unavailable (private windows etc.) ---------- */
export const store = {
  get(k, d = null) { try { const v = localStorage.getItem("mp:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("mp:" + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("mp:" + k); } catch {} },
};

/* ---------- derived data: catalogue, recipes, prices ---------- */
let builtInCat = null;
export function rebuild() {
  const doc = S.doc;
  S.cat = C.buildCatalog(INGREDIENTS, doc.ingredients, { aisles: AISLES, aisleOrder: AISLE_ORDER });
  if (!S.builtIns.length || builtInCat !== INGREDIENTS) { S.builtIns = BUILTIN_RECIPES.map((r) => C.expandBuiltIn(r, S.cat)); builtInCat = INGREDIENTS; }
  const house = (doc.recipes || []).map((r) => Object.assign({ builtIn: false }, r));
  S.recipes = [...S.builtIns, ...LIB.recipes, ...house];
  S.byId = new Map(S.recipes.map((r) => [r.id, r]));
  S.cuisines = new Set(S.recipes.map((r) => r.cuisine));
  S.pricer = C.makePricer(S.cat, doc.prices, doc.settings.currency, FX_FROM_GBP);
  // Only forget worked-out costs when prices could have changed (recomputing 50,000 recipes on every tick is slow).
  let entries = 0, last = ""; for (const h of Object.values(doc.prices || {})) { entries += h.length; const e = h[h.length - 1]; if (e && e.at > last) last = e.at; }
  const sig = `${doc.settings.currency}|${entries}|${last}|${(doc.ingredients || []).length}`;
  if (sig !== FACTS_SIG) { FACTS.clear(); FACTS_SIG = sig; }
  S.favs = new Set((doc.favRecipes || {})[S.user ? S.user.username : ""] || []);
}
export const recipe = (id) => S.byId.get(id);
export const ingredient = (id) => S.cat.byId.get(id);
export const isAdmin = () => !!S.user && (S.user.role === "admin");
export const me = () => (S.user ? S.user.username : "");

/* ---------- sync ---------- */
let queue = store.get("queue", []);
async function api(path, opts = {}) {
  const res = await fetch(path, Object.assign({ credentials: "same-origin", headers: opts.body ? { "content-type": "application/json" } : {} }, opts,
    opts.body ? { method: opts.method || "POST", body: JSON.stringify(opts.body) } : {}));
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !S.local) { location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.hash); throw new Error("Please log in again."); }
  if (!res.ok) { const e = new Error(data.error || `Something went wrong (${res.status}).`); e.status = res.status; e.data = data; throw e; }
  return data;
}
export { api };

export async function boot() {
  try {
    const meRes = await fetch("/api/me", { credentials: "same-origin" });
    if (meRes.status === 401) { location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.hash); return false; }
    if (!meRes.ok || !(meRes.headers.get("content-type") || "").includes("json")) throw new Error("no server");
    const d = await meRes.json();
    S.user = { username: d.user.username, displayName: d.user.displayName, role: d.user.role, siteAdmin: d.user.siteAdmin, email: d.user.email };
    S.household = d.household;
    S.config = await api("/api/config").catch(() => ({}));
    const cached = store.get("doc:" + S.user.username);
    if (cached) { S.doc = C.normalizeDoc(cached); rebuild(); }
    await pull(true);
  } catch (err) {
    // No server (opened from a file or a preview): run on this device only.
    S.local = true;
    S.user = { username: "you", displayName: "You", role: "admin" };
    S.household = { name: "This device" };
    S.doc = C.normalizeDoc(store.get("localdoc", null) || C.freshDoc());
    if (!S.doc.diners.length) S.doc.diners.push({ id: "p1", name: "You", portion: 1, diet: "any", goals: [], avoid: [], username: "you", createdBy: "you" });
  }
  rebuild();
  return true;
}
export async function pull(force = false) {
  if (S.local || (!force && queue.length) || S.syncing) return;
  try {
    const d = await api("/api/data");
    const changed = !S.doc.updatedAt || d.doc.updatedAt !== S.doc.updatedAt;
    S.doc = C.normalizeDoc(d.doc);
    applyQueued();
    store.set("doc:" + me(), S.doc);
    S.online = true; S.lastSync = Date.now();
    if (changed) { rebuild(); refresh({ soft: true }); }
  } catch (err) { if (!err.status) S.online = false; }
  banner();
}
function applyQueued() {
  for (const op of queue) { try { C.applyOp(S.doc, op, opUser()); } catch {} }
}
const opUser = () => ({ username: S.user.username, displayName: S.user.displayName, role: S.user.role });

// Make changes: show them at once, then save. Returns the result of the last op (e.g. a new id).
export function commit(ops, { quiet = false } = {}) {
  ops = Array.isArray(ops) ? ops : [ops];
  for (const op of ops) prepareIds(op);
  const draft = structuredClone(S.doc);
  let result = null;
  try { for (const op of ops) result = C.applyOp(draft, op, opUser()) ?? result; }
  catch (err) { toast(err.message, true); return { error: err.message }; }
  S.doc = draft;
  rebuild();
  if (S.local) { store.set("localdoc", S.doc); refresh({ soft: true }); return { result }; }
  queue.push(...ops); store.set("queue", queue); store.set("doc:" + me(), S.doc);
  refresh({ soft: true });
  flush();
  if (!quiet && !S.online) toast("Saved on this phone — it will sync when you're back online.");
  return { result };
}
function prepareIds(op) {
  const id = (p) => p + C.uid();
  if (["createMenu"].includes(op.type) && !op.newId) op.newId = id("m");
  if (op.type === "saveDiner" && !(op.diner && op.diner.id) && !op.newId) op.newId = id("p");
  if (op.type === "saveFavorite" && !op.newId) op.newId = id("f");
  if (op.type === "suggest" && !op.newId) op.newId = id("s");
  if (op.type === "applyReceipt" && !op.newId) op.newId = id("r");
  if (op.type === "saveRecipe" && op.recipe && !op.recipe.id) op.recipe.id = "h:" + C.uid();
  if (op.type === "addIngredient" && !op.newId) op.newId = "c_" + C.norm(op.name || "").replace(/ /g, "_").slice(0, 30) + "_" + C.uid().slice(-4);
  if (op.type === "listAdd") for (const it of op.items || []) if (!it.newId) it.newId = id("i");
}
let flushing = null;
export function flush() {
  if (S.local || !queue.length) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    while (queue.length) {
      const batch = queue.slice(0, 50);
      try {
        S.syncing = true;
        const d = await api("/api/data", { body: { ops: batch } });
        queue = queue.slice(batch.length); store.set("queue", queue);
        S.doc = C.normalizeDoc(d.doc); applyQueued(); rebuild();
        store.set("doc:" + me(), S.doc);
        S.online = true; S.lastSync = Date.now();
      } catch (err) {
        if (err.status === 400) {                              // the server refused a change: drop it and show the latest data
          queue = queue.slice(batch.length); store.set("queue", queue);
          if (err.data && err.data.doc) { S.doc = C.normalizeDoc(err.data.doc); applyQueued(); rebuild(); }
          toast(err.message, true);
        } else { S.online = false; break; }
      } finally { S.syncing = false; }
    }
    banner(); refresh({ soft: true });
  })().finally(() => { flushing = null; });
  return flushing;
}
window.addEventListener("online", () => { S.online = true; flush().then(() => pull()); });
window.addEventListener("offline", () => { S.online = false; banner(); });
setInterval(() => { if (document.visibilityState === "visible") { if (queue.length) flush(); else pull(); } }, 20000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pull(); });

export function banner() {
  const b = document.getElementById("banner");
  if (!b) return;
  let t = "";
  if (S.local) t = "You're using MealPilot on this device only — nothing is shared or backed up. Sign in on the website to plan with your household.";
  else if (!S.online) t = queue.length ? `You're offline. ${queue.length} change${queue.length > 1 ? "s are" : " is"} saved on this phone and will sync when you're back online.` : "You're offline. You can still view and tick off your list.";
  b.textContent = t; b.hidden = !t;
}

/* ---------- navigation ---------- */
export function go(tab, sub) {
  const h = "#" + tab + (sub ? "/" + sub : "");
  if (location.hash !== h) location.hash = h; else route();
}
export function route() {
  const [tab, ...rest] = (location.hash.replace(/^#/, "") || store.get("tab", "plan")).split("/");
  S.tab = RENDER[tab] ? tab : "plan";
  S.sub = rest.join("/");
  store.set("tab", S.tab);
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("on", v.id === "v-" + S.tab));
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("on", a.dataset.tab === S.tab));
  refresh();
  window.scrollTo(0, 0);
}
// Re-draw the current screen. A soft refresh is skipped while someone is typing so their input isn't lost.
export function refresh({ soft = false } = {}) {
  badges();
  if (soft) {
    const a = document.activeElement;
    if (a && a.closest && a.closest("#main") && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.type !== "checkbox") { pendingRefresh = true; return; }
  }
  const fn = RENDER[S.tab];
  if (fn) fn(document.getElementById("v-" + S.tab), S.sub);
  // Background updates (sync, library loading) never redraw a sheet with a form in it — that would wipe what's being typed.
  const sh = document.getElementById("sheet");
  if (sheetRefresh && !document.getElementById("sheetWrap").hidden && !(soft && sh.querySelector("input:not([type=checkbox]), textarea, select"))) sheetRefresh();
}
let pendingRefresh = false;
document.addEventListener("focusout", () => setTimeout(() => { if (pendingRefresh && !(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) { pendingRefresh = false; refresh(); } }, 50));
function badges() {
  const open = S.doc.list.items.filter((x) => !x.checked).length;
  const c = document.getElementById("shopCount");
  if (c) { c.textContent = open; c.hidden = !open; }
  const dot = document.getElementById("menusDot");
  if (dot) dot.hidden = !S.doc.menus.some((m) => m.status === "review" && m.createdBy !== me() && !(m.votes || {})[me()]);
}

/* ---------- formatting ---------- */
export function esc(v) { return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
export function money(v, opts = {}) {
  if (v == null || !isFinite(v)) return "–";
  const cur = S.doc.settings.currency || "GBP";
  const big = cur === "INR" ? v >= 100 : v >= 100;
  try { return new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-GB", { style: "currency", currency: cur, maximumFractionDigits: opts.whole || big ? 0 : 2, minimumFractionDigits: opts.whole || big ? 0 : 2 }).format(v); }
  catch { return (CURRENCIES[cur]?.symbol || "") + v.toFixed(2); }
}
export const sym = () => (CURRENCIES[S.doc.settings.currency] || CURRENCIES.GBP).symbol;
export function mins(n) { if (!n && n !== 0) return "–"; if (n < 60) return `${n} min`; const h = Math.floor(n / 60), m = n % 60; return m ? `${h} h ${m} min` : `${h} h`; }
export const dietDot = (d) => `<i class="diet ${d === "nonveg" ? "nonveg" : d === "egg" ? "egg" : ""}" title="${esc(C.DIETS[d] === "Anything" ? "Contains meat or fish" : C.DIETS[d] || "")}"></i>`;
export const ICON = {
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M4 7h3c5 0 5 10 10 10h3M4 17h3c2 0 3-1.5 4-3.5M15 7h5M17 4l3 3-3 3M17 14l3 3-3 3"/></svg>',
  pick: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg>',
  chat: '<svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4Z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M8 8l4-4 4 4M5 13v6h14v-6"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/></svg>',
};
export const icon = (k) => ICON[k] || "";

/* ---------- toast & sheet ---------- */
let toastTimer;
export function toast(text, bad = false) {
  const t = document.getElementById("toast");
  t.textContent = text; t.className = "toast on" + (bad ? " bad" : "");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = "toast"; }, bad ? 5000 : 2800);
}
let sheetRefresh = null, sheetClose = null, lastFocus = null;
// Open a bottom sheet. `draw(el)` fills it and is called again when the data changes.
export function sheet(draw, { wide = false, onClose = null } = {}) {
  const wrap = document.getElementById("sheetWrap"), el = document.getElementById("sheet");
  if (wrap.hidden) lastFocus = document.activeElement;
  el.className = "sheet" + (wide ? " wide" : "");
  sheetRefresh = () => draw(el);
  sheetClose = onClose;
  draw(el);
  wrap.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => { const f = el.querySelector("[autofocus]") || el.querySelector("h2"); if (f) { if (f.tagName === "H2") f.setAttribute("tabindex", "-1"); f.focus({ preventScroll: true }); } }, 30);
}
export function closeSheet() {
  const wrap = document.getElementById("sheetWrap");
  if (wrap.hidden) return;
  wrap.hidden = true; document.body.style.overflow = "";
  const cb = sheetClose; sheetRefresh = null; sheetClose = null;
  document.getElementById("sheet").innerHTML = "";
  if (cb) cb();
  if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch {}
}
export function refreshSheet() { const el = document.getElementById("sheet"); const y = el.scrollTop; if (sheetRefresh) sheetRefresh(); el.scrollTop = y; }
export const sheetOpen = () => !document.getElementById("sheetWrap").hidden;
ACT["close-sheet"] = closeSheet;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sheetOpen() && !document.querySelector(".cook")) closeSheet(); });
// Simple confirm/prompt built on the sheet.
export function ask({ title, text = "", ok = "OK", danger = false, input = null, cancel = "Cancel" }) {
  return new Promise((resolve) => {
    let done = false;
    sheet((el) => {
      el.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2></div>${text ? `<p class="sub">${esc(text)}</p>` : ""}
        ${input ? `<label class="f" style="margin-top:12px">${esc(input.label || "")}<input id="askInput" type="${input.type || "text"}" value="${esc(input.value || "")}" ${input.placeholder ? `placeholder="${esc(input.placeholder)}"` : ""} autofocus></label>` : ""}
        <div class="sheet-foot"><button class="btn quiet" data-act="ask-no">${esc(cancel)}</button><button class="btn ${danger ? "warn" : ""}" data-act="ask-yes" ${input ? "" : "autofocus"}>${esc(ok)}</button></div>`;
      const inp = el.querySelector("#askInput");
      if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.querySelector("[data-act=ask-yes]").click(); } });
    }, { onClose: () => { if (!done) resolve(null); } });
    ACT["ask-yes"] = () => { done = true; const v = input ? document.getElementById("askInput").value : true; closeSheet(); resolve(v); };
    ACT["ask-no"] = () => { done = true; closeSheet(); resolve(null); };
  });
}

/* ---------- event wiring ---------- */
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  if (el.tagName === "A" || el.tagName === "BUTTON" || el.dataset.prevent != null) e.preventDefault();
  fn(el, e);
});
for (const type of ["change", "input"]) document.addEventListener(type, (e) => {
  const el = e.target.closest("[data-on]");
  if (!el) return;
  const fn = ON[el.dataset.on + ":" + type] || (type === "change" ? ON[el.dataset.on] : null);
  if (fn) fn(el, e);
});

/* ---------- shared bits of UI ---------- */
// What people call each household member in menus and votes.
export function members() {
  const out = new Map();
  for (const d of S.doc.diners) if (d.username) out.set(d.username.toLowerCase(), d.name);
  if (S.user) out.set(S.user.username.toLowerCase(), S.user.displayName);
  return out;
}
export function nameOf(username) { return members().get(String(username || "").toLowerCase()) || username; }
export function peopleCount(diners = S.doc.diners) { return diners.reduce((a, d) => a + (Number(d.portion) || 1), 0) || 2; }
// Recipe cost and nutrition, remembered until prices or recipes change (the library has tens of thousands).
const FACTS = new Map();
let FACTS_SIG = "";
export function recipeFactsFor(r, servings) {
  const k = r.id + "|" + (r.updatedAt || "") + "|" + (servings || "");
  let f = FACTS.get(k);
  if (!f) { f = C.recipeFacts(r, S.cat, S.pricer, servings); if (FACTS.size > 200000) FACTS.clear(); FACTS.set(k, f); }
  return f;
}

/* ---------- the shared recipe library: a compact index for everything, full recipes fetched when opened ---------- */
export const LIB = { status: "none", version: null, count: 0, recipes: [], head: null, archiveCount: 0, progress: 0 };
const MEAL_BITS = [["breakfast", 1], ["lunch", 2], ["dinner", 4], ["snack", 8], ["side", 16], ["dessert", 32]];
const DIET_OF = ["vegan", "veg", "egg", "nonveg"], WITH_OF = ["", "rice", "roti"];
async function cachedJSON(url, cacheName) {
  let cache = null;
  try { cache = await caches.open(cacheName); const hit = await cache.match(url); if (hit) return hit.json(); } catch {}
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't load the recipe library (" + res.status + ").");
  if (cache) try { await cache.put(url, res.clone()); } catch {}
  return res.json();
}
function expandRows(head, rows, from) {
  const out = [];
  rows.forEach((row, i) => {
    const [id, name, cu, mealBits, servings, prep, cook, dietCode, spice, ftBits, withCode, nu, ings, rating] = row;
    const ingredients = [];
    for (let j = 0; j < ings.length; j += 3) ingredients.push({ id: head.ings[ings[j]], amount: ings[j + 1], opt: !!ings[j + 2] });
    out.push({ id, name, cuisine: head.cu[cu], meals: MEAL_BITS.filter(([, b]) => mealBits & b).map(([m]) => m), servings, prep, cook, total: prep + cook,
      diet: DIET_OF[dietCode], spice, ft: head.ft.filter((_, k) => ftBits & (1 << k)), with: WITH_OF[withCode] || "", nu: nu || null, ingredients, steps: null,
      tags: [], rating: rating || null, lib: true, shard: Math.floor((from + i) / head.shard) });
  });
  return out;
}
export async function loadLibrary() {
  if (S.local || LIB.status === "loading") return;
  try {
    const meta = await api("/api/lib/meta");
    if (!meta.version) { LIB.status = "none"; return; }
    LIB.status = "loading"; LIB.version = meta.version; LIB.count = meta.library.count; LIB.archiveCount = meta.archive.count; refresh({ soft: true });
    const cacheName = "mp-lib-" + meta.version;
    try { for (const k of await caches.keys()) if (k.startsWith("mp-lib-") && k !== cacheName) caches.delete(k); } catch {}
    const head = await cachedJSON(`/api/lib/head?v=${meta.version}`, cacheName);
    const all = [];
    for (let p = 0; p < head.parts; p++) {
      const part = await cachedJSON(`/api/lib/index?v=${meta.version}&p=${p}`, cacheName);
      all.push(...expandRows(head, part.rows, part.from));
      LIB.progress = (p + 1) / head.parts;
      const bar = document.getElementById("libProgress"); if (bar) bar.style.width = Math.round(LIB.progress * 100) + "%";
    }
    LIB.head = head; LIB.recipes = all; LIB.status = "ready";
    rebuild(); refresh({ soft: true });
  } catch (err) { LIB.status = "error"; LIB.error = err.message; refresh({ soft: true }); }
}
// Full text (ingredient lines, method, source) of a library recipe.
export async function libFull(r) {
  if (!r || !r.lib || r.steps) return r;
  const shard = await cachedJSON(`/api/lib/rec?v=${LIB.version}&s=${r.shard}`, "mp-lib-" + LIB.version);
  const x = shard[r.id];
  if (!x) throw new Error("Couldn't open this recipe — reload the app to update the library.");
  r.steps = x.steps || []; r.lines = x.lines || []; r.image = x.image || ""; r.desc = x.desc || ""; r.source = x.source || null; r.reviews = x.reviews || 0;
  return r;
}
export function downloadText(name, text, type = "application/json") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
