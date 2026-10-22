// Reserva de citas: servicio (con horarios inmediatos) → fecha → hora → datos → confirmación.
import { db, collection, doc, getDoc, getDocs, query, where, runTransaction, updateDoc, serverTimestamp, Timestamp } from "./firebase.js";
import { loadSite, startLoader, brandHTML } from "./site.js";
import {
  $, $$, esc, ICONS, MESES, DIAS, DIAS_CORTOS, MESES_CORTOS, todayStr, dateStr, addDays, dowOf, parseDate, startAt,
  fmtDate, fmtMoney, digits, waLink, portalKey, randomToken, toast, store, sha256,
} from "./utils.js";
import { pushState, enablePush, refreshToken, INSTALL_HINT } from "./push.js";
import { newPassCode } from "./qr.js";
import { renderPass, memberStatus } from "./pass.js";

const loader = startLoader({ min: 700 });
const { s, m } = await loadSite({ media: ["logo"] });

$("#header").innerHTML = `
  <a href="index.html" aria-label="Inicio">${brandHTML(s, m)}</a>
  <a class="icon-btn" href="index.html" aria-label="Volver al inicio">${ICONS.home}</a>`;
$("#calPrev").innerHTML = ICONS.back;
$("#calNext").innerHTML = ICONS.chevron;
$("#backBtn").innerHTML = `${ICONS.back}<span>Atrás</span>`;
$(".btn-chev", $("#submitBtn")).innerHTML = ICONS.chevron;
const fieldIcons = { name: "user", phone: "phone", email: "mail", age: "id", emergency: "shield" };
$$("#form .input-icon").forEach((l) => {
  const name = $("input", l).name;
  $("svg", l).outerHTML = ICONS[fieldIcons[name]];
});

const params = new URLSearchParams(location.search);
const state = { step: 1, services: [], service: null, date: null, time: null, month: null, used: {}, cart: [] };
const MAX_CART = 14;
const QUICK_DAYS = 7; // días que se revisan para mostrar horarios inmediatos

// ---------- Disponibilidad ----------
const slotsOf = (svc) => svc.slots || {};
const timesForDow = (svc, dow) =>
  Object.entries(slotsOf(svc))
    .filter(([k, cap]) => k.startsWith(dow + "_") && Number(cap) > 0)
    .map(([k, cap]) => ({ time: k.slice(2), cap: Number(cap) }))
    .sort((a, b) => a.time.localeCompare(b.time));

const maxDate = () => addDays(todayStr(), Number(s.bookingDays) || 30);
const usedKey = (sid, date, time) => `${sid}|${date}|${time}`;

function dateOpen(svc, ds) {
  if (!svc || ds < todayStr() || ds > maxDate()) return false;
  if ((svc.closedDates || []).includes(ds)) return false;
  return timesForDow(svc, dowOf(ds)).length > 0;
}

// Horarios de un día con lugares libres y si ya pasaron
function dayTimes(svc, ds) {
  const limit = Date.now() + (Number(s.minNoticeMin) || 0) * 60000;
  return timesForDow(svc, dowOf(ds)).map(({ time, cap }) => {
    const left = Math.max(0, cap - (state.used[usedKey(svc.id, ds, time)] || 0));
    const past = startAt(ds, time).getTime() < limit;
    return { time, cap, left, past, ok: left > 0 && !past };
  });
}

async function loadUsed(from, to) {
  try {
    const snap = await getDocs(query(collection(db, "slots"), where("date", ">=", from), where("date", "<=", to)));
    snap.forEach((d) => { const x = d.data(); state.used[usedKey(x.serviceId, x.date, x.time)] = x.count || 0; });
  } catch (e) {
    console.warn(e);
  }
}

const dayLabel = (ds) => {
  if (ds === todayStr()) return "Hoy";
  if (ds === addDays(todayStr(), 1)) return "Mañana";
  const d = parseDate(ds);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
};

