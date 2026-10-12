// Service worker: app instalable, funciona sin conexión y recibe notificaciones push.
// Estrategia "red primero": siempre muestra la versión más nueva y usa la copia guardada solo sin internet.
const CACHE = "hpl-v2";
const SHELL = [
  "./", "./index.html", "./reservar.html", "./miembro.html", "./confirmar.html", "./admin.html",
  "./css/base.css", "./css/index.css", "./css/reservar.css", "./css/miembro.css", "./css/admin.css",
  "./js/firebase.js", "./js/site.js", "./js/utils.js", "./js/logo.js", "./js/push.js",
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

// ---------- Notificaciones push (Firebase Cloud Messaging, mensajes de datos) ----------
self.addEventListener("push", (e) => {
  let payload = {};
  try { payload = e.data ? e.data.json() : {}; } catch { payload = { body: e.data && e.data.text() }; }
  const d = { ...(payload.notification || {}), ...(payload.data || payload) };
  const opts = {
    body: d.body || "",
    icon: "assets/icons/icon-192.png",
    badge: "assets/icons/favicon-32.png",
    tag: d.tag || undefined,
    renotify: !!d.tag,
    requireInteraction: d.kind === "reminder",
    data: d,
  };
  // Recordatorio de cita: botones para confirmar sin escribir nada
  if (d.kind === "reminder") opts.actions = [{ action: "si", title: "Sí, asistiré" }, { action: "no", title: "No podré ir" }];
  e.waitUntil(self.registration.showNotification(d.title || "Human Prime Lab", opts));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const d = e.notification.data || {};
  let url = d.url || "./index.html";
  if (d.kind === "reminder" && d.r && d.t) {
    const q = new URLSearchParams({ r: d.r, t: d.t, s: d.service || "", d: d.date || "", h: d.time || "" });
    if (e.action === "si") q.set("a", "confirmada");
    if (e.action === "no") q.set("a", "no_asistira");
    url = `./confirmar.html?${q}`;
  }
  const target = new URL(url, self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url === target && "focus" in c) return c.focus();
    }
    return clients.openWindow(target);
  })());
});
