// Plan: today's meals, the "tell MealPilot what you need" box, planner settings, and the week board.
import { S, C, ACT, ON, screen, sheet, closeSheet, commit, toast, esc, money, mins, dietDot, icon, recipe, ingredient, me, store, go, ask, sym, peopleCount, recipeFactsFor } from "./state.js";
import { openRecipe, pickRecipe, cookMode, cuisinesInUse } from "./recipes.js";

/* ---------- planner state (kept on this device so a half-made plan survives a reload) ---------- */
let P = store.get("planReq", null);          // planner settings
let D = store.get("draft", null);            // the board being edited: { req, slots, menuId, name }
let typed = store.get("planText", "");
let understood = store.get("planUnderstood", []);
let showSettings = store.get("planSettingsOpen", false);
const saveState = () => { store.set("planReq", P); store.set("draft", D); store.set("planText", typed); store.set("planUnderstood", understood); store.set("planSettingsOpen", showSettings); };
export const draftExists = () => !!(D && D.slots);

function defaults() {
  const s = S.doc.settings;
  const diners = S.doc.diners.map((d) => d.id);
  return { start: C.nextWeekday(C.isoDate(), s.weekStart ?? 1, false) === C.isoDate() ? C.isoDate() : C.nextWeekday(C.isoDate(), s.weekStart ?? 1, true),
    days: 7, meals: (s.meals && s.meals.length ? s.meals : ["breakfast", "lunch", "dinner"]).slice(), diners, people: null, cuisines: [], diet: s.diet || "any",
    goals: [], avoid: [], maxPrep: null, maxCook: null, maxTotal: null, maxDay: null, budget: null, alts: s.alts ?? 2, sides: s.sides !== false, leftovers: !!s.leftovers, seed: 1 };
}
function ensureP() { if (!P) P = defaults(); if (!P.start || P.start < C.isoDate()) P.start = C.isoDate(); return P; }
function selectedDiners() { const ids = new Set(P.diners || []); return S.doc.diners.filter((d) => ids.has(d.id)); }
// The request the planner gets: settings + what the chosen people need.
function effectiveReq() {
  ensureP();
  const ds = selectedDiners();
  const goals = new Set(P.goals), avoid = new Set(P.avoid);
  for (const d of ds) { (d.goals || []).forEach((g) => goals.add(g)); (d.avoid || []).forEach((a) => avoid.add(a)); if (d.age != null && d.age < 13) goals.add("kid-friendly"); }
  const people = P.people != null ? P.people : ds.length ? peopleCount(ds) : peopleCount();
  return Object.assign({}, P, { goals: [...goals], avoid: [...avoid], people, budget: P.budget || null });
}