// ---------- Paso 1: servicios con horarios inmediatos ----------
async function loadServices() {
  try {
    const snap = await getDocs(query(collection(db, "services"), where("active", "==", true)));
    state.services = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  } catch (e) {
    console.error(e);
    $("#serviceList").innerHTML = `<div class="empty">No pudimos cargar los servicios. Revisa tu conexión e intenta de nuevo.</div>`;
    return;
  }
  if (!state.services.length) {
    $("#serviceList").innerHTML = `<div class="empty">Por ahora no hay servicios disponibles para reservar.</div>`;
    return;
  }
  await loadUsed(todayStr(), addDays(todayStr(), QUICK_DAYS));
  renderServices();
}

function renderServices() {
  if (!state.services.length) return;
  $("#serviceList").innerHTML = state.services.map((x) => {
    let day = null;
    let times = [];
    for (let i = 0; i <= QUICK_DAYS; i++) {
      const ds = addDays(todayStr(), i);
      if (!dateOpen(x, ds)) continue;
      const list = dayTimes(x, ds).filter((t) => t.ok);
      if (list.length) { day = ds; times = list; break; }
    }
    const meta = [x.durationMin ? `${x.durationMin} min` : "", x.price ? fmtMoney(x.price) : ""].filter(Boolean).join(" · ");
    return `
    <article class="service-card" data-id="${esc(x.id)}">
      <button class="service-opt" data-cal>
        <span class="service-thumb">${x.image ? `<img src="${esc(x.image)}" alt="">` : ICONS.dumbbell}</span>
        <span class="service-name">${esc(x.name)}${meta ? `<small>${meta}</small>` : ""}</span>
        ${ICONS.chevron}
      </button>
      <div class="quick">
        ${day ? `
          <div class="quick-head"><span>${dayLabel(day)} · horarios disponibles</span></div>
          <div class="chips">${times.map((t) => `<button class="chip" data-date="${day}" data-time="${t.time}"><b>${t.time}</b><small>${t.left} ${t.left === 1 ? "lugar" : "lugares"}</small></button>`).join("")}</div>`
        : `<p class="quick-none">Sin horarios en los próximos días.</p>`}
        <button class="quick-cal" data-cal>${ICONS.calendar}<span>Ver calendario y otras fechas</span>${ICONS.chevron}</button>
      </div>
    </article>`;
  }).join("");
}

$("#serviceList").addEventListener("click", (e) => {
  const card = e.target.closest(".service-card");
  if (!card) return;
  const chip = e.target.closest(".chip");
  if (chip) {
    addToCart(state.services.find((x) => x.id === card.dataset.id), chip.dataset.date, chip.dataset.time);
    return;
  }
  if (e.target.closest("[data-cal]")) selectService(card.dataset.id);
});

function setService(id) {
  const svc = state.services.find((x) => x.id === id);
  if (!svc) return null;
  state.service = svc;
  state.date = state.time = null;
  return svc;
}

function selectService(id) {
  if (!setService(id)) return;
  const first = firstAvailableDate();
  const base = first ? parseDate(first) : new Date();
  state.month = new Date(base.getFullYear(), base.getMonth(), 1);
  go(2);
}

// ---------- Paso 2: calendario ----------
const dateEnabled = (ds) => dateOpen(state.service, ds);

function firstAvailableDate() {
  for (let i = 0, d = todayStr(); i <= (Number(s.bookingDays) || 30); i++, d = addDays(d, 1)) if (dateEnabled(d)) return d;
  return null;
}

function renderCalendar() {
  if (!state.month) state.month = new Date(parseDate(state.date || todayStr()).setDate(1));
  const mo = state.month;
  $("#calLabel").textContent = `${MESES[mo.getMonth()]} ${mo.getFullYear()}`;
  const startDow = (mo.getDay() + 6) % 7; // semana inicia en lunes
  const daysIn = new Date(mo.getFullYear(), mo.getMonth() + 1, 0).getDate();
  const head = [1, 2, 3, 4, 5, 6, 0].map((d) => `<span class="cal-dow">${DIAS_CORTOS[d]}</span>`).join("");
  let cells = "";
  for (let i = 0; i < startDow; i++) cells += `<span></span>`;
  for (let d = 1; d <= daysIn; d++) {
    const ds = dateStr(new Date(mo.getFullYear(), mo.getMonth(), d));
    const on = dateEnabled(ds);
    cells += `<button class="cal-day ${ds === todayStr() ? "today" : ""} ${ds === state.date ? "sel" : ""}" data-date="${ds}" ${on ? "" : "disabled"}>${d}</button>`;
  }
  $("#calGrid").innerHTML = head + cells;
  const now = new Date();
  $("#calPrev").disabled = mo <= new Date(now.getFullYear(), now.getMonth(), 1);
  $("#calNext").disabled = new Date(mo.getFullYear(), mo.getMonth() + 1, 1) > parseDate(maxDate());
}

