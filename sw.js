// Offline cache for the app shell. Bump VERSION when files change.
const VERSION = "v21";
const SHELL = [
  "./", // not "index.html": hosts like Cloudflare redirect it to "./", and Safari refuses redirected pages
  "styles.css",
  "app.js",
  "icons.js",
  "suggest.js",
  "voice.js",
  "data/hsk.json",
  "vendor/pinyin-pro.js",
  "manifest.webmanifest",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (!sameOrigin && !isFont) return; // translation / speech requests go straight to the network

  // network first for our own files (so updates show up), cache as fallback offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if ((res.ok && !res.redirected) || res.type === "opaque") {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || (e.request.mode === "navigate" ? caches.match("./") : Response.error())))
  );
});
