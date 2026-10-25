// Reservas: agenda por día, asistencia, cupos y alta manual.
import {
  db, collection, doc, getDocs, query, where, updateDoc, runTransaction, setDoc,
  serverTimestamp, Timestamp, increment,
} from "../firebase.js";
import { $, esc, ICONS, todayStr, addDays, dowOf, startAt, fmtDate, digits, waLink, randomToken, toast, fillTemplate } from "../utils.js";
import { getAll, confirmLink, getNotifySettings } from "./data.js";
import { openModal, confirmDialog, formData, loadingHTML } from "./ui.js";
import { openMemberForm, checkIn } from "./socios.js";
import { openBooking } from "./booking.js";

export { setStatus, assignMember };
export const STATUS = {
  confirmada: ["Confirmada", "badge-gold"],
  asistio: ["Asistió", "badge-ok"],
  no_asistio: ["No asistió", "badge-bad"],
  cancelada: ["Cancelada", ""],
  liberada: ["Liberada", "badge-warn"],
};
export const ATTENDANCE = {
  pendiente: ["Por confirmar", "dot-warn"],
  confirmada: ["Confirmó", ""],
  no_asistira: ["No asistirá", "dot-bad"],
};

export async function render(el, ctx) {
  const state = { date: todayStr(), service: "", q: "", list: [] };
  el.innerHTML = `
    <div class="toolbar">
      <button class="icon-btn" id="prev" title="Día anterior">${ICONS.back}</button>
      <input class="input" type="date" id="date" value="${state.date}">
      <button class="icon-btn" id="next" title="Día siguiente">${ICONS.chevron}</button>
      <button class="btn btn-sm" id="today">Hoy</button>
      <select class="input" id="svc"><option value="">Todos los servicios</option></select>
      <label class="input-icon grow">${ICONS.search}<input class="input" id="q" placeholder="Buscar cliente"></label>
      <button class="btn btn-gold btn-sm" id="add">${ICONS.plus}<span>Nueva reserva</span></button>
    </div>
    <div class="panel"><div class="panel-head"><h2>Reservas</h2><span class="muted" id="count"></span></div><div class="table-wrap" id="list">${loadingHTML}</div></div>
    <div class="panel"><div class="panel-head"><h2>Cupos del día</h2><span class="muted" id="dayLabel"></span></div><div class="panel-body"><div class="occ" id="occ">${loadingHTML}</div></div></div>`;

  const services = await getAll("services", { force: true });
  $("#svc", el).innerHTML += services.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("");

  const load = async () => {
    $("#dayLabel", el).textContent = fmtDate(state.date, { long: true });
    const [rs, ss] = await Promise.all([
      getDocs(query(collection(db, "reservations"), where("date", "==", state.date))),
      getDocs(query(collection(db, "slots"), where("date", "==", state.date))),
    ]);
    state.list = rs.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.slots = Object.fromEntries(ss.docs.map((d) => [d.id, d.data()]));
    draw();
  };

  const draw = () => {
    // Ocupación por servicio y horario
    const dow = dowOf(state.date);
    const occ = [];
    services.filter((x) => !state.service || x.id === state.service).forEach((svc) => {
      Object.entries(svc.slots || {}).filter(([k]) => k.startsWith(dow + "_")).sort().forEach(([k, cap]) => {
        const time = k.slice(2);
        const used = state.slots[`${svc.id}__${state.date}__${time}`]?.count || 0;
        occ.push(`<div class="occ-item ${used >= cap ? "full" : ""}"><span class="muted">${esc(svc.name)}</span><b>${time}</b>${used}/${cap} lugares<div class="occ-bar"><span style="width:${Math.min(100, (used / cap) * 100)}%"></span></div></div>`);
      });
    });
    $("#occ", el).innerHTML = occ.join("") || `<p class="muted" style="margin:0">No hay horarios configurados para este día.</p>`;

    const q = state.q.toLowerCase();
    const rows = state.list
      .filter((r) => !state.service || r.serviceId === state.service)
      .filter((r) => !q || [r.name, r.phone, r.email, r.memberId].some((v) => String(v || "").toLowerCase().includes(q)))
      .sort((a, b) => a.time.localeCompare(b.time));
    $("#count", el).textContent = `${rows.filter((r) => r.status !== "cancelada").length} activas`;
    $("#list", el).innerHTML = rows.length ? `
      <table class="t">
        <thead><tr><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Asistencia</th><th>Estado</th><th>Socio</th><th></th></tr></thead>
        <tbody>${rows.map((r) => {
          const st = STATUS[r.status] || STATUS.confirmada;
          const at = ATTENDANCE[r.attendance] || ATTENDANCE.pendiente;
          return `<tr class="row-click" data-id="${r.id}">
            <td class="num"><b>${r.time}</b></td>
            <td><div class="who"><div>${esc(r.name)}<small>${esc(r.phone)}</small></div></div></td>
            <td>${esc(r.serviceName)}</td>
            <td><span class="dot ${at[1]}">${at[0]}</span></td>
            <td><span class="badge ${st[1]}">${st[0]}</span></td>
            <td>${r.memberId ? `<span class="badge badge-gold">${esc(r.memberId)}</span>` : `<button class="link" data-act="assign">Asignar ID</button>`}</td>
            <td><div class="actions">
              ${r.status === "confirmada" ? `<button class="icon-btn" data-act="asistio" title="Marcar asistencia">${ICONS.check}</button>` : ""}
              <a class="icon-btn" data-act="wa" title="WhatsApp" target="_blank" rel="noopener" href="#">${ICONS.whatsapp}</a>
            </div></td>
          </tr>`;
        }).join("")}</tbody>
      </table>` : `<div class="empty">No hay reservas para este día.</div>`;
  };

  const setDate = (d) => { state.date = d; $("#date", el).value = d; load(); };
  $("#prev", el).onclick = () => setDate(addDays(state.date, -1));
  $("#next", el).onclick = () => setDate(addDays(state.date, 1));
  $("#today", el).onclick = () => setDate(todayStr());
  $("#date", el).onchange = (e) => e.target.value && setDate(e.target.value);
  $("#svc", el).onchange = (e) => { state.service = e.target.value; draw(); };
  $("#q", el).oninput = (e) => { state.q = e.target.value; draw(); };
  $("#add", el).onclick = () => openBooking(ctx, { date: state.date, onDone: load });

  $("#list", el).addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const r = state.list.find((x) => x.id === tr.dataset.id);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "wa") {
      e.preventDefault();
      const n = await getNotifySettings();
      window.open(waLink(r.phone, reminderText(ctx, n, r)), "_blank", "noopener");
      return;
    }
    if (act === "asistio") { await setStatus(r, "asistio"); load(); return; }
    if (act === "assign") { assignMember(ctx, r, load); return; }
    openDetail(ctx, r, load);
  });

  await load();
  // Se actualiza sola cuando llega una reserva nueva o un cliente confirma
  const onLive = () => load().catch(() => {});
  addEventListener("hpl:reserva", onLive);
  return () => removeEventListener("hpl:reserva", onLive);
}