$("#calPrev").addEventListener("click", () => { state.month.setMonth(state.month.getMonth() - 1); renderCalendar(); });
$("#calNext").addEventListener("click", () => { state.month.setMonth(state.month.getMonth() + 1); renderCalendar(); });
$("#calGrid").addEventListener("click", (e) => {
  const b = e.target.closest(".cal-day");
  if (!b || b.disabled) return;
  state.date = b.dataset.date;
  state.time = null;
  go(3);
});

// ---------- Paso 3: horarios ----------
async function renderTimes() {
  const svc = state.service;
  const box = $("#times");
  $("#timeSub").textContent = fmtDate(state.date, { long: true });
  box.innerHTML = `<div class="empty"><div class="spinner" style="margin:auto"></div></div>`;
  await loadUsed(state.date, state.date);
  box.innerHTML = dayTimes(svc, state.date).map((t) => `
    <button class="time ${t.time === state.time ? "sel" : ""}" data-time="${t.time}" ${t.ok ? "" : "disabled"}>
      <b>${t.time}</b><small>${t.past ? "No disponible" : t.left === 0 ? "Lleno" : `${t.left} ${t.left === 1 ? "lugar" : "lugares"}`}</small>
    </button>`).join("") || `<div class="empty">No hay horarios para este día.</div>`;
}

$("#times").addEventListener("click", (e) => {
  const b = e.target.closest(".time");
  if (!b || b.disabled) return;
  addToCart(state.service, state.date, b.dataset.time);
});

// ---------- Lista de reservas (varios días, horas y servicios) ----------
const cartKey = (it) => `${it.svc.id}|${it.date}|${it.time}`;
function addToCart(svc, date, time, { silent = false } = {}) {
  if (!svc) return;
  const it = { svc, date, time };
  if (state.cart.some((x) => cartKey(x) === cartKey(it))) { if (!silent) go(4); return; }
  if (state.cart.length >= MAX_CART) { toast(`Puedes reservar hasta ${MAX_CART} citas a la vez.`, "warn"); return; }
  state.cart.push(it);
  state.cart.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  state.service = svc;
  state.date = date;
  state.time = time;
  if (!silent) state.last = it;
  if (!silent) go(4);
}

// Mismo servicio y misma hora en los próximos 7 días (para reservar toda la semana)
async function renderCart() {
  const box = $("#cart");
  const items = state.cart;
  let repeat = "";
  const base = state.last && items.includes(state.last) ? state.last : items[0];
  if (base) {
    await loadUsed(base.date, addDays(base.date, 7));
    const days = [];
    for (let i = 1; i <= 7; i++) {
      const ds = addDays(base.date, i);
      if (!dateOpen(base.svc, ds)) continue;
      const t = dayTimes(base.svc, ds).find((x) => x.time === base.time);
      const inCart = items.some((x) => cartKey(x) === cartKey({ svc: base.svc, date: ds, time: base.time }));
      if (t && (t.ok || inCart)) days.push({ ds, left: t.left, inCart });
    }
    if (days.length) {
      const pending = days.filter((d) => !d.inCart).length;
      repeat = `
        <div class="repeat">
          <p><b>¿Toda la semana?</b> Repite ${esc(base.svc.name)} a las <b>${base.time}</b> estos días:</p>
          <div class="chips">${days.map((d) => `<button type="button" class="chip ${d.inCart ? "on" : ""}" data-rep="${d.ds}"><b>${dayLabel(d.ds).split(" ").slice(0, 2).join(" ")}</b><small>${d.inCart ? "✓ agregado" : `${d.left} lugares`}</small></button>`).join("")}</div>
          ${pending ? `<button type="button" class="link rep-all" data-rep-all>Agregar todos (${pending})</button>` : ""}
        </div>`;
    }
  }
  box.innerHTML = `
    <div class="cart-list">${items.map((it, i) => `<div class="cart-item"><span class="cart-n">${i + 1}</span><div><b>${dayLabel(it.date)} · ${it.time}</b><small>${esc(it.svc.name)}</small></div><button type="button" class="icon-btn" data-rm="${i}" aria-label="Quitar">${ICONS.close}</button></div>`).join("") || `<p class="muted">Aún no eliges horario.</p>`}</div>
    ${repeat}
    <button type="button" class="add-more" data-more>${ICONS.plus}<span>Agregar otro día, hora o servicio</span></button>`;
  $("#submitLabel").textContent = items.length > 1 ? `Confirmar ${items.length} reservas` : "Confirmar reserva";
}

