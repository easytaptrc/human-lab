// Recepción: escanear el pase (QR) de socios y reservas para dar acceso y registrar asistencia.
import { db, doc, getDoc, getDocs, updateDoc, setDoc, collection, query, where, limit, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, todayStr, fmtDate, waLink, toast } from "../utils.js";
import { parseQR, startScanner } from "../qr.js";
import { memberState, memberPlans, planUsable, daysToBirthday, invalidate, siteBase } from "./data.js";
import { checkIn, openMemberForm, renew } from "./socios.js";
import { setStatus, STATUS } from "./reservas.js";
import { avatar, loadingHTML } from "./ui.js";

// Sonido corto: agudo = permitido, grave = denegado
function beep(ok) {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.15;
    o.connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + (ok ? 0.15 : 0.4));
  } catch { /* sin audio */ }
  navigator.vibrate?.(ok ? 80 : [120, 80, 120]);
}

export async function render(el, ctx) {
  el.innerHTML = `
    <div class="scan-grid">
      <div class="panel">
        <div class="panel-head"><h2>Escanear pase</h2><button class="btn btn-sm btn-gold" id="camBtn">${ICONS.eye}<span>Usar cámara</span></button></div>
        <div class="panel-body">
          <div class="scan-cam" id="camBox" hidden><video id="video" muted playsinline></video><i class="scan-frame"></i></div>
          <form id="manual" class="scan-manual">
            <label class="input-icon">${ICONS.id}<input class="input" id="code" placeholder="Escanea con lector USB o escribe el ID / código" autocomplete="off" autocapitalize="characters"></label>
            <button class="btn btn-sm" type="submit">Buscar</button>
          </form>
          <p class="hint">Funciona con la cámara de la tablet o celular, con un lector de códigos USB (se conecta como teclado) o escribiendo el ID del socio.</p>
        </div>
      </div>
      <div class="panel scan-result" id="result"><div class="empty">Escanea un pase para ver el acceso.</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h2>Accesos de hoy</h2><span class="muted" id="todayCount"></span></div><div class="table-wrap" id="todayList">${loadingHTML}</div></div>`;

  const input = $("#code", el);
  let stopCam = null;
  let busy = false;

  const drawToday = async () => {
    try {
      const snap = await getDocs(query(collection(db, "visits"), where("date", "==", todayStr())));
      const list = snap.docs.map((d) => d.data()).sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
      $("#todayCount", el).textContent = `${list.length} accesos`;
      $("#todayList", el).innerHTML = list.length ? `<table class="t"><thead><tr><th>Hora</th><th>Socio</th><th>Plan</th><th>Registro</th></tr></thead><tbody>
        ${list.map((v) => `<tr><td class="num">${v.at?.toDate ? v.at.toDate().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td>${esc(v.name)} <span class="muted">· ${esc(v.memberId)}</span></td><td>${esc(v.plan || "—")}</td><td>${v.via === "qr" ? "QR" : "Manual"}${v.override ? ` <span class="badge badge-warn">sin membresía</span>` : ""}</td></tr>`).join("")}
        </tbody></table>` : `<div class="empty">Aún no hay accesos hoy.</div>`;
    } catch { $("#todayList", el).innerHTML = `<div class="empty">No disponible con tus permisos.</div>`; }
  };

  const show = (html) => { $("#result", el).innerHTML = html; };

  // ---------- Socio ----------
  async function handleMember(id) {
    const snap = await getDoc(doc(db, "members", id));
    if (!snap.exists()) { beep(false); show(`<div class="access bad"><b>No encontrado</b><p>No hay ningún socio con el ID ${esc(id)}.</p></div>`); return; }
    const mb = { id: snap.id, ...snap.data() };
    const today = todayStr();
    const st = memberState(mb, today);
    const plans = memberPlans(mb);
    const usable = plans.some((e) => planUsable(e, today)) || (!plans.length && st.key !== "vencida" && st.key !== "sin");
    const bday = daysToBirthday(mb.birthDate, today);
    const already = mb.lastVisit === today;
    const head = `
      <div class="access-who">${avatar(mb.name)}<div><b>${esc(mb.name)}</b><small>Socio ${esc(mb.memberId)} · ${esc(mb.plan || "sin plan")}</small></div></div>
      ${bday === 0 ? `<p class="access-bday">🎂 ¡Hoy es su cumpleaños! Felicítalo.</p>` : ""}
      <div class="access-plans">${plans.map((e) => `<span class="badge ${planUsable(e, today) ? "badge-ok" : "badge-bad"}">${esc(e.plan)} · ${e.visitsTotal != null ? `${e.visitsLeft ?? 0}/${e.visitsTotal} visitas` : `vence ${fmtDate(e.endDate)}`}</span>`).join("") || `<span class="badge">Sin planes</span>`}</div>`;
    if (usable && !already) {
      await checkIn(mb, { via: "qr", by: ctx.staff.name });
      beep(true);
      show(`<div class="access ok"><b>ACCESO PERMITIDO</b><p>Asistencia registrada</p></div>${head}`);
    } else if (usable && already) {
      beep(true);
      show(`<div class="access ok"><b>ACCESO PERMITIDO</b><p>Ya registró su acceso hoy</p></div>${head}
        <div class="btn-row"><button class="btn btn-sm" data-a="again">Registrar otra vez</button></div>`);
    } else {
      beep(false);
      show(`<div class="access bad"><b>ACCESO DENEGADO</b><p>${st.key === "sin" ? "No tiene membresía" : plans.some((e) => e.visitsLeft === 0) && !plans.some((e) => planUsable(e, today)) ? "Ya usó todas sus visitas" : `Membresía vencida el ${fmtDate(mb.endDate)}`}</p></div>${head}
        <div class="btn-row">
          ${ctx.can("socios") ? `<button class="btn btn-sm btn-gold" data-a="renew">${ICONS.calendar}<span>Renovar ahora</span></button>` : ""}
          <button class="btn btn-sm" data-a="override">Permitir acceso de todos modos</button>
          ${mb.phone ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="${waLink(mb.phone, `Hola ${mb.name.split(" ")[0]}, tu membresía de Human Prime Lab no está vigente. ¿Te ayudamos a renovarla?`)}">${ICONS.whatsapp}<span>WhatsApp</span></a>` : ""}
        </div>`);
    }
    $("#result", el).onclick = async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "again") { await checkIn(mb, { via: "qr", by: ctx.staff.name }); drawToday(); }
      if (a === "override") { await checkIn(mb, { via: "qr", override: true, by: ctx.staff.name }); show(`<div class="access ok"><b>ACCESO PERMITIDO</b><p>Registrado sin membresía vigente</p></div>${head}`); drawToday(); }
      if (a === "renew") renew(ctx, mb, () => handleMember(mb.id));
    };
    drawToday();
  }

  // ---------- Reserva (persona nueva) ----------
  async function handleReservation(code) {
    const snap = await getDocs(query(collection(db, "reservations"), where("passCode", "==", code), limit(1)));
    if (snap.empty) { beep(false); show(`<div class="access bad"><b>No encontrado</b><p>No hay ninguna reserva con el código ${esc(code)}.</p></div>`); return; }
    const r = { id: snap.docs[0].id, ...snap.docs[0].data() };
    const today = todayStr();
    // Si ya es socio, se trata como acceso de socio
    if (r.memberId) { await handleMember(r.memberId); return; }
    let note = "";
    let ok = true;
    if (r.status === "cancelada") { ok = false; note = "Esta reserva fue cancelada."; }
    else if (r.date !== today) { ok = false; note = `La reserva es para el ${fmtDate(r.date, { long: true })}.`; }
    else if (r.status === "confirmada") { await setStatus(r, "asistio"); r.status = "asistio"; note = "Llegada registrada."; }
    else note = `Estado: ${STATUS[r.status]?.[0] || r.status}.`;
    beep(ok);
    show(`
      <div class="access ${ok ? "ok" : "warn"}"><b>${ok ? "BIENVENIDO" : "REVISAR RESERVA"}</b><p>${esc(note)}</p></div>
      <div class="access-who">${avatar(r.name)}<div><b>${esc(r.name)}</b><small>${esc(r.serviceName)} · ${fmtDate(r.date)} ${esc(r.time)}</small></div></div>
      <dl class="kv">
        <dt>Teléfono</dt><dd>${esc(r.phone)}</dd>
        <dt>Correo</dt><dd>${esc(r.email)}</dd>
        <dt>Edad</dt><dd>${esc(r.age)}</dd>
        <dt>Emergencia</dt><dd>${esc(r.emergency)}</dd>
        <dt>Observaciones</dt><dd>${esc(r.notes || "—")}</dd>
      </dl>
      <div class="btn-row">
        ${ctx.can("socios") ? `<button class="btn btn-sm btn-gold" data-a="alta">${ICONS.id}<span>Dar de alta como socio</span></button>` : ""}
        ${ok || r.status === "asistio" ? "" : `<button class="btn btn-sm" data-a="arrive">Registrar llegada de todos modos</button>`}
      </div>`);
    $("#result", el).onclick = async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "arrive") { await setStatus(r, "asistio"); handleReservation(code); }
      if (a === "alta") {
        // Los datos que llenó al reservar se pasan al formulario de alta
        openMemberForm(ctx, null, async (mb) => {
          try {
            await updateDoc(doc(db, "reservations", r.id), { memberId: mb.memberId });
            if (r.date >= today && mb.portalKey) {
              await setDoc(doc(db, "portal", mb.portalKey, "reservas", r.id), { serviceName: r.serviceName, date: r.date, time: r.time, status: r.status, createdAt: serverTimestamp() });
            }
          } catch (ex) { console.error(ex); }
          invalidate("members");
          const passUrl = `${siteBase(ctx.s)}pase.html?k=${mb.portalKey}`;
          show(`<div class="access ok"><b>¡NUEVO SOCIO!</b><p>${esc(mb.name)} ya es socio con el ID <b>${esc(mb.memberId)}</b>.</p></div>
            <p class="hint">Envíale su pase de socio: lo podrá agregar a Apple Wallet o Google Wallet y será el que escanees desde ahora.</p>
            <div class="btn-row">
              ${mb.phone ? `<a class="btn btn-sm btn-gold" target="_blank" rel="noopener" href="${waLink(mb.phone, `¡Bienvenido a Human Prime Lab, ${mb.name.split(" ")[0]}! Tu ID de socio es ${mb.memberId}. Aquí está tu pase de acceso: ${passUrl}`)}">${ICONS.whatsapp}<span>Enviar pase por WhatsApp</span></a>` : ""}
              <a class="btn btn-sm" href="${passUrl}" target="_blank" rel="noopener">${ICONS.eye}<span>Ver pase</span></a>
            </div>`);
        }, { name: r.name, phone: r.phone, email: r.email, age: r.age, emergency: r.emergency, notes: r.notes });
      }
    };
    drawToday();
  }

  async function handle(text) {
    if (busy) return;
    const parsed = parseQR(text);
    if (!parsed) return;
    busy = true;
    show(loadingHTML);
    try {
      if (parsed.kind === "reservation") await handleReservation(parsed.value);
      else await handleMember(parsed.value);
    } catch (ex) {
      console.error(ex);
      beep(false);
      show(`<div class="access bad"><b>Error</b><p>${ex.code === "permission-denied" ? "No tienes permiso para esta acción." : "No se pudo leer el pase. Intenta de nuevo."}</p></div>`);
    } finally {
      busy = false;
      input.value = "";
      if (!stopCam) input.focus();
    }
  }

  $("#manual", el).addEventListener("submit", (e) => { e.preventDefault(); handle(input.value); });
  $("#camBtn", el).addEventListener("click", async () => {
    if (stopCam) { stopCam(); stopCam = null; $("#camBox", el).hidden = true; $("#camBtn", el).lastChild.textContent = "Usar cámara"; return; }
    try {
      $("#camBox", el).hidden = false;
      stopCam = await startScanner($("#video", el), handle);
      $("#camBtn", el).lastChild.textContent = "Detener cámara";
    } catch (ex) {
      console.error(ex);
      $("#camBox", el).hidden = true;
      toast("No se pudo abrir la cámara. Revisa el permiso de cámara del navegador.", "error");
    }
  });
  input.focus();
  drawToday();
  return () => { if (stopCam) stopCam(); };
}
