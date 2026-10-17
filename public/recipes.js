// Recipes: browse and search, recipe details, cook mode, add/import/edit recipes, and the dish picker used by the planner.
import { S, C, ACT, ON, LIB, libFull, loadLibrary, screen, sheet, closeSheet, refreshSheet, commit, toast, esc, money, mins, dietDot, icon, recipe, ingredient, me, isAdmin, api, ask, store, recipeFactsFor, go } from "./state.js";
import { addToDraft, draftExists } from "./plan.js";
import { registerPicker, pickerHTML } from "./foodpick.js";

const F = Object.assign({ q: "", cuisine: "", meal: "", diet: "", off: [], time: "", only: "", sort: "name", limit: 60 }, store.get("recipeFilters", {}));
if (!Array.isArray(F.off)) F.off = [];
if (F.diet && F.diet !== "vegan") F.diet = "";                       // older saved filters
const saveF = () => store.set("recipeFilters", Object.assign({}, F, { limit: 60 }));

/* ---------- list ---------- */
const TAGS = new WeakMap();
function facts(r) { const f = recipeFactsFor(r); let tags = TAGS.get(f); if (!tags) { tags = C.recipeTags(r, f); TAGS.set(f, tags); } return { f, tags }; }
function filtered(opts = {}) {
  const q = C.norm(opts.q ?? F.q);
  const words = q ? q.split(" ") : [];
  const out = [];
  for (const r of S.recipes) {
    if ((r.meals || []).length === 1 && r.meals[0] === "side" && !(opts.sides || F.meal === "side")) continue;
    const cuisine = opts.cuisine ?? F.cuisine, meal = opts.meal ?? F.meal, diet = opts.diet ?? F.diet, time = Number(opts.time ?? F.time) || 0, only = opts.only ?? F.only;
    if (cuisine && r.cuisine !== cuisine) continue;
    if (meal && !(r.meals || []).includes(meal)) continue;
    if (diet && !C.dietAllows(diet, r.diet)) continue;
    const off = opts.off ?? F.off;
    if (off.length && !C.typesAllowed(r, new Set(off))) continue;
    if (time && (r.total || 0) > time) continue;
    if (only === "fav" && !S.favs.has(r.id)) continue;
    if (only === "mine" && (r.builtIn || r.lib)) continue;
    const fx = facts(r);
    if (only === "protein" && !fx.tags.has("high-protein")) continue;
    if (only === "kid" && !fx.tags.has("kid-friendly")) continue;
    if (words.length) {
      const hay = r._hay || (r._hay = C.norm([r.name, r.cuisine, ...(r.tags || []), ...(r.ingredients || []).map((x) => (x.id && ingredient(x.id) ? ingredient(x.id).name : x.name))].join(" ")));
      if (!words.every((w) => hay.includes(w))) continue;
    }
    const nm = C.norm(r.name);
    const rel = !q ? 0 : nm.includes(q) ? 3 : words.every((w) => nm.includes(w)) ? 2 : words.some((w) => nm.includes(w)) ? 1 : 0;
    out.push({ r, rel, ...fx });
  }
  const sort = opts.sort ?? F.sort;
  out.sort((a, b) => (b.rel - a.rel) || (sort === "time" ? (a.r.total || 0) - (b.r.total || 0) : sort === "cost" ? a.f.costPer - b.f.costPer : sort === "protein" ? b.f.per.protein - a.f.per.protein : (a.r._sk || (a.r._sk = a.r.name.toLowerCase())) < (b.r._sk || (b.r._sk = b.r.name.toLowerCase())) ? -1 : a.r._sk > b.r._sk ? 1 : 0));
  return out;
}
export function cuisinesInUse() { return [...new Set([...C.CUISINES, ...S.cuisines])].filter(Boolean).sort(); }
const initials = (name) => name.split(/\s+/).filter((w) => /^[a-z]/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
export function recipeCard(x, act = "open-recipe") {
  const r = x.r;
  return `<button class="rcard" data-act="${act}" data-id="${esc(r.id)}">
    <span class="rthumb">${r.image ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : esc(initials(r.name))}</span>
    <span><h3>${dietDot(r.diet)} ${esc(r.name)}</h3>
    <span class="sub" style="display:block">${esc(r.cuisine)} · ${mins(r.total)}${r.timesEstimated ? "*" : ""} · ${money(x.f.costPer)}/serving · ${Math.round(x.f.per.protein)} g protein</span>
    <span class="sub" style="display:block">${[S.favs.has(r.id) && "♥ Favourite", x.tags.has("high-protein") && "Protein-rich", x.tags.has("kid-friendly") && "Kid-friendly", !r.builtIn && !r.lib && "Household recipe"].filter(Boolean).join(" · ")}</span></span>
  </button>`;
}
function filterBar(prefix = "rf") {
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`;
  return `<div class="filters">
    <select data-on="${prefix}" data-k="cuisine" aria-label="Cuisine">${opt("", "All cuisines", F.cuisine)}${cuisinesInUse().map((c) => opt(c, c, F.cuisine)).join("")}</select>
    <select data-on="${prefix}" data-k="meal" aria-label="Meal">${opt("", "Any meal", F.meal)}${["breakfast", "lunch", "dinner", "snack", "side", "dessert"].map((m) => opt(m, C.MEAL_LABEL[m], F.meal)).join("")}</select>
    ${pickerHTML("recipes", { off: F.off, vegan: F.diet === "vegan" })}
    <select data-on="${prefix}" data-k="time" aria-label="Time">${opt("", "Any time", F.time)}${["15", "20", "30", "45", "60"].map((t) => opt(t, `Up to ${t} min`, F.time)).join("")}</select>
    <select data-on="${prefix}" data-k="only" aria-label="Show">${opt("", "All recipes", F.only)}${opt("fav", "Favourites", F.only)}${opt("mine", "Household recipes", F.only)}${opt("protein", "Protein-rich", F.only)}${opt("kid", "Kid-friendly", F.only)}</select>
    <select data-on="${prefix}" data-k="sort" aria-label="Sort">${opt("name", "A–Z", F.sort)}${opt("time", "Quickest", F.sort)}${opt("cost", "Cheapest", F.sort)}${opt("protein", "Most protein", F.sort)}</select>
  </div>`;
}
/* ---------- "which foods" picker ---------- */
registerPicker("recipes", () => ({ off: F.off, vegan: F.diet === "vegan" }), (st) => { F.off = st.off; F.diet = st.vegan ? "vegan" : ""; F.limit = 60; refreshList(); });
function refreshList() {
  saveF();
  const list = filtered();
  const box = document.getElementById("rlist");
  if (box) box.innerHTML = list.slice(0, F.limit).map((x) => recipeCard(x)).join("") || emptyList();
  const more = document.getElementById("rmore");
  if (more) more.hidden = list.length <= F.limit;
}

screen("recipes", (el) => {
  const list = filtered();
  el.innerHTML = `
    <div class="head"><div><h1>Recipes</h1><p>${S.recipes.filter((r) => !(r.meals.length === 1 && r.meals[0] === "side")).length.toLocaleString()} recipes · ${S.doc.recipes.length} added by your household</p></div>
      <button class="btn" data-act="add-recipe">${icon("plus")} Add a recipe</button></div>
    ${LIB.status === "loading" ? `<div class="msg" style="margin-bottom:10px">Loading the recipe library (${LIB.count.toLocaleString()} recipes)… <div class="progress" style="margin-top:6px"><i id="libProgress" style="width:${Math.round(LIB.progress * 100)}%"></i></div></div>` : ""}
    ${LIB.status === "error" ? `<p class="msg bad" style="margin-bottom:10px">${esc(LIB.error || "The recipe library didn't load.")} <button class="link" data-act="lib-retry">Try again</button></p>` : ""}
    <div class="row" style="flex-wrap:nowrap"><input type="search" placeholder="Search by dish or ingredient — e.g. paneer, dosa, quick chicken" value="${esc(F.q)}" data-on="rq" aria-label="Search recipes">
      ${LIB.archiveCount ? `<button class="btn quiet" data-act="search-all" title="Search all ${LIB.archiveCount.toLocaleString()} recipes">${icon("pick")} All</button>` : ""}</div>
    ${filterBar()}
    <div class="rlist" id="rlist">${list.slice(0, F.limit).map((x) => recipeCard(x)).join("") || emptyList()}</div>
    <div class="row" id="rmore" style="justify-content:center;margin-top:14px" ${list.length > F.limit ? "" : "hidden"}><button class="btn quiet" data-act="more-recipes">Show more</button></div>`;
});
let rqTimer;
ON["rq:input"] = (el) => { clearTimeout(rqTimer); rqTimer = setTimeout(() => searchNow(el), S.recipes.length > 5000 ? 180 : 0); };
const searchNow = (el) => { F.q = el.value; saveF(); const list = filtered(); const box = document.getElementById("rlist"); if (box) box.innerHTML = list.slice(0, F.limit).map((x) => recipeCard(x)).join("") || emptyList(); };
ON["rf"] = (el) => { F[el.dataset.k] = el.value; F.limit = 60; saveF(); go("recipes"); };
function emptyList() {
  return `<div class="empty" style="grid-column:1/-1"><h3>No recipes match</h3><p>Try fewer filters, or add your own recipe.</p>${F.q && LIB.archiveCount ? `<button class="btn wrap" style="margin-top:12px" data-act="search-all">Search all ${LIB.archiveCount.toLocaleString()} recipes for “${esc(F.q)}”</button>` : ""}</div>`;
}

/* ---------- search the whole archive (millions of recipes) and add one to the household ---------- */
const SRC_NAME = { fc: "Food.com", fr: "Food.com", ak: "Archana's Kitchen", nl: "RecipeNLG", rm: "Recipe1M" };
ACT["search-all"] = () => {
  const st = { q: F.q, cu: F.cuisine, items: null, total: 0, approx: false, next: 0, more: false, busy: false, msg: "" };
  const go2 = async (append) => {
    st.busy = true; st.msg = ""; redraw();
    try {
      const d = await api(`/api/lib/search?q=${encodeURIComponent(st.q)}&cu=${encodeURIComponent(st.cu)}&o=${append ? st.next : 0}`);
      st.items = append ? [...(st.items || []), ...d.items] : d.items; st.total = d.total; st.approx = d.approx; st.next = d.next; st.more = d.more;
    } catch (e) { st.msg = e.message; }
    st.busy = false; redraw();
  };
  const draw = (el) => {
    el.innerHTML = `<div class="sheet-head"><div><h2>Search all recipes</h2><p class="sub">${LIB.archiveCount.toLocaleString()} more recipes from Food.com, Archana's Kitchen, RecipeNLG and Recipe1M. Pick one to add it to your household's recipes.</p></div><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <div class="row"><input type="search" id="saQ" style="flex:1 1 220px;width:auto" value="${esc(st.q)}" placeholder="e.g. lamb biryani, mushroom risotto" autofocus>
        <select id="saCu" style="width:auto"><option value="">Any cuisine</option>${C.CUISINES.map((c) => `<option ${c === st.cu ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <button class="btn" data-act="sa-go">Search</button></div>
      ${st.msg ? `<p class="msg bad" style="margin-top:10px">${esc(st.msg)}</p>` : ""}
      ${st.items ? (st.items.length ? `<p class="sub small" style="margin:10px 0 4px">${st.approx ? "No recipe has all those words — closest matches:" : `${st.total.toLocaleString()} recipe${st.total === 1 ? "" : "s"} found${st.total >= 20000 ? " (showing the best)" : ""}`}</p>
        ${st.items.map((x) => `<button class="rcard" style="margin-top:8px" data-act="sa-pick" data-k="${x.k}"><span><h3>${esc(x.t)}</h3>
          <span class="sub" style="display:block">${[x.cu, x.time ? mins(x.time) : "", x.v ? `serves ${x.v}` : "", x.site || SRC_NAME[x.s]].filter(Boolean).map(esc).join(" · ")}</span>
          <span class="sub small" style="display:block">${x.lo ? "Ingredients here · method from the original website" : x.nq ? "Method included · no quantities" : "Full recipe"} · ${esc(x.preview.slice(0, 4).join(", "))}${x.n > 4 ? "…" : ""}</span></span></button>`).join("")}
        ${st.more ? `<div class="row" style="justify-content:center;margin-top:12px"><button class="btn quiet" data-act="sa-more" ${st.busy ? "disabled" : ""}>More results</button></div>` : ""}`
        : `<div class="empty"><h3>Nothing found</h3><p>Try fewer or simpler words.</p></div>`) : ""}
      ${st.busy ? `<p class="sub" style="margin-top:12px">Searching…</p>` : ""}`;
    const q = el.querySelector("#saQ"); q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ACT["sa-go"](); } });
  };
  const redraw = () => refreshSheet();
  sheet(draw, { wide: true });
  ACT["sa-go"] = () => { const e = document.getElementById("sheet"); st.q = e.querySelector("#saQ").value.trim(); st.cu = e.querySelector("#saCu").value; if (st.q) go2(false); };
  ACT["sa-more"] = () => go2(true);
  ACT["sa-pick"] = (b) => previewArchive(Number(b.dataset.k));
  if (st.q) go2(false);
};
async function previewArchive(k) {
  let d;
  try { d = await api(`/api/lib/arc?k=${k}`); } catch (e) { toast(e.message, true); return; }
  const r = d.recipe;
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><div><h2>${esc(r.t)}</h2><p class="sub">${[r.cu, r.T ? mins(r.T) : r.p != null && r.c != null ? mins(r.p + r.c) : "", r.v ? `serves ${r.v}` : ""].filter(Boolean).map(esc).join(" · ")}</p></div><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <h3>Ingredients</h3><ul class="ings">${(r.l || []).map((t) => `<li><span class="n">${esc(t)}</span></li>`).join("")}</ul>
      ${r.d && r.d.length ? `<h3 style="margin-top:14px">Method</h3><ol class="steps">${r.d.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>` : `<p class="msg" style="margin-top:14px">The method for this one comes from the original website${r.u ? ` (<a href="${esc(r.u)}" target="_blank" rel="noopener noreferrer">${esc(new URL(r.u).hostname.replace(/^www\./, ""))}</a>)` : ""} — MealPilot fetches it when you add the recipe.</p>`}
      <div class="sheet-foot"><button class="btn quiet" data-act="search-all">Back to results</button><button class="btn" data-act="sa-add">Add to my recipes</button></div>`;
  }, { wide: true });
  ACT["sa-add"] = async (b) => {
    b.disabled = true; b.textContent = "Adding…";
    const base = { name: r.t, ingredients: r.l || [], steps: r.d || [], prep: r.p ?? null, cook: r.c ?? null, total: r.T ?? null, servings: r.v || null, cuisine: r.cu || "", category: "", keywords: "", image: r.im || "",
      source: { type: "dataset", site: r.u ? new URL(r.u).hostname.replace(/^www\./, "") : SRC_NAME[r.s], url: r.u || "", author: "" } };
    if (r.lo && r.u) {
      try { const imp = await api("/api/import/url", { body: { url: r.u } }); const draft = fromImported(imp.recipe); if (!draft.cuisine && r.cu) draft.cuisine = r.cu; return openEditor(draft); }
      catch (e) { const draft = fromImported(base); draft.note = `Couldn't fetch the method from ${base.source.site}: ${e.message} Paste the method below, or open the link.`; return openEditor(draft); }
    }
    const draft = fromImported(base);
    if (r.nq) draft.note = "This recipe came without quantities — add them to each ingredient so shopping lists and costs work.";
    openEditor(draft);
  };
}

