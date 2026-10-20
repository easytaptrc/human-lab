// Acceso a datos del panel con caché simple por colección.
import { db, collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from "../firebase.js";
import { todayStr, daysBetween, portalKey, addDays, addMonths } from "../utils.js";

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
  { key: "acceso", label: "Escanear acceso", short: "Escanear", icon: "id" },
  { key: "reservas", label: "Reservas", icon: "calendar" },
  { key: "socios", label: "Miembros", icon: "users" },
  { key: "servicios", label: "Servicios y cupos", short: "Servicios", icon: "dumbbell" },
  { key: "planes", label: "Planes y precios", short: "Planes", icon: "tag" },
  { key: "reportes", label: "Reportes", icon: "chart" },
  { key: "mensajes", label: "Mensajes", icon: "chat" },
  { key: "notificaciones", label: "Notificaciones", icon: "bell" },
  { key: "sitio", label: "Configuración del sitio", short: "Mi sitio", icon: "palette", group: "Configuración" },
  { key: "personal", label: "Personal y permisos", short: "Personal", icon: "shield", group: "Configuración" },
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

// ---------- Planes: unidades de duración ----------
export const UNITS = {
  dias: ["día", "días"],
  semanas: ["semana", "semanas"],
  quincenas: ["quincena", "quincenas"],
  meses: ["mes", "meses"],
  anios: ["año", "años"],
  visitas: ["visita", "visitas"], // paquete de visitas con vigencia en días
};

export function planDuration(p) {
  const n = Number(p.amount) || 1;
  const [one, many] = UNITS[p.unit] || UNITS.meses;
  const base = `${n} ${n === 1 ? one : many}`;
  return p.unit === "visitas" ? `${base} · vigencia ${Number(p.validDays) || 30} días` : base;
}

export function planEnd(p, start) {
  if (!p || !start) return "";
  const n = Number(p.amount) || 1;
  switch (p.unit) {
    case "dias": return addDays(start, n);
    case "semanas": return addDays(start, n * 7);
    case "quincenas": return addDays(start, n * 15);
    case "anios": return addMonths(start, n * 12);
    case "visitas": return addDays(start, Number(p.validDays) || 30);
    default: return addMonths(start, n);
  }
}

// ---------- Varios planes por socio ----------
// mb.plans = [{ id, planId, plan, unit, startDate, endDate, autoRenew, visitsTotal?, visitsLeft? }]
export function memberPlans(mb) {
  if (Array.isArray(mb.plans)) return mb.plans;
  if (mb.planId || mb.plan || mb.endDate) {
    return [{ id: "p1", planId: mb.planId || "", plan: mb.plan || "", startDate: mb.startDate || "", endDate: mb.endDate || "", autoRenew: !!mb.autoRenew }];
  }
  return [];
}

// Un plan de visitas sin visitas restantes deja de contar como vigente.
export function planUsable(e, today = todayStr()) {
  return !!e.endDate && e.endDate >= today && (e.visitsLeft == null || e.visitsLeft > 0);
}
const effectiveEnd = (e) => (e.visitsLeft === 0 ? e.exhaustedOn || e.endDate : e.endDate) || "";

// Campos resumen (plan, inicio, vencimiento) que usan listas, reportes, avisos y el panel del socio.
export function planSummary(plans, today = todayStr()) {
  const usable = plans.filter((e) => planUsable(e, today));
  const pick = usable.length ? usable : plans;
  const ends = pick.map(effectiveEnd).filter(Boolean).sort();
  const starts = pick.map((e) => e.startDate).filter(Boolean).sort();
  return {
    plan: pick.map((e) => e.plan).filter(Boolean).join(" + "),
    planId: pick[0]?.planId || "",
    startDate: starts[0] || "",
    endDate: ends.at(-1) || "",
    autoRenew: pick.some((e) => e.autoRenew),
  };
}

export function ageFrom(birthDate, today = todayStr()) {
  if (!birthDate) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// Días que faltan para el próximo cumpleaños (0 = hoy)
export function daysToBirthday(birthDate, today = todayStr()) {
  if (!birthDate) return null;
  const [, bm, bd] = birthDate.split("-").map(Number);
  const year = Number(today.slice(0, 4));
  const pad = (n) => String(n).padStart(2, "0");
  let next = `${year}-${pad(bm)}-${pad(bd)}`;
  if (next < today) next = `${year + 1}-${pad(bm)}-${pad(bd)}`;
  return daysBetween(today, next);
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
  let pushTokens = [];
  // Conserva mensajes y teléfonos con notificaciones; si cambió la llave (ID o teléfono), migra del panel anterior
  for (const k of [mb.portalKey, key].filter(Boolean)) {
    try {
      const snap = await getDoc(doc(db, "portal", k));
      if (snap.exists()) {
        inbox = inbox.length ? inbox : snap.data().inbox || [];
        pushTokens = [...new Set([...pushTokens, ...(snap.data().pushTokens || [])])];
      }
    } catch { /* sin documento */ }
  }
  if (mb.portalKey && mb.portalKey !== key) await deleteDoc(doc(db, "portal", mb.portalKey)).catch(() => {});
  const plans = memberPlans(mb).map((e) => ({
    plan: e.plan || "", startDate: e.startDate || "", endDate: e.endDate || "",
    ...(e.visitsLeft != null ? { visitsLeft: e.visitsLeft, visitsTotal: e.visitsTotal ?? null } : {}),
  }));
  await setDoc(doc(db, "portal", key), {
    memberId: mb.memberId,
    name: mb.name,
    plan: mb.plan || "",
    plans,
    startDate: mb.startDate || "",
    endDate: mb.endDate || "",
    autoRenew: !!mb.autoRenew,
    lastVisit: mb.lastVisit || "",
    // Datos para que el socio no tenga que volver a escribirlos al reservar
    phone: mb.phone || "",
    email: mb.email || "",
    age: ageFrom(mb.birthDate) ?? (mb.age || null),
    emergency: mb.emergency || "",
    inbox: inbox.slice(-30),
    pushTokens: pushTokens.slice(-5),
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
