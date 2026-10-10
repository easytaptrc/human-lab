// Configuración pública del sitio (portada, logos, enlaces, colores) + pantalla de carga.
import { db, doc, getDoc } from "./firebase.js";
import { logoMark } from "./logo.js";
import { esc, store } from "./utils.js";

export const DEFAULTS = {
  name: "Human Prime Lab",
  brandLine1: "HUMAN PRIME",
  brandLine2: "LAB",
  heroLines: ["CIENCIA", "APLICADA", "A TU MEJOR"],
  heroHighlight: "VERSIÓN",
  heroText: "Entrenamiento, salud y rendimiento en un solo lugar.",
  heroMode: "poster", // poster = imagen completa · cover = imagen de fondo
  sideWords: ["RENDIMIENTO", "DISCIPLINA", "LONGEVIDAD"],
  footerWords: ["DISCIPLINA HOY", "RESULTADOS SIEMPRE"],
  claimTitle: "THREE DISCIPLINES.",
  claimSub: "ONE HUMAN SYSTEM.",
  btnReserva: "RESERVA",
  btnMiembro: "SOY MIEMBRO",
  btnRecomienda: "RECOMIÉNDANOS",
  showReserva: true,
  showMiembro: true,
  showRecomienda: true,
  showClaim: false,
  showServicios: true,
  showContacto: true,
  serviciosTitle: "NUESTROS SERVICIOS",
  contactoTitle: "VISÍTANOS",
  recommendText: "Te recomiendo Human Prime Lab: entrenamiento, salud y rendimiento en un solo lugar.",
  phone: "",
  whatsapp: "",
  email: "",
  address: "",
  mapsUrl: "",
  hours: "Lun a Vie 6:00 – 22:00 · Sáb 7:00 – 14:00",
  socials: { instagram: "", facebook: "", youtube: "", tiktok: "", spotify: "" },
  colors: { gold: "#ad8a5c", bg: "#0a0a0a", surface: "#141414", text: "#ece8e2" },
  siteUrl: "",
  bookingDays: 30,
  minNoticeMin: 30,
};

export const DEFAULT_MEDIA = { logo: "", logoFull: "", hero: "assets/img/portada.jpg" };

const CACHE_KEY = "hpl_site_v1";

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object") out[k] = { ...base[k], ...v };
    else if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}

// Carga configuración + imágenes. Usa caché local para pintar rápido y respaldo por defecto si Firestore falla.
export async function loadSite({ media = ["logo", "logoFull", "hero"] } = {}) {
  const cached = store.get(CACHE_KEY, {});
  let s = merge(DEFAULTS, cached.s);
  let m = { ...DEFAULT_MEDIA, ...(cached.m || {}) };
  try {
    const [siteSnap, ...mediaSnaps] = await withTimeout(
      Promise.all([getDoc(doc(db, "settings", "site")), ...media.map((k) => getDoc(doc(db, "media", k)))]),
      7000
    );
    s = merge(DEFAULTS, siteSnap.exists() ? siteSnap.data() : {});
    media.forEach((k, i) => {
      const snap = mediaSnaps[i];
      m[k] = snap.exists() && snap.data().data ? snap.data().data : DEFAULT_MEDIA[k];
    });
    const cacheM = {};
    // Sólo se cachean imágenes pequeñas para no llenar el almacenamiento.
    for (const k of Object.keys(m)) if ((m[k] || "").length < 400000) cacheM[k] = m[k];
    store.set(CACHE_KEY, { s, m: cacheM });
  } catch (e) {
    console.warn("Usando configuración local:", e.message);
  }
  applyTheme(s);
  return { s, m };
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function applyTheme(s) {
  const c = { ...DEFAULTS.colors, ...(s.colors || {}) };
  const r = document.documentElement.style;
  r.setProperty("--gold", c.gold);
  r.setProperty("--gold-rgb", hexToRgb(c.gold).join(","));
  r.setProperty("--bg", c.bg);
  r.setProperty("--surface", c.surface);
  r.setProperty("--text", c.text);
  r.setProperty("--logo-dark", c.text);
}

// App web instalable: registra el service worker (no en los emuladores locales).
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// Isotipo: el logo subido en el admin o el vectorial por defecto.
export function markHTML(m, cls = "") {
  return m.logo ? `<img class="logo-mark ${cls}" src="${m.logo}" alt="Logo">` : logoMark({ cls });
}

export function brandHTML(s, m, { small = false } = {}) {
  return `<span class="brand ${small ? "brand-sm" : ""}">
    ${markHTML(m)}
    <span class="brand-text"><b>${esc(s.brandLine1)}</b><i>${esc(s.brandLine2)}</i></span>
  </span>`;
}

// Pantalla de carga con logo y barra de progreso.
export function startLoader({ min = 1800 } = {}) {
  const el = document.createElement("div");
  el.id = "loader";
  el.innerHTML = `
    <div class="loader-inner">
      <div class="loader-logo">${logoMark()}</div>
      <div class="loader-word"><b>HUMAN PRIME</b><i>LAB</i></div>
      <div class="loader-bar"><span></span></div>
      <div class="loader-pct">0%</div>
    </div>`;
  document.body.prepend(el);
  document.body.classList.add("is-loading");
  const bar = el.querySelector(".loader-bar span");
  const pct = el.querySelector(".loader-pct");
  const t0 = performance.now();
  let p = 0;
  let target = 82;
  const tick = () => {
    p += (target - p) * 0.06 + 0.15;
    if (p > target) p = target;
    bar.style.width = p + "%";
    pct.textContent = Math.round(p) + "%";
    if (p < 100) raf = requestAnimationFrame(tick);
  };
  let raf = requestAnimationFrame(tick);
  return {
    setLogo(m) {
      if (m.logoFull) {
        el.querySelector(".loader-logo").innerHTML = `<img src="${m.logoFull}" alt="Logo" class="loader-full">`;
        el.querySelector(".loader-word").remove();
      } else if (m.logo) {
        el.querySelector(".loader-logo").innerHTML = `<img src="${m.logo}" alt="Logo">`;
      }
    },
    async done() {
      const wait = Math.max(0, min - (performance.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
      target = 100;
      await new Promise((r) => setTimeout(r, 450));
      cancelAnimationFrame(raf);
      bar.style.width = "100%";
      pct.textContent = "100%";
      el.classList.add("out");
      document.body.classList.remove("is-loading");
      setTimeout(() => el.remove(), 700);
    },
  };
}
