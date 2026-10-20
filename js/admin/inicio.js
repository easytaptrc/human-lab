// Inicio del panel: resumen según los permisos del usuario.
import { db, collection, getDocs, query, where } from "../firebase.js";
import { $, esc, ICONS, todayStr, fmtDate } from "../utils.js";
import { getAll, memberState, daysInactive, daysToBirthday, ageFrom } from "./data.js";
import { waLink } from "../utils.js";
import { avatar } from "./ui.js";
import { STATUS, ATTENDANCE } from "./reservas.js";

export async function render(el, ctx) {
  const today = todayStr();
  const month = today.slice(0, 7);
  const canR = ctx.can("reservas");
  const canS = ctx.can("socios");
  const [res, members] = await Promise.all([
    canR ? getDocs(query(collection(db, "reservations"), where("date", "==", today))).then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))) : [],
    canS ? getAll("members", { force: true }) : [],
  ]);

  const active = members.filter((mb) => ["activa", "porvencer"].includes(memberState(mb, today).key));
  const expiring = members.filter((mb) => memberState(mb, today).key === "porvencer");
  const fresh = members.filter((mb) => (mb.joinDate || "").startsWith(month));
  const inactive = members.filter((mb) => (daysInactive(mb, today) ?? 0) > 45);
  const birthdays = members.map((mb) => ({ mb, d: daysToBirthday(mb.birthDate, today) })).filter((x) => x.d !== null && x.d <= 7).sort((a, b) => a.d - b.d);
  const todayRes = res.filter((r) => r.status !== "cancelada").sort((a, b) => a.time.localeCompare(b.time));

  const stat = (icon, label, value, hint, href) =>
    `<div class="stat ${href ? "clickable" : ""}" ${href ? `data-href="${href}"` : ""}>${ICONS[icon]}<span>${label}</span><b>${value}</b>${hint ? `<small>${hint}</small>` : ""}</div>`;

  el.innerHTML = `
    <div class="stats">
      ${canS ? stat("users", "Miembros activos", active.length, `${members.length} registrados`, "#socios?f=activa") : ""}
      ${canR ? stat("calendar", "Reservas hoy", todayRes.length, `${todayRes.filter((r) => r.attendance === "confirmada").length} confirmaron`, "#reservas") : ""}
      ${canS ? stat("plus", "Nuevos este mes", fresh.length, "", "#socios") : ""}
      ${canS ? stat("bell", "Por vencer (7 días)", expiring.length, "", "#socios?f=porvencer") : ""}
      ${canS ? stat("clock", "Sin asistir +45 d", inactive.length, "", "#socios?f=inactivos") : ""}
    </div>
    <div class="grid-2">
      ${canR ? `<div class="panel">
        <div class="panel-head"><h2>Próximas reservas</h2><a href="#reservas">Ver todas</a></div>
        <div class="table-wrap">${todayRes.length ? `<table class="t"><thead><tr><th>Hora</th><th>Cliente</th><th>Servicio</th><th>Estado</th></tr></thead><tbody>
          ${todayRes.slice(0, 10).map((r) => {
            const at = ATTENDANCE[r.attendance] || ATTENDANCE.pendiente;
            const st = STATUS[r.status];
            return `<tr><td class="num">${r.time}</td><td>${esc(r.name)}</td><td>${esc(r.serviceName)}</td><td>${r.status === "confirmada" ? `<span class="dot ${at[1]}">${at[0]}</span>` : `<span class="badge ${st[1]}">${st[0]}</span>`}</td></tr>`;
          }).join("")}</tbody></table>` : `<div class="empty">Sin reservas para hoy.</div>`}</div>
      </div>` : ""}
      ${canS ? `<div class="panel">
        <div class="panel-head"><h2>Miembros</h2><a href="#socios">Ver todos</a></div>
        <div class="table-wrap">${members.length ? `<table class="t"><thead><tr><th>Nombre</th><th>Estado</th><th>Membresía</th><th>Registro</th></tr></thead><tbody>
          ${[...members].sort((a, b) => String(b.joinDate || "").localeCompare(a.joinDate || "")).slice(0, 6).map((mb) => {
            const st = memberState(mb, today);
            return `<tr><td><div class="who">${avatar(mb.name)}${esc(mb.name)}</div></td><td><span class="dot ${st.cls}">${st.label}</span></td><td>${esc(mb.plan || "—")}</td><td class="nowrap">${fmtDate(mb.joinDate || mb.startDate)}</td></tr>`;
          }).join("")}</tbody></table>` : `<div class="empty">Aún no hay socios.</div>`}</div>
      </div>` : ""}
    </div>
    ${canS && birthdays.length ? `<div class="panel">
      <div class="panel-head"><h2>🎂 Cumpleaños de la semana</h2><a href="#socios?f=cumple">Ver del mes</a></div>
      <div class="table-wrap"><table class="t"><thead><tr><th>Socio</th><th>Cuándo</th><th>Cumple</th><th></th></tr></thead><tbody>
        ${birthdays.map(({ mb, d }) => `<tr><td><div class="who">${avatar(mb.name)}${esc(mb.name)}</div></td>
          <td>${d === 0 ? '<span class="badge badge-gold">¡Hoy!</span>' : d === 1 ? "Mañana" : `En ${d} días`}</td>
          <td>${(ageFrom(mb.birthDate) ?? 0) + (d === 0 ? 0 : 1)} años</td>
          <td><div class="actions">${mb.phone ? `<a class="icon-btn" target="_blank" rel="noopener" title="Felicitar por WhatsApp" href="${waLink(mb.phone, `¡Feliz cumpleaños ${mb.name.split(" ")[0]}! 🎉 Todo el equipo de Human Prime Lab te desea un gran año.`)}">${ICONS.whatsapp}</a>` : ""}</div></td></tr>`).join("")}
      </tbody></table></div></div>` : ""}
    ${!canR && !canS ? `<div class="panel"><div class="panel-body">Bienvenido, ${esc(ctx.staff.name)}. Usa el menú para ir a tus secciones.</div></div>` : ""}`;

  el.addEventListener("click", (e) => {
    const s = e.target.closest("[data-href]");
    if (s) location.hash = s.dataset.href;
  });
}
