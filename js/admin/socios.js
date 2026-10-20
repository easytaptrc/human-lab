// Miembros: registro con ID de socio, varios planes, asistencias, renovaciones, cumpleaños y mensajes.
import {
  db, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where,
  serverTimestamp, increment, arrayUnion,
} from "../firebase.js";
import { $, esc, ICONS, todayStr, addDays, fmtDate, fmtMoney, digits, waLink, toast, MESES, parseDate } from "../utils.js";
import {
  getAll, invalidate, memberState, daysInactive, syncPortal, planEnd, planDuration, memberPlans, planUsable,
  planSummary, ageFrom, daysToBirthday,
} from "./data.js";
import { openModal, confirmDialog, formData, avatar, loadingHTML } from "./ui.js";

const FILTERS = [
  ["todos", "Todos"], ["activa", "Activos"], ["porvencer", "Por vencer"], ["vencida", "Vencidos"], ["inactivos", "Sin asistir +45 d"], ["cumple", "Cumpleaños del mes"],
];

const newId = () => Math.random().toString(36).slice(2, 9);
const fmtBirthday = (b) => { if (!b) return "—"; const d = parseDate(b); return `${d.getDate()} de ${MESES[d.getMonth()]}`; };

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
    const month = today.slice(5, 7);
    const q = state.q.toLowerCase();
    const rows = members
      .filter((mb) => !q || [mb.name, mb.memberId, mb.phone, mb.email].some((v) => String(v || "").toLowerCase().includes(q)))
      .filter((mb) => {
        if (state.filter === "todos") return true;
        if (state.filter === "inactivos") return (daysInactive(mb, today) ?? 0) > 45;
        if (state.filter === "cumple") return (mb.birthDate || "").slice(5, 7) === month;
        const st = memberState(mb, today).key;
        return state.filter === "activa" ? st === "activa" || st === "porvencer" : st === state.filter;
      })
      .sort((a, b) => state.filter === "cumple"
        ? String(a.birthDate).slice(5).localeCompare(String(b.birthDate).slice(5))
        : String(a.name).localeCompare(String(b.name)));
    $("#list", el).innerHTML = rows.length ? `
      <table class="t">
        <thead><tr><th>Nombre</th><th>ID</th><th>Estado</th><th>Planes</th><th>Vence</th><th>Última visita</th><th></th></tr></thead>
        <tbody>${rows.map((mb) => {
          const st = memberState(mb, today);
          const inact = daysInactive(mb, today);
          const bday = daysToBirthday(mb.birthDate, today);
          return `<tr class="row-click" data-id="${esc(mb.id)}">
            <td><div class="who">${avatar(mb.name)}<div>${esc(mb.name)}${bday === 0 ? ` <span class="badge badge-gold">🎂 Hoy</span>` : bday !== null && bday <= 7 ? ` <span class="badge">🎂 en ${bday} d</span>` : ""}<small>${esc(mb.phone || "")}</small></div></div></td>
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

// ID de socio aleatorio: letras y números (sin 0/O, 1/I/L para no confundirse), mínimo 6 caracteres
const ID_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const validMemberId = (id) => /^[A-Z0-9]{6,20}$/.test(id) && /[A-Z]/.test(id) && /[0-9]/.test(id);
function randomMemberId(len = 6) {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    const id = [...bytes].map((x) => ID_CHARS[x % ID_CHARS.length]).join("");
    if (validMemberId(id)) return id;
  }
}
async function nextMemberId() {
  const taken = new Set((await getAll("members")).map((mb) => mb.memberId));
  let id;
  do { id = randomMemberId(); } while (taken.has(id));
  return id;
}

// Crea la entrada de un plan del catálogo para un socio
function planEntry(p, start, extra = {}) {
  const e = { id: newId(), planId: p.id, plan: p.name, unit: p.unit || "meses", startDate: start, endDate: planEnd(p, start), autoRenew: false, ...extra };
  if (p.unit === "visitas") { e.visitsTotal = Number(p.amount) || 1; e.visitsLeft = e.visitsTotal; }
  return e;
}

