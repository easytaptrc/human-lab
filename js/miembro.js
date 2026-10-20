// Panel del socio: acceso con ID + últimos 4 dígitos del teléfono.
import { db, doc, getDoc, updateDoc, collection, getDocs, query, where } from "./firebase.js";
import { loadSite, startLoader, brandHTML } from "./site.js";
import { $, esc, ICONS, todayStr, daysBetween, fmtDate, parseDate, MESES_CORTOS, waLink, sha256, store, toast, digits } from "./utils.js";
import { pushState, enablePush, refreshToken, INSTALL_HINT } from "./push.js";
import { renderPass, memberStatus } from "./pass.js";

const loader = startLoader({ min: 700 });
const { s, m } = await loadSite({ media: ["logo", "hero"] });
const SESSION = "hpl_socio";

$("#header").innerHTML = `
  <a href="index.html" aria-label="Inicio">${brandHTML(s, m)}</a>
  <a class="icon-btn" href="index.html" aria-label="Volver al inicio">${ICONS.home}</a>`;

const form = $("#loginForm");
const [idLabel, passLabel] = form.querySelectorAll(".input-icon");
$("svg", idLabel).outerHTML = ICONS.id;
$("svg", passLabel).outerHTML = ICONS.lock;
$(".eye").innerHTML = ICONS.eye;
$(".btn-chev", $("#loginBtn")).innerHTML = ICONS.chevron;
$(".eye").addEventListener("click", () => { form.last4.type = form.last4.type === "password" ? "text" : "password"; });
if (m.hero) $("#loginMedia").innerHTML = `<img src="${esc(m.hero)}" alt="">`;
const forgot = $("#forgot");
if (s.whatsapp) forgot.href = waLink(s.whatsapp, "Hola, olvidé mi ID de socio. Mi nombre es: ");
else forgot.hidden = true;

async function fetchPortal(key) {
  const snap = await getDoc(doc(db, "portal", key));
  return snap.exists() ? snap.data() : null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = form.memberId.value.trim().toUpperCase();
  const last4 = digits(form.last4.value);
  if (!id || last4.length !== 4) { toast("Escribe tu ID y los últimos 4 dígitos de tu teléfono.", "error"); return; }
  const btn = $("#loginBtn");
  btn.disabled = true;
  try {
    const key = await sha256(`${id}|${last4}`);
    const data = await fetchPortal(key);
    if (!data) { toast("No encontramos un socio con esos datos.", "error"); return; }
    if (form.remember.checked) store.set(SESSION, key); else store.del(SESSION);
    await showProfile(key, data);
  } catch (ex) {
    console.error(ex);
    toast("No pudimos verificar tus datos. Intenta de nuevo.", "error");
  } finally {
    btn.disabled = false;
  }
});

function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

