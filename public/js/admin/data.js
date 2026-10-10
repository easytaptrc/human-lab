// Acceso a datos del panel con caché simple por colección.
import { db, collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "../firebase.js";
import { todayStr, daysBetween, portalKey } from "../utils.js";

const cache = {};

export async function getAll(name, { force = false } = {}) {
  if (!force && cache[name]) return cache[name];
  const snap = await getDocs(collection(db, name));
  cache[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return cache[name];
}
export function invalidate(...names) { names.forEach((n) => delete cache[n]); }

export const MODULES = [
  { key: "inicio", label: "Inicio", icon: "home" },
  { key: "reservas", label: "Reservas", icon: "calendar" },
  { key: "socios", label: "Miembros", icon: "users" },
  { key: "servicios", label: "Servicios y cupos", icon: "dumbbell" },
  { key: "planes", label: "Planes y precios", icon: "tag" },
  { key: "reportes", label: "Reportes", icon: "chart" },
  { key: "mensajes", label: "Mensajes", icon: "chat" },
  { key: "notificaciones", label: "Notificaciones", icon: "bell" },
  { key: "sitio", label: "Configuración del sitio", icon: "palette", group: "Configuración" },
  { key: "personal", label: "Personal y permisos", icon: "shield", group: "Configuración" },
];

export const NOTIFY_DEFAULTS = {
  expiringDays: 5,
  inactiveDays: 45,
  tplReminder: "Hola {nombre}, te recordamos tu cita de {servicio} hoy a las {hora} en Human Prime Lab. Por favor confirma tu asistencia aquí: {enlace}",
  tplExpiring: "Hola {nombre}, tu membresía {plan} de Human Prime Lab vence el {vence}. Renueva a tiempo y sigue entrenando sin pausas.",
  tplExpired: "Hola {nombre}, tu membresía de Human Prime Lab venció el {vence}. ¡Te extrañamos! Escríbenos para renovarla.",
  tplPromo: "Hola {nombre}, hace tiempo que no te vemos en Human Prime Lab. Tenemos una promoción especial para tu regreso. ¡Escríbenos!",
};

export async function getNotifySettings() {
  const snap = await getDoc(doc(db, "settings", "notify"));
  return { ...NOTIFY_DEFAULTS, ...(snap.exists() ? snap.data() : {}) };
}

export function memberState(mb, today = todayStr()) {
  if (!mb.endDate) return { key: "sin", label: "Sin membresía", cls: "dot-muted" };
  if (mb.endDate < today) return { key: "vencida", label: "Vencida", cls: "dot-bad" };
  const left = daysBetween(today, mb.endDate);
  if (left <= 7) return { key: "porvencer", label: left === 0 ? "Vence hoy" : `Vence en ${left} d`, cls: "dot-warn" };
  return { key: "activa", label: "Activa", cls: "" };
}

export function daysInactive(mb, today = todayStr()) {
  const ref = mb.lastVisit || mb.startDate;
  return ref ? daysBetween(ref, today) : null;
}

// Mantiene el documento público del socio (portal/{llave}) sincronizado con su ficha.
export async function syncPortal(mb) {
  const key = await portalKey(mb.memberId, mb.phone);
  let inbox = [];
  if (mb.portalKey && mb.portalKey !== key) {
    try {
      const old = await getDoc(doc(db, "portal", mb.portalKey));
      if (old.exists()) inbox = old.data().inbox || [];
      await deleteDoc(doc(db, "portal", mb.portalKey));
    } catch { /* sin documento previo */ }
  } else {
    const cur = await getDoc(doc(db, "portal", key));
    if (cur.exists()) inbox = cur.data().inbox || [];
  }
  await setDoc(doc(db, "portal", key), {
    memberId: mb.memberId,
    name: mb.name,
    plan: mb.plan || "",
    startDate: mb.startDate || "",
    endDate: mb.endDate || "",
    autoRenew: !!mb.autoRenew,
    lastVisit: mb.lastVisit || "",
    inbox: inbox.slice(-30),
    updatedAt: serverTimestamp(),
  });
  return key;
}

export function siteBase(s) {
  return (s?.siteUrl || location.origin + location.pathname.replace(/[^/]*$/, "")).replace(/\/?$/, "/");
}

export function confirmLink(s, r) {
  const q = new URLSearchParams({ r: r.id, t: r.token, s: r.serviceName, d: r.date, h: r.time });
  return `${siteBase(s)}confirmar.html?${q}`;
}