ACT["lib-retry"] = () => { LIB.status = "none"; loadLibrary(); };
ACT["more-recipes"] = () => { F.limit += 60; go("recipes"); };
ACT["open-recipe"] = (el) => openRecipe(el.dataset.id);

/* ---------- recipe details ---------- */
export function openRecipe(id, opts = {}) {
  const st = { servings: opts.servings || null, err: "" };
  const r0 = recipe(id);
  if (r0 && r0.lib && !r0.steps) libFull(r0).then(() => refreshSheet()).catch((e) => { st.err = e.message; refreshSheet(); });
  sheet((el) => {
    const r = recipe(id);
    if (!r) { el.innerHTML = `<div class="empty"><h3>${id.startsWith("l:") && LIB.status === "loading" ? "The recipe library is still loading…" : "This recipe was removed"}</h3></div><div class="sheet-foot"><button class="btn" data-act="close-sheet">Close</button></div>`; return; }
    const loading = r.lib && !r.steps;
    const s = st.servings || r.servings;
    const f = recipeFactsFor(r, s);
    const tags = C.recipeTags(r, recipeFactsFor(r));
    const k = s / r.servings;
    const canEdit = !r.builtIn && !r.lib && (r.createdBy === me() || isAdmin());
    el.innerHTML = `
      ${r.image ? `<div class="rhero"><img src="${esc(r.image)}" alt=""></div>` : ""}
      <div class="sheet-head"><div><h2>${dietDot(r.diet)} ${esc(r.name)}</h2>
        <p class="sub" style="margin-top:4px">${esc(r.cuisine)} · ${(r.meals || []).map((m) => C.MEAL_LABEL[m] || m).join(", ")}${r.with ? ` · served with ${esc((recipe(C.SIDE_RECIPES[r.with]) || {}).name || r.with)}` : ""}</p></div>
        <button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <div class="chips">${[...tags].filter((t) => C.GOALS[t] || ["quick"].includes(t)).map((t) => `<span class="chip read">${esc(C.GOALS[t] || "Quick")}</span>`).join("")}${"🌶".repeat(r.spice || 0) ? `<span class="chip read" title="Spice level">${"🌶".repeat(r.spice)}</span>` : ""}</div>
      <div class="facts">
        <div><b>${mins(r.prep)}</b><span>Prep${r.timesEstimated ? " (estimate)" : ""}</span></div>
        <div><b>${mins(r.cook)}</b><span>Cooking</span></div>
        <div><b>${mins(r.total)}</b><span>Total</span></div>
        <div><b>${money(f.cost)}</b><span>${money(f.costPer)} per serving</span></div>
      </div>
      <div class="row between"><div class="stepper" role="group" aria-label="Servings"><button data-act="rs-minus" aria-label="Fewer servings">−</button><span>${C.fmtNum(s)} serving${s === 1 ? "" : "s"}</span><button data-act="rs-plus" aria-label="More servings">+</button></div>
        <span class="sub small">${f.billPriced ? `${f.billPriced} of ${f.counted} prices from your bills` : "Prices are starter estimates until you scan bills"}${f.unknown ? ` · ${f.unknown} unpriced` : ""}</span></div>
      <p class="sub small" style="margin-top:10px">Per serving: <b>${Math.round(f.per.kcal)}</b> kcal · <b>${Math.round(f.per.protein)} g</b> protein · ${Math.round(f.per.carbs)} g carbs · ${Math.round(f.per.fat)} g fat · ${Math.round(f.per.fibre)} g fibre <span class="muted">(estimates)</span></p>
      <h3 style="margin-top:16px">Ingredients</h3>
      ${loading ? `<p class="sub" style="margin-top:12px">${st.err ? esc(st.err) : "Loading the full recipe…"}</p>` : ""}
      <ul class="ings">${(r.lines || r.ingredients || []).map((x) => {
        const ing = x.id && ingredient(x.id);
        const q = x.q != null ? C.fmtQty(x.q * k, x.u) : x.amount && ing ? C.fmtBase(x.amount * k, ing) : "";
        return `<li class="${ing ? "" : "unmatched"}"><span class="q">${esc(q)}</span><span class="n">${esc(ing ? ing.name : x.name)}${x.opt ? " <span class='muted'>(optional)</span>" : ""}${x.note ? ` <span class="note">— ${esc(x.note)}</span>` : ""}</span></li>`;
      }).join("")}</ul>
      <h3 style="margin-top:16px">Method</h3>
      <ol class="steps">${(r.steps || []).map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
      ${r.lib && r.source ? `<p class="sub small" style="margin-top:12px">From the MealPilot recipe library${r.source.site ? ` · originally from ${r.source.url ? `<a href="${esc(r.source.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source.site)}</a>` : esc(r.source.site)}` : ""}${r.source.author ? ` by ${esc(r.source.author)}` : ""}${r.rating ? ` · rated ${r.rating}/5${r.reviews ? ` by ${r.reviews} cooks` : ""}` : ""}.</p>` : r.source && (r.source.url || r.source.site) ? `<p class="sub small" style="margin-top:12px">Recipe from ${r.source.url ? `<a href="${esc(r.source.url)}" target="_blank" rel="noopener noreferrer">${esc(r.source.site || r.source.url)}</a>` : esc(r.source.site)}${r.source.author ? ` by ${esc(r.source.author)}` : ""}. Saved to your household's own recipe book.</p>` : r.builtIn ? `<p class="sub small" style="margin-top:12px">A MealPilot starter recipe.</p>` : ""}
      <div class="sheet-foot" style="justify-content:space-between">
        <button class="btn quiet sm ${S.favs.has(r.id) ? "on" : ""}" data-act="fav-recipe" data-id="${esc(r.id)}">${S.favs.has(r.id) ? "♥ Favourite" : "♡ Favourite"}</button>
        <div class="row">
          ${canEdit ? `<button class="btn ghost sm" data-act="edit-recipe" data-id="${esc(r.id)}">Edit</button>` : `<button class="btn ghost sm" data-act="copy-recipe" data-id="${esc(r.id)}">Make my own version</button>`}
          <button class="btn ghost sm" data-act="recipe-to-list" data-id="${esc(r.id)}">Add to shopping list</button>
          <button class="btn ghost sm" data-act="recipe-to-menu" data-id="${esc(r.id)}">Add to a menu</button>
          <button class="btn sm" data-act="cook" data-id="${esc(r.id)}" ${loading ? "disabled" : ""}>Cook now</button>
        </div>
      </div>`;
    ACT["rs-minus"] = () => { st.servings = Math.max(1, (st.servings || r.servings) - 1); refreshSheet(); };
    ACT["rs-plus"] = () => { st.servings = Math.min(40, (st.servings || r.servings) + 1); refreshSheet(); };
    ACT["cook"] = () => cookMode(r.id, st.servings || r.servings);
    ACT["recipe-to-list"] = () => recipeToList(r.id, st.servings || r.servings);
  }, { wide: true });
}
ACT["fav-recipe"] = (el) => commit({ type: "favRecipe", id: el.dataset.id }, { quiet: true });
ACT["edit-recipe"] = (el) => openEditor(structuredClone(recipe(el.dataset.id)));
ACT["copy-recipe"] = (el) => {
  const r = structuredClone(recipe(el.dataset.id));
  delete r.id; r.builtIn = false; r.name = r.name + " (my version)";
  if (r.lines) r.ingredients = r.lines;
  delete r.lib; delete r.lines; delete r.shard; delete r.nu; delete r.ft;
  r.source = r.source ? Object.assign({}, r.source, { type: "link" }) : null;
  r.ingredients = r.ingredients.map((x) => Object.assign({ text: x.q != null ? `${C.fmtQty(x.q, x.u)} ${ingredient(x.id) ? ingredient(x.id).name.toLowerCase() : x.name}`.trim() : x.text || x.name }, x));
  openEditor(r);
};
function recipeToList(id, servings) {
  const r = recipe(id);
  const k = servings / r.servings;
  const items = [];
  let staples = 0;
  for (const x of r.lines || r.ingredients) {
    if (x.opt) continue;
    const ing = x.id && ingredient(x.id);
    if (ing && ing.free) continue;
    if (ing && ing.staple) { staples++; continue; }
    items.push(ing ? { id: ing.id, name: ing.name, amount: x.amount * k } : { name: x.name });
  }
  commit({ type: "listAdd", items }, { quiet: true });
  toast(`Added ${items.length} item${items.length === 1 ? "" : "s"} to the shopping list${staples ? ` (left out ${staples} pantry staple${staples > 1 ? "s" : ""})` : ""}.`);
}
ACT["recipe-to-menu"] = (el) => {
  const r = recipe(el.dataset.id);
  const mineMenus = S.doc.menus.filter((m) => m.createdBy === me() && m.status !== "final" && C.addDays(m.start, m.days - 1) >= C.isoDate());
  sheet((s) => {
    s.innerHTML = `<div class="sheet-head"><h2>Add ${esc(r.name)} to…</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      ${draftExists() ? `<button class="btn wide" data-act="to-draft" style="margin-bottom:12px">The menu I'm planning now</button>` : ""}
      ${mineMenus.length ? `<label class="f">Menu<select id="tmMenu">${mineMenus.map((m) => `<option value="${m.id}">${esc(m.name)} (${C.dayLabel(m.start)})</option>`).join("")}</select></label>
        <div class="grid2" style="margin-top:10px"><label class="f">Day<select id="tmDay"></select></label>
        <label class="f">Meal<select id="tmMeal">${C.MEALS.map((m) => `<option value="${m}" ${r.meals.includes(m) ? "" : ""}>${C.MEAL_LABEL[m]}</option>`).join("")}</select></label></div>
        <div class="sheet-foot"><button class="btn" data-act="to-menu">Add</button></div>`
        : draftExists() ? "" : `<p class="sub">You don't have a menu you can add to yet. Start one on the Plan tab.</p><div class="sheet-foot"><button class="btn" data-act="to-plan">Go to Plan</button></div>`}`;
    const fillDays = () => {
      const m = S.doc.menus.find((x) => x.id === s.querySelector("#tmMenu").value);
      s.querySelector("#tmDay").innerHTML = Array.from({ length: m.days }, (_, d) => `<option value="${d}">${C.dayLabel(C.addDays(m.start, d))}</option>`).join("");
      const meal = r.meals.find((x) => m.meals.includes(x)) || m.meals[0];
      if (meal) s.querySelector("#tmMeal").value = meal;
    };
    if (mineMenus.length) { fillDays(); s.querySelector("#tmMenu").onchange = fillDays; }
  });
  ACT["to-draft"] = () => { closeSheet(); addToDraft(r.id); };
  ACT["to-plan"] = () => { closeSheet(); go("plan"); };
  ACT["to-menu"] = () => {
    const s = document.getElementById("sheet");
    const m = structuredClone(S.doc.menus.find((x) => x.id === s.querySelector("#tmMenu").value));
    const d = Number(s.querySelector("#tmDay").value), meal = s.querySelector("#tmMeal").value;
    let slot = m.slots.find((x) => x.d === d && x.m === meal);
    if (!slot) { slot = { d, m: meal, dishes: [], alts: [] }; m.slots.push(slot); }
    slot.dishes.push({ r: r.id, s: m.people });
    if (!m.meals.includes(meal)) m.meals = C.MEALS.filter((x) => m.meals.includes(x) || x === meal);
    commit({ type: "updateMenu", id: m.id, menu: { slots: m.slots, meals: m.meals } });
    closeSheet(); toast(`Added to ${m.name}.`);
  };
};

/* ---------- cook mode ---------- */
const timers = [];
let timerTick = null, wakeLock = null;
function timeHints(text) {
  const out = [];
  for (const m of text.matchAll(/(\d+)(?:\s*(?:–|-|to)\s*(\d+))?\s*(minutes?|mins?|hours?|hrs?)\b/gi)) {
    let n = Number(m[2] || m[1]); if (/^h/i.test(m[3])) n *= 60;
    if (n > 0 && n <= 600 && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 2);
}
function beep() {
  try { const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(), g = a.createGain(); o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = 0.15; o.start(); setTimeout(() => { o.stop(); a.close(); }, 600); } catch {}
  try { navigator.vibrate && navigator.vibrate([300, 150, 300]); } catch {}
}
export function cookMode(id, servings) {
  const r0 = recipe(id);
  if (r0 && r0.lib && !r0.steps) { libFull(r0).then(() => cookMode(id, servings)).catch((e) => toast(e.message, true)); return; }
  closeSheet();
  const r = recipe(id);
  const k = servings / r.servings;
  let step = 0, view = "steps";
  const ticked = new Set();
  const wrap = document.createElement("div");
  wrap.className = "cook"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Cook " + r.name);
  document.body.appendChild(wrap); document.body.style.overflow = "hidden";
  try { navigator.wakeLock && navigator.wakeLock.request("screen").then((l) => { wakeLock = l; }).catch(() => {}); } catch {}
  const draw = () => {
    const steps = r.steps || [];
    wrap.innerHTML = `
      <div class="cook-top"><button class="icon-btn" data-act="cook-close" aria-label="Close cook mode">${icon("x")}</button><h2>${esc(r.name)}</h2>
        <div class="seg"><button class="${view === "ings" ? "on" : ""}" data-act="cook-view" data-v="ings">Ingredients</button><button class="${view === "steps" ? "on" : ""}" data-act="cook-view" data-v="steps">Steps</button></div></div>
      <div class="timers" id="timers"></div>
      <div class="cook-body">${view === "ings" ? `<p class="sub">For ${C.fmtNum(servings)} serving${servings === 1 ? "" : "s"} — tap to tick off.</p><ul class="ings cook-ings">${(r.lines || r.ingredients).map((x, i) => {
          const ing = x.id && ingredient(x.id);
          const q = x.q != null ? C.fmtQty(x.q * k, x.u) : ing && x.amount ? C.fmtBase(x.amount * k, ing) : "";
          return `<li data-act="cook-tick" data-i="${i}" style="cursor:pointer;${ticked.has(i) ? "opacity:.45;text-decoration:line-through" : ""}"><span class="q">${esc(q)}</span><span class="n">${esc(ing ? ing.name : x.name)}${x.note ? ` <span class="note">— ${esc(x.note)}</span>` : ""}</span></li>`;
        }).join("")}</ul>`
        : `<div class="cook-count">Step ${step + 1} of ${steps.length}</div><p class="cook-step">${esc(steps[step] || "")}</p>
          <div class="row" style="margin-top:18px">${timeHints(steps[step] || "").map((n) => `<button class="btn quiet" data-act="cook-timer" data-n="${n}">⏱ Start ${mins(n)} timer</button>`).join("")}</div>`}</div>
      ${view === "steps" ? `<div class="cook-foot"><button class="btn quiet" data-act="cook-prev" ${step === 0 ? "disabled" : ""}>Back</button><button class="btn" data-act="${step >= steps.length - 1 ? "cook-close" : "cook-next"}">${step >= steps.length - 1 ? "Done" : "Next step"}</button></div>` : ""}`;
    drawTimers();
  };
  const drawTimers = () => {
    const box = wrap.querySelector("#timers"); if (!box) return;
    box.innerHTML = timers.map((t, i) => { const left = Math.max(0, Math.round((t.end - Date.now()) / 1000)); return `<span class="timer ${left === 0 ? "done" : ""}">${esc(t.label)} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}<button data-act="cook-untimer" data-i="${i}" aria-label="Stop timer">×</button></span>`; }).join("");
  };
  clearInterval(timerTick);
  timerTick = setInterval(() => { for (const t of timers) if (!t.rang && t.end <= Date.now()) { t.rang = true; beep(); } drawTimers(); }, 1000);
  ACT["cook-view"] = (el) => { view = el.dataset.v; draw(); };
  ACT["cook-next"] = () => { step++; draw(); };
  ACT["cook-prev"] = () => { step = Math.max(0, step - 1); draw(); };
  ACT["cook-tick"] = (el) => { const i = Number(el.dataset.i); ticked.has(i) ? ticked.delete(i) : ticked.add(i); draw(); };
  ACT["cook-timer"] = (el) => { const n = Number(el.dataset.n); timers.push({ label: `Step ${step + 1}`, end: Date.now() + n * 60000 }); drawTimers(); toast(`Timer set for ${mins(n)}.`); };
  ACT["cook-untimer"] = (el) => { timers.splice(Number(el.dataset.i), 1); drawTimers(); };
  ACT["cook-close"] = () => { wrap.remove(); document.body.style.overflow = ""; if (!timers.length) clearInterval(timerTick); try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; };
  draw();
}

/* ---------- adding recipes: link, online search, pasted text, or write your own ---------- */
ACT["add-recipe"] = () => {
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>Add a recipe</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <div class="stack">
        <div class="card flat" style="margin:0"><h3>Import from a link</h3><p class="sub" style="margin:4px 0 10px">Paste the address of a recipe page — BBC Good Food, Allrecipes, a blog… MealPilot reads the ingredients, method and times and saves a private copy for your household, credited to the site.</p>
          <div class="row" style="flex-wrap:nowrap"><input type="url" id="impUrl" placeholder="https://www.bbcgoodfood.com/recipes/…" autofocus ${S.local ? "disabled" : ""}><button class="btn" data-act="import-url" ${S.local ? "disabled" : ""}>Import</button></div>
          ${S.local ? `<p class="hint">Importing needs the MealPilot website (sign in), not this offline copy.</p>` : ""}<div id="impMsg" style="margin-top:8px"></div></div>
        <div class="grid2">
          <button class="btn quiet wide" data-act="search-online" ${S.local ? "disabled" : ""}>${icon("pick")} Search recipes online</button>
          <button class="btn quiet wide" data-act="paste-recipe">Paste the recipe text</button>
        </div>
        <button class="btn ghost wide" data-act="new-recipe">${icon("edit")} Write your own recipe</button>
      </div>`;
    el.querySelector("#impUrl")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ACT["import-url"](); } });
  });
};
ACT["new-recipe"] = () => openEditor({ name: "", cuisine: "", meals: ["dinner"], servings: 4, prep: 15, cook: 30, diet: "", spice: 1, ingredients: [], steps: [] });
ACT["import-url"] = async () => {
  const url = document.getElementById("impUrl").value.trim(), msg = document.getElementById("impMsg");
  if (!url) { msg.innerHTML = `<p class="msg bad">Paste a link first.</p>`; return; }
  msg.innerHTML = `<p class="msg">Reading the recipe…</p>`;
  try { const d = await api("/api/import/url", { body: { url } }); openEditor(fromImported(d.recipe)); }
  catch (err) { msg.innerHTML = `<p class="msg bad">${esc(err.message)}</p>`; }
};
// Turn a recipe read from a web page / TheMealDB into editor content.
export function fromImported(x) {
  const lines = (x.ingredients || []).map((t) => C.parseIngredientLine(t, S.cat)).filter(Boolean);
  const text = C.norm([x.name, x.cuisine, x.category, x.keywords].join(" "));
  const guessCuisine = () => {
    const c = C.norm(x.cuisine || "");
    const hit = C.CUISINES.find((k) => C.norm(k) === c);
    if (hit) return hit;
    if (/indian/.test(c) || /\b(curry|dal|masala|paneer|biryani|tikka)\b/.test(text)) return /\b(dosa|idli|sambar|rasam|kerala|chettinad|uttapam|appam|coconut chutney|south indian)\b/.test(text) ? "South Indian" : "North Indian";
    const map = { greek: "Mediterranean", turkish: "Middle Eastern", lebanese: "Middle Eastern", moroccan: "Middle Eastern", egyptian: "Middle Eastern", tunisian: "Middle Eastern", irish: "British", english: "British", scottish: "British", welsh: "British", canadian: "American", malaysian: "Thai", vietnamese: "Thai", filipino: "Chinese", jamaican: "Other", croatian: "Mediterranean", portuguese: "Spanish", polish: "Other", dutch: "Other", russian: "Other", ukrainian: "Other", kenyan: "Other", indian: "North Indian" };
    for (const [k, v] of Object.entries(map)) if (c.includes(k)) return v;
    return x.cuisine ? x.cuisine.split(",")[0].trim().slice(0, 30) : "";
  };
  const cat = C.norm(x.category || "");
  const meals = /breakfast|brunch/.test(cat) ? ["breakfast"] : /dessert|snack|starter|appetizer|side/.test(cat) ? ["snack"] : /lunch/.test(cat) ? ["lunch"] : ["lunch", "dinner"];
  let prep = x.prep, cook = x.cook, est = false;
  if (prep == null && cook == null && x.total) { prep = Math.min(20, Math.round(x.total / 3)); cook = x.total - prep; }
  if (prep == null) { prep = 15; est = true; }
  if (cook == null) { cook = Math.max(10, Math.min(90, (x.steps || []).length * 7)); est = true; }
  const draft = { name: x.name || "", cuisine: guessCuisine(), meals, servings: x.servings || 4, prep, cook, timesEstimated: est, spice: 1,
    ingredients: lines, steps: x.steps || [], image: x.image || "", source: x.source || null, diet: "" };
  draft.diet = C.dietOf(draft, S.cat);
  return draft;
}
ACT["paste-recipe"] = () => {
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>Paste a recipe</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <p class="sub">Copy the recipe from a website, message or document and paste it here. Put the name on the first line; MealPilot works out which lines are ingredients and which are steps.</p>
      <textarea id="pasteText" style="min-height:240px;margin-top:10px" placeholder="Chicken curry&#10;&#10;Ingredients&#10;500g chicken thighs&#10;2 onions&#10;…&#10;&#10;Method&#10;1. Fry the onions…" autofocus></textarea>
      <label class="f" style="margin-top:10px">Where it's from (optional)<input id="pasteSrc" placeholder="e.g. Amma's notebook, or a web address"></label>
      <div class="sheet-foot"><button class="btn" data-act="paste-go">Read recipe</button></div>`;
  });
  ACT["paste-go"] = () => {
    const raw = document.getElementById("pasteText").value, src = document.getElementById("pasteSrc").value.trim();
    if (raw.trim().length < 20) { toast("Paste the whole recipe first.", true); return; }
    openEditor(fromImported(Object.assign(parsePasted(raw), { source: src ? (/^https?:\/\//.test(src) ? { type: "link", url: src, site: new URL(src).hostname.replace(/^www\./, "") } : { type: "note", site: src }) : null })));
  };
};
export function parsePasted(raw) {
  const lines = raw.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const name = (lines.find((l) => l) || "").replace(/^#+\s*/, "").slice(0, 100);
  const ingredients = [], steps = [];
  let mode = "auto", prep = null, cook = null, servings = null;
  for (const l of lines.slice(lines.indexOf(lines.find((x) => x)) + 1)) {
    if (!l) continue;
    if (/^(ingredients?|you will need|for the [a-z ]+:?)\s*:?$/i.test(l)) { mode = "ing"; continue; }
    if (/^(method|instructions?|directions?|steps?|preparation|how to make( it)?)\s*:?$/i.test(l)) { mode = "step"; continue; }
    const pm = l.match(/prep(?:aration)?(?: time)?\s*:?\s*(\d+)\s*(min|hour|hr)/i); if (pm) { prep = Number(pm[1]) * (/h/i.test(pm[2]) ? 60 : 1); continue; }
    const cm = l.match(/cook(?:ing)?(?: time)?\s*:?\s*(\d+)\s*(min|hour|hr)/i); if (cm) { cook = Number(cm[1]) * (/h/i.test(cm[2]) ? 60 : 1); continue; }
    const sm = l.match(/^(?:serves|servings|makes|yield)\s*:?\s*(\d+)/i); if (sm) { servings = Number(sm[1]); continue; }
    const looksIng = /^[-•*▢]?\s*(\d|½|¼|¾|⅓|a |an |one |two |three |pinch|handful|salt|pepper)/i.test(l) && l.length < 90 && !/^\d+[.)]\s+[A-Z][a-z]+ .{40,}/.test(l);
    if (mode === "ing" || (mode === "auto" && looksIng)) {
      if (mode === "ing" && /^\d+[.)]\s/.test(l) && l.length > 60) { mode = "step"; steps.push(l.replace(/^\d+[.)]\s*/, "")); continue; }
      ingredients.push(l);
    } else steps.push(l.replace(/^(step\s*)?\d+[.):]\s*/i, ""));
  }
  return { name, ingredients, steps, prep, cook, servings };
}

/* ---------- online search: TheMealDB and Spoonacular ---------- */
ACT["search-online"] = () => {
  const st = { source: "mealdb", q: "", cuisine: "", results: null, busy: false, msg: "" };
  const draw = (el) => {
    el.innerHTML = `<div class="sheet-head"><h2>Search recipes online</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <div class="row">${S.config.spoonacular ? `<div class="seg"><button class="${st.source === "mealdb" ? "on" : ""}" data-act="os-src" data-s="mealdb">TheMealDB</button><button class="${st.source === "spoonacular" ? "on" : ""}" data-act="os-src" data-s="spoonacular">Spoonacular</button></div>` : `<span class="sub small">Searching TheMealDB, a free recipe library.</span>`}</div>
      <div class="row" style="margin-top:10px"><input type="search" id="osQ" style="flex:1 1 220px;width:auto" placeholder="Dish or ingredient, e.g. lamb, biryani, soup" value="${esc(st.q)}" autofocus>
        <select id="osC" style="width:auto"><option value="">Any cuisine</option>${C.CUISINES.map((c) => `<option ${c === st.cuisine ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
        <button class="btn" data-act="os-go">Search</button></div>
      ${st.msg ? `<p class="msg ${/n't|not|fail|error/i.test(st.msg) ? "bad" : ""}" style="margin-top:10px">${esc(st.msg)}</p>` : ""}
      ${st.busy ? `<p class="sub" style="margin-top:12px">Searching…</p>` : ""}
      ${st.results ? (st.results.length ? `<div class="results">${st.results.map((x) => `<button class="result" data-act="os-pick" data-id="${esc(x.id)}">${x.image ? `<img src="${esc(x.image)}${st.source === "mealdb" ? "/preview" : ""}" alt="" loading="lazy">` : `<img alt="">`}<div>${esc(x.name)}${x.cuisine ? `<span>${esc(x.cuisine)}</span>` : ""}</div></button>`).join("")}</div>`
        : `<div class="empty"><h3>Nothing found</h3><p>Try a simpler word, or a different cuisine.</p></div>`) : `<p class="sub small" style="margin-top:12px">Leave the search empty and pick a cuisine to browse, or search with nothing for a few random ideas.</p>`}
      ${st.source === "mealdb" && S.config.mealdbTestKey ? `<p class="hint" style="margin-top:12px">Recipes from TheMealDB (themealdb.com). Times and prices are estimated when you save.</p>` : ""}
      ${st.source === "spoonacular" ? `<p class="hint" style="margin-top:12px">Search by Spoonacular. When you pick one, MealPilot imports it from the original website it came from.</p>` : ""}`;
    el.querySelector("#osQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ACT["os-go"](); } });
  };
  sheet(draw, { wide: true });
  const redraw = () => draw(document.getElementById("sheet"));
  ACT["os-src"] = (el) => { st.source = el.dataset.s; st.results = null; redraw(); };
  ACT["os-go"] = async () => {
    st.q = document.getElementById("osQ").value.trim(); st.cuisine = document.getElementById("osC").value; st.busy = true; st.msg = ""; redraw();
    try { const d = await api(`/api/discover?source=${st.source}&q=${encodeURIComponent(st.q)}&cuisine=${encodeURIComponent(st.cuisine)}`); st.results = d.results; }
    catch (err) { st.msg = err.message; st.results = null; }
    st.busy = false; redraw();
  };
  ACT["os-pick"] = async (el) => {
    st.msg = "Opening the recipe…"; redraw();
    try {
      const d = await api(`/api/discover/item?source=${st.source}&id=${encodeURIComponent(el.dataset.id)}`);
      if (d.recipe) { const draft = fromImported(d.recipe); if (st.cuisine && !draft.cuisine) draft.cuisine = st.cuisine; return openEditor(draft); }
      if (!d.sourceUrl) throw new Error("That recipe doesn't say where it came from, so it can't be imported.");
      st.msg = `Importing from ${d.sourceName || new URL(d.sourceUrl).hostname}…`; redraw();
      try { const imp = await api("/api/import/url", { body: { url: d.sourceUrl } }); openEditor(fromImported(imp.recipe)); }
      catch (err) { st.msg = `${err.message} You can open it here: ${d.sourceUrl}`; redraw(); }
    } catch (err) { st.msg = err.message; redraw(); }
  };
};

/* ---------- the recipe editor ---------- */
export function openEditor(draft) {
  const st = { r: draft, lines: (draft.ingredients || []).map((x) => Object.assign({}, x, { text: x.text || (x.q != null ? `${C.fmtQty(x.q, x.u)} ${x.id && ingredient(x.id) ? ingredient(x.id).name.toLowerCase() : x.name || ""}`.trim() : x.name || "") })) };
  if (!st.lines.length) st.lines.push({ text: "" });
  const ingOptions = (sel) => `<option value="">— not matched (won't be priced) —</option><option value="__new">＋ Add as a new ingredient</option>` +
    S.cat.list.filter((i) => !i.free).slice().sort((a, b) => a.name.localeCompare(b.name)).map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? "selected" : ""}>${esc(i.name)}</option>`).join("");
  const draw = (el) => {
    const r = st.r;
    const cuisines = cuisinesInUse();
    el.innerHTML = `<div class="sheet-head"><h2>${r.id ? "Edit recipe" : "New recipe"}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      ${r.note ? `<p class="msg warn" style="margin-bottom:12px">${esc(r.note)}</p>` : ""}
      ${r.source && r.source.site ? `<p class="msg" style="margin-bottom:12px">From ${esc(r.source.site)}${r.source.author ? ` (by ${esc(r.source.author)})` : ""}. Check the details, then save it to your household's recipe book.</p>` : ""}
      <div class="stack">
        <label class="f">Name<input id="edName" value="${esc(r.name)}" placeholder="e.g. Amma's sambar" ${r.name ? "" : "autofocus"}></label>
        <div class="grid3">
          <label class="f">Cuisine<select id="edCuisine">${[...new Set([r.cuisine, ...cuisines, "Other"])].filter(Boolean).map((c) => `<option ${c === r.cuisine ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
          <label class="f">Serves<input id="edServ" type="number" min="1" max="100" value="${esc(r.servings)}"></label>
          <label class="f">Diet<select id="edDiet">${["vegan", "veg", "egg", "nonveg"].map((d) => `<option value="${d}" ${d === r.diet ? "selected" : ""}>${{ vegan: "Vegan", veg: "Vegetarian", egg: "Vegetarian + eggs", nonveg: "Meat or fish" }[d]}</option>`).join("")}</select></label>
          <label class="f">Prep (min)<input id="edPrep" type="number" min="0" value="${esc(r.prep)}"></label>
          <label class="f">Cooking (min)<input id="edCook" type="number" min="0" value="${esc(r.cook)}"></label>
          <label class="f">Spice<select id="edSpice">${[0, 1, 2, 3].map((n) => `<option value="${n}" ${n === Number(r.spice ?? 1) ? "selected" : ""}>${["None", "Mild", "Medium", "Hot"][n]}</option>`).join("")}</select></label>
        </div>
        ${r.timesEstimated ? `<p class="hint">The page didn't give times, so these are estimates — adjust them if you know better.</p>` : ""}
        <div class="fieldset"><span class="lbl">Good for</span><div class="chips">${["breakfast", "lunch", "dinner", "snack", "side", "dessert"].map((m) => `<label class="chip"><input type="checkbox" class="edMeal" value="${m}" ${(r.meals || []).includes(m) ? "checked" : ""}>${C.MEAL_LABEL[m]}</label>`).join("")}</div></div>
        <label class="f">Usually served with<select id="edWith"><option value="">Nothing extra</option>${Object.keys(C.SIDE_RECIPES).map((k) => `<option value="${k}" ${k === r.with ? "selected" : ""}>${esc((recipe(C.SIDE_RECIPES[k]) || {}).name || k)}</option>`).join("")}</select><span class="hint">The planner adds it automatically when you choose “add sides”.</span></label>
        <div class="fieldset"><span class="lbl">Ingredients <span class="hint" style="display:inline">— one per line, with the amount. MealPilot matches each to its ingredient list for prices, nutrition and shopping.</span></span>
          <div id="edIngs">${st.lines.map((x, i) => {
            const ing = x.id && ingredient(x.id);
            return `<div class="ing-edit"><input data-on="ed-line" data-i="${i}" value="${esc(x.text)}" placeholder="e.g. 2 onions, finely chopped" aria-label="Ingredient ${i + 1}">
              <select data-on="ed-match" data-i="${i}" aria-label="Matched ingredient">${ingOptions(x.id)}</select>
              <button class="icon-btn" data-act="ed-del" data-i="${i}" aria-label="Remove ingredient">${icon("x")}</button>
              <span class="m ${ing || !x.text ? "" : "no"}">${ing ? `${esc(ing.name)} · ${x.amount ? esc(C.fmtBase(x.amount, ing)) : "amount not given"}${x.score && x.score < 0.8 ? " — check this match" : ""}` : x.text ? "Not matched — choose an ingredient, or leave it unpriced" : ""}</span></div>`;
          }).join("")}</div>
          <button class="btn ghost sm" data-act="ed-add" style="margin-top:8px">${icon("plus")} Add ingredient</button></div>
        <label class="f">Method<textarea id="edSteps" style="min-height:180px" placeholder="One step per line">${esc((r.steps || []).join("\n"))}</textarea></label>
        <label class="f">Picture (optional)<input id="edImg" type="url" value="${esc(r.image || "")}" placeholder="https://… link to a photo"></label>
      </div>
      <div class="sheet-foot" style="justify-content:space-between">${r.id && !r.builtIn ? `<button class="btn ghost warn sm" data-act="ed-delete" style="color:var(--chilli);border-color:var(--chilli);background:none">Delete recipe</button>` : "<span></span>"}
        <div class="row"><button class="btn quiet" data-act="close-sheet">Cancel</button><button class="btn" data-act="ed-save">Save recipe</button></div></div>`;
  };
  sheet(draw, { wide: true });
  const el = () => document.getElementById("sheet");
  const grab = () => {
    const e = el(); if (!e.querySelector("#edName")) return;
    Object.assign(st.r, {
      name: e.querySelector("#edName").value.trim(), cuisine: e.querySelector("#edCuisine").value, servings: Number(e.querySelector("#edServ").value) || 4,
      diet: e.querySelector("#edDiet").value, prep: Number(e.querySelector("#edPrep").value) || 0, cook: Number(e.querySelector("#edCook").value) || 0,
      spice: Number(e.querySelector("#edSpice").value), with: e.querySelector("#edWith").value, image: e.querySelector("#edImg").value.trim(),
      meals: [...e.querySelectorAll(".edMeal:checked")].map((x) => x.value), steps: e.querySelector("#edSteps").value.split("\n").map((x) => x.trim()).filter(Boolean),
    });
  };
  const redraw = () => { grab(); const y = el().scrollTop; draw(el()); el().scrollTop = y; };
  ON["ed-line"] = (input) => {
    const i = Number(input.dataset.i), p = C.parseIngredientLine(input.value, S.cat, { aliases: {} });
    st.lines[i] = p ? Object.assign(p, { text: input.value }) : { text: input.value };
    const row = input.closest(".ing-edit"), ing = p && p.id && ingredient(p.id);
    row.querySelector("select").value = p && p.id ? p.id : "";
    const m = row.querySelector(".m");
    m.className = "m " + (ing || !input.value ? "" : "no");
    m.textContent = ing ? `${ing.name} · ${p.amount ? C.fmtBase(p.amount, ing) : "amount not given"}` : input.value ? "Not matched — choose an ingredient, or leave it unpriced" : "";
    if (st.r.diet !== "nonveg" || !st.r.id) { const auto = C.dietOf({ ingredients: st.lines }, S.cat); el().querySelector("#edDiet").value = auto; }
  };
  ON["ed-match"] = async (sel) => {
    const i = Number(sel.dataset.i), line = st.lines[i] || { text: "" };
    if (sel.value === "__new") {
      const name = await ask({ title: "New ingredient", text: "It'll be added to your household's ingredient list so it can go on shopping lists and get prices from bills.", input: { label: "Name", value: line.name || line.text }, ok: "Add" });
      if (!name) { draw(el()); return; }
      const { result } = commit({ type: "addIngredient", name, unit: /\b(ml|litre|l)\b/.test(line.text) ? "ml" : line.u === "pc" || line.u == null ? "pc" : "g" }, { quiet: true });
      if (result) { const ing = ingredient(result); line.id = result; line.amount = Math.round(C.toBase(line.q || 1, line.u, ing) * 100) / 100; }
      st.lines[i] = line;
      openEditorAgain();
      return;
    }
    line.id = sel.value || null;
    const ing = line.id && ingredient(line.id);
    line.amount = ing ? Math.round(C.toBase(line.q ?? 1, line.u || (ing.unit === "pc" ? "pc" : null), ing) * 100) / 100 : 0;
    line.score = 1;
    st.lines[i] = line; redraw();
  };
  const openEditorAgain = () => { grab(); sheet(draw, { wide: true }); };
  ACT["ed-add"] = () => { st.lines.push({ text: "" }); redraw(); const inputs = el().querySelectorAll("[data-on=ed-line]"); inputs[inputs.length - 1].focus(); };
  ACT["ed-del"] = (b) => { st.lines.splice(Number(b.dataset.i), 1); redraw(); };
  ACT["ed-delete"] = async () => {
    if (!(await ask({ title: "Delete this recipe?", text: "Menus that use it will show it as removed.", ok: "Delete", danger: true }))) return openEditorAgain();
    commit({ type: "deleteRecipe", id: st.r.id }); toast("Recipe deleted.");
  };
  ACT["ed-save"] = () => {
    grab();
    const r = st.r;
    if (!r.name) { toast("Give the recipe a name.", true); return; }
    if (!r.meals.length) { toast("Pick at least one meal it's good for.", true); return; }
    const ingredients = st.lines.filter((x) => (x.text || "").trim()).map((x) => ({ id: x.id || null, q: x.q ?? null, u: x.u || null, amount: x.amount || 0, name: x.id ? "" : (x.name || x.text), note: x.note || "", text: x.text, opt: !!x.opt, absorb: x.absorb }));
    if (!ingredients.length) { toast("Add at least one ingredient.", true); return; }
    const payload = { id: r.builtIn ? undefined : r.id, name: r.name, cuisine: r.cuisine, meals: r.meals, servings: r.servings, prep: r.prep, cook: r.cook, timesEstimated: r.timesEstimated && false,
      diet: r.diet, spice: r.spice, tags: r.tags || [], with: r.with, ingredients, steps: r.steps, image: r.image, source: r.source || null };
    const { result, error } = commit({ type: "saveRecipe", recipe: payload });
    if (error) return;
    closeSheet(); toast("Recipe saved.");
    if (result) setTimeout(() => openRecipe(result), 50);
  };
}

/* ---------- the dish picker used by the planner and suggestions ---------- */
export function pickRecipe({ title = "Choose a dish", meal = "", onPick, note = "" }) {
  const st = { q: "", meal, cuisine: "", diet: S.doc.settings.diet === "any" ? "" : S.doc.settings.diet };
  const draw = (el) => {
    const list = filtered({ q: st.q, meal: st.meal, cuisine: st.cuisine, diet: st.diet, time: "", only: "", sort: "name", sides: st.meal === "side" });
    el.innerHTML = `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      ${note ? `<p class="sub" style="margin-bottom:8px">${esc(note)}</p>` : ""}
      <input type="search" id="pkQ" placeholder="Search dishes" value="${esc(st.q)}" autofocus>
      <div class="filters"><select id="pkMeal"><option value="">Any meal</option>${["breakfast", "lunch", "dinner", "snack", "side", "dessert"].map((m) => `<option value="${m}" ${m === st.meal ? "selected" : ""}>${C.MEAL_LABEL[m]}</option>`).join("")}</select>
        <select id="pkCuisine"><option value="">All cuisines</option>${cuisinesInUse().map((c) => `<option ${c === st.cuisine ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
      <div class="rlist" id="pkList">${list.slice(0, 80).map((x) => recipeCard(x, "pick-this")).join("") || `<div class="empty" style="grid-column:1/-1"><h3>No dishes match</h3></div>`}</div>`;
    const q = el.querySelector("#pkQ");
    q.addEventListener("input", () => { st.q = q.value; const l = filtered({ q: st.q, meal: st.meal, cuisine: st.cuisine, diet: st.diet, time: "", only: "", sort: "name", sides: st.meal === "side" }); el.querySelector("#pkList").innerHTML = l.slice(0, 80).map((x) => recipeCard(x, "pick-this")).join("") || `<div class="empty" style="grid-column:1/-1"><h3>No dishes match</h3></div>`; });
    el.querySelector("#pkMeal").onchange = (e) => { st.meal = e.target.value; draw(el); };
    el.querySelector("#pkCuisine").onchange = (e) => { st.cuisine = e.target.value; draw(el); };
  };
  sheet(draw, { wide: true });
  ACT["pick-this"] = (el) => { closeSheet(); onPick(el.dataset.id); };
}
