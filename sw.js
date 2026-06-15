/* GeoGuess service worker — installable PWA + offline app shell.
 *
 * Network-first for same-origin requests (so a new deploy is always picked up
 * when online), with a cache fallback for offline. Cross-origin requests
 * (Google Maps / Street View / tiles) always go straight to the network. */
const CACHE = "geoguess-v9";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=9",
  "./game.js?v=9",
  "./config.js?v=9",
  "./locations.js?v=9",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-180.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return; // Google etc. → network
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
  );
});
