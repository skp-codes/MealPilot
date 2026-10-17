#!/usr/bin/env node
// Builds MealPilot's recipe library from the downloaded datasets.
//
//   node tools/library/build.mjs <folder with the downloads> <output folder> [--target 50000] [--limit N]
//
// Output:
//   library/  — the default library everyone gets (complete recipes only, spread across cuisines by quota)
//               index.json (compact, loaded by the app) + rec-<n>.json shards (full recipes, loaded when opened)
//   archive/  — everything else, de-duplicated, for "Search all recipes"
//               rec-<n>.json shards + post-<n>.json title search index
//   meta.json — counts and version
// Then upload with tools/library/upload.mjs.
import fs from "node:fs";
import path from "node:path";
import * as C from "../../public/core.js";
import { INGREDIENTS, AISLE_ORDER } from "../../public/data/ingredients.js";
import { detect, READERS, ndjson, writer, foodcomId, listSources } from "./readers.mjs";
import { cuisineOf, mealsOf, typesFromText, dietOfText, spiceOf, sideOf, linesWithUnits, normTitle, dedupeKey, hash52, titleTokens } from "./classify.mjs";

/* ---------- settings ---------- */
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const IN = args[0], OUT = args[1];
if (!IN || !OUT) { console.error("Usage: node tools/library/build.mjs <downloads folder> <output folder> [--target 50000] [--limit N]"); process.exit(1); }
const TARGET = Number(flag("--target", 50000));
const LIMIT = Number(flag("--limit", 0)) || Infinity;          // per source, for trial runs
const LIB_SHARD = 250, ARC_SHARD = 250, POST_SHARDS = Number(flag("--post-shards", 4096)), POST_CAP = 20000, BUCKET = 25000;
// How the default library is shared out. Cuisines that don't have enough good recipes pass their share on.
const QUOTA = {
  "South Indian": 4000, "North Indian": 4500, "West Indian": 1500, "East Indian": 600, "Indo-Chinese": 700, "Pakistani": 400, "Sri Lankan": 200,
  Italian: 4500, British: 3000, American: 8400, Mexican: 3000, Chinese: 2500, Thai: 1500, Japanese: 1200, Korean: 700, Vietnamese: 600,
  "Southeast Asian": 600, "Middle Eastern": 2000, Mediterranean: 2500, French: 2000, Spanish: 1000, German: 800, "Eastern European": 800,
  Scandinavian: 300, African: 900, Caribbean: 700, "Latin American": 1100,
};
const MEAL_CAP = { dessert: 0.12, snack: 0.15, side: 0.12 };      // most of each cuisine's share goes to proper meals
const SITE = { fc: "Food.com", fr: "Food.com", ak: "Archana's Kitchen", nl: "", rm: "" };
const DATASET = { fc: "Food.com Recipes and Reviews (Kaggle)", fr: "Food.com Recipes and Interactions", ak: "6000+ Indian Food Recipes (Mendeley)", nl: "RecipeNLG", rm: "Recipe1M+ (MIT)" };

