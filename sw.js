// Offline cache. Bump VERSION whenever a file below changes, so phones pick up the new build.
const VERSION = "felt-12";
const FILES = ["./", "index.html", "fonts.css", "style.css", "engine.js", "data.js", "table.js", "coach.js", "app.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
// GitHub Pages lets browsers keep files for 10 minutes, so always go past that cache ("reload" / "no-cache"),
// otherwise a phone opened right after a deploy keeps showing the old build.
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first (so a deploy shows up next launch), cache when offline.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== self.location.origin) return; // never cache GitHub API calls
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