/* ---------- today ---------- */
export function menusCovering(date) {
  return S.doc.menus.filter((m) => m.start <= date && C.addDays(m.start, m.days - 1) >= date)
    .sort((a, b) => ({ final: 0, review: 1, draft: 2 }[a.status] - { final: 0, review: 1, draft: 2 }[b.status]) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
function todayCard() {
  const today = C.isoDate();
  const m = menusCovering(today).find((x) => x.status !== "draft" || x.createdBy === me());
  if (!m) return "";
  const d = Math.round((Date.parse(today) - Date.parse(m.start)) / 864e5);
  const slots = C.MEALS.map((meal) => m.slots.find((s) => s.d === d && s.m === meal)).filter((s) => s && s.dishes.length);
  if (!slots.length) return "";
  return `<div class="card" style="border-color:var(--turmeric)"><div class="head"><div><h2>Today</h2><p>${C.dayLabel(today, "long")} · from <a href="#menus/${esc(m.id)}">${esc(m.name)}</a> <span class="pill ${m.status}">${statusLabel(m.status)}</span></p></div></div>
    ${slots.map((s) => `<div class="row between" style="padding:8px 0;border-top:1px solid var(--line-2)"><div><span class="sub small">${C.MEAL_LABEL[s.m]}</span><br>${s.dishes.map((x) => { const r = recipe(x.r); return r ? `<button class="dish-name" data-act="plan-open" data-id="${esc(r.id)}" data-s="${x.s}">${dietDot(r.diet)} ${esc(r.name)}</button>` : ""; }).join(" + ")}${s.leftover ? ` <span class="sub small">(leftovers)</span>` : ""}</div>
      ${s.leftover ? "" : `<button class="btn sm" data-act="plan-cook" data-id="${esc(s.dishes[0].r)}" data-s="${s.dishes[0].s}">Cook</button>`}</div>`).join("")}</div>`;
}
export const statusLabel = (s) => ({ draft: "Draft", review: "Open for comments", final: "Final" }[s] || s);
ACT["plan-open"] = (el) => openRecipe(el.dataset.id, { servings: Number(el.dataset.s) || null });
ACT["plan-cook"] = (el) => cookMode(el.dataset.id, Number(el.dataset.s) || recipe(el.dataset.id).servings);

/* ---------- the request box and settings ---------- */
function examples() {
  const cur = sym(), inr = S.doc.settings.currency === "INR";
  return [
    `Plan dinners for a family of four next week, Indian and Italian, no more than 30 minutes of cooking per day, ${cur}${inr ? "3000" : "60"} budget`,
    "South Indian breakfast, lunch and dinner for 3 people for 5 days, vegetarian",
    "Protein-rich meals for my 11-year-old this week, mild, no mushrooms",
  ];
}
const chk = (on) => (on ? "checked" : "");
function settingsForm() {
  const p = ensureP();
  const eff = effectiveReq();
  const ds = S.doc.diners;
  const opt = (v, l, cur) => `<option value="${v}" ${String(v) === String(cur ?? "") ? "selected" : ""}>${l}</option>`;
  const timeSel = (k, choices, any = "No limit") => `<select data-on="pset" data-k="${k}">${opt("", any, p[k])}${choices.map((n) => opt(n, mins(n), p[k])).join("")}</select>`;
  const avoidNames = (p.avoid || []).map((id) => (ingredient(id) ? ingredient(id).name : id));
  return `<div class="settings">
    <div class="grid3">
      <label class="f">Start on<input type="date" data-on="pset" data-k="start" value="${esc(p.start)}" min="${C.isoDate()}"></label>
      <label class="f">Number of days<input type="number" min="1" max="14" data-on="pset" data-k="days" value="${esc(p.days)}"></label>
      <label class="f">Number of people<input type="number" min="0.5" max="40" step="0.5" data-on="pset" data-k="people" value="${esc(eff.people)}"><span class="hint">${p.people != null ? `<button class="link" data-act="people-auto">Use the people ticked below</button>` : "Adds up portion sizes"}</span></label>
    </div>
    <div class="fieldset"><span class="lbl">Meals each day</span><div class="chips">${C.MEALS.map((m) => `<label class="chip"><input type="checkbox" data-on="pmeal" value="${m}" ${chk(p.meals.includes(m))}>${C.MEAL_LABEL[m]}</label>`).join("")}</div></div>
    ${ds.length ? `<div class="fieldset"><span class="lbl">Who's eating</span><div class="chips">${ds.map((d) => `<label class="chip"><input type="checkbox" data-on="pdiner" value="${esc(d.id)}" ${chk((p.diners || []).includes(d.id))}>${esc(d.name)}${d.portion && d.portion !== 1 ? ` <span style="opacity:.75">×${d.portion}</span>` : ""}</label>`).join("")}</div>
      <span class="hint">Their diets, goals and dislikes from <a href="#home">Household</a> are included.</span></div>` : ""}
    <div class="fieldset"><span class="lbl">Cuisines <span class="hint" style="display:inline">— none ticked means any</span></span><div class="chips">${cuisinesInUse().filter((c) => C.CUISINES.includes(c) || S.recipes.some((r) => r.cuisine === c && !r.builtIn)).map((c) => `<label class="chip"><input type="checkbox" data-on="pcuisine" value="${esc(c)}" ${chk(p.cuisines.includes(c))}>${esc(c)}</label>`).join("")}</div></div>
    <div class="fieldset"><span class="lbl">Goals</span><div class="chips">${Object.entries(C.GOALS).map(([k, l]) => `<label class="chip"><input type="checkbox" data-on="pgoal" value="${k}" ${chk(p.goals.includes(k))}>${l}</label>`).join("")}</div>
      ${eff.goals.filter((g) => !p.goals.includes(g)).length ? `<span class="hint">Also from people's profiles: ${eff.goals.filter((g) => !p.goals.includes(g)).map((g) => C.GOALS[g]).join(", ")}</span>` : ""}</div>
    <div class="grid3">
      <label class="f">Diet<select data-on="pset" data-k="diet">${opt("any", "Anything", p.diet)}${opt("egg", "Vegetarian + eggs", p.diet)}${opt("veg", "Vegetarian", p.diet)}${opt("vegan", "Vegan", p.diet)}</select></label>
      <label class="f">Budget for the whole plan<input type="number" min="0" step="1" data-on="pset" data-k="budget" value="${esc(p.budget ?? "")}" placeholder="No budget (${sym()})"></label>
      <label class="f">Choices per meal<select data-on="pset" data-k="alts">${[1, 2, 3].map((n) => opt(n, `Best pick + ${n} alternative${n > 1 ? "s" : ""}`, p.alts)).join("")}</select></label>
      <label class="f">Prep time per meal${timeSel("maxPrep", [10, 15, 20, 30, 45])}</label>
      <label class="f">Cooking time per meal${timeSel("maxCook", [10, 15, 20, 30, 45, 60, 90])}</label>
      <label class="f">Total time per meal${timeSel("maxTotal", [15, 20, 30, 40, 45, 60, 90])}</label>
      <label class="f">Kitchen time per day${timeSel("maxDay", [30, 45, 60, 90, 120, 180])}</label>
    </div>
    <label class="f" style="margin-top:12px">Leave out<input data-on="pavoid" placeholder="e.g. mushrooms, beef, peanuts" value="${esc(avoidNames.join(", "))}"><span class="hint">Separate with commas. ${eff.avoid.length > p.avoid.length ? `People's profiles also leave out: ${eff.avoid.filter((a) => !p.avoid.includes(a)).map((id) => (ingredient(id) ? ingredient(id).name : id)).join(", ")}.` : ""}</span></label>
    <div class="row" style="margin-top:12px;gap:18px">
      <label class="row" style="gap:8px"><input type="checkbox" data-on="pset" data-k="sides" ${chk(p.sides)}> Add rice, roti or a side where a dish needs one</label>
      <label class="row" style="gap:8px"><input type="checkbox" data-on="pset" data-k="leftovers" ${chk(p.leftovers)}> Cook dinner twice the size for next day's lunch</label>
    </div>
  </div>`;
}
ON["pset"] = (el) => {
  const k = el.dataset.k;
  if (el.type === "checkbox") P[k] = el.checked;
  else if (["days", "budget", "alts", "maxPrep", "maxCook", "maxTotal", "maxDay", "people"].includes(k)) P[k] = el.value === "" ? null : Number(el.value);
  else P[k] = el.value;
  if (k === "days") P.days = C.clamp(P.days || 7, 1, 14);
  saveState(); if (el.tagName === "SELECT" || el.type === "checkbox") rerenderPlanSoon();
};
ON["pset:input"] = (el) => { if (el.dataset.k === "budget" || el.dataset.k === "people") { P[el.dataset.k] = el.value === "" ? null : Number(el.value); saveState(); } };
ON["pmeal"] = (el) => { P.meals = C.MEALS.filter((m) => (m === el.value ? el.checked : P.meals.includes(m))); saveState(); };
ON["pdiner"] = (el) => { const s = new Set(P.diners || []); el.checked ? s.add(el.value) : s.delete(el.value); P.diners = [...s]; P.people = null; saveState(); rerenderPlanSoon(); };
ON["pcuisine"] = (el) => { const s = new Set(P.cuisines); el.checked ? s.add(el.value) : s.delete(el.value); P.cuisines = [...s]; saveState(); };
ON["pgoal"] = (el) => { const s = new Set(P.goals); el.checked ? s.add(el.value) : s.delete(el.value); P.goals = [...s]; saveState(); };
ON["pavoid"] = (el) => {
  const ids = [];
  for (const w of el.value.split(",").map((x) => x.trim()).filter(Boolean)) { const m = C.matchIngredient(w, S.cat, { min: 0.6 }); if (m) ids.push(m.id); }
  P.avoid = [...new Set(ids)]; saveState();
};
ACT["people-auto"] = () => { P.people = null; saveState(); go("plan"); };
let rr; function rerenderPlanSoon() { clearTimeout(rr); rr = setTimeout(() => { if (S.tab === "plan") go("plan"); }, 10); }

ON["ptext:input"] = (el) => { typed = el.value; store.set("planText", typed); };
ACT["plan-example"] = (el) => { typed = el.textContent; const t = document.getElementById("planText"); if (t) t.value = typed; ACT["plan-understand"](); };
ACT["plan-understand"] = () => {
  const t = document.getElementById("planText"); if (t) typed = t.value;
  if (!typed.trim()) { toast("Type or say what you'd like first.", true); return; }
  const { req, understood: u } = C.parseRequest(typed, { today: C.isoDate(), cat: S.cat, weekStart: S.doc.settings.weekStart ?? 1 });
  P = defaults();
  if (req.people != null) { P.people = req.people; }
  for (const k of ["start", "days", "meals", "cuisines", "diet", "maxPrep", "maxCook", "maxTotal", "maxDay", "alts", "leftovers"]) if (req[k] != null) P[k] = req[k];
  if (req.budget) P.budget = req.budget; else if (req.budgetPerDay) P.budget = req.budgetPerDay * (P.days || 7);
  if (req.goals) P.goals = req.goals;
  if (req.avoid) P.avoid = req.avoid;
  if (req.variety) P.variety = req.variety;
  P.seed = Math.floor(Math.random() * 1e9);
  understood = u.length ? u : [{ key: "none", label: "Nothing specific — using your usual settings" }];
  showSettings = false; saveState();
  makePlan();
};
ACT["plan-settings"] = () => { showSettings = !showSettings; saveState(); go("plan"); };
ACT["plan-make"] = () => { ensureP(); P.seed = Math.floor(Math.random() * 1e9); saveState(); makePlan(); };
let recog = null;
ACT["plan-mic"] = (el) => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast("Speaking isn't supported in this browser — try Chrome or Safari, or type instead.", true); return; }
  if (recog) { recog.stop(); return; }
  recog = new SR();
  recog.lang = S.doc.settings.currency === "INR" ? "en-IN" : "en-GB"; recog.interimResults = true; recog.continuous = false;
  const box = document.getElementById("planText"), before = box.value ? box.value.trim() + " " : "";
  recog.onresult = (e) => { let t = ""; for (const r of e.results) t += r[0].transcript; box.value = before + t; typed = box.value; };
  recog.onerror = (e) => { toast(e.error === "not-allowed" ? "Allow the microphone to speak your request." : "Didn't catch that — try again.", true); };
  recog.onend = () => { el.classList.remove("live"); recog = null; store.set("planText", typed); if (typed.trim()) ACT["plan-understand"](); };
  el.classList.add("live"); recog.start();
};

/* ---------- making and editing the board ---------- */
function makePlan(lockedOnly = null) {
  const req = effectiveReq();
  const locked = {};
  if (lockedOnly) Object.assign(locked, lockedOnly);
  else if (D && D.slots && !D.menuId) for (const s of D.slots) if (s.locked && s.d < req.days && req.meals.includes(s.m)) locked[`${s.d}|${s.m}`] = s;
  const plan = C.planMenu(req, S.recipes, { cat: S.cat, pricer: S.pricer, favs: S.favs, today: C.isoDate(), locked });
  D = Object.assign({}, D && lockedOnly ? D : {}, { req: plan.req, slots: plan.slots, warnings: plan.warnings, menuId: D && lockedOnly ? D.menuId : null, name: D && lockedOnly ? D.name : null });
  saveState();
  go("plan");
  setTimeout(() => document.getElementById("board")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}
export function addToDraft(rid) {
  if (!D) { toast("Start a plan first.", true); return; }
  const r = recipe(rid);
  pickSlot(`Add ${r.name} to…`, (d, m) => { const s = slotOf(d, m, true); s.dishes = [{ r: rid, s: D.req.servings }, ...s.dishes.filter((x) => x.side)]; s.locked = true; delete s.leftover; saveState(); go("plan"); });
}
function pickSlot(title, cb) {
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <div class="grid2"><label class="f">Day<select id="psDay">${Array.from({ length: D.req.days }, (_, d) => `<option value="${d}">${C.dayLabel(C.addDays(D.req.start, d))}</option>`).join("")}</select></label>
      <label class="f">Meal<select id="psMeal">${D.req.meals.map((m) => `<option value="${m}">${C.MEAL_LABEL[m]}</option>`).join("")}</select></label></div>
      <div class="sheet-foot"><button class="btn" data-act="ps-ok">Add</button></div>`;
  });
  ACT["ps-ok"] = () => { const e = document.getElementById("sheet"); const d = Number(e.querySelector("#psDay").value), m = e.querySelector("#psMeal").value; closeSheet(); cb(d, m); };
}
function slotOf(d, m, create = false) {
  let s = D.slots.find((x) => x.d === d && x.m === m);
  if (!s && create) { s = { d, m, dishes: [], alts: [] }; D.slots.push(s); }
  return s;
}
const keyOf = (el) => { const [d, m] = el.dataset.key.split("|"); return [Number(d), m]; };
function sideFor(rid) { const r = recipe(rid); if (!r || !D.req.sides || !r.with) return null; const sid = C.SIDE_RECIPES[r.with]; return recipe(sid) ? sid : null; }
function setMain(s, rid) {
  const old = s.dishes.find((x) => !x.side);
  const srv = old ? old.s : D.req.servings;
  const oldSide = old && sideFor(old.r);
  const extras = s.dishes.filter((x) => x.side && x.r !== oldSide);
  const side = sideFor(rid);
  s.dishes = [{ r: rid, s: srv }, ...(side ? [{ r: side, s: srv, side: true }] : []), ...extras.filter((x) => x.r !== side)];
  if (old && old.r !== rid) s.alts = [old.r, ...(s.alts || []).filter((a) => a !== rid && a !== old.r)].slice(0, 3); else s.alts = (s.alts || []).filter((a) => a !== rid);
  delete s.leftover;
  // Leftover lunches follow the dinner they come from.
  for (const l of D.slots) if (l.leftover && l.leftover.d === s.d && l.leftover.m === s.m) l.dishes = s.dishes.map((x) => ({ r: x.r, s: D.req.servings, side: x.side }));
}
ACT["slot-alt"] = (el) => { const s = slotOf(...keyOf(el)); setMain(s, el.dataset.r); s.locked = true; saveState(); go("plan"); };
ACT["slot-lock"] = (el) => { const s = slotOf(...keyOf(el)); s.locked = !s.locked; saveState(); go("plan"); };
ACT["slot-clear"] = (el) => { const s = slotOf(...keyOf(el)); s.dishes = []; s.alts = []; s.locked = true; delete s.leftover; saveState(); go("plan"); };
ACT["slot-pick"] = (el) => { const [d, m] = keyOf(el); pickRecipe({ title: `${C.MEAL_LABEL[m]} on ${C.dayLabel(C.addDays(D.req.start, d))}`, meal: m, onPick: (rid) => { const s = slotOf(d, m, true); setMain(s, rid); s.locked = true; saveState(); go("plan"); } }); };
ACT["slot-side"] = (el) => { const [d, m] = keyOf(el); pickRecipe({ title: "Add a side or extra dish", meal: "side", onPick: (rid) => { const s = slotOf(d, m, true); s.dishes.push({ r: rid, s: (s.dishes[0] || {}).s || D.req.servings, side: true }); saveState(); go("plan"); } }); };
ACT["slot-unside"] = (el) => { const s = slotOf(...keyOf(el)); s.dishes = s.dishes.filter((x, i) => !(x.side && x.r === el.dataset.r && i > 0)); saveState(); go("plan"); };
ACT["slot-reroll"] = (el) => {
  const [d, m] = keyOf(el);
  const locked = {};
  for (const s of D.slots) if (!(s.d === d && s.m === m)) locked[`${s.d}|${s.m}`] = s;
  const cur = slotOf(d, m);
  const avoidIds = new Set([...(cur ? cur.dishes.map((x) => x.r) : []), ...(D.rerolled || [])]);
  const req = effectiveReq(); req.seed = Math.floor(Math.random() * 1e9);
  const plan = C.planMenu(Object.assign({}, req, { leftovers: false }), S.recipes.filter((r) => !avoidIds.has(r.id) || r.meals.includes("side")), { cat: S.cat, pricer: S.pricer, favs: S.favs, today: C.isoDate(), locked });
  const fresh = plan.slots.find((s) => s.d === d && s.m === m);
  if (!fresh || !fresh.dishes.length) { toast("No other dish fits your settings for this meal.", true); return; }
  const s = slotOf(d, m, true);
  setMain(s, fresh.dishes[0].r); s.alts = fresh.alts; delete s.leftover;
  D.rerolled = [...avoidIds].slice(-30);
  saveState(); go("plan");
};
ACT["slot-cookfresh"] = (el) => { const s = slotOf(...keyOf(el)); delete s.leftover; s.dishes = []; const prev = D.slots.find((x) => x.d === s.d - 1 && x.m === "dinner"); if (prev) prev.dishes.forEach((x) => { x.s = D.req.servings; }); ACT["slot-reroll"](el); };
ACT["plan-shuffle"] = () => {
  const locked = {};
  for (const s of D.slots) if (s.locked) locked[`${s.d}|${s.m}`] = s;
  ensureP(); P.seed = Math.floor(Math.random() * 1e9); saveState();
  makePlan(Object.keys(locked).length ? locked : {});
};
ACT["plan-discard"] = async () => {
  if (!(await ask({ title: D.menuId ? "Stop editing?" : "Throw away this plan?", text: D.menuId ? "Changes you haven't saved will be lost." : "You can always make a new one.", ok: D.menuId ? "Stop editing" : "Throw away", danger: true }))) return;
  D = null; saveState(); go("plan");
};
ACT["plan-blank"] = () => {
  const req = effectiveReq();
  D = { req: Object.assign({}, C.PLAN_DEFAULTS, req, { servings: Math.max(1, Math.round(req.people * 2) / 2) }), slots: [], warnings: [], menuId: null };
  for (let d = 0; d < req.days; d++) for (const m of req.meals) D.slots.push({ d, m, dishes: [], alts: [], locked: true });
  saveState(); go("plan");
};
// Load a saved menu or favourite into the board.
export function loadIntoPlanner(src, { asNew = true, start = null } = {}) {
  const servings = src.people || 2;
  D = { req: Object.assign({}, C.PLAN_DEFAULTS, ensureP(), { start: start || src.start || C.isoDate(), days: src.days, meals: src.meals && src.meals.length ? src.meals : [...new Set(src.slots.map((s) => s.m))], people: servings, servings }),
    slots: structuredClone(src.slots).map((s) => Object.assign(s, { locked: true })), warnings: [], menuId: asNew ? null : src.id, name: asNew ? null : src.name };
  if (asNew && src.people !== peopleCount() && S.doc.diners.length) D.note = `This menu was for ${C.fmtNum(src.people)} people.`;
  saveState(); go("plan");
}

