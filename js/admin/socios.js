// Miembros: registro con ID de socio, mensualidades, asistencia y mensajes.
import {
  db, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where,
  serverTimestamp, increment, arrayUnion,
} from "../firebase.js";
import { $, esc, ICONS, todayStr, addMonths, addDays, fmtDate, fmtMoney, digits, waLink, toast } from "../utils.js";
import { getAll, invalidate, memberState, daysInactive, syncPortal } from "./data.js";
import { openModal, confirmDialog, formData, avatar, loadingHTML } from "./ui.js";

const FILTERS = [
  ["todos", "Todos"], ["activa", "Activos"], ["porvencer", "Por vencer"], ["vencida", "Vencidos"], ["inactivos", "Sin asistir +45 d"],
];

export async function render(el, ctx) {
  const state = { q: "", filter: new URLSearchParams(location.hash.split("?")[1] || "").get("f") || "todos" };
  el.innerHTML = `
    <div class="toolbar">
      <label class="input-icon grow">${ICONS.search}<input class="input" id="q" placeholder="Buscar por nombre, ID, teléfono o correo"></label>
      <div class="seg" id="filters">${FILTERS.map(([k, l]) => `<button data-f="${k}" class="${k === state.filter ? "on" : ""}">${l}</button>`).join("")}</div>
      <button class="btn btn-gold btn-sm" id="add">${ICONS.plus}<span>Nuevo socio</span></button>
    </div>
    <div class="panel"><div class="table-wrap" id="list">${loadingHTML}</div></div>`;

  const draw = async (force = false) => {
    const members = await getAll("members", { force });
    const today = todayStr();
    const q = state.q.toLowerCase();
    const rows = members
      .filter((mb) => !q || [mb.name, mb.memberId, mb.phone, mb.email].some((v) => String(v || "").toLowerCase().includes(q)))
      .filter((mb) => {
        if (state.filter === "todos") return true;
        if (state.filter === "inactivos") return (daysInactive(mb, today) ?? 0) > 45;
        const st = memberState(mb, today).key;
        return state.filter === "activa" ? st === "activa" || st === "porvencer" : st === state.filter;
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    $("#list", el).innerHTML = rows.length ? `
      <table class="t">
        <thead><tr><th>Nombre</th><th>ID</th><th>Estado</th><th>Membresía</th><th>Vence</th><th>Última visita</th><th></th></tr></thead>
        <tbody>${rows.map((mb) => {
          const st = memberState(mb, today);
          const inact = daysInactive(mb, today);
          return `<tr class="row-click" data-id="${esc(mb.id)}">
            <td><div class="who">${avatar(mb.name)}<div>${esc(mb.name)}<small>${esc(mb.phone || "")}</small></div></div></td>
            <td class="nowrap"><span class="badge badge-gold">${esc(mb.memberId)}</span></td>
            <td><span class="dot ${st.cls}">${st.label}</span></td>
            <td>${esc(mb.plan || "—")}</td>
            <td class="nowrap">${fmtDate(mb.endDate)}</td>
            <td class="nowrap">${mb.lastVisit ? fmtDate(mb.lastVisit) : "—"}${inact > 45 ? ` <span class="badge badge-warn">${inact} d</span>` : ""}</td>
            <td><div class="actions">
              <button class="icon-btn" data-act="checkin" title="Registrar asistencia">${ICONS.check}</button>
              <button class="icon-btn" data-act="edit" title="Editar">${ICONS.edit}</button>
            </div></td>
          </tr>`;
        }).join("")}</tbody>
      </table>` : `<div class="empty">${members.length ? "Sin resultados." : "Aún no hay socios registrados. Agrega el primero o asígnale un ID desde una reserva."}</div>`;
  };

  $("#q", el).addEventListener("input", (e) => { state.q = e.target.value; draw(); });
  $("#filters", el).addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]");
    if (!b) return;
    state.filter = b.dataset.f;
    el.querySelectorAll("#filters button").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  });
  $("#add", el).addEventListener("click", () => openMemberForm(ctx, null, () => draw(true)));
  $("#list", el).addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const mb = (await getAll("members")).find((x) => x.id === tr.dataset.id);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "checkin") { await checkIn(mb); draw(true); }
    else if (act === "edit") openMemberForm(ctx, mb, () => draw(true));
    else openMemberDetail(ctx, mb, () => draw(true));
  });
  await draw(true);
}

async function nextMemberId() {
  const members = await getAll("members");
  const max = members.reduce((acc, mb) => {
    const n = Number(String(mb.memberId || "").replace(/\D/g, ""));
    return n > acc ? n : acc;
  }, 0);
  return `HPL-${String(max + 1).padStart(4, "0")}`;
}

