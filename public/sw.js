// Offline support: the app and its recipe library load from cache when there's no signal (handy in a shop).
// Data and logins always go to the server; the app keeps its own copy of the household data for offline use.
const CACHE = "mealpilot-v1";
const STATIC = ["/app.js", "/app.css", "/theme.js", "/state.js", "/core.js", "/plan.js", "/menus.js", "/recipes.js", "/shop.js", "/household.js",
  "/data/index.js", "/data/ingredients.js", "/data/recipes-indian.js", "/data/recipes-world.js", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(STATIC.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && !res.redirected && (url.pathname === "/" || url.pathname === "/index.html")) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put("/index.html", copy)); }
      return res;
    }).catch(() => caches.match(url.pathname === "/" ? "/index.html" : url.pathname).then((r) => r || caches.match("/index.html"))
      .then((r) => r || new Response("You're offline. Open MealPilot again when you're connected.", { headers: { "content-type": "text/plain; charset=utf-8" } }))));
    return;
  }
  // App files: network first so updates arrive straight away; cached copy when offline.
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; }).catch(() => caches.match(req)));
    return;
  }
  // Fonts and the bill reader: cache first.
  if (/fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }))));
  }
});
