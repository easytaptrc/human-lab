// Página del pase: socio (?k=llave del panel, estado en vivo) o reserva (?r, t, c, n, s, d, h).
import { db, doc, getDoc } from "./firebase.js";
import { loadSite } from "./site.js";
import { $, ICONS, todayStr, store } from "./utils.js";
import { renderPass, memberStatus } from "./pass.js";
import { openInstallGuide, isStandalone } from "./install-guide.js";

const { s, m } = await loadSite({ media: ["logo"] });
const p = new URLSearchParams(location.search);
// Sin datos en el enlace: el pase guardado en este teléfono (socio o última reserva)
if (!p.get("k") && !p.get("c")) {
  const socio = store.get("hpl_socio");
  const res = store.get("hpl_pass");
  if (socio) p.set("k", socio);
  else if (res) Object.entries({ r: res.id, t: res.token, c: res.code, n: res.name, s: res.service, d: res.date, h: res.time, m: res.more || 0 }).forEach(([k, v]) => p.set(k, v ?? ""));
}
const box = $("#pass");

try {
  if (p.get("k")) {
    const snap = await getDoc(doc(db, "portal", p.get("k")));
    if (!snap.exists()) throw new Error("no existe");
    const d = snap.data();
    const st = memberStatus(d, todayStr());
    await renderPass(box, { kind: "member", key: p.get("k"), name: d.name, memberId: d.memberId, ok: st.ok, until: d.endDate }, s, m);
  } else if (p.get("c")) {
    await renderPass(box, { kind: "reservation", id: p.get("r"), token: p.get("t"), code: p.get("c"), name: p.get("n") || "", service: p.get("s"), date: p.get("d"), time: p.get("h"), more: Number(p.get("m")) || 0 }, s, m);
  } else throw new Error("sin datos");
  // ¿Es el pase guardado en este teléfono? Si no, se ofrece guardarlo para verlo en "Mi pase"
  const saved = p.get("k") ? store.get("hpl_socio") === p.get("k") : store.get("hpl_pass")?.code === p.get("c");
  $("#actions").innerHTML = `
    ${saved ? "" : `<button class="btn btn-block btn-gold" id="keepBtn">${ICONS.check}<span>Usar como mi pase en este teléfono</span></button>`}
    ${isStandalone() ? "" : `<button class="btn btn-block" id="saveBtn">${ICONS.plus}<span>Instalar la app en mi teléfono</span></button>`}
    <a class="btn btn-block btn-ghost" href="index.html"><span>Ir al inicio</span></a>`;
  $("#keepBtn")?.addEventListener("click", (e) => {
    if (p.get("k")) store.set("hpl_socio", p.get("k"));
    else store.set("hpl_pass", { id: p.get("r"), token: p.get("t"), code: p.get("c"), name: p.get("n"), service: p.get("s"), date: p.get("d"), time: p.get("h"), more: Number(p.get("m")) || 0 });
    e.currentTarget.remove();
  });
  $("#saveBtn")?.addEventListener("click", () => openInstallGuide({ name: s.name, label: "Mi pase HPL", icon: "assets/icons/icon-192.png" }));
} catch {
  box.innerHTML = p.get("k") || p.get("c")
    ? `<div class="empty card">Este pase no es válido o ya no existe. Pide ayuda en recepción.</div>`
    : `<div class="empty card">Aún no tienes un pase en este teléfono.<br>Haz una reserva o entra como socio y aparecerá aquí.</div><div class="pase-actions"><a class="btn btn-gold btn-block" href="reservar.html">Reservar</a><a class="btn btn-block" href="miembro.html">Soy socio</a></div>`;
}