/* ---------- the board ---------- */
// Shared with the Menus screen. mode: "edit" (planner) or "view" (a saved menu; suggestions allowed when `canSuggest`).
export function boardHTML(m, { mode = "edit", canSuggest = false, suggestions = [] } = {}) {
  const today = C.isoDate();
  const stats = C.menuStats(m.slots, S.byId, S.cat, S.pricer, m.req ? m.req.people : m.people, m.days);
  let out = "";
  for (let d = 0; d < m.days; d++) {
    const date = C.addDays(m.start, d), st = stats[d] || { time: 0, cost: 0 };
    const dt = new Date(date + "T12:00:00Z");
    out += `<div class="day ${date === today ? "today" : ""}"><div class="date"><span class="dn">${dt.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span><span class="dd">${dt.getUTCDate()}</span><span class="dm">${dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</span>
      <span class="dt">${st.time ? mins(st.time) : ""}${st.cost ? `<br>${money(st.cost)}` : ""}</span></div><div class="slots">`;
    for (const meal of m.meals) {
      const s = m.slots.find((x) => x.d === d && x.m === meal) || { d, m: meal, dishes: [], alts: [] };
      const key = `${d}|${meal}`;
      const main = s.dishes.find((x) => !x.side) || s.dishes[0];
      const r = main && recipe(main.r);
      const sides = s.dishes.filter((x) => x !== main);
      const f = r ? recipeFactsFor(r, main.s) : null;
      const sl = suggestions.filter((x) => x.d === d && x.m === meal && x.status === "open");
      out += `<div class="slot ${s.locked && mode === "edit" ? "locked" : ""} ${!r ? "empty" : ""} ${s.leftover ? "leftover" : ""}"><span class="meal">${C.MEAL_LABEL[meal]}</span><div class="dish">`;
      if (!r) out += main ? `<span>Removed recipe</span>` : `<span>Nothing planned${mode === "edit" ? " — pick a dish" : ""}</span>`;
      else {
        out += `<button class="dish-name" data-act="plan-open" data-id="${esc(r.id)}" data-s="${main.s}">${dietDot(r.diet)} ${esc(r.name)}</button>`;
        out += s.leftover ? `<div class="dish-meta">Leftovers from ${C.dayLabel(C.addDays(m.start, s.leftover.d))} ${C.MEAL_LABEL[s.leftover.m].toLowerCase()}${mode === "edit" ? ` · <button class="link" data-act="slot-cookfresh" data-key="${key}">Cook something else</button>` : ""}</div>`
          : `<div class="dish-meta">${esc(r.cuisine)} · ${mins(r.total)} · ${money(f.cost)} · ${Math.round(f.per.protein)} g protein each · for ${C.fmtNum(main.s)}</div>`;
        if (sides.length) out += `<div class="sides">${sides.map((x) => { const sr = recipe(x.r); return sr ? `<span>+ ${esc(sr.name)}${mode === "edit" ? ` <button data-act="slot-unside" data-key="${key}" data-r="${esc(x.r)}" aria-label="Remove ${esc(sr.name)}">×</button>` : ""}</span>` : ""; }).join("")}</div>`;
        if (mode === "edit" && !s.leftover && (s.alts || []).length) out += `<div class="alts"><span class="lbl">Or:</span>${s.alts.map((a) => { const ar = recipe(a); return ar ? `<button class="alt" data-act="slot-alt" data-key="${key}" data-r="${esc(a)}" title="Swap to ${esc(ar.name)}">${esc(ar.name)}</button>` : ""; }).join("")}</div>`;
      }
      for (const x of sl) { const sr = x.r && recipe(x.r); out += `<div class="sugg"><b>${esc(x.name)}</b> suggests ${sr ? `<b>${esc(sr.name)}</b>` : "a change"}${x.text ? `: “${esc(x.text)}”` : ""}</div>`; }
      out += `</div><div class="slot-actions">`;
      if (mode === "edit") {
        if (!s.leftover) out += `<button class="icon-btn ${s.locked ? "on" : ""}" data-act="slot-lock" data-key="${key}" title="${s.locked ? "Kept when you shuffle" : "Keep when shuffling"}" aria-label="Keep this dish" aria-pressed="${!!s.locked}">${icon("lock")}</button>
          <button class="icon-btn" data-act="slot-reroll" data-key="${key}" title="Something else" aria-label="Suggest something else">${icon("shuffle")}</button>`;
        out += `<button class="icon-btn" data-act="slot-pick" data-key="${key}" title="Choose a dish" aria-label="Choose a dish">${icon("pick")}</button>`;
        if (r && !s.leftover) out += `<button class="icon-btn" data-act="slot-side" data-key="${key}" title="Add a side dish" aria-label="Add a side dish">${icon("plus")}</button>`;
        if (r) out += `<button class="icon-btn" data-act="slot-clear" data-key="${key}" title="Clear" aria-label="Clear this meal">${icon("x")}</button>`;
      } else if (canSuggest) out += `<button class="btn ghost sm" data-act="menu-suggest" data-key="${key}">Suggest</button>`;
      out += `</div></div>`;
    }
    out += `</div></div>`;
  }
  return out;
}
export function summaryHTML(m, budget) {
  const cost = C.planCost(m.slots, S.byId, S.cat, S.pricer);
  const people = m.req ? m.req.people : m.people;
  const stats = C.menuStats(m.slots, S.byId, S.cat, S.pricer, people, m.days);
  const maxDay = Math.max(0, ...stats.map((x) => x.time));
  const protein = stats.length ? Math.round(stats.reduce((a, x) => a + x.protein, 0) / stats.length) : 0;
  const over = budget && cost > budget;
  return `<div class="summary">
    <div class="${over ? "over" : ""}"><b>${money(cost)}</b><span>${budget ? `of ${money(budget, { whole: true })} budget` : "estimated food cost"}</span>${budget ? `<div class="meter"><i style="width:${Math.min(100, (cost / budget) * 100)}%"></i></div>` : ""}</div>
    <div><b>${money(cost / Math.max(1, m.days))}</b><span>per day · ${money(cost / Math.max(1, m.days) / Math.max(1, people))} a head</span></div>
    <div><b>${mins(maxDay)}</b><span>longest day in the kitchen</span></div>
    <div><b>${protein} g</b><span>protein per person a day (planned meals)</span></div>
  </div>`;
}