function planEnd(plan, start) {
  if (!plan || !start) return "";
  return plan.unit === "dias" ? addDays(start, Number(plan.amount) || 0) : addMonths(start, Number(plan.amount) || 1);
}

// Formulario de alta/edición. `prefill` puede venir de una reserva.
export async function openMemberForm(ctx, mb, onSaved, prefill = {}) {
  const plans = (await getAll("plans")).filter((p) => p.active !== false);
  const isNew = !mb;
  const v = { memberId: await (isNew ? nextMemberId() : mb.memberId), startDate: todayStr(), ...prefill, ...(mb || {}) };
  openModal({
    title: isNew ? "Nuevo socio" : `Editar socio · ${v.memberId}`,
    wide: true,
    body: `
      <h4 class="form-sec">Datos del socio</h4>
      <div class="form-grid">
        <label class="field"><span>ID de socio</span><input class="input" name="memberId" value="${esc(v.memberId)}" ${isNew ? "" : "readonly"} maxlength="20"></label>
        <label class="field span-2"><span>Nombre completo</span><input class="input" name="name" value="${esc(v.name || "")}" required></label>
        <label class="field"><span>Teléfono</span><input class="input" name="phone" value="${esc(v.phone || "")}" inputmode="tel"></label>
        <label class="field"><span>Correo</span><input class="input" name="email" type="email" value="${esc(v.email || "")}"></label>
        <label class="field"><span>Edad</span><input class="input" name="age" type="number" value="${esc(v.age ?? "")}"></label>
        <label class="field"><span>Número de emergencia</span><input class="input" name="emergency" value="${esc(v.emergency || "")}" inputmode="tel"></label>
        <label class="field span-2"><span>Observaciones / condiciones médicas</span><textarea class="input" name="notes">${esc(v.notes || "")}</textarea></label>
      </div>
      <h4 class="form-sec">Membresía</h4>
      <div class="form-grid">
        <label class="field"><span>Plan</span><select class="input" name="planId">
          <option value="">Sin plan</option>
          ${plans.map((p) => `<option value="${esc(p.id)}" ${p.id === v.planId ? "selected" : ""}>${esc(p.name)} · ${fmtMoney(p.price)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Inicio</span><input class="input" name="startDate" type="date" value="${esc(v.startDate || "")}"></label>
        <label class="field"><span>Vencimiento</span><input class="input" name="endDate" type="date" value="${esc(v.endDate || "")}"></label>
        <label class="switch" style="align-self:end;min-height:46px"><input type="checkbox" name="autoRenew" ${v.autoRenew ? "checked" : ""}> Renovación automática</label>
      </div>
      ${isNew ? `<label class="switch" style="margin-top:14px"><input type="checkbox" name="registerPayment" checked> Registrar el pago del plan</label>` : ""}
      <p class="hint">El socio entra a su panel con su <b>ID</b> y los <b>últimos 4 dígitos de su teléfono</b>.</p>`,
    onMount(body) {
      const sel = body.querySelector("[name=planId]");
      const start = body.querySelector("[name=startDate]");
      const end = body.querySelector("[name=endDate]");
      const recalc = () => {
        const p = plans.find((x) => x.id === sel.value);
        if (p && start.value) end.value = planEnd(p, start.value);
      };
      sel.addEventListener("change", recalc);
      start.addEventListener("change", recalc);
    },
    actions: [
      { label: "Cancelar" },
      {
        label: isNew ? "Registrar socio" : "Guardar cambios",
        cls: "btn-gold",
        onClick: async (wrap) => {
          const f = formData(wrap);
          f.memberId = f.memberId.toUpperCase().replace(/\s+/g, "");
          if (!f.memberId || !f.name) { toast("El ID y el nombre son obligatorios.", "error"); return false; }
          if (digits(f.phone).length < 4) { toast("Escribe el teléfono del socio (lo usa para entrar a su panel).", "error"); return false; }
          if (/[/]/.test(f.memberId)) { toast("El ID no puede contener “/”.", "error"); return false; }
          const ref = doc(db, "members", f.memberId);
          if (isNew && (await getDoc(ref)).exists()) { toast("Ese ID ya está asignado a otro socio.", "error"); return false; }
          const plan = plans.find((p) => p.id === f.planId);
          const data = {
            memberId: f.memberId, name: f.name, phone: digits(f.phone), email: f.email.toLowerCase(), age: f.age,
            emergency: digits(f.emergency), notes: f.notes, planId: f.planId, plan: plan?.name || "",
            startDate: f.startDate, endDate: f.endDate, autoRenew: f.autoRenew,
            lastVisit: mb?.lastVisit || "", visits: mb?.visits || 0, portalKey: mb?.portalKey || "",
            updatedAt: serverTimestamp(),
          };
          if (isNew) { data.createdAt = serverTimestamp(); data.createdBy = ctx.staff.name; data.joinDate = todayStr(); }
          try {
            data.portalKey = await syncPortal(data);
            await setDoc(ref, data, { merge: true });
            if (isNew && f.registerPayment && plan) {
              await addDoc(collection(db, "payments"), {
                memberId: f.memberId, name: f.name, plan: plan.name, amount: Number(plan.price) || 0,
                date: todayStr(), from: f.startDate, to: f.endDate, by: ctx.staff.name, createdAt: serverTimestamp(),
              });
            }
            invalidate("members");
            toast(isNew ? `Socio ${f.memberId} registrado.` : "Cambios guardados.");
            onSaved?.({ ...data, id: f.memberId });
          } catch (ex) {
            console.error(ex);
            toast("No se pudo guardar el socio.", "error");
            return false;
          }
        },
      },
    ],
  });
}

export async function checkIn(mb) {
  const today = todayStr();
  try {
    await updateDoc(doc(db, "members", mb.id), { lastVisit: today, visits: increment(1) });
    if (mb.portalKey) await updateDoc(doc(db, "portal", mb.portalKey), { lastVisit: today }).catch(() => {});
    await addDoc(collection(db, "visits"), { memberId: mb.memberId, name: mb.name, date: today, at: serverTimestamp() });
    invalidate("members");
    toast(`Asistencia registrada: ${mb.name}`);
  } catch (ex) {
    console.error(ex);
    toast("No se pudo registrar la asistencia.", "error");
  }
}

export async function sendInbox(mb, title, body) {
  if (!mb.portalKey) return false;
  await updateDoc(doc(db, "portal", mb.portalKey), {
    inbox: arrayUnion({ id: crypto.randomUUID(), title, body, date: todayStr() }),
  });
  return true;
}

async function renew(ctx, mb, onDone) {
  const plans = (await getAll("plans")).filter((p) => p.active !== false);
  const today = todayStr();
  const from = mb.endDate && mb.endDate >= today ? mb.endDate : today;
  openModal({
    title: `Renovar · ${mb.name}`,
    body: `
      <div class="form-grid">
        <label class="field span-2"><span>Plan</span><select class="input" name="planId">
          ${plans.map((p) => `<option value="${esc(p.id)}" ${p.id === mb.planId ? "selected" : ""}>${esc(p.name)} · ${fmtMoney(p.price)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Desde</span><input class="input" type="date" name="from" value="${from}"></label>
        <label class="field"><span>Monto cobrado</span><input class="input" type="number" name="amount"></label>
      </div>
      ${plans.length ? "" : `<p class="hint">Primero crea tus planes en “Planes y precios”.</p>`}`,
    onMount(body) {
      const sel = body.querySelector("[name=planId]");
      const amt = body.querySelector("[name=amount]");
      const set = () => { const p = plans.find((x) => x.id === sel.value); amt.value = p?.price ?? ""; };
      sel.addEventListener("change", set);
      set();
    },
    actions: [
      { label: "Cancelar" },
      {
        label: "Renovar",
        cls: "btn-gold",
        onClick: async (wrap) => {
          const f = formData(wrap);
          const p = plans.find((x) => x.id === f.planId);
          if (!p) { toast("Elige un plan.", "error"); return false; }
          const to = planEnd(p, f.from);
          try {
            await updateDoc(doc(db, "members", mb.id), { planId: p.id, plan: p.name, startDate: f.from, endDate: to, notifiedExpiry: "" });
            await syncPortal({ ...mb, planId: p.id, plan: p.name, startDate: f.from, endDate: to });
            await addDoc(collection(db, "payments"), {
              memberId: mb.memberId, name: mb.name, plan: p.name, amount: Number(f.amount) || 0,
              date: today, from: f.from, to, by: ctx.staff.name, createdAt: serverTimestamp(),
            });
            invalidate("members");
            toast(`Membresía renovada hasta ${fmtDate(to)}.`);
            onDone?.();
          } catch (ex) {
            console.error(ex);
            toast("No se pudo renovar.", "error");
            return false;
          }
        },
      },
    ],
  });
}

function openMemberDetail(ctx, mb, onChange) {
  const st = memberState(mb);
  const inact = daysInactive(mb);
  const modal = openModal({
    title: `${mb.memberId} · ${mb.name}`,
    wide: true,
    body: `
      <div class="btn-row" style="margin-bottom:18px">
        <button class="btn btn-sm btn-gold" data-x="checkin">${ICONS.check}<span>Registrar asistencia</span></button>
        <button class="btn btn-sm" data-x="renew">${ICONS.calendar}<span>Renovar</span></button>
        <button class="btn btn-sm" data-x="msg">${ICONS.chat}<span>Mensaje</span></button>
        ${mb.phone ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="${waLink(mb.phone, `Hola ${mb.name.split(" ")[0]}, `)}">${ICONS.whatsapp}<span>WhatsApp</span></a>` : ""}
        <button class="btn btn-sm" data-x="edit">${ICONS.edit}<span>Editar</span></button>
        <button class="btn btn-sm btn-danger" data-x="del">${ICONS.trash}<span>Eliminar</span></button>
      </div>
      <dl class="kv">
        <dt>Estado</dt><dd><span class="dot ${st.cls}">${st.label}</span></dd>
        <dt>Plan</dt><dd>${esc(mb.plan || "—")}${mb.autoRenew ? " · renovación automática" : ""}</dd>
        <dt>Vigencia</dt><dd>${fmtDate(mb.startDate)} → ${fmtDate(mb.endDate)}</dd>
        <dt>Última visita</dt><dd>${mb.lastVisit ? fmtDate(mb.lastVisit) : "Sin registro"}${inact !== null ? ` (${inact} días)` : ""} · ${mb.visits || 0} visitas</dd>
        <dt>Teléfono</dt><dd>${esc(mb.phone || "—")}</dd>
        <dt>Correo</dt><dd>${esc(mb.email || "—")}</dd>
        <dt>Edad</dt><dd>${esc(mb.age ?? "—")}</dd>
        <dt>Emergencia</dt><dd>${esc(mb.emergency || "—")}</dd>
        <dt>Observaciones</dt><dd>${esc(mb.notes || "—")}</dd>
      </dl>
      <h4 class="form-sec">Pagos</h4>
      <div id="pays">${loadingHTML}</div>`,
  });
  const body = modal.el;
  getDocs(query(collection(db, "payments"), where("memberId", "==", mb.memberId)))
    .then((snap) => {
      const list = snap.docs.map((d) => d.data()).sort((a, b) => String(b.date).localeCompare(a.date));
      body.querySelector("#pays").innerHTML = list.length
        ? `<table class="t"><thead><tr><th>Fecha</th><th>Plan</th><th>Periodo</th><th>Monto</th></tr></thead><tbody>
          ${list.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.plan)}</td><td class="nowrap">${fmtDate(p.from)} → ${fmtDate(p.to)}</td><td>${fmtMoney(p.amount)}</td></tr>`).join("")}
          </tbody></table>`
        : `<p class="muted">Sin pagos registrados.</p>`;
    })
    .catch(() => { body.querySelector("#pays").innerHTML = `<p class="muted">No disponible.</p>`; });

  body.addEventListener("click", async (e) => {
    const x = e.target.closest("[data-x]")?.dataset.x;
    if (!x) return;
    if (x === "checkin") { await checkIn(mb); modal.close(); onChange(); }
    if (x === "renew") { modal.close(); renew(ctx, mb, onChange); }
    if (x === "edit") { modal.close(); openMemberForm(ctx, mb, onChange); }
    if (x === "msg") {
      modal.close();
      openModal({
        title: `Mensaje para ${mb.name}`,
        body: `<div class="form-grid"><label class="field span-2"><span>Título</span><input class="input" name="title"></label>
          <label class="field span-2"><span>Mensaje</span><textarea class="input" name="body" rows="5"></textarea></label></div>
          <p class="hint">Aparecerá en el panel del socio.</p>`,
        actions: [{ label: "Cancelar" }, {
          label: "Enviar", cls: "btn-gold",
          onClick: async (w) => {
            const f = formData(w);
            if (!f.body) { toast("Escribe el mensaje.", "error"); return false; }
            try {
              await sendInbox(mb, f.title || "Mensaje del gimnasio", f.body);
              await addDoc(collection(db, "messages"), { title: f.title, body: f.body, audience: `Socio ${mb.memberId}`, count: 1, channels: ["panel"], by: ctx.staff.name, createdAt: serverTimestamp() });
              toast("Mensaje enviado al panel del socio.");
            } catch (ex) { console.error(ex); toast("No se pudo enviar.", "error"); return false; }
          },
        }],
      });
    }
    if (x === "del") {
      if (!(await confirmDialog(`¿Eliminar al socio ${mb.name} (${mb.memberId})? Esta acción no se puede deshacer.`, { ok: "Eliminar", danger: true }))) return;
      try {
        if (mb.portalKey) await deleteDoc(doc(db, "portal", mb.portalKey)).catch(() => {});
        await deleteDoc(doc(db, "members", mb.id));
        invalidate("members");
        toast("Socio eliminado.");
        modal.close();
        onChange();
      } catch (ex) { console.error(ex); toast("No se pudo eliminar.", "error"); }
    }
  });
}
