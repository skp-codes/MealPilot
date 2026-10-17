// Shop: the household shopping list, building it from menus, and reading shop bills to learn real prices.
import { S, C, ACT, ON, AISLES, screen, sheet, closeSheet, commit, toast, esc, money, icon, recipe, ingredient, me, isAdmin, go, ask, nameOf, store } from "./state.js";
import { statusLabel } from "./plan.js";

const tabs = [["list", "Shopping list"], ["build", "From a menu"], ["bills", "Bills & prices"]];
screen("shop", (el, sub) => {
  const [t, arg] = (sub || "list").split("/");
  const tab = tabs.some((x) => x[0] === t) ? t : "list";
  el.innerHTML = `<div class="head"><h1>Shop</h1><div class="seg" role="tablist">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${k === tab}" class="${k === tab ? "on" : ""}" data-act="shop-tab" data-t="${k}">${l}</button>`).join("")}</div></div><div id="shopBody"></div>`;
  const body = el.querySelector("#shopBody");
  if (tab === "list") listView(body);
  else if (tab === "build") buildView(body, arg);
  else billsView(body);
});
ACT["shop-tab"] = (b) => go("shop", b.dataset.t);

/* ---------- the list ---------- */
const aisleOf = (it) => (it.ing && ingredient(it.ing) ? ingredient(it.ing).aisle : "other");
const amountText = (it) => { const ing = it.ing && ingredient(it.ing); if (!ing || !it.amount) return ""; const buy = C.packSuggestion(it.amount, ing); return C.fmtBase(it.amount, ing) + (buy && ing.unit !== "pc" ? ` · buy ${buy}` : ""); };
const itemCost = (it) => { const p = it.ing && S.pricer.per(it.ing); return p && it.amount ? p.p * it.amount : null; };
function listView(el) {
  const items = S.doc.list.items;
  const open = items.filter((x) => !x.checked), done = items.filter((x) => x.checked);
  const est = open.reduce((a, x) => a + (itemCost(x) || 0), 0);
  const groups = new Map();
  for (const it of open) { const a = aisleOf(it); if (!groups.has(a)) groups.set(a, []); groups.get(a).push(it); }
  const order = S.cat.aisleOrder;
  const row = (it) => `<div class="item ${it.checked ? "done" : ""}" data-act="li-toggle" data-id="${esc(it.id)}">
    <input type="checkbox" ${it.checked ? "checked" : ""} aria-label="Got ${esc(it.ing && ingredient(it.ing) ? ingredient(it.ing).name : it.name)}" tabindex="-1">
    <div><div class="nm">${esc(it.ing && ingredient(it.ing) ? ingredient(it.ing).name : it.name)}</div><div class="am">${esc(amountText(it))}${it.note ? ` · ${esc(it.note)}` : ""}${it.checked && it.checkedBy && it.checkedBy !== me() ? ` · got by ${esc(nameOf(it.checkedBy))}` : ""}</div></div>
    <span class="pr">${itemCost(it) != null ? money(itemCost(it)) : ""}</span>
    <button class="icon-btn" data-act="li-edit" data-id="${esc(it.id)}" aria-label="Change">${icon("edit")}</button></div>`;
  el.innerHTML = `<div class="card">
    <div class="row between"><div><h2>${open.length ? `${open.length} thing${open.length > 1 ? "s" : ""} to buy` : "Nothing to buy"}</h2>${open.length ? `<p class="sub">About ${money(est)} · shared with everyone in the household</p>` : ""}</div>
      <div class="row">${open.length ? `<button class="btn quiet sm" data-act="li-share">${icon("share")} Share</button>` : ""}<a class="btn quiet sm" href="#shop/build">From a menu</a></div></div>
    <div class="row" style="margin-top:12px;flex-wrap:nowrap"><input id="liAdd" list="liNames" placeholder="Add an item, e.g. bananas"><input id="liAmt" style="max-width:110px" placeholder="Amount" aria-label="Amount, e.g. 500g or 6"><button class="btn" data-act="li-add">Add</button></div>
    <datalist id="liNames">${S.cat.list.filter((i) => !i.free).map((i) => `<option value="${esc(i.name)}">`).join("")}</datalist>
    ${open.length ? [...groups.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])).map(([a, list]) => `<div class="aisle"><h3>${esc(AISLES[a] || "Other")}</h3>${list.map(row).join("")}</div>`).join("")
      : `<div class="empty"><h3>Your list is empty</h3><p>Build it from a menu, or add things above.</p></div>`}
    ${done.length ? `<div class="aisle"><h3>In the basket (${done.length})</h3>${done.map(row).join("")}</div>
      <div class="row" style="margin-top:14px"><button class="btn" data-act="li-finish">Finished shopping</button><button class="btn quiet sm" data-act="li-clear">Clear ticked items</button></div>` : ""}
  </div>`;
  const add = el.querySelector("#liAdd"), amt = el.querySelector("#liAmt");
  [add, amt].forEach((x) => x.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ACT["li-add"](); } }));
}
ACT["li-toggle"] = (el, e) => { if (e.target.closest("[data-act=li-edit]")) return; const it = S.doc.list.items.find((x) => x.id === el.dataset.id); if (it) commit({ type: "listUpdate", id: it.id, checked: !it.checked }, { quiet: true }); };
ACT["li-add"] = () => {
  const name = document.getElementById("liAdd").value.trim(), amtText = document.getElementById("liAmt").value.trim();
  if (!name) return;
  const m = C.matchIngredient(name, S.cat, { min: 0.8 });
  const ing = m && ingredient(m.id);
  let amount = 0;
  if (ing && amtText) { const p = C.parseIngredientLine(`${amtText} ${ing.name}`, S.cat); amount = p && p.id === ing.id ? p.amount : 0; }
  commit({ type: "listAdd", items: [ing ? { id: ing.id, name: ing.name, amount, note: amount ? "" : amtText } : { name, note: amtText }] }, { quiet: true });
  document.getElementById("liAdd").value = ""; document.getElementById("liAmt").value = ""; document.getElementById("liAdd").focus();
};
ACT["li-edit"] = (b) => {
  const it = S.doc.list.items.find((x) => x.id === b.dataset.id); if (!it) return;
  const ing = it.ing && ingredient(it.ing);
  const unit = ing ? (ing.unit === "pc" ? "" : ing.unit) : "";
  sheet((el) => {
    el.innerHTML = `<div class="sheet-head"><h2>${esc(ing ? ing.name : it.name)}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      ${ing ? `<label class="f">Amount${unit ? ` (${unit})` : " (how many)"}<input id="leAmt" type="number" min="0" step="any" value="${esc(Math.round(it.amount * 10) / 10 || "")}"></label>` : `<label class="f">Name<input id="leName" value="${esc(it.name)}"></label>`}
      <label class="f" style="margin-top:10px">Note<input id="leNote" value="${esc(it.note || "")}" placeholder="e.g. the big bag, or brand"></label>
      ${it.from && it.from.length ? `<p class="sub small" style="margin-top:8px">From: ${it.from.map((id) => (S.doc.menus.find((m) => m.id === id) || {}).name).filter(Boolean).map(esc).join(", ")}</p>` : ""}
      <div class="sheet-foot" style="justify-content:space-between"><button class="btn ghost sm" style="color:var(--chilli);border-color:var(--chilli)" data-act="le-del">Remove</button><button class="btn" data-act="le-save">Save</button></div>`;
  });
  ACT["le-save"] = () => {
    const e = document.getElementById("sheet");
    const op = { type: "listUpdate", id: it.id, note: e.querySelector("#leNote").value };
    if (e.querySelector("#leAmt")) op.amount = Number(e.querySelector("#leAmt").value) || 0;
    if (e.querySelector("#leName")) op.name = e.querySelector("#leName").value;
    commit(op, { quiet: true }); closeSheet();
  };
  ACT["le-del"] = () => { commit({ type: "listRemove", id: it.id }, { quiet: true }); closeSheet(); };
};
ACT["li-clear"] = () => commit({ type: "listClear" }, { quiet: true });
ACT["li-finish"] = async () => {
  const yes = await ask({ title: "Done shopping?", text: "Ticked items are cleared from the list. Scan your bill now so MealPilot learns what things really cost — your menu estimates get better every time.", ok: "Scan my bill", cancel: "Not now" });
  commit({ type: "listClear" }, { quiet: true });
  if (yes) go("shop", "bills");
};
ACT["li-share"] = async () => {
  const groups = new Map();
  for (const it of S.doc.list.items.filter((x) => !x.checked)) { const a = AISLES[aisleOf(it)] || "Other"; if (!groups.has(a)) groups.set(a, []); groups.get(a).push(it); }
  const text = "Shopping list\n" + [...groups.entries()].map(([a, l]) => `\n${a}\n` + l.map((it) => `• ${it.ing && ingredient(it.ing) ? ingredient(it.ing).name : it.name}${it.amount && it.ing ? ` — ${C.fmtBase(it.amount, ingredient(it.ing))}` : ""}${it.note ? ` (${it.note})` : ""}`).join("\n")).join("\n");
  try { if (navigator.share) { await navigator.share({ title: "Shopping list", text }); return; } } catch (e) { if (e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(text); toast("List copied — paste it into a message."); } catch { toast("Couldn't share from this browser.", true); }
};

/* ---------- build from a menu ---------- */
const B = { menus: null, sel: {} };
function buildView(el, menuId) {
  const today = C.isoDate();
  const menus = S.doc.menus.filter((m) => (m.status !== "draft" || m.createdBy === me()) && C.addDays(m.start, m.days - 1) >= C.addDays(today, -7))
    .sort((a, b) => ({ final: 0, review: 1, draft: 2 }[a.status] - { final: 0, review: 1, draft: 2 }[b.status]) || a.start.localeCompare(b.start));
  if (menuId && S.doc.menus.some((m) => m.id === menuId)) { B.menus = [menuId]; B.sel = {}; history.replaceState(null, "", "#shop/build"); }
  if (!B.menus || !B.menus.every((id) => menus.some((m) => m.id === id))) { B.menus = menus.length ? [menus[0].id] : []; B.sel = {}; }
  if (!menus.length) { el.innerHTML = `<div class="card"><div class="empty"><h3>No menus to shop for</h3><p>Plan a menu first, then come back to turn it into a shopping list.</p><a class="btn" href="#plan" style="margin-top:12px">Plan meals</a></div></div>`; return; }
  const slots = B.menus.flatMap((id) => (S.doc.menus.find((m) => m.id === id) || { slots: [] }).slots);
  const needs = C.shoppingNeeds(slots, S.byId, S.cat, S.pricer);
  const onList = new Map(); for (const it of S.doc.list.items) if (!it.checked && it.ing) onList.set(it.ing, (onList.get(it.ing) || 0) + (it.amount || 0));
  const haveIds = new Set(B.menus.flatMap((id) => { const m = S.doc.menus.find((x) => x.id === id); return (m && m.req && m.req.have) || []; }));
  for (const n of needs) {
    const key = n.id || "x:" + n.name;
    if (!B.sel[key]) { const have = n.id ? onList.get(n.id) || 0 : 0; B.sel[key] = { on: !n.staple && !haveIds.has(n.id) && !(have >= n.amount * 0.95 && n.amount), amount: n.id ? Math.max(0, Math.round((n.amount - have) * 10) / 10) || n.amount : 0 }; }
  }
  const main = needs.filter((n) => !n.staple), staples = needs.filter((n) => n.staple);
  const chosen = needs.filter((n) => B.sel[n.id || "x:" + n.name].on);
  const total = chosen.reduce((a, n) => { const p = n.id && S.pricer.per(n.id); return a + (p ? p.p * B.sel[n.id].amount : 0); }, 0);
  const unitOf = (n) => (n.unit === "pc" ? "" : n.unit);
  const row = (n) => {
    const key = n.id || "x:" + n.name, s = B.sel[key];
    const ing = n.id && ingredient(n.id);
    const p = n.id && S.pricer.per(n.id);
    const have = n.id && onList.get(n.id);
    return `<div class="need ${s.on ? "" : "off"}"><input type="checkbox" data-on="bd-on" data-k="${esc(key)}" ${s.on ? "checked" : ""} aria-label="Buy ${esc(n.name)}">
      <div><div class="nm">${esc(n.name)}</div><div class="why">${esc(n.display)}${n.buy && ing && ing.unit !== "pc" ? ` · usually ${esc(n.buy)}` : ""}${have ? ` · ${esc(C.fmtBase(have, ing))} already on your list` : ""}${n.id && haveIds.has(n.id) ? " · you said you have this" : ""} · ${esc(n.recipes.slice(0, 3).join(", "))}${n.recipes.length > 3 ? "…" : ""}</div></div>
      ${n.id ? `<label class="row" style="gap:4px;flex-wrap:nowrap"><input type="number" min="0" step="any" data-on="bd-amt" data-k="${esc(key)}" value="${esc(s.amount)}" aria-label="Amount of ${esc(n.name)} to buy"><span class="sub small">${unitOf(n)}</span></label>` : `<span class="sub small">as needed</span>`}
      <span class="pr num small">${p && n.id ? money(p.p * s.amount) : ""}${p && p.src === "bill" ? "" : p ? "<span class='muted'>*</span>" : ""}</span></div>`;
  };
  el.innerHTML = `<div class="card">
    <h2>What do you need to buy?</h2><p class="sub" style="margin-top:4px">Untick anything you already have, or lower the amount. Then add the rest to the shopping list.</p>
    <div class="fieldset"><span class="lbl">For</span><div class="chips">${menus.map((m) => `<label class="chip"><input type="checkbox" data-on="bd-menu" value="${esc(m.id)}" ${B.menus.includes(m.id) ? "checked" : ""}>${esc(m.name)} <span style="opacity:.75">· ${statusLabel(m.status)}</span></label>`).join("")}</div></div>
    ${B.menus.length ? `
    <div style="margin-top:12px">${main.map(row).join("") || `<p class="sub">These menus have no ingredients.</p>`}</div>
    ${staples.length ? `<details style="margin-top:14px"><summary>Pantry staples — tick any you're running low on (${staples.length})</summary><div style="margin-top:6px">${staples.map(row).join("")}</div></details>` : ""}
    <p class="sub small" style="margin-top:10px">* starter price estimate — scan your bills to replace these with real prices.</p>
    <div class="board-foot"><span><b>${chosen.length}</b> items · about <b>${money(total)}</b></span><button class="btn" data-act="bd-add" ${chosen.length ? "" : "disabled"}>Add ${chosen.length} to shopping list</button></div>` : `<p class="sub" style="margin-top:10px">Tick a menu above.</p>`}
  </div>`;
}
ON["bd-menu"] = (el) => { const s = new Set(B.menus); el.checked ? s.add(el.value) : s.delete(el.value); B.menus = [...s]; B.sel = {}; go("shop", "build"); };
ON["bd-on"] = (el) => { B.sel[el.dataset.k].on = el.checked; go("shop", "build"); };
ON["bd-amt"] = (el) => { B.sel[el.dataset.k].amount = Number(el.value) || 0; B.sel[el.dataset.k].on = B.sel[el.dataset.k].amount > 0; };
ACT["bd-add"] = () => {
  const slots = B.menus.flatMap((id) => (S.doc.menus.find((m) => m.id === id) || { slots: [] }).slots);
  const needs = C.shoppingNeeds(slots, S.byId, S.cat, S.pricer);
  const items = needs.filter((n) => B.sel[n.id || "x:" + n.name] && B.sel[n.id || "x:" + n.name].on).map((n) => n.id ? { id: n.id, name: n.name, amount: B.sel[n.id].amount } : { name: n.name, note: "as needed" });
  commit({ type: "listAdd", items, menuId: B.menus.length === 1 ? B.menus[0] : undefined }, { quiet: true });
  toast(`Added ${items.length} items to the shopping list.`);
  B.sel = {}; go("shop", "list");
};

