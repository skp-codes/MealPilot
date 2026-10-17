// Menus: everyone's weekly menus, the review flow (agree / suggest changes / owner decides), and saved favourites.
import { S, C, ACT, screen, sheet, closeSheet, commit, toast, esc, money, mins, icon, recipe, me, isAdmin, go, ask, nameOf, members } from "./state.js";
import { boardHTML, summaryHTML, loadIntoPlanner, statusLabel } from "./plan.js";
import { pickRecipe } from "./recipes.js";

const endOf = (m) => C.addDays(m.start, m.days - 1);
function menuRow(m) {
  const votes = Object.values(m.votes || {});
  const agree = votes.filter((v) => v.v === "agree").length, open = (m.suggestions || []).filter((s) => s.status === "open").length;
  const needsMe = m.status === "review" && m.createdBy !== me() && !(m.votes || {})[me()];
  return `<div class="menu-item" data-act="open-menu" data-id="${esc(m.id)}" role="button" tabindex="0">
    <div><h3>${esc(m.name)} ${needsMe ? `<span class="pill warn">Your turn</span>` : ""}</h3>
      <p class="sub">${C.dayLabel(m.start)} – ${C.dayLabel(endOf(m))} · ${m.meals.map((x) => C.MEAL_LABEL[x]).join(", ")} · by ${esc(m.createdBy === me() ? "you" : nameOf(m.createdBy))}</p>
      ${m.status === "review" ? `<p class="sub small">${agree} agreed${open ? ` · ${open} suggestion${open > 1 ? "s" : ""} waiting` : ""}</p>` : ""}</div>
    <div style="text-align:right"><span class="pill ${m.status}">${statusLabel(m.status)}</span><p class="sub small" style="margin-top:4px">${money(C.planCost(m.slots, S.byId, S.cat, S.pricer))}</p></div></div>`;
}
screen("menus", (el, sub) => {
  if (sub) { const m = S.doc.menus.find((x) => x.id === sub); if (m) return detail(el, m); }
  const today = C.isoDate();
  const visible = S.doc.menus.filter((m) => m.status !== "draft" || m.createdBy === me());
  const needs = visible.filter((m) => m.status === "review" && m.createdBy !== me() && !(m.votes || {})[me()] && endOf(m) >= today);
  const current = visible.filter((m) => !needs.includes(m) && endOf(m) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const past = visible.filter((m) => endOf(m) < today).sort((a, b) => b.start.localeCompare(a.start));
  const favs = S.doc.favorites.slice().sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `<div class="head"><div><h1>Menus</h1><p>Anyone in the household can make a menu. Others can agree or suggest changes; whoever made it decides.</p></div>
      <a class="btn" href="#plan">${icon("plus")} New menu</a></div>
    ${needs.length ? `<div class="card" style="border-color:var(--turmeric)"><h2>Waiting for your opinion</h2>${needs.map(menuRow).join("")}</div>` : ""}
    <div class="card"><h2>This week and coming up</h2>${current.length ? current.map(menuRow).join("") : `<div class="empty"><h3>No menus yet</h3><p>Plan one on the <a href="#plan">Plan</a> tab — it takes a minute.</p></div>`}</div>
    <div class="card"><div class="head" style="margin-bottom:4px"><div><h2>Favourites</h2><p>Weeks and days you've saved to use again.</p></div></div>
      ${favs.length ? favs.map((f) => `<div class="menu-item" style="cursor:default"><div><h3>${esc(f.name)}</h3><p class="sub">${f.kind === "day" ? "One day" : `${f.days} days`} · ${f.meals.map((x) => C.MEAL_LABEL[x]).join(", ")} · for ${C.fmtNum(f.people)} · saved by ${esc(f.createdBy === me() ? "you" : nameOf(f.createdBy))}</p>
        <p class="sub small">${[...new Set(f.slots.flatMap((s) => s.dishes.filter((x) => !x.side).map((x) => (recipe(x.r) || {}).name)).filter(Boolean))].slice(0, 6).map(esc).join(", ")}…</p></div>
        <div class="row" style="align-items:flex-start"><button class="btn sm" data-act="fav-use" data-id="${esc(f.id)}">Use</button>${f.createdBy === me() || isAdmin() ? `<button class="icon-btn" data-act="fav-rename" data-id="${esc(f.id)}" aria-label="Rename">${icon("edit")}</button><button class="icon-btn" data-act="fav-del" data-id="${esc(f.id)}" aria-label="Delete">${icon("x")}</button>` : ""}</div></div>`).join("")
        : `<p class="sub">Nothing saved yet. Open a menu and choose “Save to favourites” — a whole week or just a good day.</p>`}</div>
    ${past.length ? `<details class="card"><summary>Past menus (${past.length})</summary>${past.slice(0, 40).map(menuRow).join("")}</details>` : ""}`;
});
ACT["open-menu"] = (el) => go("menus", el.dataset.id);

function detail(el, m) {
  const mineM = m.createdBy === me();
  const people = [...members().entries()].filter(([u]) => u !== m.createdBy.toLowerCase());
  const myVote = (m.votes || {})[me()];
  const open = (m.suggestions || []).filter((s) => s.status === "open");
  const done = (m.suggestions || []).filter((s) => s.status !== "open");
  el.innerHTML = `<div class="row no-print" style="margin-bottom:8px"><a class="btn ghost sm" href="#menus">${icon("back")} Menus</a></div>
    <div class="head"><div><h1>${esc(m.name)}</h1><p>${C.dayLabel(m.start, "long")} – ${C.dayLabel(endOf(m), "long")} · for ${C.fmtNum(m.people)} · made by ${esc(mineM ? "you" : nameOf(m.createdBy))} <span class="pill ${m.status}">${statusLabel(m.status)}</span></p></div>
      <div class="row no-print">${mineM ? `<button class="btn quiet sm" data-act="menu-edit">${icon("edit")} Edit dishes</button><button class="btn quiet sm" data-act="menu-rename">Rename</button>` : ""}
        <button class="btn sm" data-act="menu-shop">Make shopping list</button></div></div>
    ${mineM ? ownerBar(m, open) : reviewerBar(m, myVote)}
    ${summaryHTML(m, m.req && m.req.budget)}
    <div class="board">${boardHTML(m, { mode: "view", canSuggest: !mineM && m.status !== "draft", suggestions: m.suggestions || [] })}</div>
    ${m.status !== "draft" ? `<div class="card" style="margin-top:16px"><h2>Who agrees</h2><div class="votes" style="margin-top:10px">${people.length ? people.map(([u, name]) => { const v = (m.votes || {})[u] || Object.entries(m.votes || {}).find(([k]) => k.toLowerCase() === u)?.[1];
        return `<span class="vote ${v ? v.v : ""}">${v ? (v.v === "agree" ? "✓" : "✎") : "…"} ${esc(name)}${v && v.note ? ` — “${esc(v.note)}”` : ""}${!v ? " (not yet)" : ""}</span>`; }).join("") : `<p class="sub">Only you are in this household so far. Invite others from Admin → My household.</p>`}</div></div>` : ""}
    ${open.length || done.length ? `<div class="card"><h2>Suggestions</h2>${open.map((s) => suggestionRow(m, s, mineM)).join("")}${done.length ? `<details style="margin-top:10px"><summary class="sub">Decided (${done.length})</summary>${done.map((s) => suggestionRow(m, s, false)).join("")}</details>` : ""}</div>` : ""}
    <div class="card"><h2>Comments</h2>${(m.comments || []).map((c) => `<div class="comment"><b>${esc(c.by === me() ? "You" : c.name || nameOf(c.by))}</b> <span class="sub small">${new Date(c.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span><p>${esc(c.text)}</p></div>`).join("") || `<p class="sub">No comments yet.</p>`}
      <div class="row no-print" style="margin-top:10px;flex-wrap:nowrap"><input id="cmText" placeholder="Write a comment"><button class="btn" data-act="menu-comment">Post</button></div></div>
    <div class="row no-print" style="margin-bottom:24px"><button class="btn quiet sm" data-act="menu-fav">Save week to favourites</button><button class="btn quiet sm" data-act="menu-favday">Save a day to favourites</button>
      <button class="btn quiet sm" data-act="menu-again">Plan this again</button><button class="btn quiet sm" data-act="menu-print">Print</button>
      ${mineM || isAdmin() ? `<button class="btn ghost sm" style="color:var(--chilli);border-color:var(--chilli)" data-act="menu-delete">Delete</button>` : ""}</div>`;
  const cm = el.querySelector("#cmText");
  if (cm) cm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ACT["menu-comment"](); } });
  CUR = m.id;
}
let CUR = null;
const cur = () => S.doc.menus.find((x) => x.id === CUR);
function ownerBar(m, open) {
  if (m.status === "draft") return `<div class="msg warn no-print" style="margin-bottom:14px">Only you can see this draft. <button class="btn sm" style="margin-left:6px" data-act="menu-status" data-s="review">Share for comments</button> <button class="btn quiet sm" data-act="menu-status" data-s="final">Make it final</button></div>`;
  if (m.status === "review") return `<div class="msg warn no-print" style="margin-bottom:14px">${open.length ? `${open.length} suggestion${open.length > 1 ? "s" : ""} to decide on below. ` : "Waiting for the household's thoughts. "}When you're happy, make it final. <button class="btn sm" style="margin-left:6px" data-act="menu-status" data-s="final">Make it final</button></div>`;
  return `<div class="msg no-print" style="margin-bottom:14px">This menu is final. <button class="link" data-act="menu-status" data-s="review">Reopen for comments</button></div>`;
}
function reviewerBar(m, v) {
  if (m.status === "final") return `<div class="msg no-print" style="margin-bottom:14px">This menu is final. You can still comment.</div>`;
  return `<div class="msg warn no-print" style="margin-bottom:14px">${v ? (v.v === "agree" ? "You agreed to this menu." : "You asked for changes.") : `${esc(nameOf(m.createdBy))} would like your thoughts.`}
    <div class="row" style="margin-top:8px"><button class="btn sm" data-act="menu-vote" data-v="agree">${v && v.v === "agree" ? "✓ Agreed" : "Looks good — I agree"}</button><button class="btn quiet sm" data-act="menu-vote" data-v="change">Ask for changes</button>
    <span class="sub small">Or press “Suggest” on any meal.</span></div></div>`;
}
function suggestionRow(m, s, canDecide) {
  const r = s.r && recipe(s.r);
  const slotNow = m.slots.find((x) => x.d === s.d && x.m === s.m);
  const nowR = slotNow && slotNow.dishes[0] && recipe(slotNow.dishes[0].r);
  return `<div class="comment"><b>${esc(s.by === me() ? "You" : s.name)}</b> <span class="sub small">for ${C.dayLabel(C.addDays(m.start, s.d))} ${C.MEAL_LABEL[s.m].toLowerCase()}</span>
    <p>${r ? `Swap ${nowR ? `<b>${esc(nowR.name)}</b>` : "it"} for <button class="link" data-act="plan-open" data-id="${esc(r.id)}">${esc(r.name)}</button>` : ""}${r && s.text ? " — " : ""}${s.text ? `“${esc(s.text)}”` : ""}</p>
    ${s.status !== "open" ? `<p class="sub small">${s.status === "accepted" ? "✓ Accepted" : "Not this time"}${s.reply ? ` — ${esc(s.reply)}` : ""}</p>` : ""}
    ${canDecide ? `<div class="row" style="margin-top:6px"><button class="btn sm" data-act="sugg-accept" data-sid="${esc(s.id)}">${r ? "Accept swap" : "Done"}</button><button class="btn quiet sm" data-act="sugg-decline" data-sid="${esc(s.id)}">Decline</button></div>` : ""}</div>`;
}
ACT["menu-status"] = (b) => { const m = cur(); commit({ type: "setMenuStatus", id: m.id, status: b.dataset.s }); toast(b.dataset.s === "final" ? "Menu is final." : "Shared — the household can comment now."); };
ACT["menu-vote"] = async (b) => {
  const m = cur();
  let note = "";
  if (b.dataset.v === "change") { note = await ask({ title: "What would you change?", text: "You can also press “Suggest” on a particular meal to propose a different dish.", input: { label: "Your note (optional)", placeholder: "e.g. less spicy on Wednesday" }, ok: "Send" }); if (note === null) return; }
  commit({ type: "voteMenu", id: m.id, vote: b.dataset.v, note });
};
ACT["menu-suggest"] = (b) => {
  const m = cur(); const [d, meal] = b.dataset.key.split("|");
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>Suggest a change for ${C.dayLabel(C.addDays(m.start, Number(d)))} ${C.MEAL_LABEL[meal].toLowerCase()}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <button class="btn wide" data-act="sg-pick">Choose a different dish</button>
      <label class="f" style="margin-top:14px">Or just say what you'd like<input id="sgText" placeholder="e.g. something lighter, or no fish please"></label>
      <div class="sheet-foot"><button class="btn quiet" data-act="sg-text">Send note</button></div>`;
  });
  const send = (r, text) => { commit({ type: "suggest", id: m.id, d: Number(d), m: meal, r, text }); toast(`Sent to ${nameOf(m.createdBy)}.`); };
  ACT["sg-pick"] = () => { const text = document.getElementById("sgText").value.trim(); pickRecipe({ title: "Suggest a dish", meal, onPick: (rid) => send(rid, text) }); };
  ACT["sg-text"] = () => { const text = document.getElementById("sgText").value.trim(); if (!text) { toast("Write a note or choose a dish.", true); return; } closeSheet(); send(null, text); };
};
ACT["sugg-accept"] = (b) => {
  const m = cur(); const s = m.suggestions.find((x) => x.id === b.dataset.sid);
  const r = s && s.r && recipe(s.r);
  const sides = r && r.with && C.SIDE_RECIPES[r.with] && (m.req ? m.req.sides !== false : true) ? [C.SIDE_RECIPES[r.with]] : [];
  commit({ type: "resolveSuggestion", id: m.id, sid: b.dataset.sid, accept: true, sides });
  toast(r ? `Swapped in ${r.name}.` : "Marked as done.");
};
ACT["sugg-decline"] = async (b) => {
  const reply = await ask({ title: "Decline this suggestion?", input: { label: "Reason (optional)", placeholder: "e.g. we had it last week" }, ok: "Decline" });
  if (reply === null) return;
  commit({ type: "resolveSuggestion", id: cur().id, sid: b.dataset.sid, accept: false, reply });
};
ACT["menu-comment"] = () => { const t = document.getElementById("cmText"); if (!t.value.trim()) return; commit({ type: "commentMenu", id: cur().id, text: t.value.trim() }); t.value = ""; };
ACT["menu-edit"] = () => loadIntoPlanner(cur(), { asNew: false });
ACT["menu-again"] = async () => {
  const m = cur();
  const start = await ask({ title: "Plan this menu again", text: "It opens on the Plan tab so you can change anything before saving.", input: { label: "Starting on", type: "date", value: C.nextWeekday(C.isoDate(), S.doc.settings.weekStart ?? 1, true) }, ok: "Open" });
  if (start) loadIntoPlanner(m, { asNew: true, start });
};
ACT["menu-rename"] = async () => { const m = cur(); const name = await ask({ title: "Rename menu", input: { label: "Name", value: m.name }, ok: "Rename" }); if (name && name.trim()) commit({ type: "updateMenu", id: m.id, menu: { name: name.trim() } }); };
ACT["menu-delete"] = async () => { const m = cur(); if (!(await ask({ title: `Delete “${m.name}”?`, text: "Its comments and suggestions go too. Items already on the shopping list stay.", ok: "Delete", danger: true }))) return; commit({ type: "deleteMenu", id: m.id }); go("menus"); };
ACT["menu-print"] = () => window.print();
ACT["menu-shop"] = () => go("shop", "build/" + cur().id);
ACT["menu-fav"] = async () => {
  const m = cur();
  const name = await ask({ title: "Save to favourites", text: "Saved menus can be reused any week from the Menus tab.", input: { label: "Name", value: m.name }, ok: "Save" });
  if (!name) return;
  commit({ type: "saveFavorite", name, kind: "week", days: m.days, meals: m.meals, people: m.people, slots: m.slots, fromMenu: m.id }); toast("Saved to favourites.");
};
ACT["menu-favday"] = () => {
  const m = cur();
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>Save a day to favourites</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      <label class="f">Which day<select id="fdDay">${Array.from({ length: m.days }, (_, d) => `<option value="${d}">${C.dayLabel(C.addDays(m.start, d))} — ${m.slots.filter((s) => s.d === d).map((s) => (s.dishes[0] && recipe(s.dishes[0].r) || {}).name).filter(Boolean).join(", ")}</option>`).join("")}</select></label>
      <label class="f" style="margin-top:10px">Name<input id="fdName" placeholder="e.g. Perfect Sunday" autofocus></label>
      <div class="sheet-foot"><button class="btn" data-act="fd-save">Save</button></div>`;
  });
  ACT["fd-save"] = () => {
    const e = document.getElementById("sheet"), d = Number(e.querySelector("#fdDay").value), name = e.querySelector("#fdName").value.trim() || `${C.dayLabel(C.addDays(m.start, d))} favourites`;
    const slots = m.slots.filter((s) => s.d === d).map((s) => Object.assign({}, s, { d: 0, leftover: undefined }));
    commit({ type: "saveFavorite", name, kind: "day", days: 1, meals: m.meals, people: m.people, slots, fromMenu: m.id }); closeSheet(); toast("Day saved to favourites.");
  };
};
ACT["fav-use"] = async (b) => {
  const f = S.doc.favorites.find((x) => x.id === b.dataset.id);
  const start = await ask({ title: `Use “${f.name}”`, text: "It opens on the Plan tab so you can adjust it before saving.", input: { label: "Starting on", type: "date", value: f.kind === "day" ? C.isoDate() : C.nextWeekday(C.isoDate(), S.doc.settings.weekStart ?? 1, true) }, ok: "Open" });
  if (start) loadIntoPlanner(f, { asNew: true, start });
};
ACT["fav-rename"] = async (b) => { const f = S.doc.favorites.find((x) => x.id === b.dataset.id); const name = await ask({ title: "Rename", input: { label: "Name", value: f.name }, ok: "Rename" }); if (name && name.trim()) commit({ type: "renameFavorite", id: f.id, name: name.trim() }); };
ACT["fav-del"] = async (b) => { const f = S.doc.favorites.find((x) => x.id === b.dataset.id); if (await ask({ title: `Delete “${f.name}”?`, ok: "Delete", danger: true })) commit({ type: "deleteFavorite", id: f.id }); };
