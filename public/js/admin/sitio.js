// Configuración del sitio público: marca, logos, portada, botones, contacto, enlaces y colores.
import { db, doc, setDoc, deleteDoc, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, toast, compressImage } from "../utils.js";
import { DEFAULTS, DEFAULT_MEDIA, applyTheme } from "../site.js";
import { logoMark } from "../logo.js";

const TABS = [["marca", "Marca y logos"], ["portada", "Portada"], ["botones", "Botones y secciones"], ["contacto", "Contacto y redes"], ["colores", "Colores"], ["reservas", "Reservas"]];
const PRESETS = [
  ["Original", { gold: "#ad8a5c", bg: "#0a0a0a", surface: "#141414", text: "#ece8e2" }],
  ["Oro claro", { gold: "#c9a46a", bg: "#0b0b0c", surface: "#161618", text: "#f1ede6" }],
  ["Bronce", { gold: "#9c6b3f", bg: "#0c0a09", surface: "#171412", text: "#efe7df" }],
  ["Plata", { gold: "#b8bcc2", bg: "#0a0a0b", surface: "#141416", text: "#ececee" }],
];

export async function render(el, ctx) {
  const s = structuredClone(ctx.s);
  const media = { ...ctx.m };
  // Las imágenes por defecto no se guardan como datos.
  const changedMedia = {};
  let dirty = false;
  let tab = "marca";

  el.innerHTML = `
    <div class="cfg-tabs" id="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="panel"><div class="panel-body" id="form"></div></div>
    <div class="save-bar"><span class="dirty" id="dirty" hidden>Cambios sin guardar</span>
      <a class="btn btn-sm" href="index.html" target="_blank" rel="noopener">${ICONS.eye}<span>Ver sitio</span></a>
      <button class="btn btn-sm btn-gold" id="save">Guardar cambios</button></div>`;

  const markDirty = () => { dirty = true; $("#dirty", el).hidden = false; };
  const inp = (path, label, { type = "text", ph = "", span = false } = {}) => {
    const val = path.split(".").reduce((o, k) => o?.[k], s) ?? "";
    return `<label class="field ${span ? "span-2" : ""}"><span>${label}</span><input class="input" data-path="${path}" type="${type}" value="${esc(val)}" placeholder="${esc(ph)}"></label>`;
  };
  const area = (path, label) => `<label class="field span-2"><span>${label}</span><textarea class="input" data-path="${path}" rows="2">${esc(s[path] ?? "")}</textarea></label>`;
  const sw = (path, label) => `<label class="switch"><input type="checkbox" data-path="${path}" ${s[path] ? "checked" : ""}> ${label}</label>`;
  const list = (path, label, n) => `<div class="field span-2"><span>${label}</span><div class="form-grid">${Array.from({ length: n }, (_, i) => `<input class="input" data-list="${path}" data-i="${i}" value="${esc((s[path] || [])[i] || "")}">`).join("")}</div></div>`;
  const imgBox = (key, label, hint, { wide = false, cover = false, fallback = "" } = {}) => `
    <div class="field span-2"><span>${label}</span>
      <div class="img-up">
        <div class="img-prev ${wide ? "wide" : ""} ${cover ? "cover" : ""}" id="prev-${key}">${media[key] ? `<img src="${esc(media[key])}">` : fallback}</div>
        <div class="img-actions">
          <label class="btn btn-sm">${ICONS.image}<span>Subir</span><input type="file" accept="image/*" data-img="${key}"></label>
          <button class="btn btn-sm btn-ghost" type="button" data-reset="${key}">Restaurar original</button>
          <p class="hint" style="margin:0;max-width:260px">${hint}</p>
        </div>
      </div></div>`;

  const forms = {
    marca: () => `
      <h4 class="form-sec">Nombre</h4>
      <div class="form-grid">${inp("name", "Nombre del negocio")}${inp("brandLine1", "Texto del logo (línea 1)")}${inp("brandLine2", "Texto del logo (línea 2)")}</div>
      <h4 class="form-sec">Logos</h4>
      <div class="form-grid">
        ${imgBox("logo", "Isotipo (cabecera y menú)", "PNG con fondo transparente recomendado. Si no subes uno, se usa el isotipo vectorial de Human Prime Lab.", { fallback: logoMark() })}
        ${imgBox("logoFull", "Logo completo (pantalla de carga)", "Se muestra en la pantalla de carga. PNG transparente con texto claro.", { wide: true, fallback: `<div style="text-align:center">${logoMark()}<small class="muted">Logo + texto</small></div>` })}
      </div>`,
    portada: () => `
      <h4 class="form-sec">Imagen</h4>
      <div class="form-grid">
        ${imgBox("hero", "Imagen de portada", "Imagen vertical u horizontal de buena calidad. Se comprime automáticamente.", { wide: true, cover: true })}
        <label class="field"><span>Estilo de portada</span><select class="input" data-path="heroMode">
          <option value="poster" ${s.heroMode !== "cover" ? "selected" : ""}>Imagen completa (póster)</option>
          <option value="cover" ${s.heroMode === "cover" ? "selected" : ""}>Imagen de fondo detrás del texto</option></select></label>
      </div>
      <h4 class="form-sec">Textos</h4>
      <div class="form-grid">
        ${list("heroLines", "Título (una línea por campo)", 3)}
        ${inp("heroHighlight", "Palabra destacada (dorada)")}
        ${area("heroText", "Texto debajo del título")}
        ${list("sideWords", "Palabras laterales", 3)}
        ${list("footerWords", "Frase inferior", 2)}
      </div>
      <h4 class="form-sec">Frase de marca</h4>
      <div class="form-grid">${inp("claimTitle", "Línea 1")}${inp("claimSub", "Línea 2")}<div class="span-2">${sw("showClaim", "Mostrar frase en la página")}</div></div>`,
    botones: () => `
      <h4 class="form-sec">Botones de la portada</h4>
      <div class="form-grid">
        ${inp("btnReserva", "Botón de reserva")}${inp("btnMiembro", "Botón de miembros")}${inp("btnRecomienda", "Botón recomiéndanos")}
        <div class="span-2 btn-row" style="gap:22px">${sw("showReserva", "Mostrar reserva")}${sw("showMiembro", "Mostrar miembros")}${sw("showRecomienda", "Mostrar recomiéndanos")}</div>
        ${area("recommendText", "Texto al compartir (recomiéndanos)")}
      </div>
      <h4 class="form-sec">Secciones</h4>
      <div class="form-grid">
        ${inp("serviciosTitle", "Título de servicios")}${inp("contactoTitle", "Título de contacto")}
        <div class="span-2 btn-row" style="gap:22px">${sw("showServicios", "Mostrar servicios")}${sw("showContacto", "Mostrar contacto")}</div>
      </div>`,
    contacto: () => `
      <h4 class="form-sec">Números y ubicación</h4>
      <div class="form-grid">
        ${inp("phone", "Teléfono", { type: "tel" })}${inp("whatsapp", "WhatsApp (10 dígitos o con lada)", { type: "tel" })}${inp("email", "Correo", { type: "email" })}
        ${inp("address", "Dirección", { span: true })}${inp("mapsUrl", "Enlace de Google Maps", { span: true, ph: "https://maps.app.goo.gl/…" })}
        ${inp("hours", "Horario", { span: true })}
      </div>
      <h4 class="form-sec">Redes sociales</h4>
      <div class="form-grid">
        ${["instagram", "facebook", "youtube", "tiktok", "spotify"].map((k) => inp(`socials.${k}`, k[0].toUpperCase() + k.slice(1), { ph: "https://…" })).join("")}
      </div>
      <h4 class="form-sec">Dominio</h4>
      <div class="form-grid">${inp("siteUrl", "Dirección pública del sitio", { span: true, ph: "https://humanprimelab.com" })}</div>
      <p class="hint">Se usa en los enlaces de confirmación de citas y al compartir.</p>`,
    colores: () => `
      <h4 class="form-sec">Paletas</h4>
      <div class="presets">${PRESETS.map(([n, c], i) => `<button type="button" class="preset" data-preset="${i}"><i style="background:${c.gold}"></i>${n}</button>`).join("")}</div>
      <h4 class="form-sec">Personalizar</h4>
      <div class="form-grid">
        ${[["gold", "Color de acento (dorado)"], ["bg", "Fondo"], ["surface", "Tarjetas"], ["text", "Texto"]].map(([k, l]) => `
          <div class="color-row"><input type="color" data-color="${k}" value="${esc(s.colors[k])}"><span>${l}</span><input class="input" data-colorhex="${k}" value="${esc(s.colors[k])}" maxlength="7"></div>`).join("")}
      </div>
      <h4 class="form-sec">Vista previa</h4>
      <div class="mini-preview" style="background:var(--bg)">
        <span class="mp-title">${esc((s.heroLines || [])[0] || "")} <span class="gold">${esc(s.heroHighlight)}</span></span>
        <button type="button" class="btn btn-gold btn-sm">${esc(s.btnReserva)}</button>
        <button type="button" class="btn btn-sm">${esc(s.btnMiembro)}</button>
      </div>`,
    reservas: () => `
      <div class="form-grid">
        ${inp("bookingDays", "Días hacia adelante para reservar", { type: "number" })}
        ${inp("minNoticeMin", "Anticipación mínima (minutos)", { type: "number" })}
      </div>
      <p class="hint">Los horarios y cupos de cada servicio se configuran en “Servicios y cupos”.</p>`,
  };

  const draw = () => { $("#form", el).innerHTML = forms[tab](); };
  draw();

  $("#tabs", el).onclick = (e) => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    tab = b.dataset.t;
    el.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    draw();
  };

  const setColor = (k, v) => {
    if (!/^#[0-9a-f]{6}$/i.test(v)) return;
    s.colors[k] = v;
    applyTheme(s);
    const c = el.querySelector(`[data-color="${k}"]`);
    const h = el.querySelector(`[data-colorhex="${k}"]`);
    if (c && c.value !== v) c.value = v;
    if (h && h.value !== v) h.value = v;
    markDirty();
  };

  const form = $("#form", el);
  form.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.path) {
      const keys = t.dataset.path.split(".");
      let o = s;
      keys.slice(0, -1).forEach((k) => { o[k] = o[k] || {}; o = o[k]; });
      o[keys.at(-1)] = t.type === "checkbox" ? t.checked : t.type === "number" ? Number(t.value) : t.value;
      markDirty();
    }
    if (t.dataset.list) {
      s[t.dataset.list] = [...(s[t.dataset.list] || [])];
      s[t.dataset.list][Number(t.dataset.i)] = t.value;
      markDirty();
    }
    if (t.dataset.color) setColor(t.dataset.color, t.value);
    if (t.dataset.colorhex) setColor(t.dataset.colorhex, t.value.startsWith("#") ? t.value : "#" + t.value);
  });
  form.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.dataset.path && (t.type === "checkbox" || t.tagName === "SELECT")) {
      s[t.dataset.path] = t.type === "checkbox" ? t.checked : t.value;
      markDirty();
    }
    if (t.dataset.img) {
      const file = t.files[0];
      if (!file) return;
      const key = t.dataset.img;
      try {
        const data = key === "hero"
          ? await compressImage(file, { max: 1600, quality: 0.8 })
          : await compressImage(file, { max: 600, keepAlpha: true });
        if (data.length > 950000) { toast("La imagen es demasiado pesada aun comprimida. Prueba con otra.", "error"); return; }
        media[key] = data;
        changedMedia[key] = data;
        $(`#prev-${key}`, el).innerHTML = `<img src="${data}">`;
        markDirty();
      } catch {
        toast("No se pudo leer la imagen.", "error");
      }
    }
  });
  form.addEventListener("click", (e) => {
    const r = e.target.closest("[data-reset]");
    if (r) {
      const key = r.dataset.reset;
      media[key] = DEFAULT_MEDIA[key];
      changedMedia[key] = null;
      draw();
      markDirty();
    }
    const p = e.target.closest("[data-preset]");
    if (p) {
      const c = PRESETS[Number(p.dataset.preset)][1];
      Object.entries(c).forEach(([k, v]) => setColor(k, v));
    }
  });

  $("#save", el).onclick = async () => {
    const btn = $("#save", el);
    btn.disabled = true;
    try {
      const clean = {};
      for (const k of Object.keys(DEFAULTS)) clean[k] = s[k];
      clean.heroLines = (s.heroLines || []).map((x) => x || "");
      clean.sideWords = (s.sideWords || []).map((x) => x || "");
      clean.footerWords = (s.footerWords || []).map((x) => x || "");
      await setDoc(doc(db, "settings", "site"), { ...clean, updatedAt: serverTimestamp(), updatedBy: ctx.staff.name });
      for (const [k, v] of Object.entries(changedMedia)) {
        if (v === null) await deleteDoc(doc(db, "media", k));
        else await setDoc(doc(db, "media", k), { data: v, updatedAt: serverTimestamp() });
        delete changedMedia[k];
      }
      Object.assign(ctx.s, s);
      Object.assign(ctx.m, media);
      try { localStorage.removeItem("hpl_site_v1"); } catch { /* sin almacenamiento */ }
      dirty = false;
      $("#dirty", el).hidden = true;
      toast("Sitio actualizado.");
    } catch (ex) {
      console.error(ex);
      toast("No se pudo guardar la configuración.", "error");
    } finally {
      btn.disabled = false;
    }
  };

  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
  addEventListener("beforeunload", beforeUnload);
  return () => {
    removeEventListener("beforeunload", beforeUnload);
    if (dirty) applyTheme(ctx.s);
  };
}
