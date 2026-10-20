// Tarjeta de pase de acceso (estilo Wallet) con QR y botones para Apple Wallet / Google Wallet.
import { WALLET_URL } from "./firebase.js";
import { esc, ICONS, fmtDate } from "./utils.js";
import { markHTML } from "./site.js";
import { qrSVG, memberQR, reservationQR } from "./qr.js";

const isApple = /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent);

// Enlaces del servicio de Wallet y de la página del pase
export function passLinks(p) {
  const q = p.kind === "member" ? `k=${encodeURIComponent(p.key)}` : `r=${encodeURIComponent(p.id)}&t=${encodeURIComponent(p.token)}`;
  const page = p.kind === "member"
    ? `pase.html?k=${encodeURIComponent(p.key)}`
    : `pase.html?${new URLSearchParams({ r: p.id, t: p.token, c: p.code, n: p.name, s: p.service || "", d: p.date || "", h: p.time || "" })}`;
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
      <div class="pass-qr">${await qrSVG(qrValue)}<small>${esc(p.kind === "member" ? p.memberId : p.code)}</small></div>
      <p class="pass-note">Muestra este código en recepción para ${p.kind === "member" ? "registrar tu acceso" : "registrar tu llegada"}.</p>
    </div>
    ${wallet ? `<div class="wallet-row">${wallet}</div>` : ""}`;
  return links;
}
