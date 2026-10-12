// Servicios / secciones del gimnasio con horarios y cupos independientes.
import { db, collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, DIAS, fmtMoney, fmtDate, toast, compressImage } from "../utils.js";
import { getAll, invalidate } from "./data.js";
import { openModal, confirmDialog, formData, loadingHTML } from "./ui.js";

const WEEK = [1, 2, 3, 4, 5, 6, 0]; // lunes → domingo

export async function render(el) {
  el.innerHTML = `
    <div class="toolbar"><p class="muted" style="margin:0;flex:1">Cada servicio tiene sus propios horarios y cupos; las reservas no se mezclan entre secciones.</p>
      <button class="btn btn-gold btn-sm" id="add">${ICONS.plus}<span>Nuevo servicio</span></button></div>
    <div class="svc-grid" id="grid">${loadingHTML}</div>`;

  const draw = async () => {
    const list = (await getAll("services", { force: true })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    $("#grid", el).innerHTML = list.length ? list.map((x) => {
      const slots = Object.entries(x.slots || {});
      const days = new Set(slots.map(([k]) => Number(k[0])));
      const seats = slots.reduce((a, [, c]) => a + Number(c || 0), 0);
      return `<article class="svc" data-id="${esc(x.id)}">
        <div class="svc-img">${x.image ? `<img src="${esc(x.image)}" alt="">` : ICONS.dumbbell}</div>
        <div class="svc-body">
          <h3>${esc(x.name)} <label class="switch" title="Visible para reservar"><input type="checkbox" data-act="toggle" ${x.active !== false ? "checked" : ""}></label></h3>
          ${x.description ? `<p>${esc(x.description)}</p>` : ""}
          <div class="svc-meta">
            <span class="badge">${x.durationMin || 60} min</span>
            ${x.price ? `<span class="badge badge-gold">${fmtMoney(x.price)}</span>` : ""}
            <span class="badge">${slots.length} horarios · ${days.size} días</span>
            <span class="badge">${seats} lugares/semana</span>
          </div>
        </div>
        <div class="svc-foot">
          <button class="btn btn-sm btn-gold" data-act="sched">${ICONS.clock}<span>Horarios y cupos</span></button>
          <button class="btn btn-sm" data-act="edit">${ICONS.edit}<span>Editar</span></button>
          <button class="icon-btn" data-act="del" title="Eliminar">${ICONS.trash}</button>
        </div>
      </article>`;
    }).join("") : `<div class="empty card" style="grid-column:1/-1">Agrega tu primer servicio (por ejemplo: Entrenamiento personalizado, Evaluación física, Recuperación y movilidad…).</div>`;
  };

  $("#add", el).onclick = () => editService(null, draw);
  $("#grid", el).addEventListener("click", async (e) => {
    const card = e.target.closest(".svc");
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!card || !act) return;
    const svc = (await getAll("services")).find((x) => x.id === card.dataset.id);
    if (act === "toggle") {
      await updateDoc(doc(db, "services", svc.id), { active: e.target.checked });
      invalidate("services");
      toast(e.target.checked ? "Servicio visible para reservar." : "Servicio oculto.");
    }
    if (act === "edit") editService(svc, draw);
    if (act === "sched") editSchedule(svc, draw);
    if (act === "del") {
      if (!(await confirmDialog(`¿Eliminar “${svc.name}”? Las reservas existentes se conservan.`, { ok: "Eliminar", danger: true }))) return;
      await deleteDoc(doc(db, "services", svc.id));
      invalidate("services");
      toast("Servicio eliminado.");
      draw();
    }
  });
  await draw();
}

