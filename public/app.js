// MealPilot app entry: start up, show who's signed in, route between screens.
import { S, boot, route, banner, esc, api, isAdmin, loadLibrary } from "./state.js";
import "./plan.js";
import "./menus.js";
import "./recipes.js";
import "./shop.js";
import "./household.js";

async function header() {
  const who = document.getElementById("who");
  if (S.local) { who.innerHTML = `<span class="hh">On this device</span>`; return; }
  who.innerHTML = `<span class="hh">${esc(S.user.displayName)} · ${esc(S.household ? S.household.name : "")}</span>${isAdmin() || S.user.siteAdmin ? `<a href="/admin.html" id="adminLink">Admin</a>` : ""}`;
  if (isAdmin() || S.user.siteAdmin) {
    let n = 0;
    try {
      if (isAdmin()) { const h = await api("/api/household"); n += h.users.filter((u) => u.membership === "pending" || u.resetRequested).length; }
      if (S.user.siteAdmin) { const s = await api("/api/site"); n += s.households.filter((h) => h.status === "pending").length + (s.unverified || []).length + (s.help || []).filter((x) => x.status === "open").length; }
    } catch {}
    if (n) document.getElementById("adminLink").insertAdjacentHTML("beforeend", `<span class="badge" title="Waiting for you">${n}</span>`);
  }
}

(async () => {
  if (!(await boot())) return;
  header();
  banner();
  window.addEventListener("hashchange", route);
  route();
  loadLibrary();
  // Keyboard: Enter/Space on clickable rows.
  document.addEventListener("keydown", (e) => {
    const el = e.target.closest && e.target.closest('[role=button][data-act]');
    if (el && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.click(); }
  });
  if ("serviceWorker" in navigator && !S.local) navigator.serviceWorker.register("/sw.js").catch(() => {});
})();
