/* sw.js — offline app shell with a network-first strategy so updates
 * always land when the user is online, and the app still works offline. */
var CACHE = "cold-approach-odds-v3";
var ASSETS = [
  "./", "./index.html", "./styles.css",
  "./data.js", "./census.js", "./store.js", "./share.js", "./app.js",
  "./manifest.webmanifest", "./icon.svg"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  // Let cross-origin requests (Census, FCC) go straight to the network.
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  // Network-first: fetch fresh, update the cache, fall back to cache offline.
  e.respondWith(
    fetch(e.request).then(function (resp) {
      var copy = resp.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return resp;
    }).catch(function () {
      return caches.match(e.request);
    })
  );
});
