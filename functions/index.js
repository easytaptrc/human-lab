// Notificaciones automáticas de Human Prime Lab (Cloud Functions v2).
// Correo: escribe en la colección "mail" que procesa la extensión "Trigger Email" de Firebase.
// WhatsApp (opcional): API de WhatsApp Cloud de Meta con las variables WHATSAPP_TOKEN y WHATSAPP_PHONE_ID.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();
const TZ = process.env.TZ_GYM || "America/Mexico_City";
const REGION = "us-central1";

const DEFAULTS = {
  expiringDays: 5,
  inactiveDays: 45,
  autoEmail: false,
  autoWhatsapp: false,
  tplReminder: "Hola {nombre}, te recordamos tu cita de {servicio} hoy a las {hora} en Human Prime Lab. Por favor confirma tu asistencia aquí: {enlace}",
  tplExpiring: "Hola {nombre}, tu membresía {plan} de Human Prime Lab vence el {vence}. Renueva a tiempo y sigue entrenando sin pausas.",
  tplExpired: "Hola {nombre}, tu membresía de Human Prime Lab venció el {vence}. ¡Te extrañamos! Escríbenos para renovarla.",
  tplPromo: "Hola {nombre}, hace tiempo que no te vemos en Human Prime Lab. Tenemos una promoción especial para tu regreso. ¡Escríbenos!",
};

async function settings() {
  const [site, notify] = await Promise.all([db.doc("settings/site").get(), db.doc("settings/notify").get()]);
  return { site: site.data() || {}, n: { ...DEFAULTS, ...(notify.data() || {}) } };
}

const fill = (tpl, data) => String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => data[k] ?? "");
const first = (name) => String(name || "").split(" ")[0];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return `${d} de ${MESES[m - 1]} de ${y}`; };

function todayInTz(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

function baseUrl(site) {
  const url = site.siteUrl || `https://${process.env.GCLOUD_PROJECT}.web.app`;
  return url.replace(/\/?$/, "/");
}

async function sendEmail(to, subject, text) {
  if (!to) return;
  await db.collection("mail").add({ to, message: { subject, text }, createdAt: FieldValue.serverTimestamp() });
}

async function sendWhatsApp(phone, text) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  if (!token || !phoneId || !phone) return;
  let to = String(phone).replace(/\D/g, "");
  if (to.length === 10) to = "52" + to;
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
  });
  if (!res.ok) logger.warn("WhatsApp no enviado", await res.text());
}

async function pushInbox(portalKey, title, body) {
  if (!portalKey) return;
  await db.doc(`portal/${portalKey}`).update({
    inbox: FieldValue.arrayUnion({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title, body, date: todayInTz() }),
  }).catch(() => {});
}

// 1) Confirmación de la reserva al momento de crearla
exports.reservaCreada = onDocumentCreated({ document: "reservations/{id}", region: REGION }, async (event) => {
  const r = event.data?.data();
  if (!r) return;
  const { site, n } = await settings();
  if (!n.autoEmail || !r.email) return;
  const name = site.name || "Human Prime Lab";
  await sendEmail(r.email, `Reserva confirmada · ${name}`,
    `Hola ${first(r.name)},\n\nTu reserva quedó registrada:\n\n• Servicio: ${r.serviceName}\n• Fecha: ${fmtDate(r.date)}\n• Hora: ${r.time}\n• Folio: ${event.params.id.slice(0, 6).toUpperCase()}\n\nUna hora antes te pediremos que confirmes tu asistencia.\n\n${name}${site.address ? "\n" + site.address : ""}`);
});

// 2) Recordatorio una hora antes para confirmar asistencia
exports.recordatorioCitas = onSchedule({ schedule: "every 10 minutes", timeZone: TZ, region: REGION }, async () => {
  const { site, n } = await settings();
  if (!n.autoEmail && !n.autoWhatsapp) return;
  const now = Date.now();
  const snap = await db.collection("reservations")
    .where("startAt", ">=", Timestamp.fromMillis(now + 45 * 60000))
    .where("startAt", "<=", Timestamp.fromMillis(now + 70 * 60000))
    .get();
  for (const d of snap.docs) {
    const r = d.data();
    if (r.status !== "confirmada" || r.reminderSent || r.attendance !== "pendiente") continue;
    const q = new URLSearchParams({ r: d.id, t: r.token, s: r.serviceName, d: r.date, h: r.time });
    const text = fill(n.tplReminder, { nombre: first(r.name), servicio: r.serviceName, fecha: fmtDate(r.date), hora: r.time, enlace: `${baseUrl(site)}confirmar.html?${q}` });
    try {
      if (n.autoEmail) await sendEmail(r.email, `Confirma tu cita de hoy · ${site.name || "Human Prime Lab"}`, text);
      if (n.autoWhatsapp) await sendWhatsApp(r.phone, text);
      await d.ref.update({ reminderSent: true, reminderAt: FieldValue.serverTimestamp(), reminderBy: "auto" });
    } catch (e) {
      logger.error("Recordatorio fallido", d.id, e);
    }
  }
});

// 3) Diario: suscripciones por vencer / vencidas y promoción a inactivos
exports.avisosSocios = onSchedule({ schedule: "every day 10:00", timeZone: TZ, region: REGION }, async () => {
  const { n } = await settings();
  const today = todayInTz();
  const limit = todayInTz(n.expiringDays);
  const members = await db.collection("members").get();
  for (const doc of members.docs) {
    const mb = doc.data();
    const data = { nombre: first(mb.name), plan: mb.plan || "", vence: fmtDate(mb.endDate) };
    try {
      if (mb.endDate) {
        const state = mb.endDate < today ? "vencida" : mb.endDate <= limit ? "porvencer" : null;
        const mark = `${state}:${mb.endDate}`;
        if (state && mb.notifiedExpiry !== mark && (state === "porvencer" || daysBetween(mb.endDate, today) <= 30)) {
          const text = fill(state === "vencida" ? n.tplExpired : n.tplExpiring, data);
          const title = state === "vencida" ? "Tu membresía venció" : "Tu membresía está por vencer";
          await pushInbox(mb.portalKey, title, text);
          if (n.autoEmail) await sendEmail(mb.email, title, text);
          if (n.autoWhatsapp) await sendWhatsApp(mb.phone, text);
          await doc.ref.update({ notifiedExpiry: mark });
        }
      }
      const ref = mb.lastVisit || mb.startDate;
      const inactive = ref ? daysBetween(ref, today) : 0;
      const promoRecent = mb.promoSent && daysBetween(mb.promoSent, today) < 30;
      if (inactive > n.inactiveDays && !promoRecent) {
        const text = fill(n.tplPromo, data);
        await pushInbox(mb.portalKey, "¡Te extrañamos!", text);
        if (n.autoEmail) await sendEmail(mb.email, "¡Te extrañamos en Human Prime Lab!", text);
        if (n.autoWhatsapp) await sendWhatsApp(mb.phone, text);
        await doc.ref.update({ promoSent: today });
      }
    } catch (e) {
      logger.error("Aviso fallido", doc.id, e);
    }
  }
});
