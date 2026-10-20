// Guía "Descargar app" con mini video animado según el dispositivo (Android, iPhone o computadora).
import { esc, ICONS } from "./utils.js";

let installEvent = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; dispatchEvent(new Event("hpl:installable")); });
addEventListener("appinstalled", () => { installEvent = null; dispatchEvent(new Event("hpl:installed")); });

export const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const ua = navigator.userAgent;
const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /android/i.test(ua);
export const detectDevice = () => (isIOS ? "iphone" : isAndroid ? "android" : "computadora");

// Pide la instalación directa cuando el navegador lo permite (Chrome/Edge en Android y computadora)
export async function promptInstall() {
  if (!installEvent) return false;
  installEvent.prompt();
  const r = await installEvent.userChoice.catch(() => null);
  installEvent = null;
  return r?.outcome === "accepted";
}
export const canPromptInstall = () => !!installEvent;

// ---------- Pantallas del mini video ----------
const tap = (x, y) => `<i class="g-tap" style="left:${x}%;top:${y}%"></i>`;
const site = (o) => `<div class="g-site"><div class="g-hero"></div><div class="g-line w70"></div><div class="g-line w50"></div><div class="g-btn">${esc(o.label)}</div></div>`;
const home = (o, pop) => `<div class="g-home">${Array.from({ length: 11 }, () => `<span class="g-app"></span>`).join("")}<span class="g-app g-mine ${pop ? "pop" : ""}"><img src="${o.icon}" alt=""><small>${esc(o.label)}</small></span></div>`;

function steps(device, o) {
  if (device === "android") return [
    { cap: "Abre la página en Chrome y toca los 3 puntos ⋮ de arriba a la derecha.", html: `<div class="g-bar"><span class="g-url">${esc(o.host)}</span><b class="g-dots">⋮</b></div>${site(o)}${tap(90, 6)}` },
    { cap: "Toca “Instalar app” o “Agregar a pantalla principal”.", html: `<div class="g-bar"><span class="g-url">${esc(o.host)}</span><b class="g-dots">⋮</b></div>${site(o)}<div class="g-menu"><p>Nueva pestaña</p><p>Historial</p><p>Compartir…</p><p class="hl">${ICONS.plus} Instalar app</p><p>Configuración</p></div>${tap(70, 46)}` },
    { cap: "Confirma tocando “Instalar”.", html: `${site(o)}<div class="g-dialog"><img src="${o.icon}" alt=""><b>¿Instalar app?</b><small>${esc(o.name)}</small><div><span>Cancelar</span><span class="hl">Instalar</span></div></div>${tap(70, 62)}` },
    { cap: "¡Listo! La app aparece en tu pantalla de inicio.", html: home(o, true) },
  ];
  if (device === "iphone") return [
    { cap: "Abre la página en Safari y toca el botón Compartir (cuadro con flecha) abajo.", html: `${site(o)}<div class="g-safari"><span>‹</span><span>›</span><b class="g-share">${ICONS.share}</b><span>▢</span><span>▣</span></div>${tap(50, 93)}` },
    { cap: "Desliza y toca “Agregar a inicio”.", html: `${site(o)}<div class="g-sheet"><p>Copiar</p><p>Agregar a favoritos</p><p class="hl">Agregar a inicio ${ICONS.plus}</p><p>Buscar en la página</p></div>${tap(45, 74)}` },
    { cap: "Toca “Agregar” arriba a la derecha.", html: `<div class="g-add"><div><span>Cancelar</span><b>Agregar a inicio</b><span class="hl">Agregar</span></div><p><img src="${o.icon}" alt=""> ${esc(o.label)}</p></div>${tap(86, 9)}` },
    { cap: "¡Listo! Abre la app desde tu pantalla de inicio.", html: home(o, true) },
  ];
  return [
    { cap: "Abre la página en Chrome o Edge y busca el ícono de instalar en la barra de dirección.", html: `<div class="g-win"><div class="g-winbar"><i></i><i></i><i></i><span class="g-url">${esc(o.host)}</span><b class="g-inst">${ICONS.plus}</b></div>${site(o)}</div>${tap(88, 13)}` },
    { cap: "Haz clic en “Instalar”.", html: `<div class="g-win"><div class="g-winbar"><i></i><i></i><i></i><span class="g-url">${esc(o.host)}</span><b class="g-inst">${ICONS.plus}</b></div>${site(o)}<div class="g-dialog g-pop-right"><img src="${o.icon}" alt=""><b>¿Instalar app?</b><small>${esc(o.name)}</small><div><span>Cancelar</span><span class="hl">Instalar</span></div></div></div>${tap(78, 52)}` },
    { cap: "La app se abre en su propia ventana y queda un acceso en tu escritorio.", html: `<div class="g-desk"><span class="g-deskicon pop"><img src="${o.icon}" alt=""><small>${esc(o.label)}</small></span><div class="g-win g-mini"><div class="g-winbar"><i></i><i></i><i></i><span class="g-url">${esc(o.label)}</span></div>${site(o)}</div></div>` },
  ];
}