/* ---------- bills: scan or paste, check matches, save prices ---------- */
const R = { stage: "start", img: null, progress: 0, status: "", parsed: null, rows: [], store: "", date: "", total: null, error: "" };
function billsView(el) {
  const unitName = (ing) => (ing.unit === "g" ? "kg" : ing.unit === "ml" ? "litre" : "each");
  const perUnit = (ing, pb) => (ing.unit === "pc" ? pb : pb * 1000);
  const priced = Object.entries(S.doc.prices).map(([id, h]) => ({ ing: ingredient(id), h })).filter((x) => x.ing && x.h.length).sort((a, b) => a.ing.name.localeCompare(b.ing.name));
  el.innerHTML = `<div class="card">${scanPanel()}</div>
    <div class="card"><div class="head" style="margin-bottom:6px"><div><h2>Prices MealPilot knows</h2><p>${priced.length} ingredient${priced.length === 1 ? "" : "s"} priced from your bills · the rest use starter estimates in ${esc(S.doc.settings.currency)}</p></div><button class="btn quiet sm" data-act="price-set">Set a price</button></div>
      ${priced.length ? `<table><thead><tr><th>Ingredient</th><th class="num">Latest</th><th>Where</th><th class="num">Change</th><th></th></tr></thead><tbody>${priced.map(({ ing, h }) => {
        const last = h[h.length - 1], prev = h[h.length - 2];
        const ch = prev ? (last.pb - prev.pb) / prev.pb : 0;
        return `<tr><td>${esc(ing.name)}</td><td class="num">${money(perUnit(ing, last.pb))}<span class="sub small"> /${unitName(ing)}</span></td><td class="small">${esc(last.store || "")}<br><span class="sub">${esc(last.date)}</span></td>
          <td class="num small">${prev ? `<span style="color:${ch > 0.02 ? "var(--chilli)" : ch < -0.02 ? "var(--leaf)" : "var(--muted)"}">${ch > 0 ? "▲" : ch < 0 ? "▼" : ""} ${Math.abs(Math.round(ch * 100))}%</span>` : ""}</td>
          <td><button class="icon-btn" data-act="price-edit" data-id="${esc(ing.id)}" aria-label="Change price">${icon("edit")}</button></td></tr>`; }).join("")}</tbody></table>`
        : `<p class="sub">After your first bill, real prices show up here and in every menu estimate.</p>`}</div>
    ${S.doc.receipts.length ? `<div class="card"><h2>Bills you've added</h2>${S.doc.receipts.slice(0, 30).map((r) => `<div class="menu-item" style="cursor:default"><div><h3>${esc(r.store || "Shop")} · ${esc(r.date)}</h3><p class="sub">${r.lines.filter((l) => l.id).length} prices learned · by ${esc(r.by === me() ? "you" : nameOf(r.by))}</p></div>
      <div class="row"><span class="num">${r.total != null ? money(r.total) : ""}</span>${r.by === me() || isAdmin() ? `<button class="icon-btn" data-act="rc-del" data-id="${esc(r.id)}" aria-label="Delete bill">${icon("x")}</button>` : ""}</div></div>`).join("")}</div>` : ""}`;
  wireScan(el);
}
function scanPanel() {
  if (R.stage === "start") return `<h2>Add a bill</h2><p class="sub" style="margin:4px 0 12px">Take a photo of your till receipt. MealPilot reads it on your phone, matches each line to an ingredient and learns your shop's names for things — after the first few bills it does this by itself.</p>
    <div class="row"><label class="btn">${icon("camera")} Scan a bill<input type="file" accept="image/*" capture="environment" id="rcFile" hidden></label>
      <label class="btn quiet">Choose a photo<input type="file" accept="image/*" id="rcFile2" hidden></label>
      <button class="btn ghost" data-act="rc-paste">Paste receipt text</button></div>
    ${R.error ? `<p class="msg bad" style="margin-top:10px">${esc(R.error)}</p>` : ""}
    <p class="hint" style="margin-top:10px">Tip: lay the receipt flat in good light and fill the photo with it. Long receipts read best in two halves.</p>`;
  if (R.stage === "reading") return `<h2>Reading your bill…</h2>${R.img ? `<img class="preview" src="${R.img}" alt="Your receipt">` : ""}<div class="progress" style="margin-top:10px"><i style="width:${Math.round(R.progress * 100)}%"></i></div><p class="sub small" style="margin-top:6px">${esc(R.status)}</p>`;
  if (R.stage === "paste") return `<h2>Paste receipt text</h2><p class="sub" style="margin:4px 0 10px">For e-receipts from online shopping or a shop's app: copy the text and paste it here.</p>
    <textarea id="rcText" style="min-height:200px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.86rem" placeholder="BASMATI RICE 1KG   2.10&#10;ONIONS 1KG   0.95&#10;…"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" data-act="rc-readtext">Read it</button><button class="btn quiet" data-act="rc-reset">Cancel</button></div>`;
  // review
  const opts = (sel) => `<option value="">— skip —</option>` + S.cat.list.filter((i) => !i.free).slice().sort((a, b) => a.name.localeCompare(b.name)).map((i) => `<option value="${esc(i.id)}" ${i.id === sel ? "selected" : ""}>${esc(i.name)}</option>`).join("");
  const sum = R.rows.reduce((a, r) => a + (Number(r.price) || 0), 0);
  const used = R.rows.filter((r) => r.use && r.id);
  return `<h2>Check the prices</h2><p class="sub" style="margin:4px 0 10px">Ticked lines update prices. Fix any wrong matches once — next time MealPilot remembers your shop's name for it.</p>
    <div class="grid3"><label class="f">Shop<input id="rcStore" value="${esc(R.store)}" placeholder="e.g. Tesco"></label><label class="f">Date<input id="rcDate" type="date" value="${esc(R.date)}"></label>
      <div><span class="sub small">Lines add up to</span><br><b class="num">${money(sum)}</b>${R.total != null ? `<span class="sub small"> · bill total ${money(R.total)}${Math.abs(sum - R.total) > 0.05 ? " — some lines may be missing" : " ✓"}</span>` : ""}</div></div>
    <div style="margin-top:10px">${R.rows.map((r, i) => {
      const ing = r.id && ingredient(r.id);
      return `<div class="scan-line"><input type="checkbox" data-on="rc-use" data-i="${i}" ${r.use ? "checked" : ""} aria-label="Use this line">
        <span class="t">${esc(r.text)}${r.count > 1 ? ` <b>×${r.count}</b>` : ""}<br><span class="conf pill ${r.how === "learned" ? "bill" : r.score >= 0.78 ? "est" : "warn"}">${r.how === "learned" ? "remembered" : r.id ? (r.score >= 0.78 ? "good match" : "check") : "no match"}</span></span>
        <input type="number" step="0.01" min="0" data-on="rc-price" data-i="${i}" value="${esc(r.price)}" aria-label="Price">
        <select class="mt" data-on="rc-id" data-i="${i}" aria-label="Ingredient">${opts(r.id)}</select>
        <label class="qt row" style="gap:4px;flex-wrap:nowrap"><input type="number" min="0" step="any" data-on="rc-qty" data-i="${i}" value="${esc(r.qty ?? "")}" placeholder="amount" aria-label="Amount bought"><span class="sub small">${ing ? (ing.unit === "pc" ? "pcs" : ing.unit) : ""}</span></label></div>`;
    }).join("")}</div>
    ${R.rows.length ? "" : `<p class="msg warn">No item lines found. Try a clearer photo, or paste the text.</p>`}
    <div class="row" style="margin-top:14px"><button class="btn" data-act="rc-save" ${used.length ? "" : "disabled"}>Save ${used.length} price${used.length === 1 ? "" : "s"}</button><button class="btn quiet" data-act="rc-reset">Start again</button></div>
    <p class="hint" style="margin-top:8px">Amounts come from the label (e.g. “1KG”) or the usual pack size — check them so the price per kilo is right.</p>`;
}
function wireScan(el) {
  for (const id of ["rcFile", "rcFile2"]) { const f = el.querySelector("#" + id); if (f) f.addEventListener("change", () => f.files[0] && readImage(f.files[0])); }
}
const listIds = () => S.doc.list.items.map((x) => x.ing).filter(Boolean);
function toReview(text) {
  const parsed = C.parseReceipt(text);
  const rows = C.matchReceipt(parsed, S.cat, S.doc.aliases, listIds());
  Object.assign(R, { stage: "review", parsed, rows, store: parsed.store || R.store || "", date: parsed.date || C.isoDate(), total: parsed.total });
  go("shop", "bills");
}
ACT["rc-paste"] = () => { R.stage = "paste"; R.error = ""; go("shop", "bills"); };
ACT["rc-readtext"] = () => { const t = document.getElementById("rcText").value; if (t.trim().length < 5) { toast("Paste the receipt text first.", true); return; } toReview(t); };
ACT["rc-reset"] = () => { Object.assign(R, { stage: "start", img: null, rows: [], error: "" }); go("shop", "bills"); };
ON["rc-use"] = (el) => { R.rows[el.dataset.i].use = el.checked; refreshSave(); };
ON["rc-price"] = (el) => { R.rows[el.dataset.i].price = Number(el.value) || 0; };
ON["rc-qty"] = (el) => { R.rows[el.dataset.i].qty = Number(el.value) || null; };
ON["rc-id"] = (el) => {
  const r = R.rows[el.dataset.i]; r.id = el.value || null; r.how = "manual"; r.score = 1; r.use = !!r.id;
  const ing = r.id && ingredient(r.id);
  if (ing && !r.qty) { const l = R.parsed.lines[el.dataset.i]; r.qty = l && l.pack && (l.pack.unit === ing.unit) ? l.pack.qty * (r.count || 1) : ing.unit === "pc" ? r.count || 1 : (ing.packs[0] || 1000) * (r.count || 1); }
  grabMeta(); go("shop", "bills");
};
function grabMeta() { const s = document.getElementById("rcStore"), d = document.getElementById("rcDate"); if (s) R.store = s.value; if (d) R.date = d.value; }
function refreshSave() { const b = document.querySelector("[data-act=rc-save]"); const n = R.rows.filter((r) => r.use && r.id).length; if (b) { b.textContent = `Save ${n} price${n === 1 ? "" : "s"}`; b.disabled = !n; } }
ACT["rc-save"] = () => {
  grabMeta();
  const lines = R.rows.map((r) => ({ key: r.key, text: r.text, id: r.use ? r.id : null, price: r.price, qty: r.qty, count: r.count, learn: r.use && !!r.id }));
  const bad = R.rows.filter((r) => r.use && r.id && !(r.qty > 0));
  if (bad.length) { toast(`Enter how much you bought for: ${bad.map((r) => r.text).slice(0, 3).join(", ")}.`, true); return; }
  commit({ type: "applyReceipt", store: R.store, date: R.date, total: R.total, lines });
  const n = lines.filter((l) => l.id).length;
  Object.assign(R, { stage: "start", img: null, rows: [], error: "" });
  toast(`Updated ${n} price${n === 1 ? "" : "s"}. Menu costs now use them.`);
};
ACT["rc-del"] = async (b) => { if (await ask({ title: "Delete this bill?", text: "Prices learned from it are removed too.", ok: "Delete", danger: true })) commit({ type: "deleteReceipt", id: b.dataset.id }); };
ACT["price-edit"] = (b) => priceDialog(b.dataset.id);
ACT["price-set"] = () => priceDialog(null);
function priceDialog(id) {
  sheet((el) => {
    const ing = id && ingredient(id);
    el.innerHTML = `<div class="sheet-head"><h2>${ing ? esc(ing.name) : "Set a price"}</h2><button class="icon-btn" data-act="close-sheet" aria-label="Close">${icon("x")}</button></div>
      ${ing ? "" : `<label class="f">Ingredient<input id="pdName" list="pdNames" placeholder="Start typing…" autofocus><datalist id="pdNames">${S.cat.list.filter((i) => !i.free).map((i) => `<option value="${esc(i.name)}">`).join("")}</datalist></label>`}
      <div class="grid2" style="margin-top:10px"><label class="f">Price paid (${esc(S.doc.settings.currency)})<input id="pdPrice" type="number" min="0" step="0.01" ${ing ? "autofocus" : ""}></label>
        <label class="f">For how much<input id="pdQty" placeholder="e.g. 1kg, 500g, 2 litres, 6"></label></div>
      <label class="f" style="margin-top:10px">Shop (optional)<input id="pdStore"></label>
      <div class="sheet-foot" style="justify-content:space-between">${ing ? `<button class="btn ghost sm" data-act="pd-clear">Forget bill prices</button>` : "<span></span>"}<button class="btn" data-act="pd-save">Save</button></div>`;
    ACT["pd-save"] = () => {
      const target = ing || ingredient((C.matchIngredient(el.querySelector("#pdName").value, S.cat, { min: 0.8 }) || {}).id);
      if (!target) { toast("Pick an ingredient from the list.", true); return; }
      const p = C.parseIngredientLine(`${el.querySelector("#pdQty").value || "1"} ${target.name}`, S.cat);
      const qty = p && p.id === target.id ? p.amount : 0;
      const price = Number(el.querySelector("#pdPrice").value);
      if (!(price > 0) || !(qty > 0)) { toast("Enter the price and how much it was for.", true); return; }
      commit({ type: "setPrice", id: target.id, price, qty, store: el.querySelector("#pdStore").value });
      closeSheet(); toast(`${target.name} price saved.`);
    };
    ACT["pd-clear"] = () => { commit({ type: "clearPrices", id }); closeSheet(); toast("Back to the starter estimate."); };
  });
}

