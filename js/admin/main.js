// Panel de administración y recepción: acceso, permisos por usuario y navegación.
import { app, db, doc, getDoc, writeBatch, serverTimestamp, USE_EMULATORS } from "../firebase.js";
import {
  getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { loadSite, startLoader, brandHTML } from "../site.js";
import { $, esc, ICONS, toast } from "../utils.js";
import { MODULES } from "./data.js";
import { initials } from "./ui.js";

const loader = startLoader({ min: 900 });
const { s, m } = await loadSite({ media: ["logo", "logoFull"] });
const auth = getAuth(app);
if (USE_EMULATORS) connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
await setPersistence(auth, browserLocalPersistence).catch(() => {});

const PAGES = {
  inicio: ["Panel de administración", "Gestión integral de miembros, reservas y servicios."],
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
  }).join("") + `<a href="index.html" target="_blank" rel="noopener" class="nav-ext">${ICONS.eye}<span>Ver sitio</span></a>`;
  const st = ctx.staff;
  $("#user").innerHTML = `
    <button class="user-btn" id="userBtn"><span class="av">${esc(initials(st.name))}</span><span class="user-name">${esc(st.name)}</span>${ICONS.chevron}</button>
    <div class="user-menu" id="userMenu" hidden>
      <div class="user-info"><b>${esc(st.name)}</b><small>${esc(st.position || (st.role === "owner" ? "Dueño" : "Personal"))}</small><small>${esc(st.email)}</small></div>
      <button id="logoutBtn">${ICONS.logout}<span>Cerrar sesión</span></button>
    </div>`;
  $("#userBtn").onclick = (e) => { e.stopPropagation(); $("#userMenu").hidden = !$("#userMenu").hidden; };
  document.addEventListener("click", () => { const um = $("#userMenu"); if (um) um.hidden = true; });
  $("#logoutBtn").onclick = async () => { await signOut(auth); location.hash = ""; location.reload(); };
}

const toggleSide = (open) => document.body.classList.toggle("side-open", open);
$("#menuBtn").addEventListener("click", () => toggleSide(true));
$("#scrim").addEventListener("click", () => toggleSide(false));
$("#nav").addEventListener("click", (e) => { if (e.target.closest("a")) toggleSide(false); });

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
  $("#pageTitle").textContent = PAGES[key][0];
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