export function reminderText(ctx, n, r) {
  return fillTemplate(n.tplReminder, {
    nombre: r.name.split(" ")[0], servicio: r.serviceName, fecha: fmtDate(r.date, { long: true }), hora: r.time, enlace: confirmLink(ctx.s, r),
  });
}

async function setStatus(r, status) {
  try {
    await updateDoc(doc(db, "reservations", r.id), { status, statusAt: serverTimestamp() });
    if (status === "asistio" && r.memberId) {
      const mb = (await getAll("members", { force: true })).find((x) => x.memberId === r.memberId);
      if (mb) await checkIn(mb);
    }
    if (r.memberId) {
      const mb = (await getAll("members")).find((x) => x.memberId === r.memberId);
      if (mb?.portalKey) await updateDoc(doc(db, "portal", mb.portalKey, "reservas", r.id), { status }).catch(() => {});
    }
    toast(`Reserva marcada como “${STATUS[status][0]}”.`);
  } catch (ex) {
    console.error(ex);
    toast("No se pudo actualizar la reserva.", "error");
  }
}

async function cancel(r) {
  const slotRef = doc(db, "slots", `${r.serviceId}__${r.date}__${r.time}`);
  await runTransaction(db, async (tx) => {
    const slot = await tx.get(slotRef);
    tx.update(doc(db, "reservations", r.id), { status: "cancelada", statusAt: serverTimestamp() });
    if (slot.exists() && r.status !== "cancelada") tx.update(slotRef, { count: Math.max(0, (slot.data().count || 0) - 1) });
  });
  if (r.memberId) {
    const mb = (await getAll("members").catch(() => [])).find((x) => x.memberId === r.memberId);
    if (mb?.portalKey) await updateDoc(doc(db, "portal", mb.portalKey, "reservas", r.id), { status: "cancelada" }).catch(() => {});
  }
}