/* ---------- reading a photo on the phone (Tesseract, loaded only when needed) ---------- */
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";
function loadScript(src) {
  return new Promise((res, rej) => { if (window.Tesseract) return res(); const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the bill reader. Check your connection and try again.")); document.head.appendChild(s); });
}
async function prepare(file) {
  const url = URL.createObjectURL(file);
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("That file isn't a picture MealPilot can read.")); i.src = url; });
  const scale = Math.min(1, 2200 / Math.max(img.width, img.height));
  const c = document.createElement("canvas"); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {                 // greyscale + contrast: receipts are faint thermal print
    let v = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    v = Math.max(0, Math.min(255, (v - 128) * 1.6 + 140));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  URL.revokeObjectURL(url);
  return c;
}
async function readImage(file) {
  Object.assign(R, { stage: "reading", progress: 0.02, status: "Getting the picture ready…", error: "", img: null });
  go("shop", "bills");
  try {
    const canvas = await prepare(file);
    R.img = canvas.toDataURL("image/jpeg", 0.6); R.status = "Loading the bill reader (first time only)…"; R.progress = 0.08; go("shop", "bills");
    await loadScript(TESSERACT);
    const worker = await window.Tesseract.createWorker("eng", 1, {
      logger: (m) => { if (m.status === "recognizing text") { R.progress = 0.2 + m.progress * 0.8; R.status = `Reading the text… ${Math.round(m.progress * 100)}%`; } else { R.status = m.status ? m.status[0].toUpperCase() + m.status.slice(1) + "…" : R.status; R.progress = Math.max(R.progress, 0.1 + (m.progress || 0) * 0.1); }
        const bar = document.querySelector(".progress>i"), st = document.querySelector("#shopBody .sub.small"); if (bar) bar.style.width = Math.round(R.progress * 100) + "%"; if (st) st.textContent = R.status; },
    });
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });
    const { data } = await worker.recognize(canvas);
    await worker.terminate();
    toReview(data.text || "");
  } catch (err) {
    Object.assign(R, { stage: "start", error: err.message || "Couldn't read that bill." });
    go("shop", "bills");
  }
}