export function openInstallGuide(opts = {}) {
  const o = {
    name: opts.name || "Human Prime Lab",
    label: opts.label || "Human Prime",
    icon: opts.icon || "assets/icons/icon-192.png",
    host: location.host || "humanprimelab-hermosillo.com",
  };
  let device = opts.device || detectDevice();
  let i = 0;
  let timer = null;

  const wrap = document.createElement("div");
  wrap.className = "sheet guide";
  wrap.innerHTML = `
    <div class="sheet-box guide-box" role="dialog" aria-modal="true" aria-label="Descargar app">
      <button class="icon-btn guide-close" aria-label="Cerrar">${ICONS.close}</button>
      <h2>Descarga la app</h2>
      <p id="gSub"></p>
      <div class="guide-tabs">${[["android", "Android"], ["iphone", "iPhone"], ["computadora", "Computadora"]].map(([k, l]) => `<button data-d="${k}">${l}</button>`).join("")}</div>
      <div class="guide-stage"><div class="guide-device" id="gDevice"></div></div>
      <div class="guide-dots" id="gDots"></div>
      <p class="guide-cap" id="gCap"></p>
      <div class="sheet-actions" id="gActions"></div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));

  const $ = (s) => wrap.querySelector(s);
  const render = () => {
    const list = steps(device, o);
    i %= list.length;
    const dev = $("#gDevice");
    dev.className = `guide-device ${device === "computadora" ? "is-pc" : "is-phone"}`;
    dev.innerHTML = `<div class="g-screen" key="${i}">${list[i].html}</div>`;
    $("#gDots").innerHTML = list.map((_, k) => `<span class="${k === i ? "on" : ""}" data-k="${k}"></span>`).join("");
    $("#gCap").innerHTML = `<b>Paso ${i + 1}.</b> ${esc(list[i].cap)}`;
    wrap.querySelectorAll("[data-d]").forEach((b) => b.classList.toggle("on", b.dataset.d === device));
    $("#gSub").textContent = `Instálala en tu ${device === "computadora" ? "computadora y queda en tu escritorio" : "teléfono para abrirla con un toque"}${opts.admin ? "" : " y recibir notificaciones"}.`;
    const direct = canPromptInstall() && device === detectDevice() && device !== "iphone";
    $("#gActions").innerHTML = direct
      ? `<button class="btn" data-a="close">Después</button><button class="btn btn-gold" data-a="install">Instalar ahora</button>`
      : `<button class="btn btn-gold" data-a="close">Entendido</button>`;
  };
  const play = () => { clearInterval(timer); timer = setInterval(() => { i++; render(); }, 2800); };
  const close = () => { clearInterval(timer); wrap.classList.remove("open"); setTimeout(() => wrap.remove(), 250); };

  wrap.addEventListener("click", async (e) => {
    if (e.target === wrap || e.target.closest(".guide-close") || e.target.closest("[data-a=close]")) return close();
    const d = e.target.closest("[data-d]");
    if (d) { device = d.dataset.d; i = 0; render(); play(); return; }
    const dot = e.target.closest("[data-k]");
    if (dot) { i = Number(dot.dataset.k); render(); play(); return; }
    if (e.target.closest("[data-a=install]")) {
      const ok = await promptInstall();
      if (ok) close(); else render();
    }
  });
  render();
  play();
}
