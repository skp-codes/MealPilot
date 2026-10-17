// MealPilot core — the rules shared by the app (browser) and the server.
// Units and quantities · ingredient matching · recipe nutrition and cost · the meal planner ·
// reading typed/spoken requests · shopping lists · reading shop receipts · the household data operations.

/* =========================================================================================
   Small helpers
   ========================================================================================= */
export const MEALS = ["breakfast", "lunch", "dinner", "snack"];
export const MEAL_LABEL = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", side: "Side" };
export const DIETS = { any: "Anything", nonveg: "Anything", egg: "Vegetarian + eggs", veg: "Vegetarian", vegan: "Vegan" };
const DIET_RANK = { vegan: 0, veg: 1, egg: 2, nonveg: 3 };
export const GOALS = {
  "high-protein": "Protein-rich", "kid-friendly": "Kid-friendly", "low-carb": "Low-carb", light: "Light",
  budget: "Budget-friendly", "high-fibre": "High-fibre", mild: "Mild", spicy: "Spicy",
};
// What's in a dish, for the "Contains" filter. Seafood is split so you can keep, say, fish but not prawns.
export const FOOD_TYPES = [
  { k: "veg", label: "Vegetarian (no meat, fish or eggs)", ids: [] },
  { k: "egg", label: "Eggs", ids: ["eggs"] },
  { k: "chicken", label: "Chicken", ids: ["chicken_breast", "chicken_thigh", "chicken_curry_cut"] },
  { k: "lamb", label: "Lamb & mutton", ids: ["mutton", "lamb_mince"] },
  { k: "beef", label: "Beef", ids: ["beef_mince", "beef_steak"] },
  { k: "pork", label: "Pork, bacon & ham", ids: ["pork", "bacon", "sausages", "chorizo"] },
  { k: "fish", label: "Fish (cod, haddock, fish sauce…)", group: "seafood", ids: ["white_fish", "fish_sauce"] },
  { k: "salmon", label: "Salmon", group: "seafood", ids: ["salmon"] },
  { k: "tuna", label: "Tuna", group: "seafood", ids: ["tuna_tin"] },
  { k: "prawns", label: "Prawns & shrimp", group: "seafood", ids: ["prawns"] },
  { k: "shellfish", label: "Mussels, clams & scallops", group: "seafood", ids: ["mussels"] },
  { k: "squid", label: "Squid & octopus", group: "seafood", ids: ["squid"] },
  { k: "crab", label: "Crab & lobster", group: "seafood", ids: ["crab"] },
];
const TYPE_OF = new Map(FOOD_TYPES.flatMap((t) => t.ids.map((id) => [id, t.k])));
// The food types in a recipe (optional ingredients count too, so a deselected food never sneaks in). No meat/fish/eggs → "veg".
export function foodTypes(recipe) {
  const out = new Set();
  for (const x of recipe.ingredients || []) { const t = x.id && TYPE_OF.get(x.id); if (t) out.add(t); }
  if (![...out].some((t) => t !== "egg")) { if (!out.size) out.add("veg"); }
  return out;
}
// `off` = the types switched off. A dish shows only if none of its types are off (eggs-only dishes need eggs on).
export function typesAllowed(recipe, off) {
  if (!off || !off.size) return true;
  for (const t of foodTypes(recipe)) if (off.has(t)) return false;
  return true;
}
export const SIDE_RECIPES = { rice: "b:steamed-rice", roti: "b:chapati", chutney: "b:coconut-chutney", raita: "b:raita", naan: "b:warm-naan", bread: "b:toast", salad: "b:green-salad" };

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lc = (v) => String(v ?? "").trim().toLowerCase();
const r2 = (n) => Math.round(n * 100) / 100;

export function isoDate(d = new Date()) {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function weekday(iso) { return new Date(iso + "T12:00:00Z").getUTCDay(); }          // 0 Sunday … 6 Saturday
export function dayLabel(iso, style = "short") {
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-GB", style === "long" ? { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }
    : { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
// Next occurrence of a weekday (0–6) on or after `from` (strictly after when `strict`).
export function nextWeekday(from, wd, strict = false) {
  let d = from;
  for (let i = 0; i < 8; i++) { if (weekday(d) === wd && !(strict && i === 0)) return d; d = addDays(d, 1); }
  return from;
}
// Seeded random numbers so "Shuffle" gives a new menu and the same seed gives the same one.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* =========================================================================================
   Ingredient catalogue
   ========================================================================================= */
export function norm(s) {
  return lc(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
// Plural → singular for matching ("tomatoes" → "tomato", "chillies" → "chilli").
function stem(w) {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(oes|ches|shes|sses|xes)$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}
const stemAll = (s) => norm(s).split(" ").map(stem).join(" ");

export function buildCatalog(rows, custom = [], meta = {}) {
  const byId = new Map(), list = [];
  for (const r of rows) {
    const [id, name, aisle, unit, gbp, inr, nut, o = {}] = r;
    const ing = { id, name, aisle, unit, gbp, inr, nut: { kcal: nut[0], protein: nut[1], carbs: nut[2], fat: nut[3], fibre: nut[4] },
      pc: o.pc, d: o.d, tin: o.tin, bunch: o.bunch, clove: o.clove, packs: o.packs || [], staple: !!o.st, free: !!o.free,
      aliases: (o.a || "").split("|").map((x) => x.trim()).filter(Boolean) };
    byId.set(id, ing); list.push(ing);
  }
  for (const c of custom || []) {
    if (!c || !c.id || byId.has(c.id)) continue;
    const ing = { id: c.id, name: c.name, aisle: c.aisle || "other", unit: ["g", "ml", "pc"].includes(c.unit) ? c.unit : "g", gbp: null, inr: null,
      nut: c.nut || null, pc: c.pc, d: c.d, packs: c.packs || [], staple: !!c.staple, free: false, custom: true, aliases: c.aliases || [] };
    byId.set(ing.id, ing); list.push(ing);
  }
  // Matching index: every name and alias, normalised and singularised.
  const exact = new Map(), entries = [];
  for (const ing of list) {
    for (const n of [ing.name, ...ing.aliases]) {
      const k = stemAll(n.replace(/\(.*?\)/g, ""));
      if (!k) continue;
      if (!exact.has(k)) exact.set(k, ing.id);
      entries.push({ id: ing.id, key: k, toks: k.split(" ") });
    }
  }
  return { byId, list, exact, entries, aisles: meta.aisles || {}, aisleOrder: meta.aisleOrder || [] };
}

// Words that describe an ingredient but don't identify it.
const NOISE = new Set(("fresh freshly large small medium big ripe chopped finely roughly diced sliced thinly thickly minced grated crushed peeled " +
  "deseeded seeded halved quartered cubed shredded boneless skinless organic free range british whole ground dried frozen tinned canned raw cooked " +
  "plain pure extra virgin light dark low fat reduced unsalted salted good quality handful pinch about approx optional to taste for serving garnish " +
  "of the a an and or into cut piece pieces cm inch inches stick sticks sprig sprigs leaf leaves bunch some few little more x pack packet bag tin can " +
  "jar bottle tub punnet loose value essential finest everyday basics own brand").split(" "));

function bigrams(s) { const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; }
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b), m = new Map();
  for (const x of A) m.set(x, (m.get(x) || 0) + 1);
  let hit = 0;
  for (const x of B) { const c = m.get(x); if (c) { hit++; m.set(x, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}
function tokScore(t, u) {
  if (t === u) return 1;
  if (t.length >= 3 && u.length >= 3 && (u.startsWith(t) || t.startsWith(u))) return 0.86;
  const d = dice(t, u);
  return d >= 0.55 ? d * 0.85 : 0;
}
// Best catalogue match for a piece of text. Returns { id, score } (score 0–1) or null.
export function matchIngredient(text, cat, opts = {}) {
  const k = stemAll(text);
  if (!k) return null;
  if (opts.aliases && opts.aliases[k]) return { id: opts.aliases[k].ing || opts.aliases[k], score: 1, learned: true };
  if (cat.exact.has(k)) return { id: cat.exact.get(k), score: 1 };
  const toks = k.split(" ").filter((t) => t.length > 1 && !NOISE.has(t));
  if (!toks.length) return null;
  const joined = toks.join(" ");
  if (cat.exact.has(joined)) return { id: cat.exact.get(joined), score: 0.97 };
  let best = null;
  for (const e of cat.entries) {
    const et = e.toks.filter((t) => !NOISE.has(t));
    if (!et.length) continue;
    let got = 0, weight = 0;
    for (const t of toks) {
      let b = 0;
      for (const u of et) b = Math.max(b, tokScore(t, u));
      got += b * Math.min(t.length, 8); weight += Math.min(t.length, 8);
    }
    let covered = 0;
    for (const u of et) { let b = 0; for (const t of toks) b = Math.max(b, tokScore(t, u)); covered += b; }
    const precision = got / weight, recall = covered / et.length;
    let score = precision * 0.55 + recall * 0.45;
    if (opts.boost && opts.boost.has(e.id)) score += 0.12;
    if (!best || score > best.score) best = { id: e.id, score };
  }
  return best && best.score >= (opts.min ?? 0.5) ? { id: best.id, score: Math.min(1, r2(best.score)) } : null;
}

/* =========================================================================================
   Units and quantities
   ========================================================================================= */
const MASS = { g: 1, kg: 1000, mg: 0.001, oz: 28.35, lb: 453.6 };
const VOL = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240, floz: 29.6, pint: 568, dash: 0.6, pinch: 0.3, dl: 100, cl: 10 };
const UNIT_WORDS = {
  g: "g", gm: "g", gms: "g", gr: "g", gram: "g", grams: "g", gramme: "g", grammes: "g", kg: "kg", kgs: "kg", kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg",
  mg: "mg", oz: "oz", ounce: "oz", ounces: "oz", lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  ml: "ml", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml", mls: "ml", l: "l", litre: "l", litres: "l", liter: "l", liters: "l", ltr: "l",
  dl: "dl", cl: "cl",
  tsp: "tsp", tsps: "tsp", teaspoon: "tsp", teaspoons: "tsp", t: "tsp", tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp", dsp: "tbsp",
  cup: "cup", cups: "cup", c: "cup", floz: "floz", pint: "pint", pints: "pint", pt: "pint", dash: "dash", dashes: "dash", pinch: "pinch", pinches: "pinch",
  clove: "clove", cloves: "clove", tin: "tin", tins: "tin", can: "tin", cans: "tin", bunch: "bunch", bunches: "bunch",
  slice: "pc", slices: "pc", piece: "pc", pieces: "pc", pc: "pc", pcs: "pc", whole: "pc", handful: "handful", handfuls: "handful",
  sprig: "sprig", sprigs: "sprig", stick: "pc", sticks: "pc", knob: "knob", head: "pc", heads: "pc", fillet: "pc", fillets: "pc",
  sheet: "pc", sheets: "pc", ball: "pc", balls: "pc", pod: "pc", pods: "pc", leaf: "pc", leaves: "pc", stalk: "pc", stalks: "pc", rasher: "pc", rashers: "pc",
};
export const UNIT_LABEL = { g: "g", kg: "kg", ml: "ml", l: "litre", tsp: "tsp", tbsp: "tbsp", cup: "cup", pinch: "pinch", clove: "clove", tin: "tin", bunch: "bunch", pc: "", handful: "handful", sprig: "sprig", knob: "knob", oz: "oz", lb: "lb" };

// Convert an amount in any unit to the ingredient's own unit (g, ml or pc).
export function toBase(q, unit, ing) {
  if (!ing || !(q > 0)) return 0;
  const u = unit || "pc";
  let grams = null, ml = null;
  if (MASS[u]) grams = q * MASS[u];
  else if (VOL[u]) ml = q * VOL[u];
  else if (u === "clove") grams = q * (ing.clove || 5);
  else if (u === "tin") { const t = ing.tin || 400; if (ing.unit === "ml") ml = q * t; else grams = q * t; }
  else if (u === "bunch") grams = q * (ing.bunch || 30);
  else if (u === "handful") grams = q * 30;
  else if (u === "sprig") grams = q * 1.5;
  else if (u === "knob") grams = q * 15;
  else { if (ing.unit === "pc") return q; grams = q * (ing.pc || 100); }
  if (ing.unit === "g") return grams != null ? grams : ml * (ing.d || 1);
  if (ing.unit === "ml") return ml != null ? ml : grams / (ing.d || 1);
  const g = grams != null ? grams : ml * (ing.d || 1);                                   // pieces
  return g / (ing.pc || 100);
}
export function gramsOf(amount, ing) {
  if (!ing) return 0;
  if (ing.unit === "g") return amount;
  if (ing.unit === "ml") return amount * (ing.d || 1);
  return amount * (ing.pc || 100);
}
const FRAC = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875, "⅙": 1 / 6 };
export function fmtNum(n) {
  if (!isFinite(n)) return "";
  const whole = Math.floor(n + 1e-9), f = n - whole;
  const nice = [[0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];
  if (n < 10) for (const [v, s] of nice) if (Math.abs(f - v) < 0.04) return (whole ? whole : "") + s;
  if (f < 0.05) return String(whole);
  if (f > 0.95) return String(whole + 1);
  return n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n));
}
// A nice display of an amount in the ingredient's own unit (for shopping lists).
export function fmtBase(amount, ing) {
  if (!ing) return fmtNum(amount);
  if (ing.unit === "pc") { const n = Math.ceil(amount - 0.05); return `${n}`; }
  const big = amount >= 1000, unit = ing.unit === "g" ? (big ? "kg" : "g") : (big ? "litre" : "ml");
  let v = big ? amount / 1000 : amount;
  v = big ? Math.round(v * 100) / 100 : (v < 20 ? Math.round(v * 2) / 2 : Math.round(v / 5) * 5 || Math.round(v));
  return `${v} ${unit}${big && unit === "litre" && v !== 1 ? "s" : ""}`;
}
// Recipe-style display of a scaled original quantity: "1½ tbsp", "3", "400 g".
export function fmtQty(q, u) {
  if (!(q > 0)) return "";
  if (u === "g" && q >= 1000) return `${fmtNum(q / 1000)} kg`;
  if (u === "ml" && q >= 1000) return `${fmtNum(q / 1000)} litre${q > 1000 ? "s" : ""}`;
  if (u === "g" || u === "ml") return `${q < 10 ? fmtNum(q) : Math.round(q / (q > 100 ? 5 : 1)) * (q > 100 ? 5 : 1)} ${u}`;
  const lab = UNIT_LABEL[u] ?? u;
  // Round to amounts you can actually measure: whole cloves and pieces (halves when small), quarter spoons.
  if (["pc", "clove", "tin", "bunch", "handful", "sprig", "knob"].includes(u) || !u) q = q < 3 ? Math.max(0.5, Math.round(q * 2) / 2) : Math.round(q);
  else if (["tsp", "tbsp", "cup"].includes(u)) { if (u === "tsp" && q < 0.2) return "a pinch"; q = Math.max(0.25, Math.round(q * 4) / 4); }
  const n = fmtNum(q);
  if (!lab) return n;
  const plural = q > 1 && ["tin", "clove", "bunch", "cup", "handful", "sprig", "knob", "pinch"].includes(u) ? (u === "bunch" ? "es" : u === "pinch" ? "es" : "s") : "";
  return `${n} ${lab}${plural}`;
}

// "1 ½", "1-2", "1/2", "0.5", "2 x 400g" at the start of a string → { q, rest }.
export function parseLeadingQty(s) {
  let str = String(s || "").trim().replace(/[  ]/g, " ");
  for (const [k, v] of Object.entries(FRAC)) str = str.replace(new RegExp("(\\d)\\s*" + k), (m, d) => `${d} ${v}`).replace(new RegExp(k, "g"), ` ${v} `);
  str = str.replace(/^\s+/, "");
  let m = str.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\s*(g|kg|ml|l)\b/i);                 // 2 x 400g tins
  if (m) return { q: Number(m[1]) * Number(m[2]), unitHint: m[3].toLowerCase(), rest: str.slice(m[0].length) };
  m = str.match(/^(\d+)\s+(\d+)\/(\d+)/);                                                        // 1 1/2
  if (m) return { q: Number(m[1]) + Number(m[2]) / Number(m[3]), rest: str.slice(m[0].length) };
  m = str.match(/^(\d+)\/(\d+)/);                                                                 // 1/2
  if (m) return { q: Number(m[1]) / Number(m[2]), rest: str.slice(m[0].length) };
  m = str.match(/^(\d+(?:\.\d+)?)\s+(0\.\d+)/);                                                    // 1 0.5 (from ½)
  if (m) return { q: Number(m[1]) + Number(m[2]), rest: str.slice(m[0].length) };
  m = str.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);                                // 1-2 → 1.5
  if (m) return { q: (Number(m[1]) + Number(m[2])) / 2, rest: str.slice(m[0].length) };
  m = str.match(/^(\d+(?:\.\d+)?)/);
  if (m) return { q: Number(m[1]), rest: str.slice(m[0].length) };
  m = str.match(/^(a|an|one)\s+/i);
  if (m) return { q: 1, rest: str.slice(m[0].length) };
  return { q: null, rest: str };
}
const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1, couple: 2, half: 0.5, dozen: 12 };

