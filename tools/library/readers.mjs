// Streaming readers for the recipe datasets. No packages needed — plain Node 18+.
// Each reader yields normalised records:
//   { src, sid, title, lines[], qtys?[], parts?[], steps[], prep, cook, total, servings, cuisine, course, keywords, diet,
//     rating, reviews, url, image, desc, nu?[kcal,protein,carbs,fat,fibre], ner?[] }
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

/* ---------- CSV (RFC 4180: quotes, commas and newlines inside fields) ---------- */
export async function* csvRows(file) {
  const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  let field = "", row = [], inQ = false, pendingQuote = false, first = true;
  for await (let chunk of stream) {
    if (first) { chunk = chunk.replace(/^﻿/, ""); first = false; }
    let start = 0;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (pendingQuote) {                                   // a quote inside a quoted field: "" is a literal quote, else the field ended
        pendingQuote = false;
        if (c === 34) { field += '"'; start = i + 1; continue; }
        inQ = false;
      }
      if (inQ) {
        if (c === 34) { field += chunk.slice(start, i); start = i + 1; pendingQuote = true; }
        continue;
      }
      if (c === 34) { field += chunk.slice(start, i); start = i + 1; inQ = true; }
      else if (c === 44) { field += chunk.slice(start, i); row.push(field); field = ""; start = i + 1; }
      else if (c === 10) {
        field += chunk.slice(start, i); if (field.endsWith("\r")) field = field.slice(0, -1);
        row.push(field); field = ""; start = i + 1;
        yield row; row = [];
      }
    }
    field += chunk.slice(start);
  }
  if (field || row.length) { row.push(field); yield row; }
}
export async function csvHeader(file) {
  for await (const row of csvRows(file)) return row.map((h) => h.trim());
  return [];
}
async function* csvObjects(file) {
  let header = null;
  for await (const row of csvRows(file)) {
    if (!header) { header = row.map((h) => h.trim()); continue; }
    if (row.length === 1 && !row[0]) continue;
    const o = {}; header.forEach((h, i) => { o[h] = row[i]; });
    yield o;
  }
}

/* ---------- JSON array streamed object by object (Recipe1M layer1.json is ~1.3 GB) ---------- */
export async function* jsonArrayObjects(file) {
  const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  let depth = 0, inStr = false, esc = false, buf = "", collecting = false;
  for await (const chunk of stream) {
    let start = collecting ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === "{") { if (depth === 1 && !collecting) { collecting = true; start = i; } depth++; }
      else if (c === "}") { depth--; if (depth === 1 && collecting) { buf += chunk.slice(start, i + 1); collecting = false; start = -1; try { yield JSON.parse(buf); } catch {} buf = ""; } }
      else if (c === "[" ) depth++;
      else if (c === "]") depth--;
    }
    if (collecting && start >= 0) buf += chunk.slice(start);
  }
}

