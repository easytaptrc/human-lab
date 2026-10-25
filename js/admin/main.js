// Panel de administración y recepción: acceso, permisos por usuario y navegación.
import {
  app, db, doc, getDoc, updateDoc, writeBatch, serverTimestamp, collection, query, where, onSnapshot, USE_EMULATORS,
} from "../firebase.js";
import { pushState, enablePush, refreshToken, localNotify, INSTALL_HINT } from "../push.js";
import { openInstallGuide, isStandalone } from "../install-guide.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { loadSite, startLoader, brandHTML } from "../site.js";
import { $, esc, ICONS, toast, todayStr, fmtDate } from "../utils.js";
import { MODULES } from "./data.js";
import { initials } from "./ui.js";

const loader = startLoader({ min: 900 });
const { s, m } = await loadSite({ media: ["logo", "logoFull"] });
const auth = getAuth(app);
if (USE_EMULATORS) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
await setPersistence(auth, browserLocalPersistence).catch(() => {});

const PAGES = {
  inicio: ["Panel de administración", "Gestión integral de miembros, reservas y servicios."],
  acceso: ["Escanear acceso", "Recepción: escanea el pase de socios y reservas."],
  acceso: ["Escanear acceso", "Recepción: escanea el pase de socios y reservas."],
  reservas: ["Reservas", "Agenda del día, asistencia y cupos por servicio."],
  socios: ["Miembros", "Registro de socios, ID, mensualidades y asistencia."],
  servicios: ["Servicios y cupos", "Secciones del gimnasio, horarios y lugares disponibles."],
  planes: ["Planes y precios", "Membresías que puedes asignar a tus socios."],
  reportes: ["Reportes", "Miembros activos, vencidos y personas sin asistir."],
  mensajes: ["Mensajes", "Comunicación con tus socios desde el panel."],
  notificaciones: ["Notificaciones", "Recordatorios de citas, vencimientos y promociones."],
  sitio: ["Configuración del sitio", "Logos, portada, enlaces, números y colores de tu página."],
  personal: ["Personal y permisos", "Usuarios del gimnasio y qué secciones puede ver cada uno."],
};

const ctx = {
  s, m, auth, staff: null,
  can(key) {
    const st = this.staff;
    return !!st && (st.role === "owner" || st.perms?.[key] === true);
  },
  go(route) { location.hash = route; },
};

$("#authBrand").innerHTML = brandHTML(s, m);
$("#sideBrand").innerHTML = brandHTML(s, m);
$("#menuBtn").innerHTML = ICONS.menu;

// ---------- Acceso ----------
let setupMode = false;
const form = $("#authForm");