function editService(svc, onDone) {
  const v = svc || { active: true, durationMin: 60, order: 1, closedDates: [] };
  let image = v.image || "";
  let closed = [...(v.closedDates || [])];
  openModal({
    title: svc ? `Editar · ${svc.name}` : "Nuevo servicio",
    wide: true,
    body: `
      <div class="form-grid">
        <label class="field span-2"><span>Nombre</span><input class="input" name="name" value="${esc(v.name || "")}"></label>
        <label class="field span-2"><span>Descripción</span><textarea class="input" name="description">${esc(v.description || "")}</textarea></label>
        <label class="field"><span>Duración (min)</span><input class="input" type="number" name="durationMin" value="${esc(v.durationMin ?? 60)}"></label>
        <label class="field"><span>Precio (opcional)</span><input class="input" type="number" name="price" value="${esc(v.price ?? "")}"></label>
        <label class="field"><span>Orden</span><input class="input" type="number" name="order" value="${esc(v.order ?? 1)}"></label>
        <label class="switch" style="align-self:end;min-height:46px"><input type="checkbox" name="active" ${v.active !== false ? "checked" : ""}> Visible para reservar</label>
      </div>
      <h4 class="form-sec">Imagen</h4>
      <div class="img-up">
        <div class="img-prev wide cover" id="prev">${image ? `<img src="${esc(image)}">` : ICONS.image}</div>
        <div class="img-actions">
          <label class="btn btn-sm">${ICONS.image}<span>Subir imagen</span><input type="file" accept="image/*" id="file"></label>
          <button class="btn btn-sm btn-ghost" type="button" id="rmImg">Quitar</button>
        </div>
      </div>
      <h4 class="form-sec">Días cerrados (festivos, mantenimiento)</h4>
      <div class="toolbar"><input class="input" type="date" id="cdate"><button class="btn btn-sm" type="button" id="cadd">${ICONS.plus}<span>Agregar</span></button></div>
      <div class="svc-meta" id="clist" style="margin-top:10px"></div>`,
    onMount(body) {
      const drawClosed = () => {
        body.querySelector("#clist").innerHTML = closed.sort().map((d) => `<button type="button" class="badge" data-d="${d}">${fmtDate(d)} ✕</button>`).join("") || `<span class="muted">Ninguno</span>`;
      };
      drawClosed();
      body.querySelector("#cadd").onclick = () => {
        const d = body.querySelector("#cdate").value;
        if (d && !closed.includes(d)) { closed.push(d); drawClosed(); }
      };
      body.querySelector("#clist").onclick = (e) => {
        const b = e.target.closest("[data-d]");
        if (b) { closed = closed.filter((x) => x !== b.dataset.d); drawClosed(); }
      };
      body.querySelector("#file").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        image = await compressImage(file, { max: 720, quality: 0.78 });
        body.querySelector("#prev").innerHTML = `<img src="${image}">`;
      };
      body.querySelector("#rmImg").onclick = () => { image = ""; body.querySelector("#prev").innerHTML = ICONS.image; };
    },
    actions: [
      { label: "Cancelar" },
      {
        label: "Guardar",
        cls: "btn-gold",
        onClick: async (wrap) => {
          const f = formData(wrap.querySelector(".form-grid"));
          if (!f.name) { toast("Escribe el nombre del servicio.", "error"); return false; }
          const data = { name: f.name, description: f.description, durationMin: f.durationMin || 60, price: f.price || 0, order: f.order ?? 1, active: f.active, image, closedDates: closed, updatedAt: serverTimestamp() };
          try {
            invalidate("services");
            if (svc) {
              await updateDoc(doc(db, "services", svc.id), data);
              toast("Servicio guardado.");
              onDone();
            } else {
              const ref = await addDoc(collection(db, "services"), { ...data, slots: {}, schedule: [], createdAt: serverTimestamp() });
              toast("Servicio creado. Ahora define sus horarios y cupos.");
              onDone();
              // Siguiente paso natural: horarios del servicio nuevo
              setTimeout(() => editSchedule({ id: ref.id, ...data, slots: {}, schedule: [] }, onDone), 250);
            }
          } catch (ex) {
            console.error(ex);
            toast("No se pudo guardar el servicio.", "error");
            return false;
          }
        },
      },
    ],
  });
}