function assignMember(ctx, r, onDone) {
  openMemberForm(ctx, null, async (mb) => {
    try {
      await updateDoc(doc(db, "reservations", r.id), { memberId: mb.memberId });
      if (r.date >= todayStr() && mb.portalKey) {
        await setDoc(doc(db, "portal", mb.portalKey, "reservas", r.id), { serviceName: r.serviceName, date: r.date, time: r.time, status: r.status, createdAt: serverTimestamp() });
      }
    } catch (ex) { console.error(ex); }
    onDone();
  }, { name: r.name, phone: r.phone, email: r.email, age: r.age, emergency: r.emergency, notes: r.notes });
}

function openDetail(ctx, r, onDone) {
  const st = STATUS[r.status] || STATUS.confirmada;
  const at = ATTENDANCE[r.attendance] || ATTENDANCE.pendiente;
  const m = openModal({
    title: `Reserva · ${r.id.slice(0, 6).toUpperCase()}`,
    wide: true,
    body: `
      <div class="btn-row" style="margin-bottom:18px">
        ${r.status !== "asistio" ? `<button class="btn btn-sm btn-gold" data-x="asistio">${ICONS.check}<span>Asistió</span></button>` : ""}
        ${r.status !== "no_asistio" ? `<button class="btn btn-sm" data-x="no_asistio"><span>No asistió</span></button>` : ""}
        <button class="btn btn-sm" data-x="wa">${ICONS.whatsapp}<span>Recordatorio WhatsApp</span></button>
        ${!r.memberId ? `<button class="btn btn-sm" data-x="assign">${ICONS.id}<span>Asignar ID de socio</span></button>` : ""}
        ${r.status !== "cancelada" ? `<button class="btn btn-sm btn-danger" data-x="cancel">${ICONS.close}<span>Cancelar y liberar lugar</span></button>` : ""}
      </div>
      <dl class="kv">
        <dt>Servicio</dt><dd>${esc(r.serviceName)}</dd>
        <dt>Fecha y hora</dt><dd>${fmtDate(r.date, { long: true })} · ${r.time}</dd>
        <dt>Estado</dt><dd><span class="badge ${st[1]}">${st[0]}</span></dd>
        <dt>Asistencia</dt><dd><span class="dot ${at[1]}">${at[0]}</span></dd>
        ${r.status === "cancelada" && r.cancelledBy ? `<dt>Cancelada por</dt><dd>${r.cancelledBy === "sin_confirmar" ? "Sistema: no confirmó a tiempo (lugar liberado)" : r.cancelledBy === "cliente" ? "El cliente (no asistirá)" : esc(r.cancelledBy)}</dd>` : ""}
        ${r.reminderCount ? `<dt>Avisos enviados</dt><dd>${r.reminderCount}</dd>` : ""}
        <dt>Nombre</dt><dd>${esc(r.name)}</dd>
        <dt>Teléfono</dt><dd>${esc(r.phone)}</dd>
        <dt>Correo</dt><dd>${esc(r.email)}</dd>
        <dt>Edad</dt><dd>${esc(r.age)}</dd>
        <dt>Emergencia</dt><dd>${esc(r.emergency)}</dd>
        <dt>Observaciones</dt><dd>${esc(r.notes || "—")}</dd>
        <dt>ID de socio</dt><dd>${esc(r.memberId || (r.memberIdTyped ? `${r.memberIdTyped} (no verificado)` : "—"))}</dd>
        <dt>Aviso en teléfono</dt><dd>${r.pushToken ? "Activado (recibirá el recordatorio 1 h antes)" : "No activado"}</dd>
        <dt>Origen</dt><dd>${r.source === "recepcion" ? `Recepción${r.by ? " · " + esc(r.by) : ""}` : "Reserva en línea"}</dd>
      </dl>`,
  });
  m.el.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]")?.dataset.x;
    if (!x) return;
    if (x === "wa") {
      const n = await getNotifySettings();
      window.open(waLink(r.phone, reminderText(ctx, n, r)), "_blank", "noopener");
      await updateDoc(doc(db, "reservations", r.id), { reminderSent: true }).catch(() => {});
      return;
    }
    if (x === "assign") { m.close(); assignMember(ctx, r, onDone); return; }
    if (x === "cancel") {
      if (!(await confirmDialog("¿Cancelar esta reserva y liberar el lugar?", { ok: "Cancelar reserva", danger: true }))) return;
      try { await cancel(r); toast("Reserva cancelada."); } catch (ex) { console.error(ex); toast("No se pudo cancelar.", "error"); }
    } else {
      await setStatus(r, x);
    }
    m.close();
    onDone();
  });
}