screen("plan", (el) => {
  ensureP();
  const eff = effectiveReq();
  let html = todayCard();
  html += `<div class="card"><div class="head"><div><h1>Plan meals</h1><p>Say what you need, or set it up below. MealPilot picks dishes with ${eff.alts} alternative${eff.alts > 1 ? "s" : ""} each.</p></div></div>
    <div class="ask"><textarea id="planText" data-on="ptext" aria-label="What would you like to plan?" placeholder="e.g. ${esc(examples()[0])}">${esc(typed)}</textarea>
      <button class="mic" data-act="plan-mic" title="Say it" aria-label="Speak your request">${icon("mic")}</button></div>
    ${!typed ? `<div class="examples"><span class="sub small">Try: </span>${examples().map((x) => `<div><button data-act="plan-example">${esc(x)}</button></div>`).join("")}</div>` : ""}
    <div class="row" style="margin-top:12px"><button class="btn" data-act="plan-understand">Plan it</button><button class="btn ghost" data-act="plan-settings">${showSettings ? "Hide settings" : "Settings"}</button></div>
    ${understood.length && D ? `<div class="understood"><span class="sub small">Understood:</span> <div class="chips" style="margin-top:6px">${understood.map((u) => `<span class="chip read">${esc(u.label)}</span>`).join("")}</div>
      <p class="hint" style="margin-top:6px">Not quite right? Change anything in <button class="link" data-act="plan-settings">Settings</button>, then “Make my menu”.</p></div>` : ""}
    ${showSettings ? settingsForm() + `<div class="row" style="margin-top:14px"><button class="btn" data-act="plan-make">Make my menu</button><button class="btn quiet" data-act="plan-blank">Start with an empty menu</button></div>` : ""}
    ${!D && S.doc.favorites.length ? `<p class="sub small" style="margin-top:12px">Or reuse a <a href="#menus">saved favourite menu</a>.</p>` : ""}
  </div>`;
  if (D && D.slots) {
    const m = { start: D.req.start, days: D.req.days, meals: D.req.meals, slots: D.slots, req: D.req };
    const editing = D.menuId && S.doc.menus.find((x) => x.id === D.menuId);
    html += `<div id="board"><div class="head"><div><h2>${editing ? `Editing “${esc(editing.name)}”` : "Your menu"}</h2>
      <p>${C.dayLabel(D.req.start)} – ${C.dayLabel(C.addDays(D.req.start, D.req.days - 1))} · ${C.fmtNum(D.req.people || D.req.servings)} people · tap a dish for the recipe, “Or:” to swap</p></div></div>
      ${D.note ? `<p class="msg warn" style="margin-bottom:12px">${esc(D.note)} Servings were kept; change them per dish if needed.</p>` : ""}
      ${(D.warnings || []).map((w) => `<p class="msg warn" style="margin-bottom:8px">${esc(w)}</p>`).join("")}
      ${summaryHTML(m, D.req.budget || (D.req.budgetPerDay ? D.req.budgetPerDay * D.req.days : null))}
      <div class="board">${boardHTML(m, { mode: "edit" })}</div>
      <div class="board-foot"><div class="row"><button class="btn quiet sm" data-act="plan-shuffle">${icon("shuffle")} Shuffle the rest</button><button class="btn ghost sm" data-act="plan-discard">${editing ? "Stop editing" : "Throw away"}</button></div>
        <button class="btn" data-act="plan-save">${editing ? "Save changes" : "Save menu"}</button></div></div>`;
  }
  el.innerHTML = html;
});

