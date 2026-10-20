// Página principal (pública). No contiene ningún acceso al administrador.
import { db, collection, getDocs, query, where } from "./firebase.js";
import { loadSite, startLoader, brandHTML } from "./site.js";
import { $, esc, ICONS, digits, waLink, fmtMoney, toast } from "./utils.js";
import { pushState, enablePush, disablePush, shouldPrompt, markPrompted, INSTALL_HINT } from "./push.js";
import { sheet } from "./sheet.js";
import { openInstallGuide, isStandalone } from "./install-guide.js";

const loader = startLoader({ min: 2200 });
const { s, m } = await loadSite();
loader.setLogo(m);
document.title = s.name;

const SOCIALS = ["instagram", "facebook", "youtube", "tiktok", "spotify"];
const socialsHTML = () =>
  SOCIALS.filter((k) => s.socials?.[k])
    .map((k) => `<a href="${esc(s.socials[k])}" target="_blank" rel="noopener" aria-label="${k}">${ICONS[k]}</a>`)
    .join("") + (s.whatsapp ? `<a href="${waLink(s.whatsapp, "Hola, quiero información de " + s.name)}" target="_blank" rel="noopener" aria-label="WhatsApp">${ICONS.whatsapp}</a>` : "");

// Cabecera
$("#header").innerHTML = `
  <a href="index.html" aria-label="Inicio">${brandHTML(s, m)}</a>
  <div class="header-actions">
    <button class="icon-btn bell" id="bellBtn" hidden></button>
    <button class="icon-btn" id="menuBtn" aria-label="Abrir menú">${ICONS.menu}</button>
  </div>`;

// Menú lateral
const drawer = $("#drawer");
$("#drawerClose").innerHTML = ICONS.close;
$("#drawerLinks").innerHTML = [
  s.showReserva && `<a href="reservar.html">${esc(s.btnReserva)}</a>`,
  s.showMiembro && `<a href="miembro.html">${esc(s.btnMiembro)}</a>`,
  s.showServicios && `<a href="#servicios" data-close>Servicios</a>`,
  s.showContacto && `<a href="#contacto" data-close>Contacto</a>`,
  s.showRecomienda && `<a href="#" data-share>${esc(s.btnRecomienda)}</a>`,
  `<a href="#" data-install>Descargar app</a>`,
].filter(Boolean).join("");
$("#drawerSocials").innerHTML = socialsHTML();
const toggleDrawer = (open) => {
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", String(!open));
};
$("#menuBtn").addEventListener("click", () => toggleDrawer(true));
$("#drawerClose").addEventListener("click", () => toggleDrawer(false));
drawer.addEventListener("click", (e) => {
  if (e.target === drawer || e.target.closest("[data-close]")) toggleDrawer(false);
});

