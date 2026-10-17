/* Theme picker: Auto (follows the phone), Light, Dark and pastel colours.
   Load it in <head> (not deferred) so the page never flashes the wrong colours:
     <script src="theme.js" data-app="mealpilot"></script>
   The choice is kept on this device. Each app's CSS defines :root[data-theme="…"] for every theme below. */
(function () {
  var me = document.currentScript;
  var APP = (me && me.getAttribute("data-app")) || "app";
  var KEY = APP + "-theme";
  var THEMES = [
    { k: "auto", label: "Auto", hint: "Follows your phone", sw: ["#ffffff", "#1c1c1c"] },
    { k: "light", label: "Light", sw: ["#ffffff", "#e9ecea"] },
    { k: "dark", label: "Dark", sw: ["#1d2226", "#0f1316"], dark: true },
    { k: "mint", label: "Mint", sw: ["#e3f4ec", "#2e7d62"] },
    { k: "lavender", label: "Lavender", sw: ["#ebe5f8", "#5b4a9e"] },
    { k: "peach", label: "Peach", sw: ["#fbe6db", "#a8542e"] },
    { k: "sky", label: "Sky", sw: ["#e1eefa", "#2d6a9f"] },
    { k: "rose", label: "Rose", sw: ["#f8e2e8", "#a43d5f"] },
    { k: "lemon", label: "Lemon", sw: ["#f5efcc", "#7a6512"] }
  ];
  function read() { try { return localStorage.getItem(KEY) || "auto"; } catch (e) { return "auto"; } }
  function valid(k) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].k === k) return true; return false; }
  function apply(k) {
    if (!valid(k)) k = "auto";
    var root = document.documentElement;
    if (k === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", k);
    // Phone status-bar colour follows the page background.
    setTimeout(function () {
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); }
      if (!m.getAttribute("data-orig")) m.setAttribute("data-orig", m.getAttribute("content") || "");
      var bar = getComputedStyle(root).getPropertyValue("--theme-bar").trim();
      m.setAttribute("content", bar || m.getAttribute("data-orig"));
    }, 0);
    return k;
  }
  function set(k) {
    k = apply(k);
    try { if (k === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, k); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent("themechange", { detail: k })); } catch (e) {}
  }
  apply(read());
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(read()); });

  var CSS = ".thm-pop{position:fixed;z-index:9999;inset:auto 12px 12px 12px;max-width:420px;margin:0 auto;background:var(--thm-card,#fff);color:var(--thm-ink,#222);" +
    "border:1px solid var(--thm-line,#ddd);border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,.25);padding:16px;font:15px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}" +
    "@media(min-width:700px){.thm-pop{inset:70px 16px auto auto;width:360px}}" +
    ".thm-pop h3{margin:0 0 10px;font-size:1.05rem}" +
    ".thm-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}" +
    ".thm-opt{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:12px;border:2px solid transparent;background:none;color:inherit;font:inherit;font-size:.85rem;cursor:pointer;min-height:44px}" +
    ".thm-opt[aria-pressed=true]{border-color:currentColor;font-weight:700}" +
    ".thm-sw{width:40px;height:40px;border-radius:50%;border:1px solid rgba(0,0,0,.15);box-shadow:inset 0 0 0 1px rgba(255,255,255,.4)}" +
    ".thm-close{margin-top:12px;width:100%;min-height:44px;border-radius:10px;border:1px solid var(--thm-line,#ddd);background:none;color:inherit;font:inherit;cursor:pointer}" +
    ".thm-back{position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.25)}";
  function open() {
    close();
    if (!document.getElementById("thm-css")) { var st = document.createElement("style"); st.id = "thm-css"; st.textContent = CSS; document.head.appendChild(st); }
    var back = document.createElement("div"); back.className = "thm-back"; back.onclick = close;
    var pop = document.createElement("div"); pop.className = "thm-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Colour theme");
    var cur = read(), html = "<h3>Colour theme</h3><div class='thm-grid'>";
    for (var i = 0; i < THEMES.length; i++) {
      var t = THEMES[i];
      html += "<button type='button' class='thm-opt' data-k='" + t.k + "' aria-pressed='" + (t.k === cur) + "'>" +
        "<span class='thm-sw' style='background:linear-gradient(135deg," + t.sw[0] + " 0 50%," + t.sw[1] + " 50% 100%)'></span>" + t.label + "</button>";
    }
    html += "</div><button type='button' class='thm-close'>Done</button>";
    pop.innerHTML = html;
    pop.onclick = function (e) {
      var b = e.target.closest ? e.target.closest("[data-k]") : null;
      if (b) { set(b.getAttribute("data-k")); var all = pop.querySelectorAll("[data-k]"); for (var j = 0; j < all.length; j++) all[j].setAttribute("aria-pressed", all[j] === b); return; }
      if (e.target.className === "thm-close") close();
    };
    document.body.appendChild(back); document.body.appendChild(pop);
    var first = pop.querySelector("[aria-pressed=true]") || pop.querySelector("button"); if (first) first.focus();
    document.addEventListener("keydown", esc);
  }
  function esc(e) { if (e.key === "Escape") close(); }
  function close() {
    var p = document.querySelector(".thm-pop"), b = document.querySelector(".thm-back");
    if (p) p.remove(); if (b) b.remove();
    document.removeEventListener("keydown", esc);
  }
  window.AppTheme = { themes: THEMES, get: read, set: set, open: open, close: close };
})();
