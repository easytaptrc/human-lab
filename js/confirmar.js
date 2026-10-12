// Confirmación de asistencia desde el enlace del recordatorio (1 hora antes).
// Enlace: confirmar.html?r=<idReserva>&t=<token>&s=<servicio>&d=<fecha>&h=<hora>[&a=confirmada|no_asistira]
import { db, doc, updateDoc, serverTimestamp } from "./firebase.js";
import { loadSite, markHTML } from "./site.js";
import { $, esc, ICONS, fmtDate, waLink } from "./utils.js";

const { s, m } = await loadSite({ media: ["logo"] });
const p = new URLSearchParams(location.search);
const r = p.get("r");
const t = p.get("t");
const box = $("#box");

const details = p.get("s") || p.get("d")
  ? `<div class="card">
      ${p.get("s") ? `<div><span>Servicio:</span> ${esc(p.get("s"))}</div>` : ""}
      ${p.get("d") ? `<div><span>Fecha:</span> ${esc(fmtDate(p.get("d"), { long: true }))}</div>` : ""}
      ${p.get("h") ? `<div><span>Hora:</span> ${esc(p.get("h"))}</div>` : ""}
    </div>` : "";

function ask() {
  box.innerHTML = `
    ${markHTML(m)}
    <h1 class="title-wide">Confirma tu asistencia</h1>
    <p>Tu cita en ${esc(s.name)} es pronto. ¿Nos acompañas?</p>
    ${details}
    <div class="actions">
      <button class="btn btn-gold btn-block" data-a="confirmada">${ICONS.check}<span>Sí, asistiré</span></button>
      <button class="btn btn-block" data-a="no_asistira"><span>No podré asistir</span></button>
    </div>`;
}

function result(ok, answer) {
  box.innerHTML = `
    ${markHTML(m)}
    ${ok ? `<div class="icon-ok">${ICONS.check}</div>` : ""}
    <h1 class="title-wide">${ok ? (answer === "confirmada" ? "¡Te esperamos!" : "Gracias por avisar") : "Enlace no válido"}</h1>
    <p>${ok ? (answer === "confirmada" ? "Tu asistencia quedó confirmada." : "Liberaremos tu lugar para alguien más. Puedes reservar otro horario cuando quieras.") : "Este enlace ya no es válido o está incompleto. Escríbenos si necesitas ayuda."}</p>
    <div class="actions">
      ${!ok || answer !== "confirmada" ? `<a class="btn btn-gold btn-block" href="reservar.html"><span>Reservar otro horario</span></a>` : ""}
      ${s.whatsapp ? `<a class="btn btn-block" target="_blank" rel="noopener" href="${waLink(s.whatsapp, "Hola, tengo una duda sobre mi cita.")}">${ICONS.whatsapp}<span>WhatsApp</span></a>` : ""}
      <a class="btn btn-block btn-ghost" href="index.html"><span>Ir al inicio</span></a>
    </div>`;
}

async function answer(a) {
  box.querySelectorAll("button").forEach((x) => (x.disabled = true));
  try {
    await updateDoc(doc(db, "reservations", r), { attendance: a, attendanceAt: serverTimestamp(), tokenCheck: t });
    result(true, a);
  } catch (ex) {
    console.error(ex);
    result(false);
  }
}

box.addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]");
  if (b) answer(b.dataset.a);
});

// Respuesta directa desde los botones de la notificación (a=confirmada | no_asistira)
const direct = p.get("a");
if (!r || !t) result(false);
else if (["confirmada", "no_asistira"].includes(direct)) answer(direct);
else ask();