$("#cart").addEventListener("click", (e) => {
  const base = state.last && state.cart.includes(state.last) ? state.last : state.cart[0];
  const rm = e.target.closest("[data-rm]");
  if (rm) {
    state.cart.splice(Number(rm.dataset.rm), 1);
    if (!state.cart.length) { go(1); return; }
    renderCart();
    return;
  }
  const rep = e.target.closest("[data-rep]");
  if (rep && base) {
    const it = { svc: base.svc, date: rep.dataset.rep, time: base.time };
    const idx = state.cart.findIndex((x) => cartKey(x) === cartKey(it));
    if (idx >= 0) state.cart.splice(idx, 1);
    else addToCart(base.svc, it.date, it.time, { silent: true });
    renderCart();
    return;
  }
  if (e.target.closest("[data-rep-all]") && base) {
    e.target.closest(".repeat").querySelectorAll(".chip:not(.on)").forEach((ch) => addToCart(base.svc, ch.dataset.rep, base.time, { silent: true }));
    renderCart();
    return;
  }
  if (e.target.closest("[data-more]")) go(1);
});

// ---------- Paso 4: datos ----------
const form = $("#form");
const saved = store.get("hpl_cliente", {});
for (const k of ["name", "phone", "email", "age", "emergency", "memberId"]) if (saved[k]) form[k].value = saved[k];
if (params.get("socio")) form.memberId.value = params.get("socio");

// ---------- Socio: sus datos se llenan solos ----------
const SESSION = "hpl_socio"; // misma sesión que el panel de miembros
const MEMBER_FIELDS = ["name", "phone", "email", "age", "emergency"];
let member = null;

async function loadMember(key) {
  try {
    const snap = await getDoc(doc(db, "portal", key));
    return snap.exists() ? { key, ...snap.data() } : null;
  } catch { return null; }
}

function applyMember(m) {
  member = m;
  const vals = { name: m.name, phone: m.phone, email: m.email, age: m.age, emergency: m.emergency };
  for (const k of MEMBER_FIELDS) {
    if (vals[k] != null && vals[k] !== "") form[k].value = vals[k];
    // Solo se muestran los datos que falten
    form[k].closest("label").hidden = !!form[k].value;
  }
  form.memberId.value = m.memberId;
  $("#memberIdField").hidden = true;
  $("#memberLogin").hidden = true;
  const card = $("#memberCard");
  card.hidden = false;
  card.innerHTML = `${ICONS.user}<div><b>Reservando como ${esc(m.name)}</b><small>Socio ${esc(m.memberId)} · tus datos ya están guardados</small></div><button type="button" class="link" id="notMe">No soy yo</button>`;
  $("#notMe").onclick = () => {
    member = null;
    store.del(SESSION);
    for (const k of [...MEMBER_FIELDS, "memberId"]) { form[k].value = ""; form[k].closest("label").hidden = false; }
    card.hidden = true;
    $("#memberLogin").hidden = false;
  };
}

