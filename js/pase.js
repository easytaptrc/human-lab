// Página del pase: socio (?k=llave del panel, estado en vivo) o reserva (?r, t, c, n, s, d, h).
import { db, doc, getDoc } from "./firebase.js";
import { loadSite } from "./site.js";
import { $, ICONS, todayStr } from "./utils.js";
import { renderPass, memberStatus } from "./pass.js";
import { openInstallGuide, isStandalone } from "./install-guide.js";

const { s, m } = await loadSite({ media: ["logo"] });
const p = new URLSearchParams(location.search);
const box = $("#pass");

try {
  if (p.get("k")) {
    const snap = await getDoc(doc(db, "portal", p.get("k")));
    if (!snap.exists()) throw new Error("no existe");
    const d = snap.data();
    const st = memberStatus(d, todayStr());
    await renderPass(box, { kind: "member", key: p.get("k"), name: d.name, memberId: d.memberId, ok: st.ok, until: d.endDate }, s, m);
  } else if (p.get("c")) {
    await renderPass(box, { kind: "reservation", id: p.get("r"), token: p.get("t"), code: p.get("c"), name: p.get("n") || "", service: p.get("s"), date: p.get("d"), time: p.get("h") }, s, m);
  } else throw new Error("sin datos");
  $("#actions").innerHTML = `
    ${isStandalone() ? "" : `<button class="btn btn-block" id="saveBtn">${ICONS.plus}<span>Guardar en mi teléfono</span></button>`}
    <a class="btn btn-block btn-ghost" href="index.html"><span>Ir al inicio</span></a>`;
  $("#saveBtn")?.addEventListener("click", () => openInstallGuide({ name: s.name, label: "Mi pase HPL", icon: "assets/icons/icon-192.png" }));
} catch {
  box.innerHTML = `<div class="empty card">Este pase no es válido o ya no existe. Pide ayuda en recepción.</div>`;
}
