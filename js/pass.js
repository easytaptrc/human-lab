// Tarjeta de pase de acceso (estilo Wallet) con QR y botones para Apple Wallet / Google Wallet.
import { WALLET_URL } from "./firebase.js";
import { esc, ICONS, fmtDate } from "./utils.js";
import { markHTML } from "./site.js";
import { logoMark } from "./logo.js";
import { qrSVG, memberQR, reservationQR } from "./qr.js";

const isApple = /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent);

// Enlaces del servicio de Wallet y de la página del pase
export function passLinks(p) {
  const q = p.kind === "member" ? `k=${encodeURIComponent(p.key)}` : `r=${encodeURIComponent(p.id)}&t=${encodeURIComponent(p.token)}`;
  const page = p.kind === "member"
    ? `pase.html?k=${encodeURIComponent(p.key)}`
    : `pase.html?${new URLSearchParams({ r: p.id, t: p.token, c: p.code, n: p.name, s: p.service || "", d: p.date || "", h: p.time || "", m: p.more || 0 })}`;
  return { google: `${WALLET_URL}/google?${q}`, apple: `${WALLET_URL}/apple?${q}`, page };
}

export function memberStatus(m, today) {
  const plans = m.plans || [];
  const ok = plans.length
    ? plans.some((e) => e.endDate >= today && (e.visitsLeft == null || e.visitsLeft > 0))
    : !!m.endDate && m.endDate >= today;
  return { ok, label: ok ? "ACTIVO" : "INACTIVO" };
}

// p: { kind: "member"|"reservation", name, memberId?, code?, service?, date?, time?, status?, ok?, until?, key?, id?, token? }
export async function renderPass(el, p, s, m) {
  const qrValue = p.kind === "member" ? memberQR(p.memberId) : reservationQR(p.code);
  const links = passLinks(p);
  const wallet = [
    s.walletApple && (isApple || !s.walletGoogle) ? `<a class="wallet-btn apple" href="${links.apple}">${ICONS.wallet || ""}<span><small>Agregar a</small>Apple Wallet</span></a>` : "",
    s.walletGoogle ? `<a class="wallet-btn google" href="${links.google}" target="_blank" rel="noopener"><span><small>Agregar a</small>Google Wallet</span></a>` : "",
    s.walletApple && !isApple && s.walletGoogle ? `<a class="wallet-btn apple ghost" href="${links.apple}"><span><small>Agregar a</small>Apple Wallet</span></a>` : "",
  ].join("");
  el.innerHTML = `
    <div class="pass ${p.kind}">
      <div class="pass-top">
        <span class="pass-logo">${markHTML(m)}</span>
        <div><b>${esc(s.brandLine1 || "HUMAN PRIME")}</b><i>${esc(s.brandLine2 || "LAB")}</i></div>
        <span class="pass-kind">${p.kind === "member" ? "SOCIO" : "RESERVA"}</span>
      </div>
      <div class="pass-name"><span>${p.kind === "member" ? "Miembro" : "Nombre"}</span><b>${esc(p.name)}</b></div>
      <div class="pass-fields">
        ${p.kind === "member" ? `
          <div><span>Estado</span><b class="${p.ok ? "ok" : "bad"}">${p.ok ? "ACTIVO" : "INACTIVO"}</b></div>
          <div><span>Vigencia</span><b>${p.until ? fmtDate(p.until) : "—"}</b></div>
          <div><span>ID</span><b>${esc(p.memberId)}</b></div>` : `
          <div><span>Servicio</span><b>${esc(p.service || "")}</b></div>
          <div><span>Fecha</span><b>${p.date ? fmtDate(p.date) : ""}</b></div>
          <div><span>Hora</span><b>${esc(p.time || "")}</b></div>`}
      </div>
      ${p.more ? `<p class="pass-more">+ ${p.more} ${p.more === 1 ? "reserva más" : "reservas más"} con este mismo código</p>` : ""}
      <div class="pass-qr">${await qrSVG(qrValue)}<small>${esc(p.kind === "member" ? p.memberId : p.code)}</small></div>
      <p class="pass-note">Muestra este código en recepción para ${p.kind === "member" ? "registrar tu acceso" : "registrar tu llegada"}.</p>
    </div>
    <div class="pass-actions">
      <button type="button" class="btn btn-block btn-gold" data-pass-img><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg><span>Descargar foto del pase</span></button>
    </div>
    ${wallet ? `<div class="wallet-row">${wallet}</div>` : ""}`;
  el.querySelector("[data-pass-img]").onclick = (e) => savePassImage(p, s, qrValue, e.currentTarget);
  return links;
}