$("#memberLoginBtn").onclick = () => { $("#memberLoginForm").hidden = !$("#memberLoginForm").hidden; $("#mlId").focus(); };
$("#mlGo").onclick = async () => {
  const id = $("#mlId").value.trim().toUpperCase();
  const last4 = digits($("#mlLast4").value);
  if (!id || last4.length !== 4) { toast("Escribe tu ID y los últimos 4 dígitos de tu teléfono.", "error"); return; }
  const m = await loadMember(await sha256(`${id}|${last4}`));
  if (!m) { toast("No encontramos un socio con esos datos.", "error"); return; }
  store.set(SESSION, m.key);
  applyMember(m);
  toast(`¡Hola ${m.name.split(" ")[0]}! Ya llenamos tus datos.`);
};

const savedSession = store.get(SESSION);
if (savedSession) loadMember(savedSession).then((m) => { if (m) applyMember(m); });

// Opción de recordatorio por notificación
const push = pushState(s.vapidKey);
if (push === "ask" || push === "ready") $("#pushOpt").hidden = false;
if (push === "install") { $("#pushHint").hidden = false; $("#pushHint").textContent = `¿Quieres que te avisemos 1 hora antes? ${INSTALL_HINT}`; }
if (push === "denied") { $("#pushHint").hidden = false; $("#pushHint").textContent = "Las notificaciones están bloqueadas en este navegador. Actívalas en los ajustes del sitio si quieres recibir el aviso 1 hora antes."; }
if (push === "ready") refreshToken(s.vapidKey);

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const err = validate(f);
  if (err) { toast(err, "error"); return; }
  const btn = $("#submitBtn");
  btn.disabled = true;
  btn.firstElementChild.textContent = "Reservando…";
  try {
    // Primero el permiso de notificaciones (el navegador exige que sea justo después del toque)
    let pushToken = "";
    if (!$("#pushOpt").hidden && form.push.checked) pushToken = (await enablePush(s.vapidKey)) || "";
    if (!state.cart.length) { toast("Elige al menos un horario.", "error"); go(1); return; }
    const passCode = newPassCode(); // un solo QR para todas las reservas de esta vez
    const ok = [];
    const failed = [];
    for (const it of [...state.cart]) {
      try { ok.push({ ...it, ...(await book(f, pushToken, it, passCode)) }); }
      catch (ex) { console.error(ex); failed.push({ ...it, full: ex.message === "FULL" }); }
    }
    if (!ok.length) {
      toast(failed.some((x) => x.full) ? "Esos horarios se acaban de llenar. Elige otros, por favor." : "No pudimos completar la reserva. Intenta de nuevo.", "error");
      return;
    }
    store.set("hpl_cliente", { name: f.name, phone: f.phone, email: f.email, age: f.age, emergency: f.emergency, memberId: f.memberId });
    state.cart = [];
    showDone(ok, failed, f, pushToken);
  } catch (ex) {
    console.error(ex);
    toast("No pudimos completar la reserva. Intenta de nuevo.", "error");
  } finally {
    btn.disabled = false;
    $("#submitLabel").textContent = state.cart.length > 1 ? `Confirmar ${state.cart.length} reservas` : "Confirmar reserva";
  }
});

function validate(f) {
  if (f.name.trim().length < 3) return "Escribe tu nombre completo.";
  if (digits(f.phone).length < 10) return "Escribe un teléfono válido de 10 dígitos.";
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return "Escribe un correo válido.";
  const age = Number(f.age);
  if (!age || age < 5 || age > 110) return "Escribe una edad válida.";
  if (digits(f.emergency).length < 10) return "Escribe un número de emergencia de 10 dígitos.";
  return null;
}