// Portada
const hero = $("#hero");
hero.classList.add(s.heroMode === "cover" ? "hero-cover" : "hero-poster");
$("#heroMedia").innerHTML = `
  ${m.hero ? `<img src="${esc(m.hero)}" alt="${esc(s.name)}" fetchpriority="high">` : ""}
  <ul class="side-words">${(s.sideWords || []).filter(Boolean).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;

$("#heroContent").innerHTML = `
  <h1 class="hero-title">
    ${(s.heroLines || []).filter(Boolean).map((l) => `<span>${esc(l)}</span>`).join("")}
    ${s.heroHighlight ? `<span class="gold">${esc(s.heroHighlight)}</span>` : ""}
  </h1>
  ${s.heroText ? `<p class="hero-text">${esc(s.heroText)}</p>` : ""}
  <div class="hero-actions">
    ${s.showReserva ? `<a class="btn btn-gold btn-block btn-xl" href="reservar.html">${ICONS.calendar}<span>${esc(s.btnReserva)}</span><span class="btn-chev">${ICONS.chevron}</span></a>` : ""}
    ${s.showMiembro ? `<a class="btn btn-block btn-xl" href="miembro.html">${ICONS.user}<span>${esc(s.btnMiembro)}</span><span class="btn-chev">${ICONS.chevron}</span></a>` : ""}
    ${s.showRecomienda ? `<button class="btn btn-sm btn-recomienda" data-share>${ICONS.share}<span>${esc(s.btnRecomienda)}</span>${ICONS.chevron}</button>` : ""}
    <button class="btn btn-sm btn-install" data-install><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>Descargar app</span></button>
  </div>
  <div class="hero-foot">
    <div class="socials">${socialsHTML()}</div>
    <ul class="foot-words">${(s.footerWords || []).filter(Boolean).map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
  </div>`;

// Frase de marca
if (s.showClaim && (s.claimTitle || s.claimSub)) {
  const claim = $("#claim");
  claim.hidden = false;
  claim.innerHTML = `<p><b>${esc(s.claimTitle)}</b><span>${esc(s.claimSub)}</span></p>`;
}

// Servicios (desde el panel de administración)
if (s.showServicios) {
  try {
    const snap = await getDocs(query(collection(db, "services"), where("active", "==", true)));
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    if (list.length) {
      const sec = $("#servicios");
      sec.hidden = false;
      sec.innerHTML = `
        <div class="section-head"><span class="eyebrow">Servicios</span><h2 class="title-wide">${esc(s.serviciosTitle)}</h2></div>
        <div class="services">
          ${list.map((x) => `
            <a class="service" href="reservar.html?s=${encodeURIComponent(x.id)}">
              <div class="service-img">${x.image ? `<img src="${esc(x.image)}" alt="" loading="lazy">` : ICONS.dumbbell}</div>
              <div class="service-body">
                <h3>${esc(x.name)}</h3>
                ${x.description ? `<p>${esc(x.description)}</p>` : ""}
                <span class="service-meta">${x.durationMin ? `${ICONS.clock}${x.durationMin} min` : ""}${x.price ? `<b>${fmtMoney(x.price)}</b>` : ""}</span>
              </div>
              <span class="service-go">${ICONS.chevron}</span>
            </a>`).join("")}
        </div>`;
    }
  } catch (e) {
    console.warn("Servicios no disponibles:", e.message);
  }
}

// Contacto
if (s.showContacto && (s.phone || s.whatsapp || s.email || s.address || s.hours)) {
  const sec = $("#contacto");
  sec.hidden = false;
  const item = (icon, label, value, href) =>
    `<${href ? `a href="${esc(href)}" target="_blank" rel="noopener"` : "div"} class="contact-item">${ICONS[icon]}<div><span>${label}</span><b>${esc(value)}</b></div></${href ? "a" : "div"}>`;
  sec.innerHTML = `
    <div class="section-head"><span class="eyebrow">Contacto</span><h2 class="title-wide">${esc(s.contactoTitle)}</h2></div>
    <div class="contact-grid">
      ${s.phone ? item("phone", "Teléfono", s.phone, `tel:${digits(s.phone)}`) : ""}
      ${s.whatsapp ? item("whatsapp", "WhatsApp", s.whatsapp, waLink(s.whatsapp, `Hola, quiero información de ${s.name}`)) : ""}
      ${s.email ? item("mail", "Correo", s.email, `mailto:${s.email}`) : ""}
      ${s.address ? item("pin", "Dirección", s.address, s.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(s.address)}`) : ""}
      ${s.hours ? item("clock", "Horario", s.hours) : ""}
    </div>`;
}

$("#footer").innerHTML = `
  <div class="footer-brand">${brandHTML(s, m, { small: true })}</div>
  <div class="socials">${socialsHTML()}</div>
  <small>© ${new Date().getFullYear()} ${esc(s.name)}</small>`;

// Recomiéndanos: compartir nativo o WhatsApp
document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-share]");
  if (!btn) return;
  e.preventDefault();
  const url = s.siteUrl || location.origin + location.pathname.replace(/[^/]*$/, "");
  const text = s.recommendText;
  if (navigator.share) {
    try { await navigator.share({ title: s.name, text, url }); } catch { /* cancelado */ }
  } else {
    try { await navigator.clipboard.writeText(`${text} ${url}`); toast("Enlace copiado. ¡Gracias por recomendarnos!"); } catch { /* sin portapapeles */ }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank", "noopener");
  }
});