// ---------- Horarios y cupos (por bloques) ----------
// Un bloque = días + primer horario + último horario + cada cuántos minutos + lugares.
// Se guarda `schedule` (bloques, para editar) y `slots` (cada horario con su cupo, lo que usan las reservas).
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const toTime = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const DAY_SETS = [["Lun–Vie", [1, 2, 3, 4, 5]], ["Lun–Sáb", [1, 2, 3, 4, 5, 6]], ["Toda la semana", [1, 2, 3, 4, 5, 6, 0]], ["Sáb", [6]], ["Dom", [0]]];

function blockTimes(b) {
  const out = [];
  if (!b.from || !b.to || !(b.every > 0)) return out;
  for (let t = toMin(b.from); t <= toMin(b.to) && out.length < 96; t += Number(b.every)) out.push(toTime(t));
  return out;
}

export function blocksToSlots(blocks) {
  const slots = {};
  for (const b of blocks) {
    const cap = Math.max(1, Math.floor(Number(b.cap) || 1));
    for (const d of b.days || []) for (const t of blockTimes(b)) slots[`${d}_${t}`] = cap;
  }
  return slots;
}

// Convierte horarios guardados con el editor anterior en bloques.
function slotsToBlocks(slots = {}) {
  const perDay = {};
  for (const [k, cap] of Object.entries(slots)) (perDay[k[0]] ||= []).push({ t: k.slice(2), cap: Number(cap) });
  const blocks = [];
  for (const [d, list] of Object.entries(perDay)) {
    list.sort((a, b) => a.t.localeCompare(b.t));
    const gaps = list.slice(1).map((x, i) => toMin(x.t) - toMin(list[i].t));
    const even = list.length === 1 || gaps.every((g) => g === gaps[0]);
    const sameCap = list.every((x) => x.cap === list[0].cap);
    const parts = even && sameCap
      ? [{ from: list[0].t, to: list.at(-1).t, every: gaps[0] || 60, cap: list[0].cap }]
      : list.map((x) => ({ from: x.t, to: x.t, every: 60, cap: x.cap }));
    for (const p of parts) {
      const same = blocks.find((b) => b.from === p.from && b.to === p.to && b.every === p.every && b.cap === p.cap);
      if (same) same.days.push(Number(d)); else blocks.push({ ...p, days: [Number(d)] });
    }
  }
  return blocks;
}