// ---------- Foto del pase (PNG para guardar en la galería) ----------
const svgImage = (svg) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
});

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export async function passImage(p, s, qrValue) {
  const W = 1080;
  const H = 1600;
  const gold = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#ad8a5c";
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  await document.fonts?.ready;
  // Fondo y tarjeta
  g.fillStyle = "#050505";
  g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, "#1f1a13");
  grad.addColorStop(0.55, "#0b0b0b");
  roundRect(g, 50, 50, W - 100, H - 100, 56);
  g.fillStyle = grad;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = gold;
  g.stroke();
  // Logo y marca
  const mark = await svgImage(logoMark().replace("<svg ", '<svg width="140" height="287" ').split("var(--logo-dark, #f2efe9)").join("#f2efe9").split("var(--gold, #ad8a5c)").join(gold));
  g.drawImage(mark, 110, 110, 70, 143);
  g.fillStyle = "#f2efe9";
  g.font = "800 44px Unbounded, Montserrat, Arial";
  g.fillText(s.brandLine1 || "HUMAN PRIME", 210, 175);
  g.fillStyle = gold;
  g.font = "300 26px Unbounded, Montserrat, Arial";
  g.fillText((s.brandLine2 || "LAB").split("").join("  "), 212, 222);
  // Etiqueta
  const tag = p.kind === "member" ? "SOCIO" : "RESERVA";
  g.font = "500 24px Unbounded, Montserrat, Arial";
  const tw = g.measureText(tag).width + 48;
  roundRect(g, W - 110 - tw, 140, tw, 56, 28);
  g.strokeStyle = gold;
  g.lineWidth = 2;
  g.stroke();
  g.fillStyle = gold;
  g.fillText(tag, W - 110 - tw + 24, 177);
  // Nombre y datos
  const label = (t, x, y) => { g.fillStyle = "#8f8a83"; g.font = "400 22px Unbounded, Montserrat, Arial"; g.fillText(t.toUpperCase(), x, y); };
  const value = (t, x, y, size = 34, color = "#f2efe9") => { g.fillStyle = color; g.font = `600 ${size}px Montserrat, Arial`; g.fillText(t, x, y); };
  label(p.kind === "member" ? "Miembro" : "Nombre", 110, 340);
  value(p.name, 110, 400, 58);
  const cols = p.kind === "member"
    ? [["Estado", p.ok ? "ACTIVO" : "INACTIVO", p.ok ? "#4caf6e" : "#d65a4f"], ["Vigencia", p.until ? fmtDate(p.until) : "—"], ["ID", p.memberId]]
    : [["Servicio", p.service || ""], ["Fecha", p.date ? fmtDate(p.date) : ""], ["Hora", p.time || ""]];
  // Cada dato se achica hasta caber en su columna (máx. 270 px)
  const fit = (t, max) => { let size = 32; g.font = `600 ${size}px Montserrat, Arial`; while (g.measureText(t).width > max && size > 18) { size -= 1; g.font = `600 ${size}px Montserrat, Arial`; } return size; };
  cols.forEach(([l, v, color], i) => { const x = 110 + i * 290; const t = String(v); label(l, x, 490); value(t, x, 540, fit(t, 270), color); });
  if (p.more) { g.fillStyle = gold; g.font = "500 26px Montserrat, Arial"; g.fillText(`+ ${p.more} ${p.more === 1 ? "reserva más" : "reservas más"} con este código`, 110, 600); }
  // QR
  const qr = await svgImage(await qrSVG(qrValue, { size: 600, margin: 2 }));
  roundRect(g, (W - 640) / 2, 660, 640, 720, 36);
  g.fillStyle = "#fff";
  g.fill();
  g.drawImage(qr, (W - 600) / 2, 680, 600, 600);
  g.fillStyle = "#111";
  g.font = "700 40px ui-monospace, Consolas, monospace";
  const code = p.kind === "member" ? p.memberId : p.code;
  g.fillText(code, (W - g.measureText(code).width) / 2, 1340);
  g.fillStyle = "#8f8a83";
  g.font = "400 28px Montserrat, Arial";
  const note = p.kind === "member" ? "Muestra este código en recepción para registrar tu acceso" : "Muestra este código en recepción al llegar";
  g.fillText(note, (W - g.measureText(note).width) / 2, 1450);
  return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

async function savePassImage(p, s, qrValue, btn) {
  btn.disabled = true;
  try {
    const blob = await passImage(p, s, qrValue);
    const name = `pase-human-prime-lab-${(p.kind === "member" ? p.memberId : p.code)}.png`;
    const file = new File([blob], name, { type: "image/png" });
    // En el celular se abre "Compartir" → Guardar imagen; en computadora se descarga
    if (navigator.canShare?.({ files: [file] }) && /android|iphone|ipad|ipod/i.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: "Mi pase · Human Prime Lab" }).catch(() => {});
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }
  } finally {
    btn.disabled = false;
  }
}