async function showProfile(key, p) {
  const today = todayStr();
  const active = !!p.endDate && p.endDate >= today;
  const none = !p.endDate;
  const left = p.endDate ? daysBetween(today, p.endDate) : null;
  let reservas = [];
  try {
    const snap = await getDocs(query(collection(db, "portal", key, "reservas"), where("date", ">=", today)));
    reservas = snap.docs.map((d) => d.data()).filter((r) => r.status !== "cancelada").sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  } catch (e) { console.warn(e); }
  const inbox = [...(p.inbox || [])].reverse();

  $("#login").hidden = true;
  const box = $("#profile");
  box.hidden = false;
  box.classList.add("page-fade");
  box.innerHTML = `
    <span class="eyebrow">Mi perfil</span>
    <div class="me">
      <div class="avatar">${p.photo ? `<img src="${esc(p.photo)}" alt="">` : initials(p.name)}</div>
      <div>
        <h1>${esc(p.name)}</h1>
        <span class="dot ${active ? "" : none ? "dot-muted" : "dot-bad"}">${active ? "Miembro activo" : none ? "Sin membresía activa" : "Membresía vencida"}</span>
        <small class="me-id">ID ${esc(p.memberId)}</small>
      </div>
    </div>

    <div class="card membership">
      <div>
        <span class="eyebrow">Membresía</span>
        <b class="${active ? "gold" : none ? "" : "bad"}">${active ? "Activa" : none ? "Sin plan" : "Vencida"}</b>
        <small>${esc(p.plan || "")}${p.autoRenew ? " · Renovación automática" : ""}</small>
      </div>
      <div class="renew">
        <span class="eyebrow">${active ? "Próxima renovación" : none ? "Vigencia" : "Venció el"}</span>
        <span class="renew-date">${ICONS.calendar}${p.endDate ? fmtDate(p.endDate) : "—"}</span>
        ${left !== null ? `<small>${active ? (left === 0 ? "Vence hoy" : `Faltan ${left} días`) : `Hace ${Math.abs(left)} días`}</small>` : ""}
      </div>
    </div>
    ${s.whatsapp && (!active || (left !== null && left <= 5)) ? `<a class="btn btn-gold btn-block" target="_blank" rel="noopener" href="${waLink(s.whatsapp, `Hola, soy ${p.name} (ID ${p.memberId}). Quiero ${none ? "contratar" : "renovar"} mi membresía.`)}">${ICONS.whatsapp}<span>${none ? "Contratar membresía" : "Renovar membresía"}</span></a>` : ""}

    ${(p.plans || []).length > 1 || (p.plans || []).some((e) => e.visitsTotal != null) ? `
    <div class="block-head"><span class="eyebrow">Mis planes</span></div>
    <div class="res-list">${p.plans.map((e) => {
      const ok = e.endDate >= today && (e.visitsLeft == null || e.visitsLeft > 0);
      return `<div class="res card"><div class="res-info"><b>${esc(e.plan)}</b>
        <span class="dot ${ok ? "" : "dot-bad"}">${ok ? "Vigente" : e.visitsLeft === 0 ? "Sin visitas" : "Vencido"} · vence ${fmtDate(e.endDate)}</span>
        ${e.visitsTotal != null ? `<span>${ICONS.check}${e.visitsLeft ?? 0} de ${e.visitsTotal} visitas restantes</span>` : ""}</div></div>`;
    }).join("")}</div>` : ""}

    <div class="block-head"><span class="eyebrow">Mi pase de acceso</span></div>
    <div id="memberPass"></div>

    <div class="push-card card" id="pushCard" hidden></div>

    <div class="block-head"><span class="eyebrow">Mis próximas reservas</span><a href="reservar.html?socio=${encodeURIComponent(p.memberId)}">Reservar ${ICONS.chevron}</a></div>
    <div class="res-list">
      ${reservas.length ? reservas.map((r) => {
        const d = parseDate(r.date);
        return `<div class="res card">
          <div class="res-date"><b>${d.getDate()}</b><span>${MESES_CORTOS[d.getMonth()]}</span></div>
          <div class="res-info"><b>${esc(r.serviceName)}</b><span>${ICONS.clock}${esc(r.time)}${s.address ? ` · ${ICONS.pin}${esc(s.name)}` : ""}</span></div>
        </div>`;
      }).join("") : `<div class="empty card">No tienes reservas próximas.</div>`}
    </div>

    <div class="block-head"><span class="eyebrow">Mensajes del gimnasio</span></div>
    <div class="inbox">
      ${inbox.length ? inbox.map((msg) => `
        <div class="msg card"><b>${esc(msg.title || "Mensaje")}</b><p>${esc(msg.body)}</p><small>${msg.date ? fmtDate(msg.date) : ""}</small></div>`).join("")
        : `<div class="empty card">Sin mensajes por ahora.</div>`}
    </div>

    <div class="profile-actions">
      <a class="btn btn-block" href="reservar.html?socio=${encodeURIComponent(p.memberId)}">${ICONS.calendar}<span>Nueva reserva</span></a>
      <button class="btn btn-block btn-ghost" id="logout">${ICONS.logout}<span>Cerrar sesión</span></button>
    </div>`;
  renderPush(key, p);
  renderPass($("#memberPass"), { kind: "member", key, name: p.name, memberId: p.memberId, ...memberStatus(p, today), until: p.endDate }, s, m);
  $("#logout").addEventListener("click", () => {
    store.del(SESSION);
    box.hidden = true;
    $("#login").hidden = false;
    form.reset();
  });
}

// Notificaciones del socio: avisos de vencimiento, mensajes del gimnasio y recordatorios de citas.
async function savePortalToken(key, p, token) {
  const list = p.pushTokens || [];
  if (!token || list.includes(token)) return;
  const next = [...list, token].slice(-5);
  await updateDoc(doc(db, "portal", key), { pushTokens: next });
  p.pushTokens = next;
}

function renderPush(key, p) {
  const box = $("#pushCard");
  const st = pushState(s.vapidKey);
  if (st === "off") { box.hidden = true; return; }
  box.hidden = false;
  if (st === "ready") {
    box.innerHTML = `${ICONS.bell}<p><b>Notificaciones activadas</b> en este teléfono.</p>`;
    refreshToken(s.vapidKey).then((t) => savePortalToken(key, p, t)).catch(() => {});
  } else if (st === "install") {
    box.innerHTML = `${ICONS.bell}<p>Recibe avisos de tu membresía y tus citas. ${INSTALL_HINT}</p>`;
  } else if (st === "denied") {
    box.innerHTML = `${ICONS.bell}<p>Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador para este sitio.</p>`;
  } else {
    box.innerHTML = `${ICONS.bell}<p>Recibe avisos de tu membresía, mensajes del gimnasio y recordatorios de tus citas.</p><button class="btn btn-sm btn-gold" id="pushOn">Activar</button>`;
    $("#pushOn").onclick = async () => {
      const t = await enablePush(s.vapidKey);
      if (!t) { toast("No se activaron las notificaciones.", "warn"); renderPush(key, p); return; }
      try { await savePortalToken(key, p, t); toast("¡Listo! Te avisaremos aquí."); } catch (e) { console.error(e); toast("No pudimos guardar el aviso.", "error"); }
      renderPush(key, p);
    };
  }
}

// Sesión recordada
const savedKey = store.get(SESSION);
let shown = false;
if (savedKey) {
  try {
    const data = await fetchPortal(savedKey);
    if (data) { await showProfile(savedKey, data); shown = true; }
  } catch (e) { console.warn(e); }
}
if (!shown) $("#login").hidden = false;
await loader.done();