function editSchedule(svc, onDone) {
  let blocks = svc.schedule?.length ? structuredClone(svc.schedule) : slotsToBlocks(svc.slots);
  if (!blocks.length) blocks = [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "20:00", every: Number(svc.durationMin) || 60, cap: 5 }];

  openModal({
    title: `Horarios y cupos · ${svc.name}`,
    wide: true,
    body: `
      <p class="hint" style="margin:0 0 14px">Define bloques de horario. Ejemplo: <b>Lun–Vie</b>, primer horario <b>06:00</b>, último <b>21:00</b>, cada <b>60 min</b>, <b>5 lugares</b> por horario.</p>
      <div class="blocks" id="blocks"></div>
      <button type="button" class="add-slot add-block" id="addBlock">+ Agregar otro bloque (por ejemplo, sábados)</button>
      <h4 class="form-sec">Así quedará la semana</h4>
      <div class="week-sum" id="weekSum"></div>`,
    onMount(body) {
      const draw = () => {
        body.querySelector("#blocks").innerHTML = blocks.map((b, i) => {
          const n = blockTimes(b).length;
          return `
          <div class="block" data-i="${i}">
            <div class="block-top">
              <div class="dow-pick">${WEEK.map((d) => `<label><input type="checkbox" data-day="${d}" ${b.days.includes(d) ? "checked" : ""}><span>${DIAS[d][0]}</span></label>`).join("")}</div>
              <button type="button" class="icon-btn" data-rm title="Quitar bloque">${ICONS.trash}</button>
            </div>
            <div class="block-sets">${DAY_SETS.map(([l], j) => `<button type="button" class="link" data-set="${j}">${l}</button>`).join("")}</div>
            <div class="block-grid">
              <label class="field"><span>Primer horario</span><input class="input" type="time" data-f="from" value="${b.from}"></label>
              <label class="field"><span>Último horario</span><input class="input" type="time" data-f="to" value="${b.to}"></label>
              <label class="field"><span>Cada</span><select class="input" data-f="every">${[15, 20, 30, 45, 60, 75, 90, 120].map((v) => `<option value="${v}" ${Number(b.every) === v ? "selected" : ""}>${v} min</option>`).join("")}</select></label>
              <label class="field"><span>Lugares</span><input class="input" type="number" min="1" data-f="cap" value="${b.cap}"></label>
            </div>
            <p class="block-info">${n ? `${n} horarios por día${b.days.length ? ` · ${n * b.cap * b.days.length} lugares por semana` : ""}` : "Revisa las horas: el último horario debe ser igual o después del primero."}${b.days.length ? "" : " · <b>Elige al menos un día.</b>"}</p>
          </div>`;
        }).join("");
        const slots = blocksToSlots(blocks);
        body.querySelector("#weekSum").innerHTML = WEEK.map((d) => {
          const times = Object.keys(slots).filter((k) => Number(k[0]) === d).map((k) => k.slice(2)).sort();
          return `<div class="ws-row"><b>${DIAS[d]}</b><span>${times.length ? `${times[0]} a ${times.at(-1)} · ${times.length} horarios` : `<span class="muted">Cerrado</span>`}</span></div>`;
        }).join("");
      };
      draw();
      const box = body.querySelector("#blocks");
      box.addEventListener("change", (e) => {
        const el = e.target.closest(".block");
        if (!el) return;
        const b = blocks[Number(el.dataset.i)];
        if (e.target.dataset.day !== undefined) {
          const d = Number(e.target.dataset.day);
          b.days = e.target.checked ? [...new Set([...b.days, d])] : b.days.filter((x) => x !== d);
        } else if (e.target.dataset.f) {
          const f = e.target.dataset.f;
          b[f] = f === "every" || f === "cap" ? Number(e.target.value) : e.target.value;
        }
        draw();
      });
      box.addEventListener("click", (e) => {
        const el = e.target.closest(".block");
        if (!el) return;
        const i = Number(el.dataset.i);
        if (e.target.closest("[data-rm]")) { blocks.splice(i, 1); draw(); }
        const set = e.target.closest("[data-set]");
        if (set) { blocks[i].days = [...DAY_SETS[Number(set.dataset.set)][1]]; draw(); }
      });
      body.querySelector("#addBlock").onclick = () => {
        blocks.push({ days: [6], from: "08:00", to: "13:00", every: Number(svc.durationMin) || 60, cap: blocks.at(-1)?.cap || 5 });
        draw();
      };
    },
    actions: [
      { label: "Cancelar" },
      {
        label: "Guardar horarios",
        cls: "btn-gold",
        onClick: async () => {
          const clean = blocks.filter((b) => b.days.length && blockTimes(b).length).map((b) => ({ days: [...b.days].sort(), from: b.from, to: b.to, every: Number(b.every), cap: Math.max(1, Math.floor(Number(b.cap) || 1)) }));
          try {
            await updateDoc(doc(db, "services", svc.id), { schedule: clean, slots: blocksToSlots(clean), updatedAt: serverTimestamp() });
            invalidate("services");
            toast("Horarios y cupos guardados.");
            onDone();
          } catch (ex) {
            console.error(ex);
            toast("No se pudieron guardar los horarios.", "error");
            return false;
          }
        },
      },
    ],
  });
}
