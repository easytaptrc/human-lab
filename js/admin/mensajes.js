// Mensajes a socios: panel del socio, WhatsApp y correo.
import { db, collection, addDoc, getDocs, query, orderBy, limit, writeBatch, doc, arrayUnion, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, todayStr, fmtDate, waLink, fillTemplate, toast } from "../utils.js";
import { getAll, memberState, daysInactive } from "./data.js";
import { openModal, loadingHTML } from "./ui.js";

const AUDIENCES = [
  ["todos", "Todos los socios"],
  ["activos", "Socios activos"],
  ["porvencer", "Por vencer (7 días)"],
  ["vencidos", "Vencidos"],
  ["inactivos", "Sin asistir +45 días"],
  ["elegir", "Elegir socios…"],
];

export async function render(el, ctx) {
  const members = await getAll("members", { force: true });
  const picked = new Set();
  el.innerHTML = `
    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h2>Nuevo mensaje</h2><span class="aud-count" id="count"></span></div>
        <div class="panel-body">
          <div class="form-grid">
            <label class="field span-2"><span>Destinatarios</span><select class="input" id="aud">${AUDIENCES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
            <div class="span-2" id="pickWrap" hidden>
              <label class="input-icon" style="margin-bottom:8px">${ICONS.search}<input class="input" id="pickQ" placeholder="Buscar socio"></label>
              <div class="pick-list" id="pick"></div>
            </div>
            <label class="field span-2"><span>Título</span><input class="input" id="title" placeholder="Ej. Horario especial de fin de año"></label>
            <label class="field span-2"><span>Mensaje</span><textarea class="input" id="body" rows="6" placeholder="Hola {nombre}, …"></textarea>
              <div class="tpl-vars"><code data-v="{nombre}">{nombre}</code><code data-v="{plan}">{plan}</code><code data-v="{vence}">{vence}</code><code data-v="{id}">{id}</code></div></label>
          </div>
          <h4 class="form-sec">Enviar por</h4>
          <div class="checks">
            <label class="check"><input type="checkbox" id="chPanel" checked> ${ICONS.user} Panel del socio</label>
            <label class="check"><input type="checkbox" id="chWa"> ${ICONS.whatsapp} WhatsApp</label>
            <label class="check"><input type="checkbox" id="chMail"> ${ICONS.mail} Correo electrónico</label>
          </div>
          <p class="hint">WhatsApp abre un mensaje listo por cada socio. El correo se envía automáticamente si instalaste la extensión “Trigger Email” de Firebase (ver README).</p>
          <button class="btn btn-gold btn-block" id="send" style="margin-top:16px">${ICONS.send}<span>Enviar mensaje</span></button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Historial</h2></div>
        <div id="hist">${loadingHTML}</div>
      </div>
    </div>`;

  const today = todayStr();
  const audience = () => {
    const k = $("#aud", el).value;
    const st = (mb) => memberState(mb, today).key;
    if (k === "todos") return members;
    if (k === "activos") return members.filter((mb) => ["activa", "porvencer"].includes(st(mb)));
    if (k === "porvencer") return members.filter((mb) => st(mb) === "porvencer");
    if (k === "vencidos") return members.filter((mb) => st(mb) === "vencida");
    if (k === "inactivos") return members.filter((mb) => (daysInactive(mb, today) ?? 0) > 45);
    return members.filter((mb) => picked.has(mb.id));
  };
  const updateCount = () => { $("#count", el).textContent = `${audience().length} socios`; };
  const drawPick = () => {
    const q = $("#pickQ", el).value.toLowerCase();
    $("#pick", el).innerHTML = members
      .filter((mb) => !q || `${mb.name} ${mb.memberId}`.toLowerCase().includes(q))
      .map((mb) => `<label class="check"><input type="checkbox" value="${esc(mb.id)}" ${picked.has(mb.id) ? "checked" : ""}> ${esc(mb.name)} <span class="muted">· ${esc(mb.memberId)}</span></label>`).join("") || `<p class="muted">Sin socios.</p>`;
  };
  $("#aud", el).onchange = () => { $("#pickWrap", el).hidden = $("#aud", el).value !== "elegir"; drawPick(); updateCount(); };
  $("#pickQ", el).oninput = drawPick;
  $("#pick", el).onchange = (e) => { if (e.target.checked) picked.add(e.target.value); else picked.delete(e.target.value); updateCount(); };
  el.querySelector(".tpl-vars").onclick = (e) => {
    const v = e.target.closest("[data-v]")?.dataset.v;
    if (!v) return;
    const ta = $("#body", el);
    ta.setRangeText(v, ta.selectionStart, ta.selectionEnd, "end");
    ta.focus();
  };
  updateCount();

  const drawHist = async () => {
    try {
      const snap = await getDocs(query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(30)));
      $("#hist", el).innerHTML = snap.docs.map((d) => {
        const x = d.data();
        const when = x.createdAt?.toDate ? x.createdAt.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "";
        return `<div class="hist-item"><b>${esc(x.title || "Mensaje")}</b><p>${esc(x.body)}</p><small>${esc(x.audience)} · ${x.count} socios · ${(x.channels || []).join(", ")} · ${esc(x.by || "")} · ${when}</small></div>`;
      }).join("") || `<div class="empty">Aún no has enviado mensajes.</div>`;
    } catch (ex) {
      console.warn(ex);
      $("#hist", el).innerHTML = `<div class="empty">Historial no disponible.</div>`;
    }
  };
  drawHist();

  $("#send", el).onclick = async () => {
    const list = audience();
    const title = $("#title", el).value.trim() || "Mensaje del gimnasio";
    const body = $("#body", el).value.trim();
    const ch = { panel: $("#chPanel", el).checked, wa: $("#chWa", el).checked, mail: $("#chMail", el).checked };
    if (!body) { toast("Escribe el mensaje.", "error"); return; }
    if (!list.length) { toast("No hay socios en esta audiencia.", "error"); return; }
    if (!ch.panel && !ch.wa && !ch.mail) { toast("Elige al menos un canal.", "error"); return; }
    const btn = $("#send", el);
    btn.disabled = true;
    const text = (mb) => fillTemplate(body, { nombre: mb.name.split(" ")[0], plan: mb.plan || "", vence: fmtDate(mb.endDate), id: mb.memberId });
    try {
      // Lotes de hasta 400 escrituras
      const writes = [];
      if (ch.panel) list.filter((mb) => mb.portalKey).forEach((mb) => writes.push(["portal", mb.portalKey, { inbox: arrayUnion({ id: crypto.randomUUID(), title, body: text(mb), date: today }) }, "update"]));
      if (ch.mail) list.filter((mb) => mb.email).forEach((mb) => writes.push(["mail", null, { to: mb.email, message: { subject: title, text: text(mb) }, createdAt: serverTimestamp() }, "add"]));
      for (let i = 0; i < writes.length; i += 400) {
        const batch = writeBatch(db);
        writes.slice(i, i + 400).forEach(([col, id, data, mode]) => {
          if (mode === "update") batch.update(doc(db, col, id), data);
          else batch.set(doc(collection(db, col)), data);
        });
        await batch.commit();
      }
      const audLabel = AUDIENCES.find(([k]) => k === $("#aud", el).value)[1];
      await addDoc(collection(db, "messages"), {
        title, body, audience: audLabel, count: list.length,
        channels: Object.entries(ch).filter(([, v]) => v).map(([k]) => ({ panel: "panel", wa: "WhatsApp", mail: "correo" }[k])),
        by: ctx.staff.name, createdAt: serverTimestamp(),
      });
      toast("Mensaje enviado.");
      drawHist();
      if (ch.wa) waQueue(list.filter((mb) => mb.phone), text);
    } catch (ex) {
      console.error(ex);
      toast("No se pudo enviar el mensaje.", "error");
    } finally {
      btn.disabled = false;
    }
  };
}

// Lista para enviar por WhatsApp uno por uno (los navegadores bloquean abrir muchas ventanas a la vez).
export function waQueue(list, text) {
  openModal({
    title: `Enviar por WhatsApp (${list.length})`,
    body: `<p class="hint" style="margin:0 0 12px">Da clic en cada socio para abrir WhatsApp con el mensaje listo.</p>
      <div class="wa-list">${list.map((mb) => `<div class="wa-item"><span>${esc(mb.name)} <span class="muted">· ${esc(mb.phone)}</span></span>
        <a class="btn btn-sm" target="_blank" rel="noopener" href="${waLink(mb.phone, text(mb))}" data-wa>${ICONS.whatsapp}<span>Abrir</span></a></div>`).join("")}</div>`,
    onMount(body) {
      body.addEventListener("click", (e) => { const a = e.target.closest("[data-wa]"); if (a) a.closest(".wa-item").classList.add("sent"); });
    },
    actions: [{ label: "Listo", cls: "btn-gold" }],
  });
}
