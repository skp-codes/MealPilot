// Runs in front of every page. Sends anyone without a valid login cookie to /login.html,
// forces a password change after an admin reset, and keeps /admin.html for admins only.

const COOKIE = "mp_session";

export default async (request, context) => {
  const url = new URL(request.url);
  const secret = (Netlify.env.get("SESSION_SECRET") || "").trim();
  if (secret.length < 16) {
    const why = secret ? `SESSION_SECRET is too short (${secret.length} characters) — use at least 32 random characters, then redeploy.`
      : "SESSION_SECRET isn’t visible to the site. Check it exists, its scopes include Functions, it applies to Production, and redeploy after adding it.";
    return new Response("Site locked: " + why, {
      status: 503, headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const session = await readSession(request, secret);
  if (!session) {
    const next = encodeURIComponent(url.pathname + url.search);
    return Response.redirect(new URL(`/login.html?next=${next}`, url), 302);
  }
  if (session.mc) return Response.redirect(new URL("/login.html?mode=change", url), 302);
  if (url.pathname.startsWith("/admin") && session.r !== "admin" && !session.sa) return Response.redirect(new URL("/", url), 302);

  const res = await context.next();
  res.headers.set("cache-control", "no-store");
  return res;
};

async function readSession(request, secret) {
  const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [body, sig] = m[1].split(".");
  if (!body || !sig) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  if (!safeEqual(toB64Url(mac), sig)) return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(fromB64Url(body)));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function toB64Url(bytes) {
  let s = ""; bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64Url(str) {
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const config = { path: "/*", excludedPath: ["/login.html", "/api/*", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/icons/*"] };
