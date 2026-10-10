// Planes de membresía y precios.
import { db, collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, fmtMoney, toast } from "../utils.js";
import { getAll, invalidate } from "./data.js";
import { openModal, confirmDialog, formData, loadingHTML } from "./ui.js";

export async function render(el) {
  el.innerHTML = `
    <div class="toolbar"><p class="muted" style="margin:0;flex:1">Al asignar un plan a un socio, la fecha de vencimiento se calcula automáticamente.</p>
      <button class="btn btn-gold btn-sm" id="add">${ICONS.plus}<span>Nuevo plan</span></button></div>
    <div class="panel"><div class="table-wrap" id="list">${loadingHTML}</div></div>`;

  const draw = async () => {
    const list = (await getAll("plans", { force: true })).sort((a, b) => (a.price || 0) - (b.price || 0));
    $("#list", el).innerHTML = list.length ? `
      <table class="t"><thead><tr><th>Plan</th><th>Duración</th><th>Precio</th><th>Estado</th><th></th></tr></thead><tbody>
      ${list.map((p) => `<tr data-id="${esc(p.id)}">
        <td><b>${esc(p.name)}</b>${p.description ? `<br><small class="muted">${esc(p.description)}</small>` : ""}</td>
        <td>${p.amount} ${p.unit === "dias" ? (p.amount == 1 ? "día" : "días") : (p.amount == 1 ? "mes" : "meses")}</td>
        <td>${fmtMoney(p.price)}</td>
        <td><span class="dot ${p.active !== false ? "" : "dot-muted"}">${p.active !== false ? "Activo" : "Inactivo"}</span></td>
        <td><div class="actions"><button class="icon-btn" data-act="edit">${ICONS.edit}</button><button class="icon-btn" data-act="del">${ICONS.trash}</button></div></td>
      </tr>`).join("")}</tbody></table>`
      : `<div class="empty">Crea tus planes: Mensual, Trimestral, Anual, Visita…</div>`;
  };

  $("#add", el).onclick = () => edit(null, draw);
  $("#list", el).addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]");
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!tr || !act) return;
    const p = (await getAll("plans")).find((x) => x.id === tr.dataset.id);
    if (act === "edit") edit(p, draw);
    if (act === "del" && (await confirmDialog(`¿Eliminar el plan “${p.name}”?`, { ok: "Eliminar", danger: true }))) {
      await deleteDoc(doc(db, "plans", p.id));
      invalidate("plans");
      draw();
    }
  });
  await draw();
}

function edit(p, onDone) {
  const v = p || { amount: 1, unit: "meses", active: true };
  openModal({
    title: p ? `Editar · ${p.name}` : "Nuevo plan",
    body: `<div class="form-grid">
      <label class="field span-2"><span>Nombre</span><input class="input" name="name" value="${esc(v.name || "")}" placeholder="Mensual"></label>
      <label class="field"><span>Duración</span><input class="input" type="number" name="amount" min="1" value="${esc(v.amount)}"></label>
      <label class="field"><span>Unidad</span><select class="input" name="unit"><option value="meses" ${v.unit !== "dias" ? "selected" : ""}>Meses</option><option value="dias" ${v.unit === "dias" ? "selected" : ""}>Días</option></select></label>
      <label class="field"><span>Precio</span><input class="input" type="number" name="price" value="${esc(v.price ?? "")}"></label>
      <label class="switch" style="align-self:end;min-height:46px"><input type="checkbox" name="active" ${v.active !== false ? "checked" : ""}> Activo</label>
      <label class="field span-2"><span>Descripción</span><input class="input" name="description" value="${esc(v.description || "")}"></label>
    </div>`,
    actions: [{ label: "Cancelar" }, {
      label: "Guardar", cls: "btn-gold",
      onClick: async (wrap) => {
        const f = formData(wrap);
        if (!f.name || !f.amount) { toast("Escribe nombre y duración.", "error"); return false; }
        const data = { ...f, price: f.price || 0, updatedAt: serverTimestamp() };
        if (p) await updateDoc(doc(db, "plans", p.id), data);
        else await addDoc(collection(db, "plans"), { ...data, createdAt: serverTimestamp() });
        invalidate("plans");
        toast("Plan guardado.");
        onDone();
      },
    }],
  });
}