async function book(f, pushToken, item, passCode) {
  const { svc, date, time } = item;
  const dow = dowOf(date);
  const cap = Number(slotsOf(svc)[`${dow}_${time}`]);
  if (!cap) throw new Error("FULL");
  const slotRef = doc(db, "slots", `${svc.id}__${date}__${time}`);
  const resRef = doc(collection(db, "reservations"));
  const memberId = (member?.memberId || f.memberId).trim().toUpperCase();
  const pKey = member?.key || (memberId ? await portalKey(memberId, f.phone) : null);
  const token = randomToken();

  await runTransaction(db, async (tx) => {
    const slot = await tx.get(slotRef);
    const portal = pKey ? await tx.get(doc(db, "portal", pKey)) : null;
    const count = slot.exists() ? slot.data().count || 0 : 0;
    if (count >= cap) throw new Error("FULL");
    if (slot.exists()) tx.update(slotRef, { count: count + 1, cap });
    else tx.set(slotRef, { serviceId: svc.id, date, time, dow, cap, count: 1 });
    tx.set(resRef, {
      serviceId: svc.id,
      serviceName: svc.name,
      date,
      time,
      dow,
      startAt: Timestamp.fromDate(startAt(date, time)),
      name: f.name.trim(),
      phone: digits(f.phone),
      email: f.email.trim().toLowerCase(),
      age: Number(f.age),
      emergency: digits(f.emergency),
      notes: f.notes.trim(),
      memberId: portal?.exists() ? memberId : "",
      memberIdTyped: memberId,
      status: "confirmada",
      attendance: "pendiente",
      token,
      passCode,
      pushToken,
      reminderSent: false,
      source: "web",
      createdAt: serverTimestamp(),
    });
    if (portal?.exists()) {
      tx.set(doc(db, "portal", pKey, "reservas", resRef.id), {
        serviceName: svc.name, date, time, status: "confirmada", createdAt: serverTimestamp(),
      });
    }
  });
  state.used[usedKey(svc.id, date, time)] = (state.used[usedKey(svc.id, date, time)] || 0) + 1;
  return { id: resRef.id, token, passCode };
}

