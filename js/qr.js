// Códigos QR para los pases de acceso (generar en la página y leer con la cámara en recepción).
const GEN = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
const READ = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";

const loaded = {};
function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("No se pudo cargar " + src));
    document.head.appendChild(s);
  });
  return loaded[src];
}

// Valor del QR: HPLM:<ID de socio> para socios · HPLR:<código> para reservas
export const memberQR = (memberId) => `HPLM:${memberId}`;
export const reservationQR = (code) => `HPLR:${code}`;
export function parseQR(text) {
  const t = String(text || "").trim().toUpperCase();
  if (t.startsWith("HPLM:")) return { kind: "member", value: t.slice(5) };
  if (t.startsWith("HPLR:")) return { kind: "reservation", value: t.slice(5) };
  if (/^R-[A-Z0-9]{6,}$/.test(t)) return { kind: "reservation", value: t };
  return t ? { kind: "member", value: t.replace(/\s+/g, "") } : null; // ID escrito a mano o lector USB
}

// Código aleatorio para la reserva de una persona nueva
export function newPassCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "R-" + [...bytes].map((b) => chars[b % chars.length]).join("");
}

// SVG del QR (blanco y negro para que cualquier lector lo lea)
export async function qrSVG(text, { size = 220, margin = 2 } = {}) {
  await loadScript(GEN);
  const qr = window.qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / (n + margin * 2);
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${(c + margin) * cell},${(r + margin) * cell}h${cell}v${cell}h-${cell}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

// Lector con la cámara: llama onCode(texto) cada vez que detecta un QR.
export async function startScanner(video, onCode) {
  await loadScript(READ);
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  video.srcObject = stream;
  video.setAttribute("playsinline", "");
  await video.play();
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let stop = false;
  let last = "";
  let lastAt = 0;
  const tick = () => {
    if (stop) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
      // Evita leer el mismo código muchas veces seguidas
      if (code?.data && (code.data !== last || Date.now() - lastAt > 4000)) {
        last = code.data;
        lastAt = Date.now();
        onCode(code.data);
      }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => { stop = true; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