const cat = C.buildCatalog(INGREDIENTS, [], { aisleOrder: AISLE_ORDER });
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(5)}s]`, ...a);
for (const d of ["tmp", "library", "archive"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const tmp = (f) => path.join(OUT, "tmp", f);

/* ---------- 1. find and read the datasets ---------- */
const found = {};
for (const src of listSources(IN)) { const kind = await detect(src).catch(() => null); if (kind && !found[kind]) found[kind] = src; }
log("Found:\n  " + (Object.entries(found).map(([k, f]) => `${k.padEnd(12)} ${f.name}`).join("\n  ") || "nothing"));
if (!Object.keys(found).length) { console.error("No recognised dataset files. See tools/library/README.md."); process.exit(1); }

const counts = {}, fcIds = new Set(), altLines = new Map(), if101 = new Map();
for (const kind of ["foodcom", "archana", "if101", "foodcom_raw", "recipenlg", "recipe1m"]) {
  if (!found[kind]) continue;
  const w = kind === "if101" ? null : writer(tmp(kind + ".ndjson"));
  let n = 0, kept = 0;
  for await (const r of READERS[kind](found[kind])) {
    if (n++ >= LIMIT) break;
    if (n % 200000 === 0) log(`  ${kind}: ${n.toLocaleString()} read`);
    if (kind === "if101") { if101.set(normTitle(r.title), r); continue; }
    if (!r.title || !r.lines || r.lines.length < 2) continue;
    if (kind === "foodcom") fcIds.add(r.sid);
    if ((kind === "recipenlg" || kind === "recipe1m") && fcIds.size) {         // full-text copy of a Food.com recipe: keeps its units
      const id = foodcomId(r.url);
      if (id && fcIds.has(id) && !altLines.has(id)) altLines.set(id, r.lines.join("\u0001"));
    }
    w.write(r); kept++;
  }
  if (w) await w.close();
  counts[kind] = { read: n, kept: kind === "if101" ? n : kept };
  log(`Read ${kind}: ${n.toLocaleString()} records`);
}

/* ---------- 2. the default library: complete recipes only ---------- */
const candW = writer(tmp("cands.ndjson"));
const cands = [];                                                           // small summaries, full records stay on disk
let rejected = { incomplete: 0, unmatched: 0, meals: 0, other: 0 };
for (const kind of ["foodcom", "archana"]) {
  if (!fs.existsSync(tmp(kind + ".ndjson"))) continue;
  let n = 0;
  for await (const r of ndjson(tmp(kind + ".ndjson"))) {
    if (++n % 100000 === 0) log(`  checking ${kind}: ${n.toLocaleString()}`);
    const c = candidate(r);
    if (!c) continue;
    cands.push({ i: cands.length, score: c.score, cuisine: c.cuisine, meal: c.mealCat, hash: c.hash, title: c.tnorm });
    candW.write(c.rec);
  }
}
await candW.close();
log(`Complete recipes available for the library: ${cands.length.toLocaleString()} (rejected: ${JSON.stringify(rejected)})`);

function candidate(r) {
  const steps = (r.steps || []).map((s) => String(s).trim()).filter((s) => s.length > 3).slice(0, 60);
  let prep = r.prep, cook = r.cook;
  if (prep == null && cook == null && r.total) { prep = Math.min(20, Math.round(r.total / 3)); cook = r.total - prep; }
  if (prep == null && cook != null) prep = 0;
  if (cook == null && prep != null) cook = 0;
  const servings = r.servings && r.servings >= 1 && r.servings <= 24 ? Math.round(r.servings) : null;
  if (prep == null || cook == null || prep + cook <= 0 || prep + cook > 600 || !servings || steps.length < 2 || r.lines.length < 3 || r.lines.length > 35) { rejected.incomplete++; return null; }
  let lines, guessed = 0;
  if (r.src === "fc") { const alt = altLines.get(r.sid); ({ lines, guessed } = linesWithUnits(r, alt ? alt.split("\u0001") : null, cat)); }
  else lines = r.lines.map((l) => Object.assign(C.parseIngredientLine(l, cat) || { name: l, id: null }, { text: l }));
  const real = lines.filter((x) => !(x.id && cat.byId.get(x.id)?.free));
  const ok = real.filter((x) => x.id && x.amount > 0);
  if (!real.length || ok.length / real.length < 0.85) { rejected.unmatched++; return null; }
  const meals = mealsOf(r);
  if (!meals) { rejected.meals++; return null; }
  const cuisine = cuisineOf(r, if101);
  if (!cuisine) { rejected.other++; return null; }
  const textTypes = typesFromText(r.lines);
  const recipe = { ingredients: lines, ft: textTypes };
  const ft = [...new Set([...textTypes, ...C.foodTypes(Object.assign({}, recipe, { ft: [] }))].filter((t) => t !== "veg"))];
  const dietCat = C.dietOf(recipe, cat), dietTxt = dietOfText(ft, r.diet);
  const rank = { vegan: 0, veg: 1, egg: 2, nonveg: 3 };
  let diet = [dietCat, dietTxt].filter(Boolean).sort((a, b) => rank[b] - rank[a])[0] || "veg";
  if (/vegan/i.test(r.diet || "") && diet !== "nonveg" && dietCat === "vegan") diet = "vegan";
  // Quality: ratings (Food.com), completeness, and a nudge for Indian recipes (Archana's has no ratings).
  let score;
  if (r.src === "fc") { const n = r.reviews || 0, avg = r.rating || 0; score = (avg * n + 4.1 * 5) / (n + 5) + 0.12 * Math.log10(1 + n); }
  else score = 4.35;
  score += (ok.length / real.length - 0.85) * 1.5 - (guessed / Math.max(1, lines.length)) * 0.6 + (r.image ? 0.05 : 0) + (steps.length >= 3 ? 0.05 : 0);
  const mealCat = meals.includes("dessert") ? "dessert" : meals.length === 1 && meals[0] === "snack" ? "snack" : meals.length === 1 && meals[0] === "side" ? "side" : "main";
  const nu = r.nu && r.nu[0] && servings ? r.nu.map((v) => (v == null ? null : Math.round(v * 10) / 10)) : null;
  const id = `l:${r.src}${r.sid}`;
  const title = String(r.title).replace(/\s+/g, " ").trim().slice(0, 100);
  return {
    score, cuisine, mealCat, hash: hash52(dedupeKey(r)), tnorm: normTitle(title),
    rec: { id, name: title, cuisine, meals, servings, prep, cook, diet, ft, spice: spiceOf(ok, servings), with: sideOf(r, cuisine, meals), nu,
      lines: lines.map((x) => ({ q: x.q ?? null, u: x.u || null, name: x.id ? "" : x.name || x.text, note: x.note || "", id: x.id || null, amount: x.amount || 0, text: x.text || x.name, opt: !!x.opt })),
      steps, image: r.image || "", desc: String(r.desc || "").slice(0, 300), src: r.src, url: r.url || "", author: r.author || "", rating: r.rating || null, reviews: r.reviews || 0 },
  };
}

// Choose the library: best recipes per cuisine up to its quota, keeping a balance of meals and no duplicates.
const byCuisine = new Map();
for (const c of cands) { if (!byCuisine.has(c.cuisine)) byCuisine.set(c.cuisine, []); byCuisine.get(c.cuisine).push(c); }
for (const list of byCuisine.values()) list.sort((a, b) => b.score - a.score);
const quota = Object.assign({}, QUOTA);
for (const c of byCuisine.keys()) if (!(c in quota)) quota[c] = 0;
const scale = TARGET / Object.values(QUOTA).reduce((a, b) => a + b, 0);
for (const k in quota) quota[k] = Math.round(quota[k] * scale);
const chosen = new Set(), usedHash = new Set(), titleCount = new Map();
function take(cuisine, want) {
  const list = byCuisine.get(cuisine) || [], mealN = { dessert: 0, snack: 0, side: 0, main: 0 };
  let got = 0;
  for (const c of list) { if (chosen.has(c.i)) { got++; mealN[c.meal]++; } }
  for (const c of list) {
    if (got >= want) break;
    if (chosen.has(c.i) || usedHash.has(c.hash)) continue;
    if (MEAL_CAP[c.meal] && mealN[c.meal] >= Math.ceil(want * MEAL_CAP[c.meal])) continue;
    const tc = titleCount.get(c.title) || 0;
    if (tc >= 2) continue;
    chosen.add(c.i); usedHash.add(c.hash); titleCount.set(c.title, tc + 1); mealN[c.meal]++; got++;
  }
  return got;
}
let spare = 0;
const short = {};
for (const [c, q] of Object.entries(quota)) { const got = take(c, q); if (got < q) { spare += q - got; short[c] = got; } }
// Share out what short cuisines couldn't fill, in proportion to the others' quotas, until the target is met.
for (let round = 0; round < 6 && chosen.size < TARGET; round++) {
  const open = Object.keys(quota).filter((c) => !(c in short) && quota[c] > 0);
  const tot = open.reduce((a, c) => a + quota[c], 0) || 1, need = TARGET - chosen.size;
  for (const c of open) { const want = (byCuisine.get(c) || []).filter((x) => chosen.has(x.i)).length + Math.ceil((need * quota[c]) / tot); const before = chosen.size; take(c, want); if (chosen.size - before < Math.ceil((need * quota[c]) / tot)) short[c] = 1; }
}
log(`Library: ${chosen.size.toLocaleString()} recipes chosen`);

// Write the library: compact index + full-recipe shards.
const ingIds = [], ingIdx = new Map();
const ii = (id) => { if (!ingIdx.has(id)) { ingIdx.set(id, ingIds.length); ingIds.push(id); } return ingIdx.get(id); };
const cuisineList = [], cuIdx = new Map();
const cu = (c) => { if (!cuIdx.has(c)) { cuIdx.set(c, cuisineList.length); cuisineList.push(c); } return cuIdx.get(c); };
const MEAL_BITS = { breakfast: 1, lunch: 2, dinner: 4, snack: 8, side: 16, dessert: 32 };
const DIET_CODE = { vegan: 0, veg: 1, egg: 2, nonveg: 3 }, WITH_CODE = { "": 0, rice: 1, roti: 2 };
const FT = C.FOOD_TYPES.map((t) => t.k);
const rows = [], libStats = {};
let shard = [], shardNo = 0, pos = 0, sel = [];
const flushLib = () => { if (!shard.length) return; fs.writeFileSync(path.join(OUT, "library", `rec-${shardNo}.json`), JSON.stringify(Object.fromEntries(shard))); shard = []; shardNo++; };
{
  let i = 0;
  for await (const rec of ndjson(tmp("cands.ndjson"))) { if (chosen.has(i)) sel.push(rec); i++; }
  // Order by cuisine then quality so the shards a phone opens are related.
  const scoreOf = new Map(cands.map((c) => [c.i, c.score]));
  sel.sort((a, b) => a.cuisine.localeCompare(b.cuisine) || (b.rating || 0) - (a.rating || 0));
  for (const r of sel) {
    const ings = [];
    for (const x of r.lines) if (x.id && x.amount > 0) ings.push(ii(x.id), Math.round(x.amount * 10) / 10, x.opt ? 1 : 0);
    let ft = 0; for (const t of r.ft) { const k = FT.indexOf(t); if (k >= 0) ft |= 1 << k; }
    rows.push([r.id, r.name, cu(r.cuisine), r.meals.reduce((a, m) => a | (MEAL_BITS[m] || 0), 0), r.servings, r.prep, r.cook, DIET_CODE[r.diet], r.spice, ft, WITH_CODE[r.with] || 0, r.nu || 0, ings, r.rating ? Math.round(r.rating * 10) / 10 : 0]);
    shard.push([r.id, { lines: r.lines, steps: r.steps, image: r.image, desc: r.desc, source: { type: "dataset", site: SITE[r.src] || "", dataset: DATASET[r.src], url: r.url, author: r.author }, rating: r.rating, reviews: r.reviews }]);
    if (shard.length >= LIB_SHARD) flushLib();
    libStats[r.cuisine] = (libStats[r.cuisine] || 0) + 1;
    pos++;
  }
  flushLib();
}
// The index is split into parts (each well under the 6 MB a Netlify function can return).
const INDEX_PART = 8000, parts = Math.ceil(rows.length / INDEX_PART) || 1;
for (let k = 0; k < parts; k++) fs.writeFileSync(path.join(OUT, "library", `index-${k}.json`), JSON.stringify({ from: k * INDEX_PART, rows: rows.slice(k * INDEX_PART, (k + 1) * INDEX_PART) }));
fs.writeFileSync(path.join(OUT, "library", "head.json"), JSON.stringify({ v: 1, shard: LIB_SHARD, parts, count: rows.length, ings: ingIds, cu: cuisineList, ft: FT }));
const libKeys = new Set(sel.map((r) => r.id));
log("Library by cuisine:", JSON.stringify(libStats));

/* ---------- 3. the archive: everything else, de-duplicated ---------- */
const sources = ["foodcom", "archana", "foodcom_raw", "recipenlg", "recipe1m"].filter((k) => fs.existsSync(tmp(k + ".ndjson")));
const best = new Map();                     // dedupe hash → record number of the best copy
let scores = new Float32Array(1 << 20), recNo = 0;
const qualityOf = (r) => r.src === "fc" ? 3 + (r.rating || 0) / 5 + 0.1 * Math.log10(1 + (r.reviews || 0)) : r.src === "ak" ? 3.5 : r.src === "fr" ? 2.5 : 1 + (r.url ? 0.3 : 0) + Math.min(0.3, (r.steps || []).length / 30);
const skipArchive = (r) => libKeys.has(`l:${r.src}${r.sid}`) || ((r.src === "fr" || r.src === "nl" || r.src === "rm") && fcIds.has(foodcomId(r.url) || "-"));
for (const k of sources) {
  for await (const r of ndjson(tmp(k + ".ndjson"))) {
    const n = recNo++;
    if (n >= scores.length) { const s2 = new Float32Array(scores.length * 2); s2.set(scores); scores = s2; }
    if (skipArchive(r)) { scores[n] = -1; continue; }
    const h = hash52(dedupeKey(r)); const q = qualityOf(r); scores[n] = q;
    const cur = best.get(h);
    if (cur === undefined || scores[cur] < q) best.set(h, n);
  }
  log(`  de-duplicating: ${recNo.toLocaleString()} records, ${best.size.toLocaleString()} unique so far`);
}
const winners = new Uint8Array(recNo);
for (const n of best.values()) winners[n] = 1;
best.clear();
// Rank winners by quality: archive ids go best-first so search results come out in a good order.
const winNos = []; for (let n = 0; n < recNo; n++) if (winners[n]) winNos.push(n);
winNos.sort((a, b) => scores[b] - scores[a]);
const rankOf = new Int32Array(recNo).fill(-1);
winNos.forEach((n, rank) => { rankOf[n] = rank; });
const ARC = winNos.length;
log(`Archive: ${ARC.toLocaleString()} unique recipes`);
// Write winners into rank buckets, then each bucket sorted into shards.
const nb = Math.ceil(ARC / BUCKET), bw = Array.from({ length: nb }, (_, b) => writer(tmp(`bucket-${b}.ndjson`)));
{
  let n = 0;
  for (const k of sources) for await (const r of ndjson(tmp(k + ".ndjson"))) {
    const rank = rankOf[n++];
    if (rank < 0) continue;
    const full = !r.linkOnly;
    bw[Math.floor(rank / BUCKET)].write({ k: rank, id: `a:${r.src}${r.sid}`, t: String(r.title).replace(/\s+/g, " ").trim().slice(0, 120), s: r.src, l: (r.lines || []).slice(0, 40).map((x) => String(x).slice(0, 200)),
      d: full ? (r.steps || []).slice(0, 60) : undefined, p: r.prep ?? undefined, c: r.cook ?? undefined, T: r.total ?? undefined, v: r.servings ?? undefined, u: r.url || undefined,
      cu: cuisineOf(r, if101) || undefined, lo: full ? undefined : 1, nq: r.noQty ? 1 : undefined, im: r.image || undefined });
  }
}
for (const w of bw) await w.close();
const post = new Map();
let arcShard = 0;
for (let b = 0; b < nb; b++) {
  const recs = []; for await (const r of ndjson(tmp(`bucket-${b}.ndjson`))) recs.push(r);
  recs.sort((x, y) => x.k - y.k);
  for (let i = 0; i < recs.length; i += ARC_SHARD) {
    const part = recs.slice(i, i + ARC_SHARD);
    fs.writeFileSync(path.join(OUT, "archive", `rec-${arcShard++}.json`), JSON.stringify(part.map((r) => { const o = Object.assign({}, r); delete o.k; return o; })));
  }
  for (const r of recs) for (const tok of titleTokens(r.t)) { let l = post.get(tok); if (!l) { l = []; post.set(tok, l); } if (l.length < POST_CAP) l.push(r.k); }
  fs.unlinkSync(tmp(`bucket-${b}.ndjson`));
  if (b % 10 === 9) log(`  archive shards: ${arcShard.toLocaleString()}`);
}
// Title search index: token → archive positions (delta-encoded), split into hashed shards.
const postShards = Array.from({ length: POST_SHARDS }, () => ({}));
for (const [tok, ids] of post) { const d = ids.map((v, i) => (i ? v - ids[i - 1] : v)); postShards[hash52(tok) % POST_SHARDS][tok] = d; }
postShards.forEach((o, i) => fs.writeFileSync(path.join(OUT, "archive", `post-${i}.json`), JSON.stringify(o)));
log(`Search index: ${post.size.toLocaleString()} words`);

/* ---------- 4. meta ---------- */
const version = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const meta = { version, created: new Date().toISOString(), counts,
  library: { count: rows.length, shards: shardNo, shardSize: LIB_SHARD, parts, byCuisine: libStats },
  archive: { count: ARC, shards: arcShard, shardSize: ARC_SHARD, postShards: POST_SHARDS, words: post.size },
  linkOnly: ["nl", "rm"], datasets: DATASET };
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
if (!args.includes("--keep-tmp")) fs.rmSync(path.join(OUT, "tmp"), { recursive: true, force: true });
log(`Done. Library ${rows.length.toLocaleString()} · archive ${ARC.toLocaleString()} · version ${version}`);
