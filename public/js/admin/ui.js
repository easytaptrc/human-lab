// Componentes de interfaz del panel: modales, confirmaciones, tablas.
import { $, esc, ICONS } from "../utils.js";

export function openModal({ title, body = "", wide = false, actions = [], onMount } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "modal";
  wrap.innerHTML = `
    <div class="modal-box ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Cerrar">${ICONS.close}</button></header>
      <div class="modal-body">${body}</div>
      ${actions.length ? `<footer class="modal-foot">${actions.map((a, i) => `<button class="btn btn-sm ${a.cls || ""}" data-act="${i}" type="button">${a.label}</button>`).join("")}</footer>` : ""}
    </div>`;
  document.body.appendChild(wrap);
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => wrap.classList.add("open"));
  const close = () => {
    wrap.classList.remove("open");
    setTimeout(() => {
      wrap.remove();
      if (!document.querySelector(".modal")) document.body.classList.remove("modal-open");
    }, 200);
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  wrap.addEventListener("mousedown", (e) => { if (e.target === wrap) close(); });
  wrap.addEventListener("click", async (e) => {
    if (e.target.closest("[data-close]")) return close();
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = actions[Number(b.dataset.act)];
    if (!a?.onClick) return close();
    b.disabled = true;
    try {
      const keep = await a.onClick(wrap, close);
      if (keep !== false) close();
    } finally {
      b.disabled = false;
    }
  });
  const body$ = $(".modal-body", wrap);
  onMount?.(body$, close);
  return { el: body$, close };
}

export function confirmDialog(message, { ok = "Confirmar", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const m = openModal({
      title: "Confirmar",
      body: `<p class="confirm-text">${esc(message)}</p>`,
      actions: [
        { label: "Cancelar", onClick: () => { done = true; resolve(false); } },
        { label: ok, cls: danger ? "btn-danger" : "btn-gold", onClick: () => { done = true; resolve(true); } },
      ],
    });
    const obs = new MutationObserver(() => {
      if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); }
    });
    obs.observe(document.body, { childList: true });
  });
}

export function formData(root) {
  const out = {};
  root.querySelectorAll("[name]").forEach((el) => {
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "number") out[el.name] = el.value === "" ? null : Number(el.value);
    else out[el.name] = el.value.trim();
  });
  return out;
}

export function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

export function avatar(name) {
  return `<span class="av">${esc(initials(name))}</span>`;
}

export function downloadCSV(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const loadingHTML = `<div class="empty"><div class="spinner" style="margin:auto"></div></div>`;
