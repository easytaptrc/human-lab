// Notificaciones: confirmación 1 h antes, vencimientos y promociones a inactivos.
import { db, collection, getDocs, query, where, doc, updateDoc, setDoc, addDoc, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, todayStr, addDays, fmtDate, waLink, fillTemplate, toast, store } from "../utils.js";
import { getAll, memberState, daysInactive, getNotifySettings, confirmLink, NOTIFY_DEFAULTS } from "./data.js";
import { avatar, loadingHTML } from "./ui.js";
import { sendInbox } from "./socios.js";
import { reminderText } from "./reservas.js";

const TABS = [["citas", "Confirmar citas (1 h antes)"], ["vence", "Suscripciones"], ["promo", "Promoción inactivos"], ["plantillas", "Plantillas y automático"]];

export async function render(el, ctx) {
  let n = await getNotifySettings();
  const state = { tab: "citas" };
  el.innerHTML = `
    <div class="notice">${ICONS.bell}<p><b>Automático:</b> quien reserva y los socios que activaron notificaciones reciben un aviso en su teléfono 1 hora antes para confirmar (requiere las Cloud Functions y la clave de notificaciones en Configuración del sitio). La columna <b>Avisos</b> indica quién las tiene activadas. <b>Manual:</b> desde aquí también puedes enviar el recordatorio por WhatsApp con un clic.</p></div>
    <div class="cfg-tabs" id="tabs">${TABS.map(([k, l]) => `<button data-t="${k}" class="${k === state.tab ? "on" : ""}">${l}</button>`).join("")}</div>
    <div id="body">${loadingHTML}</div>`;

  let timer = null;
  let notified = new Set();

  const tabCitas = async () => {
    const today = todayStr();
    const snap = await getDocs(query(collection(db, "reservations"), where("date", ">=", today), where("date", "<=", addDays(today, 1))));
    const now = Date.now();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => r.status === "confirmada")
      .map((r) => ({ ...r, mins: Math.round((r.startAt.toMillis() - now) / 60000) }))
      .filter((r) => r.mins > -30)
      .sort((a, b) => a.mins - b.mins);
    const due = list.filter((r) => r.mins <= 75 && r.mins >= 0 && r.attendance === "pendiente");
    // Aviso del navegador para recepción cuando una cita entra a la ventana de 1 hora
    if (store.get("hpl_browser_notify") && "Notification" in window && Notification.permission === "granted") {
      due.filter((r) => !r.reminderSent && !notified.has(r.id)).forEach((r) => {
        notified.add(r.id);
        new Notification("Enviar recordatorio de cita", { body: `${r.name} · ${r.serviceName} a las ${r.time}` });
      });
    }
    $("#body", el).innerHTML = `
      <div class="toolbar" style="margin:16px 0">
        <label class="switch"><input type="checkbox" id="bn" ${store.get("hpl_browser_notify") ? "checked" : ""}> Avisarme en este navegador cuando haya que enviar un recordatorio</label>
      </div>
      <div class="panel"><div class="panel-head"><h2>Citas de hoy y mañana</h2><span class="muted">${due.length} por enviar ahora</span></div>
      <div class="table-wrap">${list.length ? `<table class="t"><thead><tr><th>Cuándo</th><th>Cliente</th><th>Servicio</th><th>Asistencia</th><th>Avisos</th><th>Recordatorio</th><th></th></tr></thead><tbody>
        ${list.map((r) => `<tr data-id="${r.id}">
          <td class="nowrap"><b>${r.time}</b> <span class="muted">· ${r.date === today ? "hoy" : "mañana"}</span><br><small class="${r.mins <= 75 && r.mins >= 0 ? "gold" : "muted"}">${r.mins < 0 ? "en curso" : r.mins < 60 ? `en ${r.mins} min` : `en ${Math.floor(r.mins / 60)} h ${r.mins % 60} min`}</small></td>
          <td>${esc(r.name)}<br><small class="muted">${esc(r.phone)}</small></td>
          <td>${esc(r.serviceName)}</td>
          <td><span class="dot ${r.attendance === "confirmada" ? "" : r.attendance === "no_asistira" ? "dot-bad" : "dot-warn"}">${r.attendance === "confirmada" ? "Confirmó" : r.attendance === "no_asistira" ? "No asistirá" : "Por confirmar"}</span></td>
          <td>${r.pushToken ? `<span class="badge badge-gold">${ICONS.bell} Activos</span>` : `<span class="muted">—</span>`}</td>
          <td>${r.reminderSent ? `<span class="badge badge-ok">Enviado</span>` : `<span class="badge">Pendiente</span>`}</td>
          <td><div class="actions"><a class="btn btn-sm ${r.mins <= 75 && !r.reminderSent ? "btn-gold" : ""}" data-wa target="_blank" rel="noopener" href="${waLink(r.phone, reminderText(ctx, n, r))}">${ICONS.whatsapp}<span>Enviar</span></a>
            <button class="icon-btn" data-copy title="Copiar enlace de confirmación">${ICONS.link}</button></div></td>
        </tr>`).join("")}</tbody></table>` : `<div class="empty">No hay citas próximas.</div>`}</div></div>`;
    $("#bn", el).onchange = async (e) => {
      if (e.target.checked && "Notification" in window) {
        const p = await Notification.requestPermission();
        if (p !== "granted") { e.target.checked = false; toast("Permite las notificaciones en tu navegador.", "warn"); return; }
      }
      store.set("hpl_browser_notify", e.target.checked);
    };
    $("#body", el).onclick = async (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const r = list.find((x) => x.id === tr.dataset.id);
      if (e.target.closest("[data-wa]")) {
        await updateDoc(doc(db, "reservations", r.id), { reminderSent: true, reminderAt: serverTimestamp() }).catch(() => {});
        setTimeout(tabCitas, 800);
      }
      if (e.target.closest("[data-copy]")) {
        await navigator.clipboard.writeText(confirmLink(ctx.s, r)).catch(() => {});
        toast("Enlace de confirmación copiado.");
      }
    };
  };

  const memberRows = (list, kind) => {
    const today = todayStr();
    return list.length ? `<table class="t"><thead><tr><th>Socio</th><th>${kind === "promo" ? "Última visita" : "Vence"}</th><th>Estado</th><th>Aviso</th><th></th></tr></thead><tbody>
      ${list.map((mb) => {
        const st = memberState(mb, today);
        const tpl = kind === "promo" ? n.tplPromo : st.key === "vencida" ? n.tplExpired : n.tplExpiring;
        const text = fillTemplate(tpl, { nombre: mb.name.split(" ")[0], plan: mb.plan || "", vence: fmtDate(mb.endDate) });
        const sent = kind === "promo" ? mb.promoSent && daysInactive({ lastVisit: mb.promoSent }) < 30 : mb.notifiedExpiry === `${st.key}:${mb.endDate}`;
        return `<tr data-id="${esc(mb.id)}" data-text="${esc(text)}">
          <td><div class="who">${avatar(mb.name)}<div>${esc(mb.name)}<small>${esc(mb.memberId)} · ${esc(mb.phone || "sin teléfono")}</small></div></div></td>
          <td class="nowrap">${kind === "promo" ? `${mb.lastVisit ? fmtDate(mb.lastVisit) : "Nunca"} · ${daysInactive(mb, today)} d` : fmtDate(mb.endDate)}</td>
          <td><span class="dot ${st.cls}">${st.label}</span></td>
          <td>${sent ? `<span class="badge badge-ok">Enviado</span>` : `<span class="badge">Pendiente</span>`}</td>
          <td><div class="actions">
            ${mb.phone ? `<a class="btn btn-sm ${sent ? "" : "btn-gold"}" data-wa target="_blank" rel="noopener" href="${waLink(mb.phone, text)}">${ICONS.whatsapp}<span>WhatsApp</span></a>` : ""}
            <button class="btn btn-sm" data-panel>${ICONS.user}<span>Al panel</span></button>
          </div></td></tr>`;
      }).join("")}</tbody></table>` : `<div class="empty">Nadie en esta lista por ahora.</div>`;
  };

  const bindMembers = (list, kind, redraw) => {
    $("#body", el).onclick = async (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const mb = list.find((x) => x.id === tr.dataset.id);
      const st = memberState(mb).key;
      const mark = kind === "promo" ? { promoSent: todayStr() } : { notifiedExpiry: `${st}:${mb.endDate}` };
      if (e.target.closest("[data-wa]")) {
        await updateDoc(doc(db, "members", mb.id), mark).catch(() => {});
        Object.assign(mb, mark);
        setTimeout(redraw, 600);
      }
      if (e.target.closest("[data-panel]")) {
        const title = kind === "promo" ? "¡Te extrañamos!" : st === "vencida" ? "Tu membresía venció" : "Tu membresía está por vencer";
        try {
          if (!(await sendInbox(mb, title, tr.dataset.text))) { toast("Este socio no tiene panel activo.", "warn"); return; }
          await updateDoc(doc(db, "members", mb.id), mark);
          Object.assign(mb, mark);
          await addDoc(collection(db, "messages"), { title, body: tr.dataset.text, audience: `Socio ${mb.memberId}`, count: 1, channels: ["panel"], by: ctx.staff.name, createdAt: serverTimestamp() });
          toast("Aviso enviado al panel del socio.");
          redraw();
        } catch (ex) { console.error(ex); toast("No se pudo enviar.", "error"); }
      }
    };
  };

  const tabVence = async () => {
    const today = todayStr();
    const members = await getAll("members", { force: true });
    const soon = members.filter((mb) => mb.endDate && mb.endDate >= today && mb.endDate <= addDays(today, n.expiringDays)).sort((a, b) => a.endDate.localeCompare(b.endDate));
    const gone = members.filter((mb) => mb.endDate && mb.endDate < today && mb.endDate >= addDays(today, -30)).sort((a, b) => b.endDate.localeCompare(a.endDate));
    const draw = () => {
      $("#body", el).innerHTML = `
        <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Por vencer (próximos ${n.expiringDays} días)</h2><span class="muted">${soon.length}</span></div><div class="table-wrap">${memberRows(soon, "vence")}</div></div>
        <div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Vencidas (últimos 30 días)</h2><span class="muted">${gone.length}</span></div><div class="table-wrap">${memberRows(gone, "vence")}</div></div>`;
    };
    draw();
    bindMembers([...soon, ...gone], "vence", draw);
  };

  const tabPromo = async () => {
    const members = await getAll("members", { force: true });
    const list = members.filter((mb) => (daysInactive(mb) ?? 0) > n.inactiveDays).sort((a, b) => daysInactive(b) - daysInactive(a));
    const draw = () => {
      $("#body", el).innerHTML = `<div class="panel" style="margin-top:16px"><div class="panel-head"><h2>Sin asistir hace más de ${n.inactiveDays} días</h2><span class="muted">${list.length}</span></div><div class="table-wrap">${memberRows(list, "promo")}</div></div>`;
    };
    draw();
    bindMembers(list, "promo", draw);
  };

  const tabPlantillas = () => {
    const t = (k, label, vars) => `<label class="field span-2"><span>${label}</span><textarea class="input" name="${k}" rows="3">${esc(n[k])}</textarea>
      <div class="tpl-vars">${vars.map((v) => `<code data-v="{${v}}">{${v}}</code>`).join("")}</div></label>`;
    $("#body", el).innerHTML = `
      <div class="panel" style="margin-top:16px"><div class="panel-body">
        <div class="form-grid">
          <label class="field"><span>Avisar vencimiento con (días)</span><input class="input" type="number" name="expiringDays" min="1" value="${n.expiringDays}"></label>
          <label class="field"><span>Promoción a quien no asiste en (días)</span><input class="input" type="number" name="inactiveDays" min="7" value="${n.inactiveDays}"></label>
          <div class="span-2 release-box">
            <label class="switch"><input type="checkbox" name="autoRelease" ${n.autoRelease !== false ? "checked" : ""}> <b>Liberar el lugar si no confirma</b></label>
            <label class="field" style="max-width:240px;margin-top:10px"><span>Tolerancia (minutos después del primer aviso)</span><input class="input" type="number" name="tolerance" min="5" max="45" step="5" value="${n.tolerance ?? 15}"></label>
            <p class="hint">Ejemplo con 15 min y cita a las 6:00 pm: avisos a las 5:00, 5:05 y 5:10; a las 5:15, si no confirmó, se libera el lugar y se le avisa. Si confirma, ya no recibe avisos. Solo aplica a quien tiene notificaciones o correo/WhatsApp automático, y no a quien reservó dentro de la última hora.</p>
          </div>
          <label class="switch" style="align-self:end;min-height:46px"><input type="checkbox" name="autoEmail" ${n.autoEmail ? "checked" : ""}> Envío automático por correo (Cloud Functions)</label>
          <label class="switch" style="align-self:end;min-height:46px"><input type="checkbox" name="autoWhatsapp" ${n.autoWhatsapp ? "checked" : ""}> Envío automático por WhatsApp API</label>
          ${t("tplReminder", "Recordatorio de cita (1 hora antes)", ["nombre", "servicio", "fecha", "hora", "enlace"])}
          ${t("tplExpiring", "Suscripción por vencer", ["nombre", "plan", "vence"])}
          ${t("tplExpired", "Suscripción vencida", ["nombre", "plan", "vence"])}
          ${t("tplPromo", "Promoción para inactivos", ["nombre"])}
        </div>
        <div class="btn-row" style="margin-top:16px;justify-content:flex-end">
          <button class="btn btn-sm" id="reset">Restaurar textos</button>
          <button class="btn btn-sm btn-gold" id="save">Guardar</button>
        </div>
      </div></div>`;
    const body = $("#body", el);
    body.onclick = async (e) => {
      const v = e.target.closest("[data-v]");
      if (v) {
        const ta = v.closest(".field").querySelector("textarea");
        ta.setRangeText(v.dataset.v, ta.selectionStart, ta.selectionEnd, "end");
        ta.focus();
      }
      if (e.target.closest("#reset")) {
        for (const k of ["tplReminder", "tplExpiring", "tplExpired", "tplPromo"]) body.querySelector(`[name=${k}]`).value = NOTIFY_DEFAULTS[k];
      }
      if (e.target.closest("#save")) {
        const data = {};
        body.querySelectorAll("[name]").forEach((i) => { data[i.name] = i.type === "checkbox" ? i.checked : i.type === "number" ? Number(i.value) : i.value; });
        try {
          await setDoc(doc(db, "settings", "notify"), { ...data, updatedAt: serverTimestamp() }, { merge: true });
          n = { ...n, ...data };
          toast("Plantillas guardadas.");
        } catch (ex) { console.error(ex); toast("No se pudo guardar.", "error"); }
      }
    };
  };

  const show = async () => {
    clearInterval(timer);
    $("#body", el).innerHTML = loadingHTML;
    try {
      if (state.tab === "citas") { await tabCitas(); timer = setInterval(tabCitas, 60000); }
      if (state.tab === "vence") await tabVence();
      if (state.tab === "promo") await tabPromo();
      if (state.tab === "plantillas") tabPlantillas();
    } catch (ex) {
      console.error(ex);
      $("#body", el).innerHTML = `<div class="empty">No se pudo cargar. Verifica tus permisos.</div>`;
    }
  };
  $("#tabs", el).onclick = (e) => {
    const b = e.target.closest("[data-t]");
    if (!b) return;
    state.tab = b.dataset.t;
    el.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    show();
  };
  await show();
  return () => clearInterval(timer);
}