function icsFile(list) {
  const z = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const events = list.flatMap((r) => {
    const st = startAt(r.date, r.time);
    const en = new Date(st.getTime() + (Number(r.svc.durationMin) || 60) * 60000);
    return [
      "BEGIN:VEVENT", `UID:${r.id}@humanprimelab`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(st)}`, `DTEND:${z(en)}`,
      `SUMMARY:${r.svc.name} · ${s.name}`, s.address ? `LOCATION:${s.address}` : "",
      "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Tu cita es en una hora", "END:VALARM", "END:VEVENT",
    ];
  });
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Human Prime Lab//Reservas//ES", ...events, "END:VCALENDAR"].filter(Boolean).join("\r\n");
  return URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
}

function showDone(list, failed, f, pushToken) {
  const first = list[0];
  const many = list.length > 1;
  $(".done .step-title").textContent = many ? `¡${list.length} reservas confirmadas!` : "¡Reserva confirmada!";
  $("#doneCard").innerHTML = `
    ${list.map((r) => `<div class="done-row"><span>${dayLabel(r.date)} · ${r.time}</span><b>${esc(r.svc.name)}</b></div>`).join("")}
    ${failed.length ? `<div class="done-row warn"><span>No se pudo reservar</span><b>${failed.map((x) => `${dayLabel(x.date)} ${x.time}`).join(", ")} (lleno)</b></div>` : ""}
    <div class="done-row"><span>Nombre</span><b>${esc(f.name)}</b></div>`;
  renderPushBox({ ...first, all: list }, pushToken);
  // Pase de acceso: socio → su pase de socio; persona nueva → pase de sus reservas (un solo QR para todas)
  const passBox = $("#passBox");
  if (member) {
    renderPass(passBox, { kind: "member", key: member.key, name: member.name, memberId: member.memberId, ...memberStatus(member, todayStr()), until: member.endDate }, s, m);
  } else {
    const p = { kind: "reservation", id: first.id, token: first.token, code: first.passCode, name: f.name.trim(), service: first.svc.name, date: first.date, time: first.time, more: list.length - 1 };
    store.set("hpl_pass", p); // para verlo después en "Mi pase" dentro de la app
    renderPass(passBox, p, s, m);
  }
  const resumen = list.map((r) => `${r.svc.name} ${fmtDate(r.date)} ${r.time}`).join("; ");
  $("#doneActions").innerHTML = `
    <a class="btn btn-block" href="${icsFile(list)}" download="reservas-human-prime-lab.ics">${ICONS.calendar}<span>Agregar a mi calendario</span></a>
    ${s.whatsapp ? `<a class="btn btn-block" target="_blank" rel="noopener" href="${waLink(s.whatsapp, `Hola, acabo de reservar: ${resumen}. Código ${first.passCode}. Nombre: ${f.name}`)}">${ICONS.whatsapp}<span>Enviar al gimnasio</span></a>` : ""}
    <a class="btn btn-gold btn-block" href="index.html"><span>Volver al inicio</span></a>`;
  $(".done-icon").innerHTML = ICONS.check;
  go(5);
}

function renderPushBox(res, pushToken) {
  const box = $("#pushBox");
  const st = pushState(s.vapidKey);
  if (pushToken) {
    box.hidden = false;
    box.innerHTML = `${ICONS.bell}<p><b>Recordatorio activado.</b> Te avisaremos en este teléfono 1 hora antes para que confirmes tu asistencia.</p>`;
  } else if (st === "ask" || st === "ready") {
    box.hidden = false;
    box.innerHTML = `${ICONS.bell}<p>Recibe un aviso 1 hora antes para confirmar tu asistencia.</p><button class="btn btn-sm btn-gold" id="pushNow">Activar aviso</button>`;
    $("#pushNow").onclick = async () => {
      const t = await enablePush(s.vapidKey);
      if (!t) { toast("No se activaron las notificaciones. Revisa los permisos del navegador.", "warn"); return; }
      try {
        for (const r of (res.all || [res])) await updateDoc(doc(db, "reservations", r.id), { pushToken: t, tokenCheck: r.token });
        renderPushBox(res, t);
      } catch (e) { console.error(e); toast("No pudimos activar el aviso.", "error"); }
    };
  } else if (st === "install") {
    box.hidden = false;
    box.innerHTML = `${ICONS.bell}<p>${INSTALL_HINT}</p>`;
  } else box.hidden = true;
}

// ---------- Navegación ----------
function renderSummary() {
  const box = $("#summary");
  const parts = [];
  if (state.cart.length && state.step < 4) parts.push(`<button data-go="4" class="cart-go">${ICONS.check} Continuar con ${state.cart.length} ${state.cart.length === 1 ? "reserva" : "reservas"} →</button>`);
  if (state.step > 1 && state.service) parts.push(`<button data-go="1">${esc(state.service.name)}</button>`);
  if (state.step > 2 && state.date) parts.push(`<button data-go="2">${fmtDate(state.date)}</button>`);
  if (state.step > 3 && state.time) parts.push(`<button data-go="3">${state.time}</button>`);
  box.hidden = !parts.length || state.step === 5;
  box.innerHTML = parts.join("");
}
$("#summary").addEventListener("click", (e) => { const b = e.target.closest("[data-go]"); if (b) go(Number(b.dataset.go)); });

function go(step) {
  state.step = step;
  $$(".step").forEach((p) => { p.hidden = Number(p.dataset.panel) !== step; });
  $$("#stepper li").forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle("active", n === step);
    li.classList.toggle("done", n < step);
  });
  $("#stepper").hidden = step === 5;
  $("#backBtn").hidden = step === 1 || step === 5;
  if (step === 1) renderServices();
  if (step === 2) renderCalendar();
  if (step === 3) renderTimes();
  if (step === 4) renderCart();
  renderSummary();
  const panel = $(`.step[data-panel="${step}"]`);
  panel.classList.remove("page-fade");
  void panel.offsetWidth;
  panel.classList.add("page-fade");
  scrollTo({ top: 0, behavior: "smooth" });
}

$("#backBtn").addEventListener("click", () => go(Math.max(1, state.step - 1)));
$("#stepper").addEventListener("click", (e) => {
  const li = e.target.closest("li.done");
  if (li) go(Number(li.dataset.step));
});

await loadServices();
go(1);
if (params.get("s")) selectService(params.get("s"));
await loader.done();
