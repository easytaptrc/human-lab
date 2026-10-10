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
            if (svc) await updateDoc(doc(db, "services", svc.id), data);
            else await addDoc(collection(db, "services"), { ...data, slots: {}, createdAt: serverTimestamp() });
            invalidate("services");
            toast("Servicio guardado.");
            onDone();
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

function editSchedule(svc, onDone) {
  // Estructura de trabajo: { dow: [{time, cap}] }
  const days = Object.fromEntries(WEEK.map((d) => [d, []]));
  Object.entries(svc.slots || {}).forEach(([k, cap]) => { days[Number(k[0])]?.push({ time: k.slice(2), cap: Number(cap) }); });

  openModal({
    title: `Horarios y cupos · ${svc.name}`,
    wide: true,
    body: `
      <div class="gen">
        <label class="field"><span>Desde</span><input class="input" type="time" id="gFrom" value="07:00"></label>
        <label class="field"><span>Hasta</span><input class="input" type="time" id="gTo" value="20:00"></label>
        <label class="field"><span>Cada (min)</span><input class="input" type="number" id="gEvery" value="60" min="15" step="15"></label>
        <label class="field"><span>Lugares</span><input class="input" type="number" id="gCap" value="5" min="1"></label>
        <div class="field"><span>Días</span><div class="dow-pick">${WEEK.map((d) => `<label><input type="checkbox" value="${d}" ${d >= 1 && d <= 5 ? "checked" : ""}><span>${DIAS[d][0]}</span></label>`).join("")}</div></div>
        <button class="btn btn-sm" type="button" id="gen">Generar</button>
      </div>
      <p class="hint" style="margin:-4px 0 14px">“Generar” reemplaza los horarios de los días marcados. También puedes editar cada horario a mano.</p>
      <div class="week" id="week"></div>`,
    onMount(body) {
      const draw = () => {
        body.querySelector("#week").innerHTML = WEEK.map((d) => `
          <div class="day-col" data-dow="${d}">
            <h4>${DIAS[d]} <button class="link" type="button" data-copy="${d}" title="Copiar este día a los demás">Copiar a todos</button></h4>
            ${days[d].sort((a, b) => a.time.localeCompare(b.time)).map((s, i) => `
              <div class="slot-row" data-i="${i}">
                <input class="input" type="time" value="${s.time}" data-f="time">
                <input class="input" type="number" min="1" value="${s.cap}" data-f="cap" title="Lugares">
                <button type="button" data-rm title="Quitar">${ICONS.trash}</button>
              </div>`).join("")}
            <button class="add-slot" type="button" data-add>+ Horario</button>
          </div>`).join("");
      };
      draw();
      const week = body.querySelector("#week");
      week.addEventListener("input", (e) => {
        const row = e.target.closest(".slot-row");
        if (!row) return;
        const d = Number(row.closest(".day-col").dataset.dow);
        const item = days[d].sort((a, b) => a.time.localeCompare(b.time))[Number(row.dataset.i)];
        if (e.target.dataset.f === "time") item.time = e.target.value;
        else item.cap = Number(e.target.value);
      });
      week.addEventListener("change", (e) => { if (e.target.dataset.f === "time") draw(); });
      week.addEventListener("click", (e) => {
        const col = e.target.closest(".day-col");
        if (!col) return;
        const d = Number(col.dataset.dow);
        if (e.target.closest("[data-add]")) {
          const last = days[d].map((x) => x.time).sort().pop();
          let next = "07:00";
          if (last) { const [h, m] = last.split(":").map(Number); next = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }
          days[d].push({ time: next, cap: days[d][0]?.cap || 5 });
          draw();
        }
        if (e.target.closest("[data-rm]")) {
          const i = Number(e.target.closest(".slot-row").dataset.i);
          days[d].sort((a, b) => a.time.localeCompare(b.time)).splice(i, 1);
          draw();
        }
        if (e.target.closest("[data-copy]")) {
          WEEK.forEach((o) => { if (o !== d) days[o] = days[d].map((x) => ({ ...x })); });
          draw();
          toast(`Horarios de ${DIAS[d]} copiados a toda la semana.`);
        }
      });
      body.querySelector("#gen").onclick = () => {
        const from = body.querySelector("#gFrom").value;
        const to = body.querySelector("#gTo").value;
        const every = Math.max(15, Number(body.querySelector("#gEvery").value) || 60);
        const cap = Math.max(1, Number(body.querySelector("#gCap").value) || 1);
        const sel = [...body.querySelectorAll(".dow-pick input:checked")].map((i) => Number(i.value));
        if (!from || !to || !sel.length) { toast("Completa el horario y elige días.", "error"); return; }
        const [fh, fm] = from.split(":").map(Number);
        const [th, tm] = to.split(":").map(Number);
        const list = [];
        for (let t = fh * 60 + fm; t <= th * 60 + tm; t += every) list.push({ time: `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`, cap });
        sel.forEach((d) => { days[d] = list.map((x) => ({ ...x })); });
        draw();
      };
    },
    actions: [
      { label: "Cancelar" },
      {
        label: "Guardar horarios",
        cls: "btn-gold",
        onClick: async () => {
          const slots = {};
          for (const d of WEEK) for (const s of days[d]) if (s.time && s.cap > 0) slots[`${d}_${s.time}`] = Math.floor(s.cap);
          try {
            await updateDoc(doc(db, "services", svc.id), { slots, updatedAt: serverTimestamp() });
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
