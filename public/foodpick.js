// The "which foods" tick-list, shared by the Recipes filter and the planner settings.
// Each picker has a scope; the screen registers how to read and change its state: { off: [type keys], vegan: bool }.
import { C, ON, ACT, esc } from "./state.js";

const SCOPES = {};
const open = {};
export function registerPicker(scope, get, set) { SCOPES[scope] = { get, set }; }

const SEA = () => C.FOOD_TYPES.filter((t) => t.group === "seafood");
const short = (t) => t.label.replace(/ \(.*\)$/, "");
export const PRESETS = {
  all: () => [],
  none: () => C.FOOD_TYPES.map((t) => t.k),
  veg: () => C.FOOD_TYPES.filter((t) => t.k !== "veg").map((t) => t.k),
  egg: () => C.FOOD_TYPES.filter((t) => t.k !== "veg" && t.k !== "egg").map((t) => t.k),
  pesc: () => C.FOOD_TYPES.filter((t) => t.k !== "veg" && t.k !== "egg" && t.group !== "seafood").map((t) => t.k),
};
// Older "diet" settings (vegetarian, + eggs, vegan) expressed as a tick-list.
export function fromDiet(diet) {
  if (diet === "vegan") return { off: [], vegan: true };
  if (diet === "veg") return { off: PRESETS.veg(), vegan: false };
  if (diet === "egg") return { off: PRESETS.egg(), vegan: false };
  return { off: [], vegan: false };
}
// Foods switched off because every ingredient of that kind is on a "leave out" list (e.g. "no beef").
export function offFromAvoid(avoid) {
  const a = new Set(avoid || []);
  return C.FOOD_TYPES.filter((t) => t.ids.length && t.ids.every((id) => a.has(id))).map((t) => t.k);
}
export function pickerLabel({ off, vegan }) {
  if (vegan) return "Vegan only";
  const offS = new Set(off), on = C.FOOD_TYPES.filter((t) => !offS.has(t.k));
  if (!off.length) return "Any food";
  if (!on.length) return "Nothing selected";
  if (on.length === 1) return short(on[0]) + " only";
  const same = (keys) => keys.length === off.length && keys.every((k) => offS.has(k));
  if (same(PRESETS.egg())) return "Vegetarian + eggs";
  if (same(PRESETS.pesc())) return "Vegetarian + fish";
  // Name what's left out, with all of seafood as one word: "No beef, pork or seafood".
  const sea = SEA(), allSea = sea.every((t) => offS.has(t.k));
  const names = C.FOOD_TYPES.filter((t) => offS.has(t.k) && !(allSea && t.group === "seafood")).map((t) => short(t).toLowerCase());
  if (allSea) names.push("seafood");
  if (names.length <= 3) return "No " + (names.length > 1 ? names.slice(0, -1).join(", ") + " or " + names[names.length - 1] : names[0]);
  if (on.length <= 3) { const n = on.map((t) => (t.k === "veg" ? "vegetarian" : short(t).toLowerCase())); return "Only " + (n.length > 1 ? n.slice(0, -1).join(", ") + " & " + n[n.length - 1] : n[0]); }
  return `${on.length} of ${C.FOOD_TYPES.length} foods`;
}
export function pickerHTML(scope, state, { label = "Foods to include" } = {}) {
  const off = new Set(state.off), dis = state.vegan ? "disabled" : "";
  const box = (t) => `<label style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;font-weight:400"><input type="checkbox" data-on="ftype" value="${t.k}" ${off.has(t.k) ? "" : "checked"} ${dis}> ${esc(t.label)}</label>`;
  const sea = SEA(), seaOn = sea.filter((t) => !off.has(t.k)).length;
  return `<details class="multi" data-scope="${scope}" ${open[scope] ? "open" : ""}><summary aria-label="${esc(label)}">${esc(pickerLabel(state))}</summary><div class="pop">
    ${C.FOOD_TYPES.filter((t) => !t.group).map(box).join("")}
    <label style="display:flex;align-items:center;gap:8px;padding:5px 0;margin-top:4px;font-weight:400"><input type="checkbox" data-on="ftype-sea" ${seaOn === sea.length ? "checked" : ""} ${dis}> <b>Seafood</b> <span class="sub small">${seaOn === sea.length ? "all" : seaOn ? `${seaOn} of ${sea.length}` : "none"}</span></label>
    <div style="padding-left:26px">${sea.map(box).join("")}</div>
    <hr style="margin:8px 0">
    <label style="display:flex;align-items:flex-start;gap:8px;padding:5px 0;font-weight:400"><input type="checkbox" data-on="fvegan" ${state.vegan ? "checked" : ""}> Vegan only (no dairy, eggs or honey)</label>
    <div class="row" style="margin-top:8px"><button type="button" class="btn quiet sm" data-act="fpreset" data-p="all">Select all</button><button type="button" class="btn quiet sm" data-act="fpreset" data-p="none">Clear all</button><button type="button" class="btn quiet sm" data-act="fpreset" data-p="veg">Vegetarian</button><button type="button" class="btn quiet sm" data-act="fpreset" data-p="egg">Veg + eggs</button><button type="button" class="btn quiet sm" data-act="fpreset" data-p="pesc">Veg + fish</button></div>
  </div></details>`;
}
// Update a picker in place (keeps it open and keeps keyboard focus).
function sync(el, state) {
  const off = new Set(state.off), sea = SEA(), seaOn = sea.filter((t) => !off.has(t.k)).length;
  el.querySelector("summary").textContent = pickerLabel(state);
  el.querySelectorAll("[data-on=ftype]").forEach((x) => { x.checked = !off.has(x.value); x.disabled = !!state.vegan; });
  const s = el.querySelector("[data-on=ftype-sea]");
  s.checked = seaOn === sea.length; s.indeterminate = seaOn > 0 && seaOn < sea.length; s.disabled = !!state.vegan;
  s.parentElement.querySelector(".sub").textContent = seaOn === sea.length ? "all" : seaOn ? `${seaOn} of ${sea.length}` : "none";
  el.querySelector("[data-on=fvegan]").checked = !!state.vegan;
}
function change(el, fn) {
  const box = el.closest(".multi"), sc = box && SCOPES[box.dataset.scope];
  if (!sc) return;
  const cur = sc.get(), next = { off: [...cur.off], vegan: !!cur.vegan };
  fn(next);
  next.off = [...new Set(next.off)];
  sc.set(next);
  sync(box, next);
}
ON["ftype"] = (el) => change(el, (s) => { s.off = el.checked ? s.off.filter((k) => k !== el.value) : [...s.off, el.value]; });
ON["ftype-sea"] = (el) => change(el, (s) => { const sea = SEA().map((t) => t.k); s.off = el.checked ? s.off.filter((k) => !sea.includes(k)) : [...s.off, ...sea]; });
ON["fvegan"] = (el) => change(el, (s) => { s.vegan = el.checked; });
ACT["fpreset"] = (el) => change(el, (s) => { s.off = PRESETS[el.dataset.p](); s.vegan = false; });
document.addEventListener("toggle", (e) => { if (e.target.classList && e.target.classList.contains("multi")) open[e.target.dataset.scope] = e.target.open; }, true);
document.addEventListener("click", (e) => {
  for (const p of document.querySelectorAll(".multi[open]")) if (!p.contains(e.target)) { p.open = false; open[p.dataset.scope] = false; }
});
