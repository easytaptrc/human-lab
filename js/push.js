// Notificaciones push (Firebase Cloud Messaging) para clientes, socios y personal.
// Requiere la "clave VAPID" de Firebase guardada en Configuración del sitio → Notificaciones.
import { app } from "./firebase.js";
import { store } from "./utils.js";

const FCM = "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
const TOKEN_KEY = "hpl_push_token";

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
  return refreshToken(vapidKey);
}

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