/* ---------- small helpers ---------- */
const num = (v) => { const n = Number(String(v ?? "").trim()); return isFinite(n) && n > 0 ? n : null; };
// R-style vectors from the Food.com Kaggle CSV: c("a", "b") or "single"
export function rVector(v) {
  const s = String(v ?? "").trim();
  if (!s || s === "NA" || s === "character(0)") return [];
  if (!s.startsWith("c(")) return [s.replace(/^"|"$/g, "")];
  const out = []; let cur = null, esc = false;
  for (let i = 2; i < s.length; i++) {
    const ch = s[i];
    if (cur === null) { if (ch === '"') cur = ""; else if (s.startsWith("NA", i)) { out.push(""); i += 1; } continue; }
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { out.push(cur); cur = null; continue; }
    cur += ch;
  }
  return out;
}
// Python-style lists from the Food.com interactions CSV: ['a', "b's"]
export function pyList(v) {
  const s = String(v ?? "").trim();
  if (!s.startsWith("[")) return s ? [s] : [];
  const out = []; let q = null, cur = "", esc = false;
  for (let i = 1; i < s.length; i++) {
    const ch = s[i];
    if (!q) { if (ch === "'" || ch === '"') { q = ch; cur = ""; } continue; }
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === q) { out.push(cur); q = null; continue; }
    cur += ch;
  }
  return out;
}
function jsonList(v) { try { const a = JSON.parse(v); return Array.isArray(a) ? a.map(String) : []; } catch { return pyList(v); } }
export function isoMinutes(v) {
  const s = String(v || "").trim();
  if (!s || s === "NA") return null;
  const m = s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) { const n = parseInt(s, 10); return isFinite(n) ? n : null; }
  return Number(m[1] || 0) * 1440 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
}
function splitSteps(text) {
  return String(text || "").replace(/\r/g, "").split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map((t) => t.replace(/^\s*(step\s*)?\d+[.):]\s*/i, "").trim()).filter((t) => t.length > 2);
}
const foodcomId = (url) => { const m = String(url || "").match(/food\.com\/recipe\/[^\s?#]*?-(\d+)(?:[/?#]|$)/i) || String(url || "").match(/recipezaar\.com\/[^\s]*?(\d{3,})/i); return m ? m[1] : null; };
export { foodcomId };

/* ---------- detect which dataset a file is ---------- */
export async function detect(file) {
  const ext = path.extname(file).toLowerCase(), base = path.basename(file).toLowerCase();
  if (ext === ".json") {
    const fd = fs.openSync(file, "r"); const b = Buffer.alloc(4000); fs.readSync(fd, b, 0, 4000, 0); fs.closeSync(fd);
    const head = b.toString("utf8");
    if (/^\s*\[/.test(head) && /"ingredients"/.test(head) && /"instructions"/.test(head)) return "recipe1m";
    return null;
  }
  if (ext !== ".csv") return null;
  const h = new Set(await csvHeader(file));
  if (h.has("RecipeIngredientParts") && h.has("RecipeInstructions")) return "foodcom";
  if (h.has("minutes") && h.has("steps") && h.has("ingredients") && h.has("n_steps")) return "foodcom_raw";
  if (h.has("TranslatedRecipeName") || (h.has("RecipeName") && h.has("PrepTimeInMins"))) return "archana";
  if (h.has("flavor_profile") && h.has("region")) return "if101";
  if (h.has("title") && h.has("directions") && h.has("NER")) return "recipenlg";
  return null;
}

/* ---------- the readers ---------- */
export async function* readFoodcom(file) {                   // irkaal "Food.com Recipes and Reviews"
  for await (const o of csvObjects(file)) {
    const parts = rVector(o.RecipeIngredientParts), qtys = rVector(o.RecipeIngredientQuantities);
    yield {
      src: "fc", sid: String(o.RecipeId), title: o.Name, parts, qtys,
      lines: parts.map((p, i) => `${qtys[i] && qtys[i] !== "NA" ? qtys[i] + " " : ""}${p}`),
      steps: rVector(o.RecipeInstructions), prep: isoMinutes(o.PrepTime), cook: isoMinutes(o.CookTime), total: isoMinutes(o.TotalTime),
      servings: num(o.RecipeServings) || num(String(o.RecipeYield || "").match(/\d+/)?.[0]), course: o.RecipeCategory || "", keywords: rVector(o.Keywords).join(", "),
      rating: num(o.AggregatedRating), reviews: num(o.ReviewCount) || 0, url: `https://www.food.com/recipe/${o.RecipeId}`,
      image: rVector(o.Images).find((u) => /^https:/.test(u)) || "", desc: o.Description || "", author: o.AuthorName || "",
      nu: [num(o.Calories), num(o.ProteinContent), num(o.CarbohydrateContent), num(o.FatContent), num(o.FiberContent)],
    };
  }
}
export async function* readFoodcomRaw(file) {                // Majumder "Food.com Recipes and Interactions" (no quantities)
  for await (const o of csvObjects(file)) {
    yield { src: "fr", sid: String(o.id), title: o.name, lines: pyList(o.ingredients), steps: pyList(o.steps), total: num(o.minutes),
      keywords: pyList(o.tags).join(", "), desc: o.description || "", url: `https://www.food.com/recipe/${o.id}`, noQty: true };
  }
}
export async function* readArchana(file) {                   // 6000+ Indian Food Recipes (Archana's Kitchen)
  let n = 0;
  for await (const o of csvObjects(file)) {
    n++;
    const ingText = o.TranslatedIngredients || o.Ingredients || "";
    yield { src: "ak", sid: String(o.Srno || n), title: (o.TranslatedRecipeName || o.RecipeName || "").replace(/\s+Recipe\b.*$/i, "").trim(),
      lines: ingText.split(/,(?![^()]*\))/).map((x) => x.trim()).filter(Boolean),
      steps: splitSteps(o.TranslatedInstructions || o.Instructions), prep: num(o.PrepTimeInMins), cook: num(o.CookTimeInMins), total: num(o.TotalTimeInMins),
      servings: num(o.Servings), cuisine: o.Cuisine || "", course: o.Course || "", diet: o.Diet || "", url: o.URL || "", rating: null, reviews: 0 };
  }
}
export async function* readIF101(file) {                     // Indian Food 101 — used only to enrich Indian dishes
  for await (const o of csvObjects(file)) {
    yield { src: "if", sid: o.name, title: o.name, lines: String(o.ingredients || "").split(",").map((x) => x.trim()).filter(Boolean),
      diet: o.diet, prep: num(o.prep_time), cook: num(o.cook_time), flavor: o.flavor_profile, course: o.course, state: o.state === "-1" ? "" : o.state, region: o.region === "-1" ? "" : o.region };
  }
}
export async function* readRecipeNLG(file) {
  for await (const o of csvObjects(file)) {
    const link = String(o.link || "");
    yield { src: "nl", sid: String(o[""] ?? o.id ?? ""), title: o.title, lines: jsonList(o.ingredients), steps: jsonList(o.directions), ner: jsonList(o.NER),
      url: link ? (/^https?:\/\//.test(link) ? link : "https://" + link) : "", linkOnly: true };
  }
}
export async function* readRecipe1M(file) {
  for await (const o of jsonArrayObjects(file)) {
    yield { src: "rm", sid: String(o.id), title: o.title, lines: (o.ingredients || []).map((x) => x.text), steps: (o.instructions || []).map((x) => x.text), url: o.url || "", linkOnly: true };
  }
}
export const READERS = { foodcom: readFoodcom, foodcom_raw: readFoodcomRaw, archana: readArchana, if101: readIF101, recipenlg: readRecipeNLG, recipe1m: readRecipe1M };

// Line-by-line NDJSON helpers for the temporary files.
export async function* ndjson(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield JSON.parse(line);
}
export function writer(file) {
  const ws = fs.createWriteStream(file, { encoding: "utf8" });
  let buf = [], size = 0;
  return {
    write(obj) { const s = JSON.stringify(obj) + "\n"; buf.push(s); size += s.length; if (size > 1 << 20) { ws.write(buf.join("")); buf = []; size = 0; } },
    async close() { if (buf.length) ws.write(buf.join("")); await new Promise((r) => ws.end(r)); },
  };
}