// Read one ingredient line from an imported or pasted recipe.
export function parseIngredientLine(line, cat, opts = {}) {
  let text = String(line || "").replace(/<[^>]*>/g, " ").replace(/^[\s•*·\-–▢□✓]+/, "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const original = text;
  const notes = [];
  text = text.replace(/\(([^)]*)\)/g, (m, inner) => { notes.push(inner.trim()); return " "; }).replace(/\s+/g, " ").trim();
  let { q, rest, unitHint } = parseLeadingQty(text);
  rest = rest.trim();
  if (q == null) {                                                              // "two onions"
    const w = rest.split(" ")[0].toLowerCase();
    if (WORD_NUM[w] != null) { q = WORD_NUM[w]; rest = rest.slice(w.length).trim(); }
  }
  let unit = unitHint || null;
  if (!unit) {
    const m = rest.match(/^([a-zA-Z.]+)\b\.?\s*/);
    if (m) {
      const w = m[1].toLowerCase().replace(/\.$/, "");
      if (UNIT_WORDS[w] && !(w === "t" && q == null)) { unit = UNIT_WORDS[w]; rest = rest.slice(m[0].length); }
    }
  } else rest = rest.replace(/^(tins?|cans?|packs?|jars?)\s+(of\s+)?/i, "");
  rest = rest.replace(/^of\s+/i, "").trim();
  // A size inside brackets can say how big a tin is: "1 tin (400g) chopped tomatoes".
  if ((unit === "tin" || unit == null) && q && notes.length) {
    const sz = notes.join(" ").match(/(\d+(?:\.\d+)?)\s*(g|ml|kg|l)\b/i);
    if (sz && unit === "tin") { q = q * Number(sz[1]) * (/k|^l$/i.test(sz[2]) ? 1000 : 1); unit = /ml|^l$/i.test(sz[2]) ? "ml" : "g"; }
  }
  let name = rest, note = "";
  const ci = rest.search(/,|;| - | – /);
  if (ci > 0) { name = rest.slice(0, ci).trim(); note = rest.slice(ci + 1).trim(); }
  name = name.replace(/\b(to taste|as needed|as required|for garnish|optional)\b/gi, "").trim();
  if (notes.length) note = [note, ...notes].filter(Boolean).join("; ");
  const optional = /optional/i.test(original);
  const m = matchIngredient(name, cat, { aliases: opts.aliases, min: 0.5 }) || matchIngredient(name.split(" ").slice(-2).join(" "), cat, { min: 0.62 });
  const ing = m ? cat.byId.get(m.id) : null;
  const amount = ing ? toBase(q ?? defaultQty(ing), q == null ? defaultUnit(ing) : unit, ing) : 0;
  return { text: original, q, u: unit || (q == null ? null : "pc"), name: name || original, note, opt: optional,
    id: m ? m.id : null, score: m ? m.score : 0, amount: r2(amount) };
}
// "Salt to taste" etc: a small sensible amount so costs and lists still work.
function defaultQty(ing) { return ing.aisle === "spices" ? 0.5 : ing.unit === "pc" ? 1 : ing.aisle === "produce" ? 1 : 1; }
function defaultUnit(ing) { return ing.aisle === "spices" || ing.aisle === "pantry" ? "tsp" : ing.unit === "pc" ? "pc" : ing.pc ? "pc" : "tbsp"; }

/* =========================================================================================
   Recipes
   ========================================================================================= */