/* ---------- saving ---------- */
ACT["plan-save"] = () => {
  const editing = D.menuId && S.doc.menus.find((x) => x.id === D.menuId);
  const empty = D.slots.filter((s) => !s.dishes.length).length;
  const menu = { name: editing ? editing.name : D.name || `Week of ${C.dayLabel(D.req.start)}`, start: D.req.start, days: D.req.days, meals: D.req.meals, people: D.req.people || D.req.servings,
    req: Object.assign({}, D.req, { seed: undefined }), slots: D.slots.map((s) => { const c = Object.assign({}, s); delete c.locked; return c; }) };
  if (editing) {
    const { error } = commit({ type: "updateMenu", id: editing.id, menu });
    if (error) return;
    D = null; saveState(); toast(editing.status === "final" ? "Saved — the menu is open for comments again." : "Changes saved."); go("menus", editing.id); return;
  }
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>Save this menu</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      ${empty ? `<p class="msg warn" style="margin-bottom:10px">${empty} meal${empty > 1 ? "s have" : " has"} nothing planned yet.</p>` : ""}
      <label class="f">Name<input id="svName" value="${esc(menu.name)}" autofocus></label>
      <div class="stack" style="margin-top:14px">
        ${S.local ? "" : `<button class="btn wide" data-act="sv-go" data-s="review">Share with the household for comments</button>`}
        <button class="btn ${S.local ? "" : "quiet"} wide" data-act="sv-go" data-s="final">Save as final${S.local ? "" : " (no comments needed)"}</button>
        <button class="btn ghost wide" data-act="sv-go" data-s="draft">Keep as a private draft</button>
        <label class="row" style="gap:8px"><input type="checkbox" id="svFav"> Also save it to favourites</label>
      </div>`;
  });
  ACT["sv-go"] = (b) => {
    const e = document.getElementById("sheet");
    menu.name = e.querySelector("#svName").value.trim() || menu.name;
    const fav = e.querySelector("#svFav").checked;
    const ops = [{ type: "createMenu", menu }];
    const { error } = commit(ops);
    if (error) return;
    const id = ops[0].newId;
    const more = [];
    if (b.dataset.s !== "draft") more.push({ type: "setMenuStatus", id, status: b.dataset.s });
    if (fav) more.push({ type: "saveFavorite", name: menu.name, kind: "week", days: menu.days, meals: menu.meals, people: menu.people, slots: menu.slots, fromMenu: id });
    if (more.length) commit(more, { quiet: true });
    D = null; understood = []; saveState(); closeSheet();
    toast(b.dataset.s === "review" ? "Shared — everyone in the household can now comment." : "Menu saved.");
    go("menus", id);
  };
};
