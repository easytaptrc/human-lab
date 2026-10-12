// Mensajes a socios: panel del socio, WhatsApp y correo.
import { db, collection, addDoc, getDocs, getCountFromServer, query, orderBy, limit, writeBatch, doc, deleteDoc, arrayUnion, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, todayStr, fmtDate, waLink, fillTemplate, toast } from "../utils.js";
import { getAll, memberState, daysInactive } from "./data.js";
import { openModal, confirmDialog, loadingHTML } from "./ui.js";

const AUDIENCES = [
  ["todos", "Todos los socios"],
  ["activos", "Socios activos"],
  ["porvencer", "Por vencer (7 días)"],
  ["vencidos", "Vencidos"],
  ["inactivos", "Sin asistir +45 días"],
  ["elegir", "Elegir socios…"],
  ["push", "📣 Todos con notificaciones activas (promoción)"],
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
          <p class="hint" id="pushInfo" hidden>Llega como notificación al teléfono de todas las personas que activaron las notificaciones (clientes, socios y visitantes). Ideal para promociones. No uses {nombre} aquí.</p>
          <div id="chWrap">
          <h4 class="form-sec">Enviar por</h4>
          <div class="checks">
            <label class="check"><input type="checkbox" id="chPanel" checked> ${ICONS.user} Panel del socio</label>
            <label class="check"><input type="checkbox" id="chWa"> ${ICONS.whatsapp} WhatsApp</label>
            <label class="check"><input type="checkbox" id="chMail"> ${ICONS.mail} Correo electrónico</label>
          </div>
          <p class="hint">WhatsApp abre un mensaje listo por cada socio. El correo se envía automáticamente si instalaste la extensión “Trigger Email” de Firebase (ver README).</p>
          </div>
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
  let pushCount = null;
  const isPush = () => $("#aud", el).value === "push";
  const updateCount = async () => {
    if (isPush()) {
      $("#count", el).textContent = "contando…";
      try { pushCount = (await getCountFromServer(collection(db, "subscribers"))).data().count; } catch { pushCount = 0; }
      if (isPush()) $("#count", el).textContent = `${pushCount} dispositivos`;
      return;
    }
    $("#count", el).textContent = `${audience().length} socios`;
  };
  const drawPick = () => {
    const q = $("#pickQ", el).value.toLowerCase();
    $("#pick", el).innerHTML = members
      .filter((mb) => !q || `${mb.name} ${mb.memberId}`.toLowerCase().includes(q))
      .map((mb) => `<label class="check"><input type="checkbox" value="${esc(mb.id)}" ${picked.has(mb.id) ? "checked" : ""}> ${esc(mb.name)} <span class="muted">· ${esc(mb.memberId)}</span></label>`).join("") || `<p class="muted">Sin socios.</p>`;
  };
  $("#aud", el).onchange = () => {
    $("#pickWrap", el).hidden = $("#aud", el).value !== "elegir";
    $("#chWrap", el).hidden = isPush();
    $("#pushInfo", el).hidden = !isPush();
    drawPick();
    updateCount();
  };
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

  let hist = [];
  const drawHist = async () => {
    try {
      const snap = await getDocs(query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(50)));
      hist = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      $("#hist", el).innerHTML = hist.map((x) => {
        const when = x.createdAt?.toDate ? x.createdAt.toDate().toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : "";
        return `<div class="hist-item" data-id="${esc(x.id)}"><div class="hist-top"><b>${esc(x.title || "Mensaje")}</b><span class="hist-actions"><button class="btn btn-sm" data-h="reuse" title="Usar como plantilla">${ICONS.edit}<span>Reutilizar</span></button><button class="icon-btn" data-h="del" title="Borrar del historial">${ICONS.trash}</button></span></div><p>${esc(x.body)}</p><small>${esc(x.audience)} · ${x.count} ${x.audience === "Notificación a todos" ? "dispositivos" : "socios"} · ${(x.channels || []).join(", ")} · ${esc(x.by || "")} · ${when}</small></div>`;
      }).join("") || `<div class="empty">Aún no has enviado mensajes.</div>`;
    } catch (ex) {
      console.warn(ex);
      $("#hist", el).innerHTML = `<div class="empty">Historial no disponible.</div>`;
    }
  };
  drawHist();

  // Historial: reutilizar como plantilla o borrar
  $("#hist", el).addEventListener("click", async (e) => {
    const act = e.target.closest("[data-h]")?.dataset.h;
    const item = e.target.closest(".hist-item");
    if (!act || !item) return;
    const x = hist.find((h) => h.id === item.dataset.id);
    if (!x) return;
    if (act === "reuse") {
      $("#title", el).value = x.title || "";
      $("#body", el).value = x.body || "";
      if (x.audience === "Notificación a todos") { $("#aud", el).value = "push"; $("#aud", el).onchange(); }
      el.querySelector(".panel").scrollIntoView({ behavior: "smooth", block: "start" });
      $("#body", el).focus();
      toast("Mensaje cargado. Ajústalo y elige a quién enviarlo.");
    }
    if (act === "del") {
      if (!(await confirmDialog(`¿Borrar “${x.title || "Mensaje"}” del historial? Los socios que ya lo recibieron lo conservan.`, { ok: "Borrar", danger: true }))) return;
      try { await deleteDoc(doc(db, "messages", x.id)); toast("Mensaje borrado del historial."); drawHist(); }
      catch (ex) { console.error(ex); toast("No se pudo borrar.", "error"); }
    }
  });

  $("#send", el).onclick = async () => {
    const title = $("#title", el).value.trim() || "Mensaje del gimnasio";
    const body = $("#body", el).value.trim();
    // Promoción: notificación push a todos los dispositivos suscritos (la envía la función difusionPush)
    if (isPush()) {
      if (!body) { toast("Escribe el mensaje.", "error"); return; }
      if (!pushCount) { toast("Aún no hay personas con notificaciones activas.", "warn"); return; }
      try {
        await addDoc(collection(db, "broadcasts"), { title, body, url: "index.html", status: "pendiente", by: ctx.staff.name, createdAt: serverTimestamp() });
        await addDoc(collection(db, "messages"), { title, body, audience: "Notificación a todos", count: pushCount, channels: ["notificación push"], by: ctx.staff.name, createdAt: serverTimestamp() });
        toast(`Notificación enviada a ${pushCount} dispositivos.`);
        drawHist();
      } catch (ex) { console.error(ex); toast("No se pudo enviar la notificación.", "error"); }
      return;
    }
    const list = audience();
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
