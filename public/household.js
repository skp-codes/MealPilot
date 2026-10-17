// Household: the people you cook for (portions, diets, goals, dislikes), household settings, account links and data export.
import { S, C, ACT, CURRENCIES, screen, sheet, closeSheet, commit, toast, esc, icon, ingredient, me, isAdmin, api, ask, downloadText, store, go } from "./state.js";

const PORTIONS = [[0.5, "Toddler (½ portion)"], [0.75, "Child (¾ portion)"], [1, "Adult (1 portion)"], [1.25, "Teen / hungry (1¼)"], [1.5, "Big appetite (1½)"]];
function portionFor(age) { if (age == null || age === "") return 1; age = Number(age); return age < 4 ? 0.5 : age < 11 ? 0.75 : age < 13 ? 1 : age < 19 ? 1.25 : 1; }

screen("home", (el) => {
  const s = S.doc.settings;
  const priced = Object.keys(S.doc.prices).length;
  el.innerHTML = `<div class="head"><div><h1>${esc(S.household ? S.household.name : "Household")}</h1><p>${S.local ? "Stored on this device only." : `Signed in as ${esc(S.user.displayName)} (@${esc(S.user.username)})${isAdmin() ? " · household admin" : ""}`}</p></div></div>
    <div class="card"><div class="head" style="margin-bottom:6px"><div><h2>People you cook for</h2><p>Portion sizes set how much to cook and buy. Diets, goals and dislikes shape menus when they're eating.</p></div>
      <button class="btn sm" data-act="diner-new">${icon("plus")} Add someone</button></div>
      ${S.doc.diners.length ? S.doc.diners.map((d) => `<div class="menu-item" data-act="diner-edit" data-id="${esc(d.id)}" role="button" tabindex="0"><div><h3>${esc(d.name)}${d.username ? ` <span class="sub small">@${esc(d.username)}</span>` : ""}</h3>
        <p class="sub">${d.age != null ? `${d.age} years · ` : ""}${(PORTIONS.find((p) => p[0] === Number(d.portion)) || [0, `${d.portion} portions`])[1]}${d.diet && d.diet !== "any" ? ` · ${C.DIETS[d.diet]}` : ""}${(d.goals || []).length ? ` · ${d.goals.map((g) => C.GOALS[g]).join(", ")}` : ""}${(d.avoid || []).length ? ` · no ${d.avoid.map((a) => (ingredient(a) ? ingredient(a).name.toLowerCase() : a)).join(", ")}` : ""}</p></div>
        <span class="sub">${icon("edit") ? "Edit" : ""}</span></div>`).join("") : `<div class="empty"><h3>Nobody yet</h3><p>Add the people you cook for so MealPilot knows how much to make.</p></div>`}
      <p class="sub small" style="margin-top:10px">Together that's <b>${C.fmtNum(S.doc.diners.reduce((a, d) => a + (Number(d.portion) || 1), 0))}</b> portions per meal.</p></div>
    <div class="card"><h2>Household settings</h2>${isAdmin() ? "" : `<p class="sub" style="margin-top:4px">Only a household admin can change these.</p>`}
      <div class="grid3" style="margin-top:12px">
        <label class="f">Currency<select id="hsCur" ${isAdmin() ? "" : "disabled"}>${Object.entries(CURRENCIES).map(([k, c]) => `<option value="${k}" ${k === s.currency ? "selected" : ""}>${c.symbol} ${esc(c.name)}</option>`).join("")}</select><span class="hint">Starter price estimates follow it. Prices from bills stay as scanned.</span></label>
        <label class="f">Week starts on<select id="hsWeek" ${isAdmin() ? "" : "disabled"}>${[[1, "Monday"], [0, "Sunday"], [6, "Saturday"]].map(([v, l]) => `<option value="${v}" ${v === Number(s.weekStart) ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="f">Usual diet<select id="hsDiet" ${isAdmin() ? "" : "disabled"}>${[["any", "Anything"], ["egg", "Vegetarian + eggs"], ["veg", "Vegetarian"], ["vegan", "Vegan"]].map(([v, l]) => `<option value="${v}" ${v === s.diet ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      <div class="fieldset"><span class="lbl">Meals you usually plan</span><div class="chips">${C.MEALS.map((m) => `<label class="chip"><input type="checkbox" class="hsMeal" value="${m}" ${s.meals.includes(m) ? "checked" : ""} ${isAdmin() ? "" : "disabled"}>${C.MEAL_LABEL[m]}</label>`).join("")}</div></div>
      <div class="row" style="margin-top:12px;gap:18px"><label class="row" style="gap:8px"><input type="checkbox" id="hsSides" ${s.sides ? "checked" : ""} ${isAdmin() ? "" : "disabled"}> Add rice, roti or sides automatically</label>
        <label class="row" style="gap:8px"><input type="checkbox" id="hsLeft" ${s.leftovers ? "checked" : ""} ${isAdmin() ? "" : "disabled"}> Plan dinner leftovers for lunch</label></div>
      ${isAdmin() ? `<div class="row end" style="margin-top:14px"><button class="btn" data-act="hs-save">Save settings</button></div>` : ""}</div>
    <div class="card"><h2>Account</h2><div class="stack" style="margin-top:10px">
      ${S.local ? `<p class="sub">This copy isn't signed in. On the MealPilot website you can create a household, invite everyone and share menus and the shopping list.</p>` : `
      <div class="row"><a class="btn quiet sm" href="/login.html?mode=account">Email address</a><a class="btn quiet sm" href="/login.html?mode=change">Change password</a>${isAdmin() || S.user.siteAdmin ? `<a class="btn quiet sm" href="/admin.html">Admin: invite people & approve requests</a>` : ""}<a class="btn quiet sm" href="/login.html?mode=help">Contact the site admin</a></div>
      <div><button class="btn ghost sm" data-act="logout">Log out</button></div>`}
    </div></div>
    <div class="card"><h2>Your data</h2><p class="sub" style="margin-top:4px">${S.doc.recipes.length} household recipes · ${S.doc.menus.length} menus · ${priced} ingredient prices from ${S.doc.receipts.length} bill${S.doc.receipts.length === 1 ? "" : "s"}.</p>
      <div class="row" style="margin-top:10px"><button class="btn quiet sm" data-act="export">Download a backup (JSON)</button>${S.local ? `<label class="btn quiet sm">Restore a backup<input type="file" accept="application/json,.json" id="restoreFile" hidden></label>` : ""}</div></div>
    <p class="sub small" style="text-align:center;margin:20px 0">MealPilot · nutrition and starter prices are estimates. Imported recipes stay credited to the sites they came from.</p>`;
  const rf = el.querySelector("#restoreFile");
  if (rf) rf.addEventListener("change", async () => {
    try { const doc = JSON.parse(await rf.files[0].text()); if (!doc || !Array.isArray(doc.menus)) throw new Error(); if (!(await ask({ title: "Replace what's on this device with the backup?", ok: "Restore", danger: true }))) return;
      store.set("localdoc", doc); location.reload(); } catch { toast("That file isn't a MealPilot backup.", true); }
  });
});
ACT["hs-save"] = () => {
  const g = (id) => document.getElementById(id);
  const meals = [...document.querySelectorAll(".hsMeal:checked")].map((x) => x.value);
  if (!meals.length) { toast("Pick at least one meal.", true); return; }
  const cur = g("hsCur").value;
  commit({ type: "setSettings", settings: { currency: cur, weekStart: Number(g("hsWeek").value), diet: g("hsDiet").value, meals, sides: g("hsSides").checked, leftovers: g("hsLeft").checked } });
  toast("Settings saved.");
};
ACT["logout"] = async () => { try { await api("/api/logout", { body: {} }); } catch {} location.href = "/login.html"; };
ACT["export"] = () => downloadText(`mealpilot-${(S.household && S.household.name) || "backup"}-${C.isoDate()}.json`, JSON.stringify(S.doc, null, 1));
ACT["diner-new"] = () => dinerDialog(null);
ACT["diner-edit"] = (el) => dinerDialog(S.doc.diners.find((d) => d.id === el.dataset.id));
function dinerDialog(d) {
  const st = d ? structuredClone(d) : { name: "", age: null, portion: 1, diet: "any", goals: [], avoid: [] };
  const canEdit = !d || isAdmin() || d.createdBy === me() || (d.username && d.username.toLowerCase() === me().toLowerCase());
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>${d ? esc(d.name) : "Add someone"}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      ${canEdit ? "" : `<p class="msg warn" style="margin-bottom:10px">Only a household admin or ${esc(d.name)} can change this.</p>`}
      <div class="grid2"><label class="f">Name<input id="dnName" value="${esc(st.name)}" ${d ? "" : "autofocus"}></label>
        <label class="f">Age (optional)<input id="dnAge" type="number" min="0" max="120" value="${esc(st.age ?? "")}"><span class="hint">Under-13s get milder, kid-friendly picks.</span></label></div>
      <label class="f" style="margin-top:10px">Portion size<select id="dnPortion">${PORTIONS.map(([v, l]) => `<option value="${v}" ${v === Number(st.portion) ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f" style="margin-top:10px">Diet<select id="dnDiet">${[["any", "Eats anything"], ["egg", "Vegetarian + eggs"], ["veg", "Vegetarian"], ["vegan", "Vegan"]].map(([v, l]) => `<option value="${v}" ${v === st.diet ? "selected" : ""}>${l}</option>`).join("")}</select>
        <span class="hint">Menus follow the household's diet setting; this is shown so whoever plans knows.</span></label>
      <div class="fieldset"><span class="lbl">Goals</span><div class="chips">${Object.entries(C.GOALS).map(([k, l]) => `<label class="chip"><input type="checkbox" class="dnGoal" value="${k}" ${st.goals.includes(k) ? "checked" : ""}>${l}</label>`).join("")}</div></div>
      <label class="f" style="margin-top:10px">Won't eat<input id="dnAvoid" value="${esc(st.avoid.map((a) => (ingredient(a) ? ingredient(a).name : a)).join(", "))}" placeholder="e.g. mushrooms, prawns"><span class="hint">Separate with commas. Menus leave these out when this person is eating.</span></label>
      <div class="sheet-foot" style="justify-content:space-between">${d && (isAdmin() || d.createdBy === me()) ? `<button class="btn ghost sm" style="color:var(--chilli);border-color:var(--chilli)" data-act="dn-del">Remove</button>` : "<span></span>"}
        ${canEdit ? `<button class="btn" data-act="dn-save">Save</button>` : ""}</div>`;
    const age = el.querySelector("#dnAge");
    age.addEventListener("change", () => { if (!d) el.querySelector("#dnPortion").value = String(portionFor(age.value)); });
  });
  ACT["dn-save"] = () => {
    const e = document.getElementById("sheet");
    const avoid = [];
    for (const w of e.querySelector("#dnAvoid").value.split(",").map((x) => x.trim()).filter(Boolean)) { const m = C.matchIngredient(w, S.cat, { min: 0.6 }); if (m) avoid.push(m.id); }
    const diner = Object.assign(st, { name: e.querySelector("#dnName").value.trim(), age: e.querySelector("#dnAge").value === "" ? null : Number(e.querySelector("#dnAge").value),
      portion: Number(e.querySelector("#dnPortion").value), diet: e.querySelector("#dnDiet").value, goals: [...e.querySelectorAll(".dnGoal:checked")].map((x) => x.value), avoid });
    if (!diner.name) { toast("Enter a name.", true); return; }
    const { error } = commit({ type: "saveDiner", diner });
    if (!error) { closeSheet(); toast("Saved."); }
  };
  ACT["dn-del"] = async () => { if (await ask({ title: `Remove ${d.name}?`, text: d.username ? "Their login stays — this only removes them from the people you cook for." : "", ok: "Remove", danger: true })) commit({ type: "removeDiner", id: d.id }); };
}