// Built-in recipes use a compact text format; this turns them into the shape the app works with.
export function expandBuiltIn(raw, cat) {
  const ingredients = [];
  for (const part of String(raw.i).split(";")) {
    const p = part.trim();
    if (!p) continue;
    const [main, note] = p.split("~").map((x) => x.trim());
    const opt = main.startsWith("?");
    const m = main.replace(/^\?/, "").match(/^([a-z_]+)\s+([\d.]+)\s*([a-z]*)$/);
    if (!m) throw new Error(`Bad ingredient "${p}" in ${raw.id}`);
    const [, id, qs, us] = m;
    const ing = cat.byId.get(id);
    if (!ing) throw new Error(`Unknown ingredient "${id}" in ${raw.id}`);
    const q = Number(qs), u = us || "pc";
    if (!["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "pinch", "clove", "tin", "bunch", "pc"].includes(u)) throw new Error(`Bad unit "${u}" in ${raw.id}`);
    const item = { id, q, u, amount: r2(toBase(q, u, ing)), opt, note: note || "" };
    if (/fry/i.test(note || "") && ing.aisle === "pantry" && ing.unit === "ml") item.absorb = 0.15;       // deep-frying oil: most stays in the pan
    ingredients.push(item);
  }
  return {
    id: "b:" + raw.id, name: raw.n, cuisine: raw.c, meals: raw.m.split(",").map((x) => x.trim()), servings: raw.s,
    prep: raw.p, cook: raw.k, total: raw.p + raw.k, diet: raw.d, spice: raw.sp ?? 1, tags: (raw.t || "").split(",").map((x) => x.trim()).filter(Boolean),
    with: raw.w || "", ingredients, steps: raw.st, builtIn: true,
  };
}
export function dietOf(recipe, cat) {
  let rank = 0;
  for (const x of recipe.ingredients || []) {
    const ing = x.id && cat.byId.get(x.id);
    if (!ing || x.opt) continue;
    if (ing.aisle === "meat" || x.id === "fish_sauce") rank = Math.max(rank, 3);
    else if (x.id === "eggs") rank = Math.max(rank, 2);
    else if (["dairy"].includes(ing.aisle) || x.id === "honey" || x.id === "ghee") rank = Math.max(rank, 1);
  }
  return ["vegan", "veg", "egg", "nonveg"][rank];
}
export function dietAllows(want, recipeDiet) {
  if (!want || want === "any" || want === "nonveg") return true;
  return DIET_RANK[recipeDiet] <= DIET_RANK[want];
}

// Prices: the latest price from the household's scanned bills, else the starter estimate.
export function makePricer(cat, prices = {}, currency = "GBP", fx = { GBP: 1, USD: 1.3, EUR: 1.17 }) {
  const cache = new Map();
  return {
    currency,
    per(id) {
      if (cache.has(id)) return cache.get(id);
      let out = null;
      const hist = prices[id];
      if (hist && hist.length) {
        const last = hist.reduce((a, b) => ((b.date || b.at) > (a.date || a.at) ? b : a));
        out = { p: last.pb, src: "bill", at: last.date || last.at, store: last.store || "" };
      } else {
        const ing = cat.byId.get(id);
        if (ing && !ing.free) {
          const base = currency === "INR" ? ing.inr : ing.gbp != null ? ing.gbp * (fx[currency] || 1) : null;
          if (base != null) out = { p: ing.unit === "pc" ? base : base / 1000, src: "est" };
        }
        if (ing && ing.free) out = { p: 0, src: "free" };
      }
      cache.set(id, out);
      return out;
    },
  };
}
// Nutrition and cost of a recipe for a number of servings, plus per-serving figures.
export function recipeFacts(recipe, cat, pricer, servings) {
  const s = servings || recipe.servings || 1, k = s / (recipe.servings || 1);
  const n = { kcal: 0, protein: 0, carbs: 0, fat: 0, fibre: 0 };
  let cost = 0, priced = 0, billPriced = 0, counted = 0, unknown = 0;
  for (const x of recipe.ingredients || []) {
    if (x.opt) continue;
    const ing = x.id && cat.byId.get(x.id);
    if (!ing) { unknown++; continue; }
    if (ing.free) continue;
    const amt = (x.amount || 0) * k;
    counted++;
    if (ing.nut) { const g = gramsOf(amt * (x.absorb || 1), ing); for (const key in n) n[key] += (ing.nut[key] || 0) * g / 100; }
    const p = pricer && pricer.per(x.id);
    if (p) { cost += p.p * amt * (x.absorb ? 0.4 : 1); priced++; if (p.src === "bill") billPriced++; }
  }
  const per = {}; for (const key in n) per[key] = Math.round((n[key] / s) * 10) / 10;
  return { servings: s, cost: r2(cost), costPer: r2(cost / s), per, priced, billPriced, counted, unknown };
}
export function recipeTags(recipe, facts) {
  const t = new Set(recipe.tags || []);
  const p = facts.per;
  if (p.protein >= 20 || (p.kcal > 0 && (p.protein * 4) / p.kcal >= 0.25 && p.protein >= 12)) t.add("high-protein");
  if (p.carbs <= 20 && p.kcal > 120) t.add("low-carb");
  if (p.fibre >= 8) t.add("high-fibre");
  if (p.kcal > 0 && p.kcal <= 400) t.add("light");
  if ((recipe.spice ?? 1) <= 1 || t.has("kid")) t.add("kid-friendly");
  if ((recipe.total || 0) <= 30) t.add("quick");
  return t;
}

/* =========================================================================================
   Reading a typed or spoken request: "Plan dinners for a family of four next week, Indian and Italian,
   no more than 30 minutes of cooking per day, £60 budget"
   ========================================================================================= */
export const CUISINES = ["South Indian", "North Indian", "West Indian", "Indo-Chinese", "Italian", "British", "Mexican", "Chinese", "Thai", "Japanese", "Korean", "Mediterranean", "Middle Eastern", "Spanish", "French", "American"];
const CUISINE_WORDS = [
  [/\bsouth[\s-]*indian|tamil|kerala|keralan|chettinad|andhra|karnataka|udupi|malabar\b/, ["South Indian"]],
  [/\bnorth[\s-]*indian|punjabi|mughlai|kashmiri|delhi\b/, ["North Indian"]],
  [/\bwest(ern)?[\s-]*indian|gujarati|maharashtrian|marathi|mumbai|goan\b/, ["West Indian"]],
  [/\bindo[\s-]*chinese|desi chinese|hakka\b/, ["Indo-Chinese"]],
  [/\bitalian|pasta night\b/, ["Italian"]],
  [/\bbritish|english|scottish|irish|pub food\b/, ["British"]],
  [/\bmexican|tex[\s-]*mex\b/, ["Mexican"]],
  [/(?<!indo[\s-]*)(?<!desi )\bchinese\b/, ["Chinese"]],
  [/\bthai\b/, ["Thai"]], [/\bjapanese\b/, ["Japanese"]], [/\bkorean\b/, ["Korean"]],
  [/\bmediterranean|greek\b/, ["Mediterranean"]], [/\bmiddle[\s-]*eastern|lebanese|turkish|arabic|persian\b/, ["Middle Eastern"]],
  [/\bspanish\b/, ["Spanish"]], [/\bfrench\b/, ["French"]], [/\bamerican\b/, ["American"]],
  [/\basian\b/, ["Chinese", "Thai", "Japanese", "Korean", "Indo-Chinese"]],
  [/\beuropean|continental\b/, ["Italian", "British", "French", "Spanish", "Mediterranean"]],
];
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, a: 1, an: 1 };
const NUM = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|forty|fifty|sixty|ninety)";
const toNum = (s) => (/^\d/.test(s) ? Number(s) : NUM_WORDS[s] ?? null);
const AVOID_GROUPS = {
  meat: ["chicken_breast", "chicken_thigh", "chicken_curry_cut", "mutton", "lamb_mince", "beef_mince", "beef_steak", "pork", "bacon", "sausages", "chorizo"],
  fish: ["white_fish", "salmon", "tuna_tin", "fish_sauce"], seafood: ["white_fish", "salmon", "prawns", "tuna_tin", "fish_sauce", "mussels", "squid", "crab"], shellfish: ["prawns", "mussels", "crab", "squid"], mussel: ["mussels"], crab: ["crab"], squid: ["squid"], salmon: ["salmon"], tuna: ["tuna_tin"],
  prawn: ["prawns"], shrimp: ["prawns"], beef: ["beef_mince", "beef_steak"], pork: ["pork", "bacon", "sausages", "chorizo"],
  chicken: ["chicken_breast", "chicken_thigh", "chicken_curry_cut"], lamb: ["mutton", "lamb_mince"], mutton: ["mutton", "lamb_mince"],
  egg: ["eggs"], dairy: ["milk", "yogurt", "greek_yogurt", "paneer", "butter", "ghee", "cream", "cheddar", "mozzarella", "parmesan", "feta", "halloumi"],
  nut: ["peanuts", "cashews", "almonds", "walnuts", "peanut_butter"], peanut: ["peanuts", "peanut_butter"],
  gluten: ["atta", "flour", "pasta", "pasta_short", "lasagne", "egg_noodles", "bread", "tortilla", "burger_bun", "pitta", "naan", "pizza_base", "semolina", "vermicelli", "couscous", "bulgur", "breadcrumbs", "granola", "soy_sauce"],
  mushroom: ["mushroom"], cheese: ["cheddar", "mozzarella", "parmesan", "feta", "halloumi"], paneer: ["paneer"], coconut: ["coconut", "coconut_milk", "desiccated_coconut", "coconut_oil"],
};