// Guarda planes + campos resumen en la ficha y en el panel del socio
async function savePlans(mb, plans, extra = {}) {
  const data = { plans, ...planSummary(plans), ...extra };
  await updateDoc(doc(db, "members", mb.id), data);
  await syncPortal({ ...mb, ...data });
  invalidate("members");
  return data;
}

// ---------- Alta / edición ----------
// `prefill` puede venir de una reserva.
export async function openMemberForm(ctx, mb, onSaved, prefill = {}) {
  const catalog = (await getAll("plans")).filter((p) => p.active !== false);
  const isNew = !mb;
  const v = { memberId: await (isNew ? nextMemberId() : mb.memberId), ...prefill, ...(mb || {}) };
  let plans = structuredClone(mb ? memberPlans(mb) : []);
  const originalIds = new Set(plans.map((e) => e.id));

  const planRows = () => plans.length ? plans.map((e, i) => `
    <div class="plan-row" data-i="${i}">
      <label class="field"><span>Plan</span><select class="input" data-p="planId">
        <option value="">Elegir…</option>
        ${catalog.map((p) => `<option value="${esc(p.id)}" ${p.id === e.planId ? "selected" : ""}>${esc(p.name)} · ${fmtMoney(p.price)}</option>`).join("")}
        ${e.planId && !catalog.find((p) => p.id === e.planId) ? `<option value="${esc(e.planId)}" selected>${esc(e.plan)}</option>` : ""}
      </select></label>
      <label class="field"><span>Inicio</span><input class="input" type="date" data-p="startDate" value="${esc(e.startDate || "")}"></label>
      <label class="field"><span>Vence</span><input class="input" type="date" data-p="endDate" value="${esc(e.endDate || "")}"></label>
      ${e.visitsTotal != null ? `<label class="field"><span>Visitas restantes</span><input class="input" type="number" min="0" data-p="visitsLeft" value="${e.visitsLeft ?? 0}"></label>` : ""}
      <button type="button" class="icon-btn plan-rm" data-rm title="Quitar plan">${ICONS.trash}</button>
    </div>`).join("") : `<p class="muted" style="margin:0 0 6px">Sin planes. Agrega uno o varios.</p>`;

  openModal({
    title: isNew ? "Nuevo socio" : `Editar socio · ${v.memberId}`,
    wide: true,
    body: `
      <h4 class="form-sec">Datos del socio</h4>
      <div class="form-grid">
        <label class="field"><span>ID de socio${isNew ? " (letras y números, mín. 6)" : ""}</span><div class="id-row"><input class="input" name="memberId" value="${esc(v.memberId)}" ${isNew ? "" : "readonly"} maxlength="20" autocapitalize="characters">${isNew ? `<button type="button" class="btn btn-sm" id="newId" title="Generar otro ID">🎲</button>` : ""}</div></label>
        <label class="field span-2"><span>Nombre completo</span><input class="input" name="name" value="${esc(v.name || "")}" required></label>
        <label class="field"><span>Teléfono</span><input class="input" name="phone" value="${esc(v.phone || "")}" inputmode="tel"></label>
        <label class="field"><span>Correo</span><input class="input" name="email" type="email" value="${esc(v.email || "")}"></label>
        <label class="field"><span>Fecha de nacimiento</span><input class="input" name="birthDate" type="date" value="${esc(v.birthDate || "")}"></label>
        <label class="field"><span>Edad</span><input class="input" name="age" type="number" value="${esc(ageFrom(v.birthDate) ?? v.age ?? "")}"></label>
        <label class="field"><span>Número de emergencia</span><input class="input" name="emergency" value="${esc(v.emergency || "")}" inputmode="tel"></label>
        <label class="field span-2"><span>Observaciones / condiciones médicas</span><textarea class="input" name="notes">${esc(v.notes || "")}</textarea></label>
      </div>
      <h4 class="form-sec">Planes y membresías</h4>
      <div id="plans"></div>
      <button type="button" class="add-slot add-block" id="addPlan">+ Agregar plan</button>
      <label class="switch" style="margin-top:14px"><input type="checkbox" name="registerPayment" checked> Registrar el pago de los planes nuevos</label>
      <p class="hint">El socio entra a su panel con su <b>ID</b> y los <b>últimos 4 dígitos de su teléfono</b>. Al reservar, sus datos se llenan solos.</p>`,
    onMount(body) {
      const box = body.querySelector("#plans");
      const draw = () => { box.innerHTML = planRows(); };
      draw();
      body.querySelector("[name=birthDate]").addEventListener("change", (e) => {
        const a = ageFrom(e.target.value);
        if (a !== null) body.querySelector("[name=age]").value = a;
      });
      body.querySelector("#newId")?.addEventListener("click", async () => { body.querySelector("[name=memberId]").value = await nextMemberId(); });
      body.querySelector("#addPlan").onclick = () => {
        plans.push({ id: newId(), planId: "", plan: "", startDate: todayStr(), endDate: "" });
        draw();
      };
      box.addEventListener("click", (e) => {
        if (!e.target.closest("[data-rm]")) return;
        plans.splice(Number(e.target.closest(".plan-row").dataset.i), 1);
        draw();
      });
      box.addEventListener("change", (e) => {
        const row = e.target.closest(".plan-row");
        if (!row) return;
        const entry = plans[Number(row.dataset.i)];
        const f = e.target.dataset.p;
        if (f === "planId") {
          const p = catalog.find((x) => x.id === e.target.value);
          if (p) Object.assign(entry, planEntry(p, entry.startDate || todayStr(), { id: entry.id }));
          draw();
        } else if (f === "startDate") {
          entry.startDate = e.target.value;
          const p = catalog.find((x) => x.id === entry.planId);
          if (p && entry.startDate) entry.endDate = planEnd(p, entry.startDate);
          draw();
        } else if (f === "visitsLeft") {
          entry.visitsLeft = Math.max(0, Number(e.target.value) || 0);
        } else {
          entry[f] = e.target.value;
        }
      });
    },
    actions: [
      { label: "Cancelar" },
      {
        label: isNew ? "Registrar socio" : "Guardar cambios",
        cls: "btn-gold",
        onClick: async (wrap) => {
          const f = formData(wrap.querySelector(".form-grid"));
          const registerPayment = wrap.querySelector("[name=registerPayment]").checked;
          f.memberId = f.memberId.toUpperCase().replace(/[\s-]+/g, "");
          if (isNew && !validMemberId(f.memberId)) { toast("El ID debe tener mínimo 6 caracteres, con letras y números (sin espacios ni símbolos).", "error"); return false; }
          if (!f.memberId || !f.name) { toast("El ID y el nombre son obligatorios.", "error"); return false; }
          if (digits(f.phone).length < 4) { toast("Escribe el teléfono del socio (lo usa para entrar a su panel).", "error"); return false; }
          if (/[/]/.test(f.memberId)) { toast("El ID no puede contener “/”.", "error"); return false; }
          const clean = plans.filter((e) => e.planId);
          if (clean.some((e) => !e.startDate || !e.endDate)) { toast("Cada plan necesita fecha de inicio y vencimiento.", "error"); return false; }
          const ref = doc(db, "members", f.memberId);
          if (isNew && (await getDoc(ref)).exists()) { toast("Ese ID ya está asignado a otro socio.", "error"); return false; }
          const data = {
            memberId: f.memberId, name: f.name, phone: digits(f.phone), email: f.email.toLowerCase(),
            birthDate: f.birthDate, age: ageFrom(f.birthDate) ?? f.age, emergency: digits(f.emergency), notes: f.notes,
            plans: clean, ...planSummary(clean),
            lastVisit: mb?.lastVisit || "", visits: mb?.visits || 0, portalKey: mb?.portalKey || "",
            updatedAt: serverTimestamp(),
          };
          if (isNew) { data.createdAt = serverTimestamp(); data.createdBy = ctx.staff.name; data.joinDate = todayStr(); }
          try {
            data.portalKey = await syncPortal(data);
            await setDoc(ref, data, { merge: true });
            if (registerPayment) {
              for (const e of clean.filter((x) => !originalIds.has(x.id))) {
                const p = catalog.find((x) => x.id === e.planId);
                await addDoc(collection(db, "payments"), {
                  memberId: f.memberId, name: f.name, plan: e.plan, planEntryId: e.id, amount: Number(p?.price) || 0,
                  date: todayStr(), from: e.startDate, to: e.endDate, type: "alta", by: ctx.staff.name, createdAt: serverTimestamp(),
                });
              }
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

// ---------- Asistencia (descuenta visitas de paquetes) ----------
// opts.via: "qr" | "manual" · opts.override: acceso permitido aunque la membresía no esté vigente
export async function checkIn(mb, opts = {}) {
  const today = todayStr();
  try {
    const plans = structuredClone(memberPlans(mb));
    // Usa primero el paquete de visitas vigente que vence antes
    const pack = plans.filter((e) => e.visitsLeft != null && planUsable(e, today)).sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
    let usedPlan = "";
    if (pack) {
      pack.visitsLeft -= 1;
      if (pack.visitsLeft === 0) pack.exhaustedOn = today;
      usedPlan = pack.plan;
    }
    const upd = { lastVisit: today, visits: increment(1) };
    if (pack) Object.assign(upd, { plans, ...planSummary(plans) });
    await updateDoc(doc(db, "members", mb.id), upd);
    await addDoc(collection(db, "visits"), { memberId: mb.memberId, name: mb.name, date: today, plan: usedPlan, via: opts.via || "manual", override: !!opts.override, by: opts.by || "", at: serverTimestamp() });
    // El panel del socio se actualiza aparte: si falla (permisos), la asistencia ya quedó registrada
    if (pack) await syncPortal({ ...mb, plans, ...planSummary(plans), lastVisit: today }).catch(() => {});
    else if (mb.portalKey) await updateDoc(doc(db, "portal", mb.portalKey), { lastVisit: today }).catch(() => {});
    invalidate("members");
    toast(`Asistencia registrada: ${mb.name}${pack ? ` · le quedan ${pack.visitsLeft} visitas de ${pack.plan}` : ""}`);
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

// ---------- Renovar un plan (o agregar uno nuevo) ----------
export async function renew(ctx, mb, onDone, entryId = null) {
  const catalog = (await getAll("plans")).filter((p) => p.active !== false);
  const plans = structuredClone(memberPlans(mb));
  const today = todayStr();
  openModal({
    title: `Renovar · ${mb.name}`,
    body: `
      <div class="form-grid">
        <label class="field span-2"><span>¿Qué plan?</span><select class="input" name="target">
          ${plans.map((e) => `<option value="${esc(e.id)}" ${e.id === entryId ? "selected" : ""}>Renovar: ${esc(e.plan)} (vence ${fmtDate(e.endDate)})</option>`).join("")}
          <option value="__new" ${!plans.length ? "selected" : ""}>+ Agregar un plan nuevo</option>
        </select></label>
        <label class="field span-2"><span>Plan del catálogo</span><select class="input" name="planId">
          ${catalog.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(planDuration(p))} · ${fmtMoney(p.price)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Desde</span><input class="input" type="date" name="from"></label>
        <label class="field"><span>Monto cobrado</span><input class="input" type="number" name="amount"></label>
        <p class="hint span-2" id="renewInfo"></p>
      </div>
      ${catalog.length ? "" : `<p class="hint">Primero crea tus planes en “Planes y precios”.</p>`}`,
    onMount(body) {
      const target = body.querySelector("[name=target]");
      const sel = body.querySelector("[name=planId]");
      const from = body.querySelector("[name=from]");
      const amt = body.querySelector("[name=amount]");
      const info = () => {
        const p = catalog.find((x) => x.id === sel.value);
        body.querySelector("#renewInfo").textContent = p && from.value ? `Quedará vigente del ${fmtDate(from.value)} al ${fmtDate(planEnd(p, from.value))}.` : "";
      };
      const pickTarget = () => {
        const e = plans.find((x) => x.id === target.value);
        if (e?.planId && catalog.find((p) => p.id === e.planId)) sel.value = e.planId;
        from.value = e && e.endDate >= today ? e.endDate : today;
        const p = catalog.find((x) => x.id === sel.value);
        amt.value = p?.price ?? "";
        info();
      };
      target.addEventListener("change", pickTarget);
      sel.addEventListener("change", () => { amt.value = catalog.find((x) => x.id === sel.value)?.price ?? ""; info(); });
      from.addEventListener("change", info);
      pickTarget();
    },
    actions: [
      { label: "Cancelar" },
      {
        label: "Renovar",
        cls: "btn-gold",
        onClick: async (wrap) => {
          const f = formData(wrap);
          const p = catalog.find((x) => x.id === f.planId);
          if (!p || !f.from) { toast("Elige el plan y la fecha.", "error"); return false; }
          const fresh = planEntry(p, f.from);
          let entry;
          if (f.target === "__new") { entry = fresh; plans.push(entry); }
          else {
            entry = plans.find((x) => x.id === f.target);
            Object.assign(entry, { ...fresh, id: entry.id, autoRenew: entry.autoRenew });
            delete entry.exhaustedOn;
            if (p.unit !== "visitas") { delete entry.visitsLeft; delete entry.visitsTotal; }
          }
          try {
            await savePlans(mb, plans, { notifiedExpiry: "" });
            await addDoc(collection(db, "payments"), {
              memberId: mb.memberId, name: mb.name, plan: p.name, planEntryId: entry.id, amount: Number(f.amount) || 0,
              date: today, from: entry.startDate, to: entry.endDate, type: f.target === "__new" ? "nuevo plan" : "renovación",
              by: ctx.staff.name, createdAt: serverTimestamp(),
            });
            toast(`${p.name} vigente hasta ${fmtDate(entry.endDate)}.`);
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

// ---------- Ficha completa del socio ----------
async function openMemberDetail(ctx, mb, onChange) {
  const today = todayStr();
  const st = memberState(mb, today);
  const inact = daysInactive(mb, today);
  const plans = memberPlans(mb);
  const age = ageFrom(mb.birthDate) ?? mb.age;
  const bday = daysToBirthday(mb.birthDate, today);
  const TABS = [["resumen", "Resumen"], ["planes", "Planes"], ["asistencias", "Asistencias"], ["pagos", "Pagos y renovaciones"], ["reservas", "Reservas"]];

  const modal = openModal({
    title: `${mb.memberId} · ${mb.name}`,
    wide: true,
    body: `
      <div class="member-head">
        ${avatar(mb.name)}
        <div>
          <b>${esc(mb.name)}</b>
          <span class="dot ${st.cls}">${st.label}</span>
          ${bday === 0 ? `<span class="badge badge-gold">🎂 ¡Hoy es su cumpleaños!</span>` : ""}
        </div>
      </div>
      <div class="btn-row" style="margin:14px 0 4px">
        <button class="btn btn-sm btn-gold" data-x="checkin">${ICONS.check}<span>Registrar asistencia</span></button>
        <button class="btn btn-sm" data-x="renew">${ICONS.calendar}<span>Renovar / agregar plan</span></button>
        <button class="btn btn-sm" data-x="msg">${ICONS.chat}<span>Mensaje</span></button>
        ${mb.phone ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="${waLink(mb.phone, `Hola ${mb.name.split(" ")[0]}, `)}">${ICONS.whatsapp}<span>WhatsApp</span></a>` : ""}
        <button class="btn btn-sm" data-x="edit">${ICONS.edit}<span>Editar</span></button>
        <button class="btn btn-sm btn-danger" data-x="del">${ICONS.trash}<span>Eliminar</span></button>
      </div>
      <div class="cfg-tabs member-tabs">${TABS.map(([k, l], i) => `<button data-tab="${k}" class="${i ? "" : "on"}">${l}</button>`).join("")}</div>

      <section data-pane="resumen">
        <div class="mini-stats">
          <div><span>Visitas totales</span><b>${mb.visits || 0}</b></div>
          <div><span>Última visita</span><b>${mb.lastVisit ? fmtDate(mb.lastVisit) : "—"}</b><small>${inact !== null ? `hace ${inact} días` : ""}</small></div>
          <div><span>Cumpleaños</span><b>${fmtBirthday(mb.birthDate)}</b><small>${bday === null ? "" : bday === 0 ? "¡Hoy!" : `en ${bday} días`}</small></div>
          <div><span>Socio desde</span><b>${fmtDate(mb.joinDate || mb.startDate)}</b></div>
        </div>
        <dl class="kv">
          <dt>Planes vigentes</dt><dd>${esc(mb.plan || "—")}</dd>
          <dt>Vence</dt><dd>${fmtDate(mb.endDate)}</dd>
          <dt>Teléfono</dt><dd>${esc(mb.phone || "—")}</dd>
          <dt>Correo</dt><dd>${esc(mb.email || "—")}</dd>
          <dt>Fecha de nacimiento</dt><dd>${mb.birthDate ? fmtDate(mb.birthDate) : "—"}${age != null && age !== "" ? ` · ${age} años` : ""}</dd>
          <dt>Emergencia</dt><dd>${esc(mb.emergency || "—")}</dd>
          <dt>Observaciones</dt><dd>${esc(mb.notes || "—")}</dd>
          <dt>Registrado por</dt><dd>${esc(mb.createdBy || "—")}</dd>
        </dl>
      </section>

      <section data-pane="planes" hidden>
        ${plans.length ? `<div class="plan-cards">${plans.map((e) => {
          const ok = planUsable(e, today);
          return `<div class="plan-card ${ok ? "" : "off"}">
            <div><b>${esc(e.plan)}</b><span class="dot ${ok ? "" : "dot-bad"}">${ok ? "Vigente" : e.visitsLeft === 0 ? "Sin visitas" : "Vencido"}</span></div>
            <small>${fmtDate(e.startDate)} → ${fmtDate(e.endDate)}</small>
            ${e.visitsTotal != null ? `<div class="visits-bar"><span style="width:${Math.round(((e.visitsLeft ?? 0) / (e.visitsTotal || 1)) * 100)}%"></span></div><small>${e.visitsLeft ?? 0} de ${e.visitsTotal} visitas restantes</small>` : ""}
            <button class="btn btn-sm" data-renew="${esc(e.id)}">${ICONS.calendar}<span>Renovar</span></button>
          </div>`;
        }).join("")}</div>` : `<p class="muted">Sin planes asignados.</p>`}
      </section>

      <section data-pane="asistencias" hidden><div id="visitsBox">${loadingHTML}</div></section>
      <section data-pane="pagos" hidden><div id="pays">${loadingHTML}</div></section>
      <section data-pane="reservas" hidden><div id="resBox">${loadingHTML}</div></section>`,
  });
  const body = modal.el;

  // Historial: asistencias, pagos y reservas
  const visitsQ = getDocs(query(collection(db, "visits"), where("memberId", "==", mb.memberId))).then((s) => s.docs.map((d) => d.data())).catch(() => null);
  const paysQ = getDocs(query(collection(db, "payments"), where("memberId", "==", mb.memberId))).then((s) => s.docs.map((d) => d.data())).catch(() => null);
  const resQ = getDocs(query(collection(db, "reservations"), where("memberId", "==", mb.memberId))).then((s) => s.docs.map((d) => d.data())).catch(() => null);

  visitsQ.then((list) => {
    const box = body.querySelector("#visitsBox");
    if (!list) { box.innerHTML = `<p class="muted">No disponible con tus permisos.</p>`; return; }
    list.sort((a, b) => String(b.date).localeCompare(a.date));
    const byMonth = {};
    list.forEach((v) => { const k = v.date.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + 1; });
    box.innerHTML = list.length ? `
      <div class="month-chips">${Object.entries(byMonth).slice(0, 6).map(([k, n]) => `<span class="badge">${MESES[Number(k.slice(5)) - 1]} ${k.slice(0, 4)}: <b>&nbsp;${n}</b></span>`).join("")}</div>
      <table class="t"><thead><tr><th>Fecha</th><th>Día</th><th>Plan usado</th><th>Registro</th></tr></thead><tbody>
      ${list.map((v) => `<tr><td>${fmtDate(v.date)}</td><td>${["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][parseDate(v.date).getDay()]}</td><td>${esc(v.plan || "—")}</td><td>${v.via === "qr" ? "Escaneo QR" : "Manual"}${v.override ? " · <span class=\"badge badge-warn\">sin membresía</span>" : ""}${v.by ? ` · ${esc(v.by)}` : ""}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">Aún no hay asistencias registradas.</p>`;
  });
  paysQ.then((list) => {
    const box = body.querySelector("#pays");
    if (!list) { box.innerHTML = `<p class="muted">No disponible con tus permisos.</p>`; return; }
    list.sort((a, b) => String(b.date).localeCompare(a.date));
    const total = list.reduce((a, p) => a + (Number(p.amount) || 0), 0);
    box.innerHTML = list.length ? `
      <p class="hint" style="margin:0 0 10px">${list.length} movimientos · total ${fmtMoney(total)}</p>
      <table class="t"><thead><tr><th>Fecha</th><th>Tipo</th><th>Plan</th><th>Periodo</th><th>Monto</th><th>Atendió</th></tr></thead><tbody>
      ${list.map((p) => `<tr><td>${fmtDate(p.date)}</td><td>${esc(p.type || "pago")}</td><td>${esc(p.plan)}</td><td class="nowrap">${fmtDate(p.from)} → ${fmtDate(p.to)}</td><td>${fmtMoney(p.amount)}</td><td>${esc(p.by || "—")}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">Sin pagos registrados.</p>`;
  });
  resQ.then((list) => {
    const box = body.querySelector("#resBox");
    if (!list) { box.innerHTML = `<p class="muted">No disponible con tus permisos.</p>`; return; }
    list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    const lbl = { confirmada: "Confirmada", asistio: "Asistió", no_asistio: "No asistió", cancelada: "Cancelada" };
    box.innerHTML = list.length ? `<table class="t"><thead><tr><th>Fecha</th><th>Hora</th><th>Servicio</th><th>Estado</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td>${fmtDate(r.date)}</td><td>${esc(r.time)}</td><td>${esc(r.serviceName)}</td><td>${lbl[r.status] || esc(r.status)}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">Sin reservas con su ID.</p>`;
  });

  body.addEventListener("click", async (e) => {
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      body.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("on", b === tab));
      body.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
      return;
    }
    const rn = e.target.closest("[data-renew]");
    if (rn) { modal.close(); renew(ctx, mb, onChange, rn.dataset.renew); return; }
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
          <p class="hint">Aparecerá en el panel del socio (y como notificación si las activó).</p>`,
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
