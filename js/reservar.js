// Reserva de citas: servicio → fecha → hora → datos → confirmación.
import { db, collection, doc, getDocs, query, where, runTransaction, serverTimestamp, Timestamp } from "./firebase.js";
import { loadSite, startLoader, brandHTML } from "./site.js";
import {
  $, $$, esc, ICONS, MESES, DIAS_CORTOS, todayStr, dateStr, addDays, dowOf, parseDate, startAt,
  fmtDate, fmtMoney, digits, waLink, portalKey, randomToken, toast, store,
} from "./utils.js";

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
const state = { step: 1, services: [], service: null, date: null, time: null, month: null };

// ---------- Servicios ----------
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
  $("#serviceList").innerHTML = state.services.map((x) => `
    <button class="service-opt" data-id="${esc(x.id)}">
      <span class="service-thumb">${x.image ? `<img src="${esc(x.image)}" alt="">` : ICONS.dumbbell}</span>
      <span class="service-name">${esc(x.name)}${x.durationMin || x.price ? `<small>${x.durationMin ? x.durationMin + " min" : ""}${x.durationMin && x.price ? " · " : ""}${x.price ? fmtMoney(x.price) : ""}</small>` : ""}</span>
      ${ICONS.chevron}
    </button>`).join("");
}

$("#serviceList").addEventListener("click", (e) => {
  const b = e.target.closest(".service-opt");
  if (!b) return;
  selectService(b.dataset.id);
});

function selectService(id) {
  const svc = state.services.find((x) => x.id === id);
  if (!svc) return;
  state.service = svc;
  state.date = state.time = null;
  $$(".service-opt").forEach((b) => b.classList.toggle("sel", b.dataset.id === id));
  const first = firstAvailableDate();
  const base = first ? parseDate(first) : new Date();
  state.month = new Date(base.getFullYear(), base.getMonth(), 1);
  go(2);
}

// ---------- Calendario ----------
const slotsOf = (svc) => svc.slots || {};
const timesForDow = (svc, dow) =>
  Object.entries(slotsOf(svc))
    .filter(([k, cap]) => k.startsWith(dow + "_") && Number(cap) > 0)
    .map(([k, cap]) => ({ time: k.slice(2), cap: Number(cap) }))
    .sort((a, b) => a.time.localeCompare(b.time));

const maxDate = () => addDays(todayStr(), Number(s.bookingDays) || 30);

function dateEnabled(ds) {
  const svc = state.service;
  if (!svc || ds < todayStr() || ds > maxDate()) return false;
  if ((svc.closedDates || []).includes(ds)) return false;
  return timesForDow(svc, dowOf(ds)).length > 0;
}

function firstAvailableDate() {
  for (let i = 0, d = todayStr(); i <= (Number(s.bookingDays) || 30); i++, d = addDays(d, 1)) if (dateEnabled(d)) return d;
  return null;
}

