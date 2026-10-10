// Reportes: miembros activos, vencidos, sin asistir y reservas por servicio.
import { db, collection, getDocs, query, where } from "../firebase.js";
import { $, esc, ICONS, todayStr, addDays, fmtDate, fmtMoney, waLink, fillTemplate } from "../utils.js";
import { getAll, memberState, daysInactive, getNotifySettings } from "./data.js";
import { avatar, downloadCSV, loadingHTML } from "./ui.js";

const RANGES = [["30", "Últimos 30 días"], ["90", "Últimos 90 días"], ["365", "Último año"]];

export async function render(el) {
  const state = { range: "30", tab: "inactivos" };
  el.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="ranges">${RANGES.map(([k, l]) => `<button data-r="${k}" class="${k === state.range ? "on" : ""}">${l}</button>`).join("")}</div>
      <span style="flex:1"></span>
      <button class="btn btn-sm" id="csvM">${ICONS.users}<span>Exportar socios</span></button>
      <button class="btn btn-sm" id="csvR">${ICONS.calendar}<span>Exportar reservas</span></button>
    </div>
    <div id="body">${loadingHTML}</div>`;

  let members = [];
  let res = [];
  let pays = [];
  const notify = await getNotifySettings();

  const load = async () => {
    const today = todayStr();
    const from = addDays(today, -Number(state.range));
    const [m, r, p] = await Promise.all([
      getAll("members", { force: true }),
      getDocs(query(collection(db, "reservations"), where("date", ">=", from), where("date", "<=", today))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      getDocs(query(collection(db, "payments"), where("date", ">=", from))).then((s) => s.docs.map((d) => d.data())).catch(() => []),
    ]);
    members = m; res = r; pays = p;
    draw();
  };

  const draw = () => {
    const today = todayStr();
    const days = notify.inactiveDays || 45;
    const by = (k) => members.filter((mb) => memberState(mb, today).key === k);
    const active = [...by("activa"), ...by("porvencer")];
    const expired = by("vencida");
    const expiring = by("porvencer");
    const inactive = members.filter((mb) => (daysInactive(mb, today) ?? 0) > days).sort((a, b) => daysInactive(b) - daysInactive(a));
    const valid = res.filter((r) => r.status !== "cancelada");
    const attended = res.filter((r) => r.status === "asistio").length;
    const missed = res.filter((r) => r.status === "no_asistio").length;
    const rate = attended + missed ? Math.round((attended / (attended + missed)) * 100) : null;
    const income = pays.reduce((a, p) => a + (Number(p.amount) || 0), 0);

    const perSvc = {};
    valid.forEach((r) => { perSvc[r.serviceName] = (perSvc[r.serviceName] || 0) + 1; });
    const svcRows = Object.entries(perSvc).sort((a, b) => b[1] - a[1]);
    const maxSvc = Math.max(1, ...svcRows.map((x) => x[1]));

    const perHour = {};
    valid.forEach((r) => { perHour[r.time] = (perHour[r.time] || 0) + 1; });
    const hourRows = Object.entries(perHour).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxHour = Math.max(1, ...hourRows.map((x) => x[1]));

    const lists = {
      inactivos: [`Sin asistir +${days} días`, inactive],
      activos: ["Activos", active],
      porvencer: ["Por vencer", expiring],
      vencidos: ["Vencidos", expired],
    };
    const [, rows] = lists[state.tab];

    $("#body", el).innerHTML = `
      <div class="stats">
        <div class="stat">${ICONS.users}<span>Socios activos</span><b>${active.length}</b><small>de ${members.length} registrados</small></div>
        <div class="stat">${ICONS.bell}<span>Vencidos</span><b>${expired.length}</b><small>${expiring.length} por vencer</small></div>
        <div class="stat">${ICONS.clock}<span>Sin asistir +${days} d</span><b>${inactive.length}</b></div>
        <div class="stat">${ICONS.calendar}<span>Reservas</span><b>${valid.length}</b><small>en el periodo</small></div>
        <div class="stat">${ICONS.check}<span>Asistencia</span><b>${rate === null ? "—" : rate + "%"}</b><small>${attended} asistieron · ${missed} faltaron</small></div>
        <div class="stat">${ICONS.tag}<span>Ingresos registrados</span><b style="font-size:22px">${fmtMoney(income)}</b><small>${pays.length} pagos</small></div>
      </div>
      <div class="grid-2">
        <div class="panel"><div class="panel-head"><h2>Reservas por servicio</h2></div><div class="panel-body">
          ${svcRows.length ? `<div class="bars">${svcRows.map(([n, c]) => `<div class="bar-row"><span>${esc(n)}</span><div class="bar-track"><span style="width:${(c / maxSvc) * 100}%"></span></div><b>${c}</b></div>`).join("")}</div>` : `<p class="muted" style="margin:0">Sin reservas en el periodo.</p>`}
        </div></div>
        <div class="panel"><div class="panel-head"><h2>Horarios más solicitados</h2></div><div class="panel-body">
          ${hourRows.length ? `<div class="bars">${hourRows.map(([n, c]) => `<div class="bar-row"><span>${esc(n)}</span><div class="bar-track"><span style="width:${(c / maxHour) * 100}%"></span></div><b>${c}</b></div>`).join("")}</div>` : `<p class="muted" style="margin:0">Sin datos.</p>`}
        </div></div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="seg" id="tabs">${Object.entries(lists).map(([k, [l, arr]]) => `<button data-t="${k}" class="${k === state.tab ? "on" : ""}">${l} (${arr.length})</button>`).join("")}</div>
        </div>
        <div class="table-wrap">${rows.length ? `<table class="t"><thead><tr><th>Socio</th><th>ID</th><th>Estado</th><th>Vence</th><th>Última visita</th><th></th></tr></thead><tbody>
          ${rows.map((mb) => {
            const st = memberState(mb, today);
            const d = daysInactive(mb, today);
            const msg = state.tab === "inactivos" ? notify.tplPromo : st.key === "vencida" ? notify.tplExpired : notify.tplExpiring;
            const text = fillTemplate(msg, { nombre: mb.name.split(" ")[0], plan: mb.plan || "", vence: fmtDate(mb.endDate) });
            return `<tr><td><div class="who">${avatar(mb.name)}<div>${esc(mb.name)}<small>${esc(mb.phone || "")}</small></div></div></td>
              <td><span class="badge badge-gold">${esc(mb.memberId)}</span></td>
              <td><span class="dot ${st.cls}">${st.label}</span></td>
              <td class="nowrap">${fmtDate(mb.endDate)}</td>
              <td class="nowrap">${mb.lastVisit ? fmtDate(mb.lastVisit) : "Nunca"}${d !== null ? ` · ${d} d` : ""}</td>
              <td><div class="actions">${mb.phone ? `<a class="icon-btn" target="_blank" rel="noopener" title="WhatsApp" href="${waLink(mb.phone, text)}">${ICONS.whatsapp}</a>` : ""}</div></td></tr>`;
          }).join("")}</tbody></table>` : `<div class="empty">Nadie en esta lista.</div>`}</div>
      </div>`;
  };

  el.addEventListener("click", (e) => {
    const r = e.target.closest("[data-r]");
    if (r) { state.range = r.dataset.r; el.querySelectorAll("#ranges button").forEach((b) => b.classList.toggle("on", b === r)); $("#body", el).innerHTML = loadingHTML; load(); }
    const t = e.target.closest("[data-t]");
    if (t) { state.tab = t.dataset.t; draw(); }
  });
  $("#csvM", el).onclick = () => downloadCSV(`socios-${todayStr()}.csv`, [
    ["ID", "Nombre", "Teléfono", "Correo", "Edad", "Emergencia", "Plan", "Inicio", "Vence", "Estado", "Última visita", "Visitas"],
    ...members.map((mb) => [mb.memberId, mb.name, mb.phone, mb.email, mb.age, mb.emergency, mb.plan, mb.startDate, mb.endDate, memberState(mb).label, mb.lastVisit, mb.visits || 0]),
  ]);
  $("#csvR", el).onclick = () => downloadCSV(`reservas-${todayStr()}.csv`, [
    ["Fecha", "Hora", "Servicio", "Nombre", "Teléfono", "Correo", "Edad", "Emergencia", "Observaciones", "Socio", "Estado", "Asistencia"],
    ...res.map((r) => [r.date, r.time, r.serviceName, r.name, r.phone, r.email, r.age, r.emergency, r.notes, r.memberId, r.status, r.attendance]),
  ]);
  await load();
}
