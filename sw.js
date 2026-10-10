// Service worker: permite instalar la app y abrirla aunque falle la conexión.
// Estrategia "red primero": siempre muestra la versión más nueva y usa la copia guardada solo sin internet.
const CACHE = "hpl-v1";
const SHELL = [
  "./", "./index.html", "./reservar.html", "./miembro.html", "./confirmar.html", "./admin.html",
  "./css/base.css", "./css/index.css", "./css/reservar.css", "./css/miembro.css", "./css/admin.css",
  "./js/firebase.js", "./js/site.js", "./js/utils.js", "./js/logo.js",
  "./js/index.js", "./js/reservar.js", "./js/miembro.js", "./js/confirmar.js",
  "./assets/img/portada.jpg", "./assets/icons/icon-192.png", "./assets/icons/icon-512.png",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Solo archivos propios; Firebase y demás servicios externos van directo a la red.
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