function renderCalendar() {
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
  const max = parseDate(maxDate());
  $("#calNext").disabled = new Date(mo.getFullYear(), mo.getMonth() + 1, 1) > max;
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

// ---------- Horarios ----------
async function renderTimes() {
  const svc = state.service;
  const box = $("#times");
  $("#timeSub").textContent = fmtDate(state.date, { long: true });
  box.innerHTML = `<div class="empty"><div class="spinner" style="margin:auto"></div></div>`;
  const list = timesForDow(svc, dowOf(state.date));
  const used = {};
  try {
    const snap = await getDocs(query(collection(db, "slots"), where("serviceId", "==", svc.id), where("date", "==", state.date)));
    snap.forEach((d) => { used[d.data().time] = d.data().count || 0; });
  } catch (e) {
    console.warn(e);
  }
  const limit = Date.now() + (Number(s.minNoticeMin) || 0) * 60000;
  box.innerHTML = list.map(({ time, cap }) => {
    const left = Math.max(0, cap - (used[time] || 0));
    const past = startAt(state.date, time).getTime() < limit;
    const off = left === 0 || past;
    return `<button class="time ${time === state.time ? "sel" : ""}" data-time="${time}" data-cap="${cap}" ${off ? "disabled" : ""}>
      <b>${time}</b><small>${past ? "No disponible" : left === 0 ? "Lleno" : `${left} ${left === 1 ? "lugar" : "lugares"}`}</small>
    </button>`;
  }).join("") || `<div class="empty">No hay horarios para este día.</div>`;
}

$("#times").addEventListener("click", (e) => {
  const b = e.target.closest(".time");
  if (!b || b.disabled) return;
  state.time = b.dataset.time;
  go(4);
});

// ---------- Datos y confirmación ----------
const form = $("#form");
const saved = store.get("hpl_cliente", {});
for (const k of ["name", "phone", "email", "age", "emergency", "memberId"]) if (saved[k]) form[k].value = saved[k];
if (params.get("socio")) form.memberId.value = params.get("socio");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const err = validate(f);
  if (err) { toast(err, "error"); return; }
  const btn = $("#submitBtn");
  btn.disabled = true;
  btn.firstElementChild.textContent = "Reservando…";
  try {
    const res = await book(f);
    store.set("hpl_cliente", { name: f.name, phone: f.phone, email: f.email, age: f.age, emergency: f.emergency, memberId: f.memberId });
    showDone(res, f);
  } catch (ex) {
    console.error(ex);
    if (ex.message === "FULL") {
      toast("Ese horario se acaba de llenar. Elige otro, por favor.", "error");
      go(3);
    } else {
      toast("No pudimos completar la reserva. Intenta de nuevo.", "error");
    }
  } finally {
    btn.disabled = false;
    btn.firstElementChild.textContent = "Confirmar reserva";
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

async function book(f) {
  const svc = state.service;
  const { date, time } = state;
  const dow = dowOf(date);
  const cap = Number(slotsOf(svc)[`${dow}_${time}`]);
  const slotRef = doc(db, "slots", `${svc.id}__${date}__${time}`);
  const resRef = doc(collection(db, "reservations"));
  const memberId = f.memberId.trim().toUpperCase();
  const pKey = memberId ? await portalKey(memberId, f.phone) : null;
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
  return { id: resRef.id, token };
}

function icsFile(res) {
  const st = startAt(state.date, state.time);
  const en = new Date(st.getTime() + (Number(state.service.durationMin) || 60) * 60000);
  const z = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const body = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Human Prime Lab//Reservas//ES", "BEGIN:VEVENT",
    `UID:${res.id}@humanprimelab`, `DTSTAMP:${z(new Date())}`, `DTSTART:${z(st)}`, `DTEND:${z(en)}`,
    `SUMMARY:${state.service.name} · ${s.name}`, s.address ? `LOCATION:${s.address}` : "",
    "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Tu cita es en una hora", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
  return URL.createObjectURL(new Blob([body], { type: "text/calendar" }));
}

function showDone(res, f) {
  const folio = res.id.slice(0, 6).toUpperCase();
  $("#doneCard").innerHTML = `
    <div class="done-row"><span>Folio</span><b>${folio}</b></div>
    <div class="done-row"><span>Servicio</span><b>${esc(state.service.name)}</b></div>
    <div class="done-row"><span>Fecha</span><b>${fmtDate(state.date, { long: true })}</b></div>
    <div class="done-row"><span>Hora</span><b>${state.time}</b></div>
    <div class="done-row"><span>Nombre</span><b>${esc(f.name)}</b></div>`;
  $("#doneActions").innerHTML = `
    <a class="btn btn-block" href="${icsFile(res)}" download="reserva-human-prime-lab.ics">${ICONS.calendar}<span>Agregar a mi calendario</span></a>
    ${s.whatsapp ? `<a class="btn btn-block" target="_blank" rel="noopener" href="${waLink(s.whatsapp, `Hola, acabo de reservar ${state.service.name} el ${fmtDate(state.date, { long: true })} a las ${state.time}. Folio ${folio}. Nombre: ${f.name}`)}">${ICONS.whatsapp}<span>Enviar al gimnasio</span></a>` : ""}
    <a class="btn btn-gold btn-block" href="index.html"><span>Volver al inicio</span></a>`;
  $(".done-icon").innerHTML = ICONS.check;
  go(5);
}

// ---------- Navegación ----------
function renderSummary() {
  const box = $("#summary");
  const parts = [];
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
  if (step === 2) renderCalendar();
  if (step === 3) renderTimes();
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
