// Isotipo de Human Prime Lab vectorizado a partir del logo original.
// Las piezas "oscuras" usan --logo-dark (blanco sobre fondo negro) y las doradas --gold.
const DARK = [
  "600,448 906,622 906,850 600,619",
  "1276,448 971,622 971,850 1276,619",
  "600,703 721,790 721,1414 603,1322",
  "1276,703 1156,790 1156,1414 1273,1322",
  "786,1073 906,1167 906,1673 783,1578",
];
const GOLD = [
  "860,277 1017,277 1017,488 938,548 860,488",
  "786,846 906,940 906,1082 786,987",
  "1091,846 971,940 971,1082 1091,987",
  "1091,1073 971,1167 971,1673 1094,1578",
];

export function logoMark({ mono = false, cls = "" } = {}) {
  const dark = mono ? "currentColor" : "var(--logo-dark, #f2efe9)";
  const gold = mono ? "currentColor" : "var(--gold, #ad8a5c)";
  return `<svg class="logo-mark ${cls}" viewBox="595 272 686 1406" role="img" aria-label="Human Prime Lab" xmlns="http://www.w3.org/2000/svg">
    ${DARK.map((p) => `<polygon points="${p}" fill="${dark}"/>`).join("")}
    ${GOLD.map((p) => `<polygon points="${p}" fill="${gold}"/>`).join("")}
  </svg>`;
}

// Favicon SVG con los colores de marca.
export function faviconDataUrl(gold = "#ad8a5c") {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="400 272 1076 1406"><rect x="400" y="272" width="1076" height="1406" rx="160" fill="#0a0a0a"/>${DARK.map((p) => `<polygon points="${p}" fill="#f2efe9"/>`).join("")}${GOLD.map((p) => `<polygon points="${p}" fill="${gold}"/>`).join("")}</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}
