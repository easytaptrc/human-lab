// Mensaje tipo "hoja" para las pantallas públicas (preguntas y confirmaciones).
// Cada acción puede tener onClick, que se ejecuta DENTRO del toque (necesario para pedir permisos del navegador).
import { esc, ICONS } from "./utils.js";

export function sheet({ icon = "bell", title, text, actions = [{ label: "Entendido", value: true }] }) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "sheet";
    wrap.innerHTML = `
      <div class="sheet-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-icon">${ICONS[icon] || ""}</div>
        <h2>${esc(title)}</h2>
        ${text ? `<p>${esc(text)}</p>` : ""}
        <div class="sheet-actions">${actions.map((a, i) => `<button class="btn ${a.cls || ""}" data-i="${i}">${esc(a.label)}</button>`).join("")}</div>
      </div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("open"));
    const close = (value) => {
      wrap.classList.remove("open");
      setTimeout(() => wrap.remove(), 250);
      resolve(value);
    };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) return close(undefined);
      const b = e.target.closest("[data-i]");
      if (!b) return;
      const a = actions[Number(b.dataset.i)];
      const result = a.onClick ? a.onClick() : a.value;
      close(result);
    });
  });
}