export function parseRequest(text, ctx = {}) {
  const today = ctx.today || isoDate();
  const cat = ctx.cat;
  const t = " " + lc(text).replace(/[’']/g, "'").replace(/\s+/g, " ") + " ";
  const req = {}, understood = [];
  const say = (key, label) => understood.push({ key, label });

  // --- who's eating
  let m;
  if ((m = t.match(new RegExp(`\\b${NUM} adults?(?: and | & | \\+ )${NUM} (kids|children|child|teens?|toddlers?)`)))) {
    req.adults = toNum(m[1]); req.kids = toNum(m[2]); req.people = req.adults + req.kids;
    say("people", `${req.people} people (${req.adults} adult${req.adults > 1 ? "s" : ""}, ${req.kids} child${req.kids > 1 ? "ren" : ""})`);
  } else if ((m = t.match(new RegExp(`\\bfamily of ${NUM}\\b`))) || (m = t.match(new RegExp(`\\b(?:for|feed|feeds|serves|serving|cook for|cooking for) ${NUM}\\b(?! (?:days?|weeks?|meals?|minutes?|mins?|hours?|year))`))) ||
             (m = t.match(new RegExp(`\\b${NUM} (?:people|persons|adults|of us|members|pax|mouths|diners)\\b`)))) {
    req.people = toNum(m[1]); say("people", `${req.people} ${req.people === 1 ? "person" : "people"}`);
  } else if (/\b(just me|for me|for myself|only me|single person)\b/.test(t)) { req.people = 1; say("people", "1 person"); }
  else if (/\b(for two|the two of us|couple|me and my (wife|husband|partner))\b/.test(t)) { req.people = 2; say("people", "2 people"); }
  const ages = [...t.matchAll(/\b(\d{1,2})[\s-]*(?:year|yr)s?[\s-]*old\b/g)].map((x) => Number(x[1]));
  if (ages.length) {
    req.ages = ages;
    if (ages.some((a) => a < 13)) { req.goals = addTo(req.goals, "kid-friendly"); say("goal", `Kid-friendly (${ages.filter((a) => a < 13).join(", ")}-year-old)`); }
  } else if (/\b(kids?|children|child|toddlers?|my son|my daughter|school lunch|lunchbox)\b/.test(t)) { req.goals = addTo(req.goals, "kid-friendly"); say("goal", "Kid-friendly"); }

  // --- which meals
  const meals = [];
  if (/\b(4|four) meals\b/.test(t)) meals.push("breakfast", "lunch", "dinner", "snack");
  else if (/\b(all|3|three) meals\b|\bevery meal\b|\ball day\b/.test(t)) meals.push("breakfast", "lunch", "dinner");
  else if (/\b(2|two) meals\b/.test(t)) meals.push("lunch", "dinner");
  else {
    if (/\bbreakfasts?\b|\bmornings?\b/.test(t)) meals.push("breakfast");
    if (/\blunch(es)?\b|\blunchbox(es)?\b/.test(t)) meals.push("lunch");
    if (/\bdinners?\b|\bsuppers?\b|\bevening meals?\b|\btea time\b/.test(t)) meals.push("dinner");
    if (/\bsnacks?\b|\btiffin\b/.test(t)) meals.push("snack");
  }
  if (meals.length) { req.meals = MEALS.filter((x) => meals.includes(x)); say("meals", req.meals.map((x) => MEAL_LABEL[x]).join(", ")); }

  // --- which days
  const weekStart = ctx.weekStart ?? 1;
  const nextWeekStart = nextWeekday(today, weekStart, true);
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  if (/\b(fortnight|two weeks|2 weeks)\b/.test(t)) { req.start = /\bnext\b/.test(t) ? nextWeekStart : today; req.days = 14; }
  else if (/\bweekdays?\b|\bwork ?week\b|\bmonday to friday\b|\bmon[\s-]*fri\b/.test(t)) {
    req.start = /\bthis\b/.test(t) && weekday(today) >= 1 && weekday(today) <= 5 ? today : nextWeekday(today, 1, /\bnext\b/.test(t) || weekday(today) !== 1);
    req.days = /\bthis\b/.test(t) ? 6 - weekday(req.start) : 5;
  } else if (/\bweekend\b/.test(t)) { req.start = nextWeekday(today, 6, /\bnext\b/.test(t) && weekday(today) === 6); req.days = 2; }
  else if (/\bnext week\b/.test(t)) { req.start = nextWeekStart; req.days = 7; }
  else if (/\bthis week\b|\bthe week\b|\bweekly\b|\bfor the week\b|\ba week\b/.test(t)) { req.start = today; req.days = 7; }
  else if (/\btomorrow\b/.test(t)) { req.start = addDays(today, 1); req.days = 1; }
  else if (/\b(today|tonight)\b/.test(t)) { req.start = today; req.days = 1; }
  if ((m = t.match(new RegExp(`\\b${NUM} days?\\b(?! a week)`))) && !/minutes? (?:a|per|each) day/.test(m[0])) { req.days = clamp(toNum(m[1]), 1, 14); req.start = req.start || today; }
  if ((m = t.match(new RegExp(`\\b${NUM} weeks?\\b`)))) { req.days = clamp(toNum(m[1]) * 7, 1, 14); req.start = req.start || (/\bnext\b/.test(t) ? nextWeekStart : today); }
  if ((m = t.match(/\b(?:from|starting|start on|beginning) (?:next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/))) req.start = nextWeekday(today, dayNames.indexOf(m[1]), /\bnext\b/.test(m[0]));
  if (req.start) say("days", `${req.days || 7} day${(req.days || 7) > 1 ? "s" : ""} from ${dayLabel(req.start)}`);

  // --- cuisines
  const cs = new Set();
  if (/\bindian\b/.test(t) && !/\b(south|north|west|western)[\s-]*indian\b/.test(t)) ["South Indian", "North Indian", "West Indian"].forEach((c) => cs.add(c));
  for (const [re, list] of CUISINE_WORDS) if (re.test(t)) list.forEach((c) => cs.add(c));
  if (cs.size) { req.cuisines = [...cs]; say("cuisines", req.cuisines.join(", ")); }

  // --- time limits
  const mins = (n, unit) => (/^h/.test(unit) ? n * 60 : n);
  const TIME = `${NUM}(?:\\s*(?:-|to)\\s*\\d+)?\\s*(minutes?|mins?|m\\b|hours?|hrs?)`;
  let tm;
  if (/\bhalf an hour\b/.test(t)) tm = { n: 30, idx: t.indexOf("half an hour"), len: 12 };
  else if (/\ban hour\b/.test(t)) tm = { n: 60, idx: t.indexOf("an hour"), len: 7 };
  const timeRe = new RegExp(TIME, "g");
  const times = [...t.matchAll(timeRe)].map((x) => ({ n: mins(toNum(x[1]), x[2]), idx: x.index, len: x[0].length }));
  if (tm && !times.length) times.push(tm);
  for (const x of times) {
    const before = t.slice(Math.max(0, x.idx - 40), x.idx), after = t.slice(x.idx + x.len, x.idx + x.len + 40);
    const perDay = /^\s*(?:of [a-z ]*?)?(?:a|per|each|every) day\b/.test(after) || /^\s*(?:of [a-z ]+ )?daily\b/.test(after) || /\b(?:a|per|each) day\b[^.]*$/.test(before.slice(-14));
    if (perDay) { req.maxDay = x.n; say("time", `Up to ${x.n} min in the kitchen per day`); continue; }
    if (/prep(aration)?\b[^.]*$/.test(before.slice(-25)) || /^\s*(of )?prep/.test(after)) { req.maxPrep = x.n; say("time", `Prep up to ${x.n} min`); continue; }
    if (/cook(ing)?( time)?\b[^.]*$/.test(before.slice(-25)) && !/total/.test(before.slice(-25))) { req.maxCook = x.n; say("time", `Cooking up to ${x.n} min per meal`); continue; }
    if (/(under|less than|no more than|max(imum)?|within|up to|at most|quick|in)\s*$/.test(before.trim() + " ") || /^\s*(or less|max|meals?|recipes?)/.test(after) || /-$/.test(before)) {
      req.maxTotal = x.n; say("time", `Up to ${x.n} min per meal`);
    }
  }
  if (!req.maxTotal && !req.maxDay && /\b(quick|fast|speedy|easy|simple|busy)\b/.test(t)) { req.maxTotal = 30; say("time", "Quick: up to 30 min per meal"); }

  // --- budget
  const money = t.match(/(£|₹|rs\.?\s?|inr\s?|\$|€|usd\s?|eur\s?)\s?(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/) ||
    t.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(k\s)?(?:pounds|quid|gbp|rupees|rs|inr|dollars|usd|euros?|eur)\b/) ||
    t.match(/\bbudget(?: of| is| around| about)?\s*(\d[\d,]*(?:\.\d+)?)/);
  if (money) {
    const numStr = money[2] && /\d/.test(money[2]) ? money[2] : money[1];
    let amount = Number(String(numStr).replace(/,/g, ""));
    if (/k/.test(money[0].replace(/\bkg\b/, "")) && amount < 1000 && /\dk\b|\d\s?k\b/.test(money[0])) amount *= 1000;
    if (amount > 0) {
      const after = t.slice(money.index + money[0].length, money.index + money[0].length + 25);
      if (/^\s*(a|per|each) day\b|^\s*daily\b/.test(after)) { req.budgetPerDay = amount; say("budget", `Budget ${amount} per day`); }
      else { req.budget = amount; say("budget", `Budget ${amount} in total`); }
    }
  }

  // --- diet and goals
  if (/\bvegan\b|\bplant[\s-]*based\b/.test(t)) req.diet = "vegan";
  else if (/\b(eggetarian|vegetarian (?:and|plus|\+|with) eggs?|veg (?:and|plus|\+) eggs?|eggs? (?:are )?(?:ok|fine|allowed))\b/.test(t)) req.diet = "egg";
  else if (/\b(vegetarian|veggie|pure veg|veg only|no meat|meat[\s-]*free|meatless|jain)\b/.test(t) && !/\bnon[\s-]*veg/.test(t)) req.diet = /\bno meat\b|\bmeat[\s-]*free\b/.test(t) && !/\bno eggs?\b/.test(t) ? "egg" : "veg";
  else if (/\bnon[\s-]*veg(etarian)?\b/.test(t)) req.diet = "any";
  if (req.diet) say("diet", DIETS[req.diet]);
  const goal = (re, g) => { if (re.test(t)) { req.goals = addTo(req.goals, g); say("goal", GOALS[g]); } };
  goal(/\bprotein\b|\bhigh[\s-]*protein\b|\bmuscle\b|\bgym\b/, "high-protein");
  goal(/\blow[\s-]*carbs?\b|\bketo\b|\bno carbs?\b/, "low-carb");
  goal(/\blight\b|\blow[\s-]*cal(orie)?s?\b|\bhealthy\b|\bweight loss\b|\blose weight\b/, "light");
  goal(/\bcheap\b|\bbudget[\s-]*friendly\b|\baffordable\b|\bsave money\b|\binexpensive\b|\bfrugal\b/, "budget");
  goal(/\bhigh[\s-]*fib(re|er)\b|\bfib(re|er)\b/, "high-fibre");
  goal(/\bmild\b|\bnot spicy\b|\bno spice\b|\bless spicy\b|\blow spice\b/, "mild");
  if (!/\bnot spicy\b|\bless spicy\b/.test(t)) goal(/\bspicy\b|\bhot food\b/, "spicy");

  // --- things to avoid
  const avoid = new Set(), avoidLabels = [];
  for (const mm of t.matchAll(/\b(?:no|without|avoid|avoiding|except|excluding|allergic to|allergy to|hates?|don't like|doesn't like|dislikes?|not)\s+([a-z ,&-]+?)(?=[,.;!?]|\s(?:and|but|for|with|in|on|under|over|less|more|budget|cooking|per|a|the|this|next)\b|$)/g)) {
    for (let word of mm[1].split(/,|\bor\b|&|\band\b/).map((x) => x.trim()).filter(Boolean)) {
      word = word.replace(/^(any|too much|too many|much)\s+/, "");
      if (/^(more than|spicy|spice|carbs?|meat|repeats?|repeat|onion and garlic|onion garlic)$/.test(word)) {
        if (/onion/.test(word)) ["onion", "red_onion", "spring_onion", "shallot", "garlic"].forEach((x) => avoid.add(x));
        continue;
      }
      const key = stem(word.split(" ").pop());
      if (AVOID_GROUPS[key]) { AVOID_GROUPS[key].forEach((x) => avoid.add(x)); avoidLabels.push(word); continue; }
      if (cat) { const hit = matchIngredient(word, cat, { min: 0.7 }); if (hit) { avoid.add(hit.id); avoidLabels.push(cat.byId.get(hit.id).name.toLowerCase()); } }
    }
  }
  if (/\bgluten[\s-]*free\b|\bcoeliac\b|\bceliac\b/.test(t)) { AVOID_GROUPS.gluten.forEach((x) => avoid.add(x)); avoidLabels.push("gluten"); }
  if (/\bdairy[\s-]*free\b|\blactose\b/.test(t)) { AVOID_GROUPS.dairy.forEach((x) => avoid.add(x)); avoidLabels.push("dairy"); }
  if (/\bnut[\s-]*free\b/.test(t)) { AVOID_GROUPS.nut.forEach((x) => avoid.add(x)); avoidLabels.push("nuts"); }
  if (/\b(no|without) onion(s)? (and|or|&) garlic\b|\bjain\b/.test(t)) ["onion", "red_onion", "spring_onion", "shallot", "garlic"].forEach((x) => avoid.add(x));
  if (avoid.size) { req.avoid = [...avoid]; say("avoid", "Avoid " + [...new Set(avoidLabels)].join(", ")); }

  // --- extras
  if (/\bleftovers?\b|\bcook once\b|\bbatch cook(ing)?\b/.test(t)) { req.leftovers = true; say("leftovers", "Dinner leftovers for next day's lunch"); }
  if ((m = t.match(/\b([1-3]|one|two|three) (?:alternatives?|options?|choices?)\b/))) { req.alts = clamp(toNum(m[1]), 1, 3); say("alts", `${req.alts} alternative${req.alts > 1 ? "s" : ""} per meal`); }
  if (/\bno (?:repeats?|repetition)\b|\bdifferent every day\b|\bvariety\b/.test(t)) req.variety = "high";
  return { req, understood };
}
function addTo(arr, v) { const a = arr ? arr.slice() : []; if (!a.includes(v)) a.push(v); return a; }

/* =========================================================================================
   The planner
   ========================================================================================= */
export const PLAN_DEFAULTS = {
  start: null, days: 7, meals: ["breakfast", "lunch", "dinner"], people: 2, cuisines: [], diet: "any", goals: [], avoid: [],
  maxPrep: null, maxCook: null, maxTotal: null, maxDay: null, budget: null, budgetPerDay: null, alts: 2, sides: true, leftovers: false, seed: 1, variety: "normal",
};

// recipes: all usable recipes (expanded). ctx: { cat, pricer, favs:Set, today, locked: { "d|meal": slot } }
export function planMenu(reqIn, recipes, ctx) {
  const req = Object.assign({}, PLAN_DEFAULTS, reqIn);
  req.start = req.start || ctx.today || isoDate();
  req.days = clamp(Number(req.days) || 7, 1, 14);
  req.meals = (req.meals && req.meals.length ? req.meals : PLAN_DEFAULTS.meals).filter((x) => MEALS.includes(x));
  const people = Math.max(0.5, Number(req.people) || 1);
  const servings = Math.max(1, Math.round(people * 2) / 2);
  const rand = rng(req.seed || 1);
  const { cat, pricer } = ctx;
  const byId = new Map(recipes.map((r) => [r.id, r]));
  const avoid = new Set(req.avoid || []);
  const goals = new Set(req.goals || []);
  const warnings = [];

  // Facts for every recipe once.
  const facts = new Map();
  for (const r of recipes) { const f = recipeFacts(r, cat, pricer, r.servings); facts.set(r.id, { f, tags: recipeTags(r, f) }); }
  const sideFor = (r) => {
    if (!req.sides || !r.with) return null;
    const id = SIDE_RECIPES[r.with];
    const s = id && byId.get(id);
    return s && !(s.ingredients || []).some((x) => avoid.has(x.id) && !x.opt) ? s : null;
  };
  const slotTime = (r) => { const s = sideFor(r); return Math.max(r.total || 0, s ? s.total || 0 : 0) + (s ? 3 : 0); };
  const slotCost = (r, srv = servings) => {
    let c = recipeFacts(r, cat, pricer, srv).cost;
    const s = sideFor(r); if (s) c += recipeFacts(s, cat, pricer, srv).cost;
    return c;
  };
  const fits = (r, meal, opts = {}) => {
    if (!r.meals.includes(meal) || r.meals.includes("side") && r.meals.length === 1) return false;
    if (!dietAllows(req.diet, r.diet)) return false;
    if (!opts.anyCuisine && req.cuisines.length && !req.cuisines.includes(r.cuisine)) return false;
    if (req.maxPrep && (r.prep || 0) > req.maxPrep) return false;
    if (req.maxCook && (r.cook || 0) > req.maxCook) return false;
    if (req.maxTotal && slotTime(r) > req.maxTotal) return false;
    if ((r.ingredients || []).some((x) => !x.opt && avoid.has(x.id))) return false;
    if (goals.has("mild") && (r.spice ?? 1) >= 3) return false;
    return true;
  };
  // Candidate pools per meal (relaxing cuisine for meals the chosen cuisines don't cover, e.g. breakfast).
  const pools = {};
  for (const meal of req.meals) {
    let pool = recipes.filter((r) => fits(r, meal));
    if (pool.length < 2 && req.cuisines.length) {
      const relaxed = recipes.filter((r) => fits(r, meal, { anyCuisine: true }));
      if (relaxed.length > pool.length) { warnings.push(`Not enough ${req.cuisines.join("/")} ${MEAL_LABEL[meal].toLowerCase()} recipes, so other cuisines are included for ${MEAL_LABEL[meal].toLowerCase()}.`); pool = relaxed; }
    }
    if (!pool.length) warnings.push(`No ${MEAL_LABEL[meal].toLowerCase()} recipes match all your settings — try relaxing the time limit, diet or things to avoid.`);
    pools[meal] = pool;
  }
  const allCosts = recipes.map((r) => facts.get(r.id).f.costPer).filter((x) => x > 0).sort((a, b) => a - b);
  const medianCost = allCosts[Math.floor(allCosts.length / 2)] || 1;
  const budgetTotal = req.budget || (req.budgetPerDay ? req.budgetPerDay * req.days : null);
  const budgetWeight = goals.has("budget") ? 0.9 : 0.15;                 // a budget itself is enforced by the squeeze below

  const score = (r, ctxS) => {
    const { f, tags } = facts.get(r.id);
    let s = rand() * 1.1;
    if (goals.has("high-protein")) s += Math.min(f.per.protein / 18, 1.8) * 1.2 - (tags.has("high-protein") ? 0 : 0.4);
    if (goals.has("kid-friendly")) s += (tags.has("kid-friendly") ? 0.6 : -0.7) + ((r.tags || []).includes("kid") ? 0.3 : 0);
    if (goals.has("low-carb")) s -= f.per.carbs / 45;
    if (goals.has("light")) s -= f.per.kcal / 600;
    if (goals.has("high-fibre")) s += Math.min(f.per.fibre / 8, 1.5);
    if (goals.has("spicy")) s += ((r.spice ?? 1) - 1) * 0.4;
    s -= (f.costPer / medianCost) * budgetWeight;
    if (ctx.favs && ctx.favs.has(r.id)) s += 0.5;
    const last = ctxS.lastUsed.get(r.id);
    if (last != null) s -= req.variety === "high" ? 5 : Math.max(0, 3 - (ctxS.slotIndex - last) * 0.15);
    if (ctxS.dayCuisines.has(r.cuisine) && req.cuisines.length !== 1) s -= 0.25;
    if (ctxS.prevMain && ctxS.prevMain === mainProtein(r)) s -= 0.35;
    if (req.cuisines.length > 1) s += 0.25 * (1 - (ctxS.cuisineCount.get(r.cuisine) || 0) / Math.max(1, ctxS.slotIndex / req.cuisines.length));
    return s;
  };

  const slots = [];
  const lastUsed = new Map(), cuisineCount = new Map();
  let slotIndex = 0, prevMain = null;
  for (let d = 0; d < req.days; d++) {
    const dayCuisines = new Set();
    let dayTime = 0;
    for (const meal of req.meals) {
      const key = `${d}|${meal}`;
      const locked = ctx.locked && ctx.locked[key];
      if (locked) {
        slots.push(locked);
        for (const x of locked.dishes || []) { const r = byId.get(x.r); if (r) { lastUsed.set(r.id, slotIndex); dayCuisines.add(r.cuisine); dayTime += slotTime(r); } }
        slotIndex++; continue;
      }
      if (req.leftovers && meal === "lunch" && d > 0 && req.meals.includes("dinner")) {
        const prev = slots.find((s) => s.d === d - 1 && s.m === "dinner");
        if (prev && prev.dishes.length) { slots.push({ d, m: meal, dishes: prev.dishes.map((x) => ({ r: x.r, s: servings })), alts: [], leftover: { d: d - 1, m: "dinner" } }); slotIndex++; continue; }
      }
      const remainingDay = req.maxDay ? req.maxDay - dayTime : Infinity;
      let pool = pools[meal].filter((r) => slotTime(r) <= remainingDay);
      if (!pool.length && pools[meal].length) {
        pool = pools[meal].slice().sort((a, b) => slotTime(a) - slotTime(b)).slice(0, 3);
        if (req.maxDay) warnings.push(`${dayLabel(addDays(req.start, d))}: couldn't keep to ${req.maxDay} min in the kitchen — picked the quickest options.`);
      }
      if (!pool.length) { slots.push({ d, m: meal, dishes: [], alts: [] }); slotIndex++; continue; }
      const ranked = pool.map((r) => ({ r, s: score(r, { lastUsed, slotIndex, dayCuisines, prevMain, cuisineCount }) })).sort((a, b) => b.s - a.s);
      const pick = ranked[0].r;
      const alts = [];
      for (const x of ranked.slice(1)) { if (alts.length >= clamp(req.alts ?? 2, 0, 3)) break; if (!alts.includes(x.r.id) && x.r.id !== pick.id) alts.push(x.r.id); }
      const leftoverNext = req.leftovers && meal === "dinner" && req.meals.includes("lunch") && d < req.days - 1;
      const dishes = [{ r: pick.id, s: leftoverNext ? servings * 2 : servings }];
      const side = sideFor(pick);
      if (side) dishes.push({ r: side.id, s: leftoverNext ? servings * 2 : servings, side: true });
      slots.push({ d, m: meal, dishes, alts });
      lastUsed.set(pick.id, slotIndex); dayCuisines.add(pick.cuisine); dayTime += slotTime(pick);
      cuisineCount.set(pick.cuisine, (cuisineCount.get(pick.cuisine) || 0) + 1);
      if (meal === "lunch" || meal === "dinner") prevMain = mainProtein(pick);
      slotIndex++;
    }
  }

  // Budget: swap the priciest meals for cheaper alternatives until the plan fits (or nothing cheaper fits).
  let cost = planCost(slots, byId, cat, pricer);
  if (budgetTotal && cost > budgetTotal) {
    for (let guard = 0; guard < 200 && cost > budgetTotal; guard++) {
      let best = null;
      for (const s of slots) {
        if (s.leftover || !s.dishes.length || (ctx.locked && ctx.locked[`${s.d}|${s.m}`])) continue;
        const cur = byId.get(s.dishes[0].r); if (!cur) continue;
        const curCost = slotCost(cur, s.dishes[0].s);
        const dayUsed = slots.filter((x) => x.d === s.d && x !== s && !x.leftover).reduce((a, x) => a + (x.dishes[0] ? slotTime(byId.get(x.dishes[0].r) || { total: 0 }) : 0), 0);
        for (const r of pools[s.m]) {
          if (r.id === cur.id) continue;
          if (req.maxDay && dayUsed + slotTime(r) > req.maxDay) continue;
          const used = slots.filter((x) => x.dishes[0] && x.dishes[0].r === r.id).length;
          if (used >= (req.days > 7 ? 2 : 1)) continue;
          const c = slotCost(r, s.dishes[0].s), saving = curCost - c;
          if (saving <= 0.01) continue;
          const loss = facts.get(cur.id).f.per.protein > facts.get(r.id).f.per.protein && goals.has("high-protein") ? 1.5 : 1;
          const val = saving / loss;
          if (!best || val > best.val) best = { s, r, val };
        }
      }
      if (!best) break;
      const s = best.s, oldId = s.dishes[0].r, srv = s.dishes[0].s;
      s.dishes = [{ r: best.r.id, s: srv }];
      const side = sideFor(best.r); if (side) s.dishes.push({ r: side.id, s: srv, side: true });
      s.alts = [oldId, ...s.alts.filter((x) => x !== best.r.id && x !== oldId)].slice(0, Math.max(1, req.alts ?? 2));
      for (const l of slots) if (l.leftover && l.leftover.d === s.d && l.leftover.m === s.m) l.dishes = s.dishes.map((x) => ({ r: x.r, s: servings }));
      cost = planCost(slots, byId, cat, pricer);
    }
    if (cost > budgetTotal) warnings.push(`The cheapest menu that fits your other settings comes to about ${r2(cost)}, over your budget of ${budgetTotal}.`);
  }
  return { req: Object.assign(req, { servings }), slots, cost: r2(cost), warnings: [...new Set(warnings)] };
}
function mainProtein(r) {
  const ids = (r.ingredients || []).map((x) => x.id);
  for (const p of ["chicken_breast", "chicken_thigh", "chicken_curry_cut", "mutton", "lamb_mince", "beef_mince", "beef_steak", "pork", "white_fish", "salmon", "prawns", "mussels", "squid", "crab", "paneer", "eggs", "tofu"])
    if (ids.includes(p)) return p.replace(/_.*/, "");
  return null;
}
export function planCost(slots, byId, cat, pricer) {
  let total = 0;
  for (const s of slots) {
    if (s.leftover) continue;
    for (const x of s.dishes || []) { const r = byId.get(x.r); if (r) total += recipeFacts(r, cat, pricer, x.s).cost; }
  }
  return r2(total);
}
// Per-day and per-person figures for a menu: kitchen time, protein and calories.
export function menuStats(slots, byId, cat, pricer, people, days) {
  const perDay = [];
  for (let d = 0; d < days; d++) perDay.push({ time: 0, cost: 0, protein: 0, kcal: 0 });
  for (const s of slots) {
    const day = perDay[s.d]; if (!day) continue;
    let slotT = 0;
    for (const x of s.dishes || []) {
      const r = byId.get(x.r); if (!r) continue;
      const f = recipeFacts(r, cat, pricer, x.s);
      if (!s.leftover) { day.cost += f.cost; slotT = Math.max(slotT, r.total || 0); }
      day.protein += f.per.protein; day.kcal += f.per.kcal;
    }
    day.time += s.leftover ? 5 : slotT;
  }
  for (const d of perDay) { d.cost = r2(d.cost); d.protein = Math.round(d.protein); d.kcal = Math.round(d.kcal); }
  return perDay;
}

/* =========================================================================================
   Shopping list
   ========================================================================================= */
// What a menu needs, ingredient by ingredient, in each ingredient's own unit.
export function shoppingNeeds(slots, byId, cat, pricer) {
  const need = new Map(), loose = new Map();
  for (const s of slots || []) {
    if (s.leftover) continue;
    for (const x of s.dishes || []) {
      const r = byId.get(x.r); if (!r) continue;
      const k = (x.s || r.servings) / (r.servings || 1);
      for (const it of r.ingredients || []) {
        if (it.opt) continue;
        const ing = it.id && cat.byId.get(it.id);
        if (ing) {
          if (ing.free) continue;
          const e = need.get(ing.id) || { id: ing.id, amount: 0, recipes: new Set() };
          e.amount += (it.amount || 0) * k; e.recipes.add(r.name); need.set(ing.id, e);
        } else if (it.name) {
          const key = norm(it.name);
          const e = loose.get(key) || { name: it.name, recipes: new Set(), texts: [] };
          e.recipes.add(r.name); if (it.text) e.texts.push(it.text); loose.set(key, e);
        }
      }
    }
  }
  const items = [];
  for (const e of need.values()) {
    const ing = cat.byId.get(e.id), amount = r2(e.amount);
    const p = pricer && pricer.per(ing.id);
    items.push({ id: ing.id, name: ing.name, aisle: ing.aisle, unit: ing.unit, amount, staple: ing.staple, recipes: [...e.recipes],
      cost: p ? r2(p.p * amount) : null, priceSrc: p ? p.src : null, buy: packSuggestion(amount, ing), display: fmtBase(amount, ing) });
  }
  for (const e of loose.values()) items.push({ id: null, name: e.name, aisle: "other", unit: "", amount: 0, staple: false, recipes: [...e.recipes], cost: null, display: "as needed", buy: "" });
  const order = cat.aisleOrder || [];
  items.sort((a, b) => (a.staple - b.staple) || (order.indexOf(a.aisle) - order.indexOf(b.aisle)) || a.name.localeCompare(b.name));
  return items;
}
export function packSuggestion(amount, ing) {
  const packs = (ing.packs || []).slice().sort((a, b) => a - b);
  if (!packs.length || !(amount > 0)) return "";
  const fit = packs.find((p) => p >= amount * 0.97);
  const p = fit || packs[packs.length - 1], n = fit ? 1 : Math.ceil(amount / p);
  const size = ing.unit === "pc" ? `${p}` : fmtBase(p, ing);
  if (ing.unit === "pc") return p === 1 ? `${Math.ceil(amount)}` : `${n} pack${n > 1 ? "s" : ""} of ${size}`;
  return `${n} × ${size}`;
}

/* =========================================================================================
   Shop receipts: read the text, find item lines and prices, and match them to ingredients
   ========================================================================================= */
const SKIP_LINE = /\b(sub[\s-]*total|total|balance|to pay|amount due|net amount|grand total|amount|change|cash|card|visa|mastercard|debit|credit|amex|contactless|tender|paid|vat|tax|gst|cgst|sgst|igst|round(ing)?|items? sold|no\.? of items|qty total|points|clubcard points|nectar points|thank|receipt|invoice|tel\b|phone|www\.|\.com|\.co\.uk|store no|till|cashier|operator|served by|auth|aid:|pan seq|merchant|terminal|date|time|bill no|gstin|fssai|signature|savings total|you saved|total savings|promotion savings|multibuy savings)\b/i;
const DISCOUNT_LINE = /\b(saving|discount|off\b|offer|promo|price cut|clubcard price|nectar price|lidl plus|coupon|voucher|reduced|multibuy|deal)\b/i;
const STORES = ["tesco", "sainsbury", "asda", "morrisons", "aldi", "lidl", "waitrose", "co-op", "coop", "iceland", "m&s", "marks", "ocado", "spar", "costco", "big bazaar", "dmart", "d-mart", "reliance", "more", "spencer", "nature's basket", "bigbasket", "star bazaar", "nilgiris", "walmart", "kroger", "target", "whole foods", "trader joe", "safeway"];
const ABBREV = {
  bsmti: "basmati", basmt: "basmati", bsmt: "basmati", chkn: "chicken", chckn: "chicken", chk: "chicken", chick: "chicken", brst: "breast", brest: "breast", thgh: "thigh", thghs: "thighs",
  tom: "tomato", toms: "tomatoes", tmto: "tomato", chpd: "chopped", chop: "chopped", swt: "sweet", pot: "potato", pots: "potatoes", ptato: "potato", onio: "onion", onin: "onion", oni: "onion",
  carr: "carrot", crrt: "carrot", crt: "carrot", mlk: "milk", semi: "semi skimmed", skmd: "skimmed", skim: "skimmed", whl: "whole", yog: "yogurt", ygrt: "yogurt", yogh: "yogurt", grk: "greek",
  mozz: "mozzarella", moz: "mozzarella", ched: "cheddar", chdr: "cheddar", mat: "mature", parm: "parmesan", butr: "butter", bttr: "butter", frz: "frozen", veg: "vegetable", vegs: "vegetables",
  cor: "coriander", corndr: "coriander", coriand: "coriander", corr: "coriander", gngr: "ginger", grlc: "garlic", glc: "garlic", chil: "chilli", chili: "chilli", chillies: "chilli", pnr: "paneer",
  spnch: "spinach", spin: "spinach", mush: "mushroom", mshrm: "mushroom", mshr: "mushroom", brocc: "broccoli", broc: "broccoli", cauli: "cauliflower", caul: "cauliflower",
  auberg: "aubergine", aub: "aubergine", cour: "courgette", crgt: "courgette", pep: "pepper", peprs: "peppers", ppr: "pepper", avo: "avocado", avoc: "avocado", bnna: "banana", ban: "banana", bnnas: "bananas",
  appl: "apple", lem: "lemon", lmn: "lemon", sunfl: "sunflower", sunflwr: "sunflower", evoo: "olive oil", olv: "olive", chkpea: "chickpeas", chkpeas: "chickpeas", chickp: "chickpeas", kdny: "kidney",
  bns: "beans", bn: "beans", lent: "lentils", lntl: "lentils", flr: "flour", pln: "plain", brd: "bread", wmeal: "wholemeal", whmeal: "wholemeal", wml: "wholemeal", fr: "free range", frange: "free range",
  bf: "beef", mnc: "mince", mince: "mince", lmb: "lamb", prk: "pork", saus: "sausages", sausg: "sausages", bcn: "bacon", salm: "salmon", slmn: "salmon", prwn: "prawns", prwns: "prawns",
  spag: "spaghetti", spagh: "spaghetti", nood: "noodles", ndls: "noodles", coc: "coconut", cocnt: "coconut", ccnt: "coconut", cnut: "coconut", sbr: "sambar", dl: "dal", daal: "dal", dhal: "dal",
  tuvar: "toor", toovar: "toor", arhar: "toor", masr: "masoor", moong: "moong", mung: "moong", channa: "chana", chna: "chana", atta: "atta", sooji: "semolina", suji: "semolina", rava: "semolina",
  pnut: "peanut", pnuts: "peanuts", cshw: "cashew", cashw: "cashew", almnd: "almond", rsns: "raisins", grnd: "ground", jeera: "cumin", haldi: "turmeric", trmrc: "turmeric", grm: "garam", msla: "masala",
  ketch: "ketchup", mayo: "mayonnaise", hny: "honey", sug: "sugar", sgr: "sugar", gran: "granulated", cstr: "caster", oats: "oats", porr: "porridge", grnla: "granola", torts: "tortillas", tort: "tortilla",
  wrps: "wraps", pitt: "pitta", nan: "naan", ckn: "chicken", fil: "fillets", flts: "fillets", fllt: "fillet", crm: "cream", dbl: "double", sngl: "single", pass: "passata", pste: "paste", pur: "puree",
  ccmbr: "cucumber", cucmbr: "cucumber", cuc: "cucumber", lett: "lettuce", ltce: "lettuce", spr: "spring", sprng: "spring", onns: "onions", red: "red", grn: "green", yell: "yellow", bty: "baby",
};
const RECEIPT_NOISE = /\b(tesco|asda|sainsbury'?s|sainsburys|morrisons|aldi|lidl|waitrose|co-?op|iceland|m&s|finest|everyday value|essential|essentials|basics|value|stockwell|hearty food co|smartprice|by sainsbury'?s|taste the difference|deluxe|specially selected|organic|british|irish|scottish|loose|class 1|pk|pack|x\d+|\d+pk|\d+ pack|ea|each|bag|tray|punnet|jar|tin|can|btl|bottle|tub)\b/gi;

export function normalizeReceiptText(s) {
  let t = lc(s).replace(/[^a-z0-9 &'/.-]+/g, " ");
  t = t.replace(RECEIPT_NOISE, " ").replace(/\b\d+(\.\d+)?\s*(kg|g|gm|ml|ltr|l|cl|pk|x)\b/g, " ").replace(/\b\d+\b/g, " ");
  t = t.split(/\s+/).filter(Boolean).map((w) => ABBREV[w.replace(/[.'-]/g, "")] || w.replace(/[.'-]/g, "")).join(" ");
  return t.replace(/\s+/g, " ").trim();
}
function packFromText(s) {
  const m = lc(s).match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|ml|ltr|l|cl)\b/) || lc(s).match(/(\d+(?:\.\d+)?)(kg|g|ml|l)\b/);
  if (m) {
    const n = Number(m[1]), u = m[2];
    if (/^k/.test(u)) return { qty: n * 1000, unit: "g" };
    if (/^(g|gm|gms)$/.test(u)) return { qty: n, unit: "g" };
    if (u === "ml") return { qty: n, unit: "ml" };
    if (u === "cl") return { qty: n * 10, unit: "ml" };
    return { qty: n * 1000, unit: "ml" };
  }
  const p = lc(s).match(/\b(\d+)\s*(?:pk|pack|x)\b|\bx\s*(\d+)\b/);
  if (p) return { qty: Number(p[1] || p[2]), unit: "pc" };
  const pt = lc(s).match(/(\d+)\s*(?:pints?|pt)\b/);
  if (pt) return { qty: Number(pt[1]) * 568, unit: "ml" };
  return null;
}
// Text from OCR or a pasted e-receipt → item lines with prices.
export function parseReceipt(text) {
  const raw = String(text || "").replace(/\r/g, "").split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const lines = [];
  let store = "", total = null, date = null;
  for (const l of raw.slice(0, 8)) { const s = STORES.find((x) => lc(l).includes(x)); if (s) { store = s.replace(/\b\w/g, (c) => c.toUpperCase()); break; } }
  for (const l of raw) {
    const dm = l.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/);
    if (dm && !date) { let y = Number(dm[3]); if (y < 100) y += 2000; const dd = Number(dm[1]), mm = Number(dm[2]); if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) date = `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`; }
    const tm = l.match(/\b(?:total|balance due|to pay|amount due|net amount|grand total)\b[^\d-]*(\d+[.,]\d{2})/i);
    if (tm && total == null && !/sub/i.test(l)) total = Number(tm[1].replace(",", "."));
  }
  const PRICE = /(-?)\s*(?:£|₹|rs\.?|\$|€)?\s*(\d{1,6}[.,]\d{2})\s*(?:[a-z*#]{0,2})?\s*$/i;
  let pendingDesc = null, pendingMult = null;
  for (let i = 0; i < raw.length; i++) {
    const l = raw[i];
    const pm = l.match(PRICE);
    if (!pm) {
      // A name with no price (weighed items print the weight on the next line), or "2 x £0.85" before the item.
      const mu = l.match(/^(\d+)\s*(?:x|@)\s*(?:£|₹|rs\.?|\$|€)?\s*(\d+[.,]\d{2})\s*$/i);
      if (mu) { pendingMult = { n: Number(mu[1]), each: Number(mu[2].replace(",", ".")) }; continue; }
      if (/[a-z]{3,}/i.test(l) && !SKIP_LINE.test(l) && l.length < 60) pendingDesc = l; else pendingDesc = null;
      continue;
    }
    const price = Number(pm[2].replace(",", ".")) * (pm[1] === "-" ? -1 : 1);
    let desc = l.slice(0, pm.index).trim();
    if (SKIP_LINE.test(desc) && !/\b(milk|card(amom)?)\b/i.test(desc.replace(SKIP_LINE, ""))) { pendingDesc = null; continue; }
    if (DISCOUNT_LINE.test(desc) || price < 0) {
      const prev = lines[lines.length - 1];
      if (prev) { prev.discount = r2((prev.discount || 0) + Math.abs(price)); prev.price = r2(Math.max(0, prev.price - Math.abs(price))); }
      continue;
    }
    let count = 1, weight = null;
    // "2 x £0.85   1.70" on its own line: the quantity of the item just above.
    const mult = desc.match(/^(\d+)\s*(?:x|@)\s*(?:£|₹|rs\.?|\$|€)?\s*(\d+[.,]\d{2})\s*$/i);
    if (mult && lines.length) { const prev = lines[lines.length - 1]; prev.count = Number(mult[1]); prev.price = price; continue; }
    const wt = desc.match(/(\d+(?:\.\d+)?)\s*kg\s*@\s*(?:£|₹|rs\.?|\$|€)?\s*(\d+[.,]\d{2})\s*\/?\s*kg/i);
    if (wt) {
      weight = Number(wt[1]) * 1000; desc = desc.replace(wt[0], "").trim();
      if (!/[a-z]{2,}/i.test(desc)) {
        if (pendingDesc) desc = pendingDesc;
        else if (lines.length && !lines[lines.length - 1].weight) { const prev = lines[lines.length - 1]; prev.weight = weight; prev.price = price; continue; }
      }
    }
    pendingDesc = null;
    // Indian-style columns: "Toor Dal 1kg   1   165.00   165.00" (qty, rate, amount).
    const cols = desc.match(/^(.*?\D)\s+(\d+(?:\.\d+)?)\s+(\d+[.,]\d{2})\s*$/);
    if (cols && Math.abs(Number(cols[2]) * Number(cols[3].replace(",", ".")) - price) < 0.06) { desc = cols[1].trim(); count = Number(cols[2]); }
    const lead = desc.match(/^(\d{1,2})\s+(?=[a-z])/i);
    if (lead && !/^\d+\s*(kg|g|ml|l|pk|x)\b/i.test(desc)) { count = Number(lead[1]); desc = desc.slice(lead[0].length); }
    if (pendingMult && Math.abs(pendingMult.n * pendingMult.each - price) < 0.02) count = pendingMult.n;
    pendingMult = null;
    desc = desc.replace(/^[\d\s*#]+(?=[a-z])/i, "").replace(/\s{2,}/g, " ").trim();
    if (!/[a-z]{2,}/i.test(desc)) continue;
    lines.push({ text: desc, price: r2(price), count, weight, pack: packFromText(desc) });
  }
  return { store, date, total, lines };
}
// Match receipt lines to ingredients. Learned names (from earlier bills) win; then shopping-list items get a boost.
export function matchReceipt(parsed, cat, aliases = {}, listIds = []) {
  const boost = new Set(listIds);
  return parsed.lines.map((l) => {
    const key = normalizeReceiptText(l.text);
    const learned = aliases[key];
    let id = null, score = 0, how = "none";
    if (learned) { id = learned.ing || learned; score = 1; how = "learned"; }
    else if (key) {
      const m = matchIngredient(key, cat, { boost, min: 0.45 });
      if (m) { id = m.id; score = m.score; how = "guess"; }
    }
    const ing = id && cat.byId.get(id);
    // How much was bought (in the ingredient's unit): weighed amount, pack size in the text, a learned pack size, or the usual pack.
    let qty = null, qtySrc = "";
    if (ing) {
      if (l.weight && ing.unit === "g") { qty = l.weight; qtySrc = "weighed"; }
      else if (l.pack && (l.pack.unit === ing.unit || (l.pack.unit !== "pc" && ing.unit !== "pc"))) { qty = l.pack.unit === ing.unit ? l.pack.qty : l.pack.unit === "g" ? l.pack.qty / (ing.d || 1) : l.pack.qty * (ing.d || 1); qtySrc = "label"; }
      else if (l.pack && l.pack.unit === "pc" && ing.unit === "pc") { qty = l.pack.qty; qtySrc = "label"; }
      else if (learned && learned.pack) { qty = learned.pack; qtySrc = "learned"; }
      else if (ing.unit === "pc") { qty = 1; qtySrc = "assumed"; }
      else if (ing.packs && ing.packs.length) { qty = ing.packs[0]; qtySrc = "assumed"; }
      if (qty) qty = qty * (l.count || 1);
    }
    const auto = !!ing && (how === "learned" || score >= 0.78);
    return { text: l.text, key, price: l.price, count: l.count || 1, id, score: r2(score), how, qty, qtySrc, use: auto };
  });
}

/* =========================================================================================
   Household data — one document per household, changed only through these operations
   ========================================================================================= */
export function freshDoc() {
  return {
    v: 1, settings: { currency: "GBP", weekStart: 1, meals: ["breakfast", "lunch", "dinner"], diet: "any", sides: true, alts: 2, leftovers: false },
    diners: [], recipes: [], favRecipes: {}, ingredients: [], menus: [], favorites: [], list: { items: [] },
    prices: {}, aliases: {}, receipts: [], updatedAt: null,
  };
}
export function normalizeDoc(d) {
  const f = freshDoc();
  const doc = Object.assign(f, d || {});
  doc.settings = Object.assign(freshDoc().settings, doc.settings || {});
  for (const k of ["diners", "recipes", "ingredients", "menus", "favorites", "receipts"]) if (!Array.isArray(doc[k])) doc[k] = [];
  for (const k of ["favRecipes", "prices", "aliases"]) if (!doc[k] || typeof doc[k] !== "object" || Array.isArray(doc[k])) doc[k] = {};
  if (!doc.list || !Array.isArray(doc.list.items)) doc.list = { items: [] };
  return doc;
}

const str = (v, n = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
const num = (v, lo = 0, hi = 1e6, dflt = 0) => { const n = Number(v); return isFinite(n) ? clamp(n, lo, hi) : dflt; };
const okId = (v) => /^[a-z0-9:_-]{1,80}$/i.test(String(v || ""));
// The app suggests ids for new things so it can show them straight away; the server keeps them if they're free.
function newId(prefix, want, taken) {
  const c = String(want || "");
  return c.startsWith(prefix) && /^[a-z0-9:_-]{4,60}$/i.test(c) && !taken(c) ? c : prefix + uid();
}
function fail(msg) { const e = new Error(msg); e.user = true; throw e; }
const isAdmin = (user) => user && user.role === "admin";
const mine = (obj, user) => obj && user && lc(obj.createdBy) === lc(user.username);

function cleanRecipe(r, user, existing) {
  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : []).slice(0, 80).map((x) => ({
    id: x.id && okId(x.id) ? String(x.id) : null, q: x.q == null ? null : num(x.q, 0, 1e5), u: str(x.u, 12) || null,
    amount: num(x.amount, 0, 1e7), name: str(x.name, 80), note: str(x.note, 120), text: str(x.text, 200), opt: !!x.opt,
  })).filter((x) => x.id || x.name);
  const steps = (Array.isArray(r.steps) ? r.steps : []).map((s) => str(s, 1500)).filter(Boolean).slice(0, 60);
  const name = str(r.name, 100);
  if (!name) fail("Give the recipe a name.");
  if (!ingredients.length) fail("Add at least one ingredient.");
  const prep = num(r.prep, 0, 2880), cook = num(r.cook, 0, 2880);
  return {
    id: existing ? existing.id : okId(r.id) && String(r.id).startsWith("h:") ? String(r.id) : "h:" + uid(),
    name, cuisine: str(r.cuisine, 40) || "Other", meals: (Array.isArray(r.meals) ? r.meals : []).filter((m) => [...MEALS, "side"].includes(m)).slice(0, 5),
    servings: num(r.servings, 1, 100, 4), prep, cook, total: prep + cook, timesEstimated: !!r.timesEstimated,
    diet: ["vegan", "veg", "egg", "nonveg"].includes(r.diet) ? r.diet : "nonveg", spice: num(r.spice, 0, 3, 1),
    tags: (Array.isArray(r.tags) ? r.tags : []).map((t) => str(t, 30)).filter(Boolean).slice(0, 12), with: SIDE_RECIPES[r.with] ? r.with : "",
    ingredients, steps, image: /^https:\/\/[^\s"'<>]{5,500}$/.test(String(r.image || "")) ? String(r.image) : "",
    source: r.source && typeof r.source === "object" ? { type: str(r.source.type, 20), url: /^https?:\/\//.test(String(r.source.url || "")) ? str(r.source.url, 500) : "", site: str(r.source.site, 80), author: str(r.source.author, 80) } : null,
    createdBy: existing ? existing.createdBy : user.username, createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}
function cleanSlots(slots, days) {
  return (Array.isArray(slots) ? slots : []).slice(0, 14 * 5).map((s) => ({
    d: num(s.d, 0, Math.max(0, days - 1)), m: MEALS.includes(s.m) ? s.m : "dinner",
    dishes: (Array.isArray(s.dishes) ? s.dishes : []).slice(0, 6).filter((x) => okId(x.r)).map((x) => ({ r: String(x.r), s: num(x.s, 0.5, 200, 2), side: !!x.side })),
    alts: (Array.isArray(s.alts) ? s.alts : []).filter(okId).slice(0, 3).map(String),
    leftover: s.leftover && typeof s.leftover === "object" ? { d: num(s.leftover.d, 0, 13), m: MEALS.includes(s.leftover.m) ? s.leftover.m : "dinner" } : undefined,
    note: str(s.note, 200) || undefined,
  }));
}
function cleanMenuFields(m) {
  const days = num(m.days, 1, 14, 7);
  return {
    name: str(m.name, 80) || "Weekly menu", start: /^\d{4}-\d{2}-\d{2}$/.test(String(m.start)) ? m.start : isoDate(), days,
    meals: (Array.isArray(m.meals) ? m.meals : []).filter((x) => MEALS.includes(x)), people: num(m.people, 0.5, 100, 2),
    req: m.req && typeof m.req === "object" ? JSON.parse(JSON.stringify(m.req, (k, v) => (typeof v === "string" ? v.slice(0, 200) : v)).slice(0, 4000)) : {},
    slots: cleanSlots(m.slots, days),
  };
}
function findMenu(doc, id) { const m = doc.menus.find((x) => x.id === id); if (!m) fail("That menu no longer exists."); return m; }

// Apply one change. `user` is { username, displayName, role }. Throws user-facing errors.
export function applyOp(doc, op, user) {
  if (!op || typeof op !== "object") fail("Invalid change.");
  const now = new Date().toISOString();
  const by = user.username;
  switch (op.type) {
    case "setSettings": {
      if (!isAdmin(user)) fail("Only a household admin can change household settings.");
      const s = op.settings || {};
      if (s.currency && ["GBP", "INR", "USD", "EUR"].includes(s.currency)) doc.settings.currency = s.currency;
      if (s.weekStart != null) doc.settings.weekStart = num(s.weekStart, 0, 6, 1);
      if (Array.isArray(s.meals)) doc.settings.meals = s.meals.filter((x) => MEALS.includes(x));
      if (s.diet && ["any", "egg", "veg", "vegan"].includes(s.diet)) doc.settings.diet = s.diet;
      if (s.sides != null) doc.settings.sides = !!s.sides;
      if (s.leftovers != null) doc.settings.leftovers = !!s.leftovers;
      if (s.alts != null) doc.settings.alts = num(s.alts, 0, 3, 2);
      return;
    }
    // ----- people you cook for
    case "saveDiner": {
      const d = op.diner || {};
      const ex = d.id && doc.diners.find((x) => x.id === d.id);
      if (ex && !isAdmin(user) && !mine(ex, user) && lc(ex.username) !== lc(by)) fail("Only a household admin, or whoever added this person, can change them.");
      if (!ex && doc.diners.length >= 30) fail("That's the most people a household can have.");
      const clean = {
        id: ex ? ex.id : newId("p", op.newId, (x) => doc.diners.some((y) => y.id === x)), name: str(d.name, 40) || fail("Enter a name."), age: d.age === "" || d.age == null ? null : num(d.age, 0, 120),
        portion: num(d.portion, 0.25, 3, 1), diet: ["any", "egg", "veg", "vegan"].includes(d.diet) ? d.diet : "any",
        goals: (Array.isArray(d.goals) ? d.goals : []).filter((g) => GOALS[g]), avoid: (Array.isArray(d.avoid) ? d.avoid : []).filter(okId).slice(0, 40),
        username: str(d.username, 40) || (ex ? ex.username : ""), createdBy: ex ? ex.createdBy : by,
      };
      if (ex) Object.assign(ex, clean); else doc.diners.push(clean);
      return clean.id;
    }
    case "removeDiner": {
      const ex = doc.diners.find((x) => x.id === op.id);
      if (!ex) return;
      if (!isAdmin(user) && !mine(ex, user)) fail("Only a household admin, or whoever added this person, can remove them.");
      doc.diners = doc.diners.filter((x) => x !== ex);
      return;
    }
    // ----- recipes
    case "saveRecipe": {
      const r = op.recipe || {};
      const ex = r.id && doc.recipes.find((x) => x.id === r.id);
      if (ex && !isAdmin(user) && !mine(ex, user)) fail("Only whoever added this recipe, or a household admin, can change it.");
      if (!ex && doc.recipes.length >= 1500) fail("Your household recipe book is full. Delete a few you don't use.");
      const clean = cleanRecipe(r, user, ex);
      if (ex) Object.assign(ex, clean); else doc.recipes.push(clean);
      return clean.id;
    }
    case "deleteRecipe": {
      const ex = doc.recipes.find((x) => x.id === op.id);
      if (!ex) return;
      if (!isAdmin(user) && !mine(ex, user)) fail("Only whoever added this recipe, or a household admin, can delete it.");
      doc.recipes = doc.recipes.filter((x) => x !== ex);
      return;
    }
    case "favRecipe": {
      if (!okId(op.id)) fail("Unknown recipe.");
      const list = (doc.favRecipes[by] = (doc.favRecipes[by] || []).filter(okId));
      const i = list.indexOf(op.id);
      if (op.on === false || (op.on == null && i >= 0)) { if (i >= 0) list.splice(i, 1); } else if (i < 0) list.push(op.id);
      if (list.length > 500) list.splice(0, list.length - 500);
      return;
    }
    case "addIngredient": {
      const name = str(op.name, 60);
      if (!name) fail("Enter the ingredient's name.");
      const ex = doc.ingredients.find((x) => lc(x.name) === lc(name));
      if (ex) return ex.id;
      if (doc.ingredients.length >= 500) fail("Too many custom ingredients.");
      const id = newId("c_", op.newId, (x) => doc.ingredients.some((y) => y.id === x) || /[^a-z0-9_]/.test(x.slice(2)) ? true : false);
      doc.ingredients.push({ id, name, aisle: str(op.aisle, 20) || "other", unit: ["g", "ml", "pc"].includes(op.unit) ? op.unit : "g", pc: op.pc ? num(op.pc, 1, 5000) : undefined, createdBy: by });
      return id;
    }
    // ----- menus
    case "createMenu": {
      if (doc.menus.length >= 300) doc.menus = doc.menus.filter((m) => m.status !== "draft" || m.createdBy !== by).slice(-250);
      const m = Object.assign(cleanMenuFields(op.menu || {}), { id: newId("m", op.newId, (x) => doc.menus.some((y) => y.id === x)), status: "draft", createdBy: by, createdAt: now, updatedAt: now, votes: {}, suggestions: [], comments: [] });
      doc.menus.push(m);
      return m.id;
    }
    case "updateMenu": {
      const m = findMenu(doc, op.id);
      if (!mine(m, user)) fail("Only the person who made this menu can change it. Suggest a change instead.");
      const f = cleanMenuFields(Object.assign({}, m, op.menu || {}));
      Object.assign(m, f, { updatedAt: now });
      if (m.status === "final" && op.menu && op.menu.slots) m.status = "review";
      return;
    }
    case "setMenuStatus": {
      const m = findMenu(doc, op.id);
      if (!mine(m, user)) fail("Only the person who made this menu can do that.");
      if (!["draft", "review", "final"].includes(op.status)) fail("Unknown status.");
      if (op.status === "review" && m.status === "draft") m.sharedAt = now;
      if (op.status === "final") m.finalAt = now;
      m.status = op.status; m.updatedAt = now;
      return;
    }
    case "deleteMenu": {
      const m = doc.menus.find((x) => x.id === op.id);
      if (!m) return;
      if (!mine(m, user) && !isAdmin(user)) fail("Only the person who made this menu, or a household admin, can delete it.");
      doc.menus = doc.menus.filter((x) => x !== m);
      return;
    }
    case "voteMenu": {
      const m = findMenu(doc, op.id);
      if (m.status === "draft" && !mine(m, user)) fail("This menu hasn't been shared yet.");
      if (!["agree", "change"].includes(op.vote)) fail("Choose agree or suggest changes.");
      m.votes[by] = { v: op.vote, at: now, name: user.displayName || by, note: str(op.note, 500) };
      return;
    }
    case "suggest": {
      const m = findMenu(doc, op.id);
      if (m.status === "draft" && !mine(m, user)) fail("This menu hasn't been shared yet.");
      if (m.suggestions.length >= 200) fail("This menu has too many suggestions already.");
      const s = { id: newId("s", op.newId, (x) => m.suggestions.some((y) => y.id === x)), by, name: user.displayName || by, at: now, d: num(op.d, 0, 13), m: MEALS.includes(op.m) ? op.m : "dinner",
        r: op.r && okId(op.r) ? String(op.r) : null, text: str(op.text, 500), status: "open" };
      if (!s.r && !s.text) fail("Pick a dish or write what you'd like instead.");
      m.suggestions.push(s);
      if (m.votes[by] && m.votes[by].v === "agree") m.votes[by] = { v: "change", at: now, name: user.displayName || by, note: m.votes[by].note || "" };
      return s.id;
    }
    case "resolveSuggestion": {
      const m = findMenu(doc, op.id);
      if (!mine(m, user)) fail("Only the person who made this menu decides on suggestions.");
      const s = m.suggestions.find((x) => x.id === op.sid);
      if (!s) fail("That suggestion no longer exists.");
      s.status = op.accept ? "accepted" : "declined"; s.reply = str(op.reply, 300); s.resolvedAt = now;
      if (op.accept && s.r) {
        let slot = m.slots.find((x) => x.d === s.d && x.m === s.m);
        if (!slot) { slot = { d: s.d, m: s.m, dishes: [], alts: [] }; m.slots.push(slot); }
        const srv = slot.dishes[0] ? slot.dishes[0].s : m.people;
        const old = slot.dishes[0] && slot.dishes[0].r;
        const sides = (Array.isArray(op.sides) ? op.sides : []).filter(okId).slice(0, 3).map((r) => ({ r: String(r), s: srv, side: true }));
        slot.dishes = [{ r: s.r, s: srv }, ...sides];
        if (old && old !== s.r) slot.alts = [old, ...slot.alts.filter((x) => x !== s.r && x !== old)].slice(0, 3);
        delete slot.leftover;
        m.updatedAt = now;
      }
      return;
    }
    case "commentMenu": {
      const m = findMenu(doc, op.id);
      const text = str(op.text, 800);
      if (!text) fail("Write a comment first.");
      if (m.comments.length >= 300) m.comments.shift();
      m.comments.push({ id: "c" + uid(), by, name: user.displayName || by, at: now, text });
      return;
    }
    // ----- favourite menus (a whole week or a single day)
    case "saveFavorite": {
      const name = str(op.name, 80);
      if (!name) fail("Give it a name.");
      if (doc.favorites.length >= 300) fail("You have a lot of saved menus — delete some first.");
      const kind = op.kind === "day" ? "day" : "week";
      const days = kind === "day" ? 1 : num(op.days, 1, 14, 7);
      const f = { id: newId("f", op.newId, (x) => doc.favorites.some((y) => y.id === x)), name, kind, days, meals: (op.meals || []).filter((x) => MEALS.includes(x)), people: num(op.people, 0.5, 100, 2),
        slots: cleanSlots(op.slots, days), createdBy: by, at: now, fromMenu: okId(op.fromMenu) ? op.fromMenu : null };
      doc.favorites.push(f);
      return f.id;
    }
    case "renameFavorite": {
      const f = doc.favorites.find((x) => x.id === op.id);
      if (!f) fail("That saved menu no longer exists.");
      if (!mine(f, user) && !isAdmin(user)) fail("Only whoever saved it can rename it.");
      f.name = str(op.name, 80) || f.name;
      return;
    }
    case "deleteFavorite": {
      const f = doc.favorites.find((x) => x.id === op.id);
      if (!f) return;
      if (!mine(f, user) && !isAdmin(user)) fail("Only whoever saved it, or a household admin, can delete it.");
      doc.favorites = doc.favorites.filter((x) => x !== f);
      return;
    }
    // ----- the shopping list
    case "listAdd": {
      const items = (Array.isArray(op.items) ? op.items : []).slice(0, 300);
      for (const it of items) {
        const id = it.id && okId(it.id) ? String(it.id) : null, name = str(it.name, 80);
        if (!id && !name) continue;
        const amount = num(it.amount, 0, 1e7);
        const ex = doc.list.items.find((x) => !x.checked && (id ? x.ing === id : !x.ing && lc(x.name) === lc(name)));
        if (ex) {
          ex.amount = r2((ex.amount || 0) + amount);
          if (op.menuId && !ex.from.includes(op.menuId)) ex.from.push(op.menuId);
          if (it.note) ex.note = str(it.note, 120);
        } else {
          if (doc.list.items.length >= 500) fail("Your shopping list is very long — clear bought items first.");
          doc.list.items.push({ id: newId("i", it.newId, (x) => doc.list.items.some((y) => y.id === x)), ing: id, name: name || id, amount: r2(amount), unit: str(it.unit, 6), note: str(it.note, 120),
            checked: false, by, at: now, from: op.menuId && okId(op.menuId) ? [op.menuId] : [] });
        }
      }
      doc.list.updatedAt = now;
      return;
    }
    case "listUpdate": {
      const it = doc.list.items.find((x) => x.id === op.id);
      if (!it) return;
      if (op.checked != null) { it.checked = !!op.checked; it.checkedBy = it.checked ? by : null; it.checkedAt = it.checked ? now : null; }
      if (op.amount != null) it.amount = num(op.amount, 0, 1e7);
      if (op.note != null) it.note = str(op.note, 120);
      if (op.name != null && !it.ing) it.name = str(op.name, 80) || it.name;
      doc.list.updatedAt = now;
      return;
    }
    case "listRemove": doc.list.items = doc.list.items.filter((x) => x.id !== op.id); doc.list.updatedAt = now; return;
    case "listClear": {
      doc.list.items = op.all ? [] : doc.list.items.filter((x) => !x.checked);
      doc.list.updatedAt = now;
      return;
    }
    // ----- prices from shop bills
    case "applyReceipt": {
      const lines = (Array.isArray(op.lines) ? op.lines : []).slice(0, 200);
      const rid = newId("r", op.newId, (x) => doc.receipts.some((y) => y.id === x)), date = /^\d{4}-\d{2}-\d{2}$/.test(String(op.date)) ? op.date : now.slice(0, 10);
      const store = str(op.store, 40);
      const kept = [];
      for (const l of lines) {
        const id = l.id && okId(l.id) ? String(l.id) : null;
        const price = num(l.price, 0, 1e6), qty = num(l.qty, 0, 1e7);
        const key = str(l.key, 120);
        if (id && key && l.learn !== false) doc.aliases[key] = { ing: id, pack: qty && l.count ? r2(qty / (l.count || 1)) : qty || undefined };
        if (!id || !(price > 0) || !(qty > 0)) { kept.push({ text: str(l.text, 80), price, id: null }); continue; }
        const pb = price / qty;
        const hist = (doc.prices[id] = Array.isArray(doc.prices[id]) ? doc.prices[id] : []);
        hist.push({ pb: Math.round(pb * 1e6) / 1e6, price, qty, date, at: now, store, rid });
        hist.sort((a, b) => (a.date + a.at).localeCompare(b.date + b.at));
        if (hist.length > 12) hist.splice(0, hist.length - 12);
        kept.push({ text: str(l.text, 80), price, id, qty });
      }
      doc.receipts.unshift({ id: rid, at: now, date, store, total: op.total == null ? null : num(op.total, 0, 1e7), by, lines: kept });
      if (doc.receipts.length > 100) doc.receipts.length = 100;
      if (Object.keys(doc.aliases).length > 3000) for (const k of Object.keys(doc.aliases).slice(0, 500)) delete doc.aliases[k];
      return rid;
    }
    case "deleteReceipt": {
      const r = doc.receipts.find((x) => x.id === op.id);
      if (!r) return;
      if (!isAdmin(user) && lc(r.by) !== lc(by)) fail("Only whoever scanned this bill, or a household admin, can delete it.");
      for (const id of Object.keys(doc.prices)) { doc.prices[id] = doc.prices[id].filter((p) => p.rid !== r.id); if (!doc.prices[id].length) delete doc.prices[id]; }
      doc.receipts = doc.receipts.filter((x) => x !== r);
      return;
    }
    case "setPrice": {                                                                    // fix one price by hand
      const id = okId(op.id) ? op.id : fail("Unknown ingredient.");
      const price = num(op.price, 0, 1e6), qty = num(op.qty, 0, 1e7);
      if (!(price > 0) || !(qty > 0)) fail("Enter a price and an amount.");
      const hist = (doc.prices[id] = Array.isArray(doc.prices[id]) ? doc.prices[id] : []);
      hist.push({ pb: Math.round((price / qty) * 1e6) / 1e6, price, qty, date: now.slice(0, 10), at: now, store: str(op.store, 40) || "Entered by hand", rid: null });
      if (hist.length > 12) hist.splice(0, hist.length - 12);
      return;
    }
    case "clearPrices": { if (!okId(op.id)) fail("Unknown ingredient."); delete doc.prices[op.id]; return; }
    case "forgetAlias": { delete doc.aliases[str(op.key, 120)]; return; }
    default: fail("Unknown change: " + str(op.type, 30));
  }
}