async function checkSetup() {
  try {
    const snap = await getDoc(doc(db, "meta", "setup"));
    setupMode = !snap.exists();
  } catch {
    setupMode = false;
  }
  if (setupMode) {
    $("#authTitle").textContent = "Configuración inicial";
    $("#authSub").textContent = "Crea la cuenta del administrador principal (dueño). Tendrá acceso a todo el panel.";
    $(".auth-name").hidden = false;
    form.password.autocomplete = "new-password";
    $("#authBtn").textContent = "Crear administrador";
    $("#forgotBtn").hidden = true;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!email || password.length < 6) { toast("Escribe tu correo y una contraseña de al menos 6 caracteres.", "error"); return; }
  const btn = $("#authBtn");
  btn.disabled = true;
  try {
    if (setupMode) {
      const name = form.name.value.trim() || "Administrador";
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const batch = writeBatch(db);
      batch.set(doc(db, "meta", "setup"), { ownerUid: cred.user.uid, createdAt: serverTimestamp() });
      batch.set(doc(db, "staff", cred.user.uid), {
        name, email, role: "owner", position: "Dueño", active: true,
        perms: Object.fromEntries(MODULES.map((x) => [x.key, true])), createdAt: serverTimestamp(),
      });
      await batch.commit();
      setupMode = false;
      await enter(cred.user);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (ex) {
    console.error(ex);
    const msg = {
      "auth/invalid-credential": "Correo o contraseña incorrectos.",
      "auth/wrong-password": "Correo o contraseña incorrectos.",
      "auth/user-not-found": "Correo o contraseña incorrectos.",
      "auth/email-already-in-use": "Ese correo ya está registrado.",
      "auth/too-many-requests": "Demasiados intentos. Espera un momento.",
      "auth/operation-not-allowed": "Activa el acceso con correo y contraseña en Firebase Authentication.",
    }[ex.code] || "No se pudo iniciar sesión.";
    toast(msg, "error");
  } finally {
    btn.disabled = false;
  }
});

$("#forgotBtn").addEventListener("click", async () => {
  const email = form.email.value.trim();
  if (!email) { toast("Escribe tu correo primero.", "warn"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    toast("Te enviamos un correo para restablecer tu contraseña.");
  } catch {
    toast("No se pudo enviar el correo.", "error");
  }
});

async function enter(user) {
  const snap = await getDoc(doc(db, "staff", user.uid));
  if (!snap.exists() || snap.data().active === false) {
    toast("Tu usuario no tiene acceso al panel.", "error");
    await signOut(auth);
    return false;
  }
  ctx.staff = { uid: user.uid, ...snap.data() };
  buildShell();
  $("#auth").hidden = true;
  $("#shell").hidden = false;
  route();
  return true;
}

// ---------- Estructura ----------
function allowed() { return MODULES.filter((x) => ctx.can(x.key)); }

function buildShell() {
  let group = null;
  $("#nav").innerHTML = allowed().map((x) => {
    let head = "";
    if (x.group && x.group !== group) { group = x.group; head = `<span class="nav-group">${esc(group)}</span>`; }
    return `${head}<a href="#${x.key}" data-key="${x.key}">${ICONS[x.icon]}<span>${esc(x.label)}</span></a>`;
  }).join("") + `<a href="index.html" target="_blank" rel="noopener" class="nav-ext">${ICONS.eye}<span>Ver sitio</span></a>`
    + (isStandalone() ? "" : `<a href="#" class="nav-install" data-install-admin><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>Descargar app del admin</span></a>`);
  const st = ctx.staff;
  $("#user").innerHTML = `
    <button class="user-btn" id="userBtn"><span class="av">${esc(initials(st.name))}</span><span class="user-name">${esc(st.name)}</span>${ICONS.chevron}</button>
    <div class="user-menu" id="userMenu" hidden>
      <div class="user-info"><b>${esc(st.name)}</b><small>${esc(st.position || (st.role === "owner" ? "Dueño" : "Personal"))}</small><small>${esc(st.email)}</small></div>
      <button id="pushBtn">${ICONS.bell}<span id="pushLabel">Activar notificaciones</span></button>
      <button id="logoutBtn">${ICONS.logout}<span>Cerrar sesión</span></button>
    </div>`;
  $("#userBtn").onclick = (e) => { e.stopPropagation(); $("#userMenu").hidden = !$("#userMenu").hidden; };
  document.addEventListener("click", () => { const um = $("#userMenu"); if (um) um.hidden = true; });
  $("#logoutBtn").onclick = async () => { await signOut(auth); location.hash = ""; location.reload(); };
  setupStaffPush();
  watchReservations();
}

// ---------- Notificaciones del personal ----------
async function saveStaffToken(token) {
  const list = ctx.staff.pushTokens || [];
  if (!token || list.includes(token)) return;
  const next = [...list, token].slice(-10);
  await updateDoc(doc(db, "staff", ctx.staff.uid), { pushTokens: next });
  ctx.staff.pushTokens = next;
}

function setupStaffPush() {
  const label = $("#pushLabel");
  const btn = $("#pushBtn");
  const paint = () => {
    const st = pushState(s.vapidKey);
    btn.hidden = st === "off";
    label.textContent = { ready: "Notificaciones activadas ✓", denied: "Notificaciones bloqueadas", install: "Activar notificaciones" }[st] || "Activar notificaciones";
  };
  paint();
  if (pushState(s.vapidKey) === "ready") refreshToken(s.vapidKey).then(saveStaffToken).catch(() => {});
  btn.onclick = async (e) => {
    e.stopPropagation();
    const st = pushState(s.vapidKey);
    if (st === "install") { toast(INSTALL_HINT, "warn"); return; }
    if (st === "denied") { toast("Activa las notificaciones para este sitio en los ajustes del navegador.", "warn"); return; }
    const t = await enablePush(s.vapidKey);
    if (!t) { toast("No se activaron las notificaciones.", "warn"); return; }
    try { await saveStaffToken(t); toast("Recibirás avisos de nuevas reservas en este dispositivo."); } catch (ex) { console.error(ex); }
    paint();
  };
}

// Aviso en vivo mientras el panel está abierto: nuevas reservas y confirmaciones de asistencia.
let unwatch = null;
function watchReservations() {
  if (unwatch || !ctx.can("reservas")) return;
  let first = true;
  const seen = new Map(); // id → asistencia conocida
  const groupSeen = new Set();
  unwatch = onSnapshot(query(collection(db, "reservations"), where("date", ">=", todayStr())), (snap) => {
    snap.docChanges().forEach((ch) => {
      const r = ch.doc.data();
      const before = seen.get(ch.doc.id);
      seen.set(ch.doc.id, r.attendance);
      if (first || ch.doc.metadata.hasPendingWrites) return;
      const when = `${fmtDate(r.date)} · ${r.time}`;
      let title = null;
      if (ch.type === "added" && r.source === "recepcion" && r.by === ctx.staff.name) return; // la acaba de capturar este mismo usuario
      // Varias reservas del mismo cliente a la vez (toda la semana) → un solo aviso
      if (ch.type === "added" && r.passCode) { if (groupSeen.has(r.passCode)) return; groupSeen.add(r.passCode); setTimeout(() => groupSeen.delete(r.passCode), 60000); }
      if (ch.type === "added") title = "Nueva reserva";
      else if (ch.type === "modified" && before !== r.attendance && r.attendance === "confirmada") title = "Asistencia confirmada";
      else if (ch.type === "modified" && before !== r.attendance && r.attendance === "no_asistira") title = "Cliente no asistirá";
      if (!title) return;
      const body = `${r.name} · ${r.serviceName} · ${when}`;
      toast(`${title}: ${body}`);
      dispatchEvent(new CustomEvent("hpl:reserva"));
      if (document.hidden) localNotify(title, body, "admin.html#reservas", `res-${ch.doc.id}`);
    });
    first = false;
  }, (e) => console.warn("Avisos en vivo no disponibles:", e.code));
}

// En el teléfono las tablas se muestran como tarjetas: cada celda lleva el título de su columna.
let labelQueued = false;
function labelTables() {
  labelQueued = false;
  document.querySelectorAll("table.t").forEach((t) => {
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    t.querySelectorAll("tbody tr").forEach((tr) => [...tr.children].forEach((td, i) => {
      if (td.dataset.label === undefined) td.dataset.label = heads[i] || "";
    }));
  });
}
new MutationObserver(() => {
  if (!labelQueued) { labelQueued = true; requestAnimationFrame(labelTables); }
}).observe(document.body, { childList: true, subtree: true });

const toggleSide = (open) => document.body.classList.toggle("side-open", open);
$("#menuBtn").addEventListener("click", () => toggleSide(true));
$("#scrim").addEventListener("click", () => toggleSide(false));
$("#nav").addEventListener("click", (e) => {
  if (e.target.closest("[data-install-admin]")) {
    e.preventDefault();
    openInstallGuide({ name: "Human Prime Lab · Administración", label: "HPL Admin", icon: "assets/icons/admin-192.png", admin: true });
  }
  if (e.target.closest("a")) toggleSide(false);
});

// ---------- Rutas ----------
let cleanup = null;
let routeToken = 0;

async function route() {
  if (!ctx.staff) return;
  const list = allowed();
  if (!list.length) {
    $("#content").innerHTML = `<div class="empty card">Tu usuario no tiene secciones asignadas. Pide al administrador que te dé permisos.</div>`;
    return;
  }
  let key = location.hash.replace("#", "").split(/[/?]/)[0];
  if (!list.find((x) => x.key === key)) {
    key = list[0].key;
    history.replaceState(null, "", "#" + key);
  }
  document.querySelectorAll("#nav a[data-key]").forEach((a) => a.classList.toggle("active", a.dataset.key === key));
  // En el teléfono se usa el nombre corto del menú para que el título no se corte
  $("#pageTitle").textContent = innerWidth < 640 ? (({ short, label }) => short || label)(MODULES.find((x) => x.key === key)) : PAGES[key][0];
  $("#pageSub").textContent = PAGES[key][1];
  document.title = `${PAGES[key][0]} · ${s.name}`;
  if (typeof cleanup === "function") cleanup();
  cleanup = null;
  const token = ++routeToken;
  const el = $("#content");
  el.innerHTML = `<div class="empty"><div class="spinner" style="margin:auto"></div></div>`;
  try {
    const mod = await import(`./${key}.js`);
    if (token !== routeToken) return;
    el.innerHTML = "";
    el.className = `content page-fade mod-${key}`;
    cleanup = await mod.render(el, ctx);
  } catch (ex) {
    console.error(ex);
    el.innerHTML = `<div class="empty card">No se pudo cargar esta sección. ${ex.code === "permission-denied" ? "No tienes permiso o faltan las reglas de seguridad de Firestore." : "Revisa tu conexión."}</div>`;
  }
  scrollTo(0, 0);
}
addEventListener("hashchange", route);

// ---------- Inicio ----------
let first = true;
onAuthStateChanged(auth, async (user) => {
  if (user && !setupMode) {
    if (!ctx.staff || ctx.staff.uid !== user.uid) {
      const ok = await enter(user);
      if (!ok) { await checkSetup(); $("#auth").hidden = false; }
    }
  } else if (!user) {
    ctx.staff = null;
    $("#shell").hidden = true;
    await checkSetup();
    $("#auth").hidden = false;
  }
  if (first) { first = false; loader.done(); }
});
