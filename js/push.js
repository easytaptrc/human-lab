// Notificaciones push (Firebase Cloud Messaging) para clientes, socios y personal.
// Requiere la "clave VAPID" de Firebase guardada en Configuración del sitio → Notificaciones.
import { app, db, doc, setDoc, deleteDoc, serverTimestamp } from "./firebase.js";
import { store, sha256 } from "./utils.js";

const FCM = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
const TOKEN_KEY = "hpl_push_token";
const OFF_KEY = "hpl_push_off"; // cuándo la persona las desactivó con la campana
const PROMPT_KEY = "hpl_push_prompt"; // cuándo se le preguntó por última vez

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

// Estado del dispositivo: "ready" (activado), "ask" (se puede pedir), "install" (iPhone: falta agregar a inicio),
// "denied" (bloqueado por el usuario), "off" (no disponible).
export function pushState(vapidKey) {
  if (!vapidKey || !("serviceWorker" in navigator) || !window.isSecureContext) return "off";
  if (isIOS() && !isStandalone()) return "install";
  if (!("Notification" in window) || !("PushManager" in window)) return "off";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && store.get(TOKEN_KEY)) return "ready";
  return "ask";
}

export function savedToken() { return store.get(TOKEN_KEY); }

async function registration() {
  const reg = await navigator.serviceWorker.register("sw.js");
  await navigator.serviceWorker.ready;
  return reg;
}

// Pide permiso (debe llamarse desde un toque del usuario) y devuelve el token del dispositivo.
export async function enablePush(vapidKey) {
  if (pushState(vapidKey) === "off" || pushState(vapidKey) === "install") return null;
  const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (perm !== "granted") return null;
  const token = await refreshToken(vapidKey);
  if (token) {
    store.del(OFF_KEY);
    subscribe(token);
  }
  return token;
}

// Lista general de personas con notificaciones (para promociones). La llave es el hash del token.
async function subscribe(token) {
  try {
    const platform = isIOS() ? "ios" : /android/i.test(navigator.userAgent) ? "android" : "web";
    await setDoc(doc(db, "subscribers", await sha256(token)), { token, platform, createdAt: serverTimestamp() });
  } catch { /* ya estaba suscrito */ }
}

// Desactiva las notificaciones en este dispositivo: el token deja de servir en todo el sistema.
export async function disablePush(vapidKey) {
  const token = store.get(TOKEN_KEY);
  try {
    const { getMessaging, getToken, deleteToken, isSupported } = await import(FCM);
    if (await isSupported()) {
      const messaging = getMessaging(app);
      await getToken(messaging, { vapidKey, serviceWorkerRegistration: await registration() }).catch(() => {});
      await deleteToken(messaging);
    }
  } catch (e) {
    console.warn("No se pudo borrar el token:", e.message);
  }
  if (token) await deleteDoc(doc(db, "subscribers", await sha256(token))).catch(() => {});
  store.del(TOKEN_KEY);
  store.set(OFF_KEY, Date.now());
}

// ¿Conviene mostrar la pregunta automática al abrir la app?
export function shouldPrompt(vapidKey) {
  const st = pushState(vapidKey);
  const days = (k) => (Date.now() - (store.get(k) || 0)) / 86400000;
  if (st === "ask") return days(OFF_KEY) > 30 && days(PROMPT_KEY) > 3 ? st : null;
  if (st === "install") return days(PROMPT_KEY) > 7 ? st : null;
  return null;
}
export function markPrompted() { store.set(PROMPT_KEY, Date.now()); }

// Obtiene el token sin pedir permiso (solo si ya se concedió antes).
export async function refreshToken(vapidKey) {
  if (!vapidKey || !("Notification" in window) || Notification.permission !== "granted") return null;
  try {
    const { getMessaging, getToken, isSupported } = await import(FCM);
    if (!(await isSupported())) return null;
    const token = await getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: await registration() });
    if (token) store.set(TOKEN_KEY, token);
    return token || null;
  } catch (e) {
    console.warn("Push no disponible:", e.message);
    return null;
  }
}

// Notificación local inmediata (por ejemplo, al personal con el panel abierto).
// La etiqueta (tag) evita duplicados si también llega el push del servidor.
export async function localNotify(title, body, url, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, icon: "assets/icons/icon-192.png", badge: "assets/icons/favicon-32.png", data: { url } });
    else new Notification(title, { body, icon: "assets/icons/icon-192.png" });
  } catch { /* sin notificaciones */ }
}

export const INSTALL_HINT = "En iPhone: abre esta página en Safari, toca Compartir y luego “Agregar a inicio”. Abre la app desde tu pantalla de inicio para activar los avisos.";