// Descargar la app: guía con mini video según el dispositivo (se oculta si ya está instalada)
document.querySelectorAll("[data-install]").forEach((b) => { b.hidden = isStandalone(); });
document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-install]")) return;
  e.preventDefault();
  drawer.classList.remove("open");
  openInstallGuide({ name: s.name, label: "Human Prime", icon: "assets/icons/icon-192.png" });
});

const header = $("#header");
const onScroll = () => header.classList.toggle("scrolled", scrollY > 40);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// ---------- Notificaciones: campana + pregunta al abrir la app ----------
const bell = $("#bellBtn");
function paintBell() {
  const st = pushState(s.vapidKey);
  bell.hidden = st === "off";
  bell.classList.toggle("on", st === "ready");
  bell.innerHTML = st === "ready" ? ICONS.bell : ICONS.bellOff;
  bell.setAttribute("aria-label", st === "ready" ? "Notificaciones activadas" : "Activar notificaciones");
  bell.title = st === "ready" ? "Notificaciones activadas (toca para desactivar)" : "Activar notificaciones";
}

// Se llama directamente desde el toque: el navegador solo muestra el permiso si viene de una acción del usuario.
function activate() {
  return enablePush(s.vapidKey).then((t) => {
    toast(t ? "¡Listo! Te avisaremos de promociones, citas y novedades." : "No se activaron. Revisa los permisos de notificaciones del navegador.", t ? "ok" : "warn");
    paintBell();
    return !!t;
  });
}

const installSheet = () => sheet({ icon: "bell", title: "Recibe nuestras notificaciones", text: INSTALL_HINT, actions: [{ label: "Entendido", cls: "btn-gold", value: true }] });
const deniedSheet = () => sheet({ icon: "bellOff", title: "Notificaciones bloqueadas", text: "Las bloqueaste en este navegador. Para activarlas, abre los ajustes del sitio (el candado junto a la dirección) y permite las notificaciones.", actions: [{ label: "Entendido", cls: "btn-gold", value: true }] });

bell.addEventListener("click", async () => {
  const st = pushState(s.vapidKey);
  if (st === "ask") { await activate(); return; }
  if (st === "install") { await installSheet(); return; }
  if (st === "denied") { await deniedSheet(); return; }
  if (st === "ready") {
    const ok = await sheet({
      icon: "bellOff",
      title: "¿Desactivar notificaciones?",
      text: "¿Estás seguro de desactivar las notificaciones? Te puedes perder las promociones, los recordatorios de tus citas y los avisos de tu membresía.",
      actions: [{ label: "Cancelar", value: false }, { label: "Sí, desactivar", cls: "btn-danger", value: true }],
    });
    if (!ok) return;
    bell.disabled = true;
    await disablePush(s.vapidKey);
    bell.disabled = false;
    paintBell();
    toast("Notificaciones desactivadas. Puedes volver a activarlas con la campana.");
  }
});
paintBell();

await loader.done();
document.body.classList.add("ready");

// Pregunta al abrir la app (no insiste: vuelve a preguntar después de unos días)
const ask = shouldPrompt(s.vapidKey);
if (ask) {
  setTimeout(async () => {
    markPrompted();
    if (ask === "install") { await installSheet(); return; }
    await sheet({
      icon: "bell",
      title: "¿Quieres activar las notificaciones?",
      text: "Te avisaremos de promociones, recordatorios de tus citas y novedades de Human Prime Lab.",
      actions: [{ label: "Ahora no", value: false }, { label: "Activar", cls: "btn-gold", onClick: activate }],
    });
  }, 1200);
}
