// Vortex offline support. Keeps the site's files on the device so pages that
// have been opened once (Hexdrift included) still work without Wi-Fi.
//  - Pages: always fetched fresh when online; the saved copy is used offline.
//  - /assets/*: file names change with every update, so a saved copy is
//    always right and is used straight away.
// Everything else (sign-in, APIs, uploads, other websites) is never touched.
const PAGES = "vortex-pages-v1";
const ASSETS = "vortex-assets-v1";
const MAX_ASSETS = 160;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== PAGES && k !== ASSETS) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.mode === "navigate") { e.respondWith(page(req)); return; }
  if (url.pathname.startsWith("/assets/")) { e.respondWith(asset(req)); return; }
  if (/^\/(favicon\.svg|logo\.svg|manifest\.webmanifest|icon-\d+\.png)$/.test(url.pathname)) e.respondWith(fresh(req, PAGES));
});

async function page(req) {
  const cache = await caches.open(PAGES);
  try {
    const res = await withTimeout(fetch(req), 6000);
    // Only keep the real page (not a sign-in page or an error).
    if (res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html")) {
      const html = await res.clone().text();
      if (html.includes('<div id="root">')) await cache.put("/", new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
    }
    return res;
  } catch {
    const saved = await cache.match("/");
    if (saved) return saved;
    return new Response("<!doctype html><meta name=viewport content='width=device-width'><p style='font:16px system-ui;padding:24px'>You're offline. Open Vortex once while online to use it offline.</p>", { headers: { "content-type": "text/html" } });
  }
}

async function asset(req) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  const size = Number(res.headers.get("content-length") || 0);
  if (res.ok && res.type === "basic" && size < 8e6) {
    await cache.put(req, res.clone());
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_ASSETS; i++) await cache.delete(keys[i]);
  }
  return res;
}

async function fresh(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) || Response.error();
  }
}

function withTimeout(p, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
