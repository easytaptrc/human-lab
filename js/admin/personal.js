// Personal del gimnasio: alta de usuarios y casillas de lo que puede ver cada uno.
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, USE_EMULATORS, db, collection, doc, getDocs, setDoc, updateDoc, serverTimestamp } from "../firebase.js";
import { $, esc, ICONS, toast } from "../utils.js";
import { MODULES } from "./data.js";
import { openModal, formData, avatar, loadingHTML } from "./ui.js";

const ROLES = [
  ["Recepción", ["inicio", "acceso", "reservas", "socios", "notificaciones"]],
  ["Coach", ["inicio", "acceso", "reservas"]],
  ["Gerente", ["inicio", "acceso", "reservas", "socios", "servicios", "planes", "reportes", "mensajes", "notificaciones"]],
  ["Administrador", MODULES.map((m) => m.key)],
];

export async function render(el, ctx) {
  el.innerHTML = `
    <div class="toolbar"><p class="muted" style="margin:0;flex:1">Cada usuario solo verá las secciones que marques. El dueño siempre tiene acceso completo.</p>
      <button class="btn btn-gold btn-sm" id="add">${ICONS.plus}<span>Agregar personal</span></button></div>
    <div class="panel"><div class="table-wrap" id="list">${loadingHTML}</div></div>`;

  let staff = [];
  const draw = async () => {
    const snap = await getDocs(collection(db, "staff"));
    staff = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : String(a.name).localeCompare(b.name)));
    $("#list", el).innerHTML = `<table class="t"><thead><tr><th>Nombre</th><th>Puesto</th><th>Puede ver</th><th>Estado</th><th></th></tr></thead><tbody>
      ${staff.map((u) => `<tr data-uid="${esc(u.uid)}">
        <td><div class="who">${avatar(u.name)}<div>${esc(u.name)}<small>${esc(u.email)}</small></div></div></td>
        <td>${u.role === "owner" ? `<span class="badge badge-gold">Dueño</span>` : esc(u.position || "Personal")}</td>
        <td><div class="svc-meta">${u.role === "owner" ? `<span class="badge">Todo</span>` : MODULES.filter((m) => u.perms?.[m.key]).map((m) => `<span class="badge">${esc(m.label)}</span>`).join("") || `<span class="muted">Nada</span>`}</div></td>
        <td><span class="dot ${u.active !== false ? "" : "dot-bad"}">${u.active !== false ? "Activo" : "Desactivado"}</span></td>
        <td><div class="actions">${u.role === "owner" && ctx.staff.role !== "owner" ? "" : `<button class="icon-btn" data-act="edit" title="Editar">${ICONS.edit}</button>`}
          <button class="icon-btn" data-act="reset" title="Enviar correo para cambiar contraseña">${ICONS.mail}</button></div></td>
      </tr>`).join("")}</tbody></table>`;
  };

  $("#add", el).onclick = () => editStaff(ctx, null, draw);
  $("#list", el).addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-uid]");
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!tr || !act) return;
    const u = staff.find((x) => x.uid === tr.dataset.uid);
    if (act === "edit") editStaff(ctx, u, draw);
    if (act === "reset") {
      try { await sendPasswordResetEmail(ctx.auth, u.email); toast(`Correo enviado a ${u.email}.`); }
      catch { toast("No se pudo enviar el correo.", "error"); }
    }
  });
  await draw();
}

function permsHTML(perms = {}, disabled = false) {
  return `<div class="checks">${MODULES.map((m) => `<label class="check"><input type="checkbox" data-perm="${m.key}" ${perms[m.key] ? "checked" : ""} ${disabled ? "disabled" : ""}> ${ICONS[m.icon]} ${esc(m.label)}</label>`).join("")}</div>`;
}

function editStaff(ctx, u, onDone) {
  const isNew = !u;
  const isOwner = u?.role === "owner";
  const self = u?.uid === ctx.staff.uid;
  openModal({
    title: isNew ? "Agregar personal" : `Editar · ${u.name}`,
    wide: true,
    body: `
      <div class="form-grid">
        <label class="field"><span>Nombre</span><input class="input" name="name" value="${esc(u?.name || "")}"></label>
        <label class="field"><span>Puesto</span><input class="input" name="position" value="${esc(u?.position || "")}" placeholder="Recepción, Coach…" ${isOwner ? "readonly" : ""}></label>
        ${isNew ? `
          <label class="field"><span>Correo (usuario)</span><input class="input" name="email" type="email" autocomplete="off"></label>
          <label class="field"><span>Contraseña temporal</span><input class="input" name="password" type="text" autocomplete="new-password" placeholder="Mínimo 6 caracteres"></label>`
        : `<label class="field"><span>Correo</span><input class="input" value="${esc(u.email)}" readonly></label>`}
        ${!isOwner && !self ? `<label class="switch" style="align-self:end;min-height:46px"><input type="checkbox" name="active" ${u?.active !== false ? "checked" : ""}> Usuario activo</label>` : ""}
      </div>
      <h4 class="form-sec">¿Qué secciones puede ver?</h4>
      ${isOwner ? `<p class="hint" style="margin-top:0">El dueño tiene acceso a todo.</p>` : `
        <div class="btn-row" style="margin-bottom:12px">${ROLES.map(([n], i) => `<button type="button" class="btn btn-sm" data-role="${i}">${n}</button>`).join("")}</div>
        ${permsHTML(u?.perms)}
        ${self ? `<p class="hint">Cuidado: si te quitas “Personal y permisos” ya no podrás volver a esta sección.</p>` : ""}`}`,
    onMount(body) {
      body.addEventListener("click", (e) => {
        const b = e.target.closest("[data-role]");
        if (!b) return;
        const [name, keys] = ROLES[Number(b.dataset.role)];
        body.querySelectorAll("[data-perm]").forEach((c) => { c.checked = keys.includes(c.dataset.perm); });
        const pos = body.querySelector("[name=position]");
        if (!pos.value) pos.value = name;
      });
    },
    actions: [
      { label: "Cancelar" },
      {
        label: isNew ? "Crear usuario" : "Guardar",
        cls: "btn-gold",
        onClick: async (wrap) => {
          const f = formData(wrap.querySelector(".form-grid"));
          const perms = {};
          wrap.querySelectorAll("[data-perm]").forEach((c) => { perms[c.dataset.perm] = c.checked; });
          if (!f.name) { toast("Escribe el nombre.", "error"); return false; }
          try {
            if (isNew) {
              if (!f.email || (f.password || "").length < 6) { toast("Escribe correo y una contraseña de 6+ caracteres.", "error"); return false; }
              // App secundaria: crea la cuenta sin cerrar la sesión del administrador.
              const sec = initializeApp(firebaseConfig, `staff-${Date.now()}`);
              const secAuth = getAuth(sec);
              if (USE_EMULATORS) connectAuthEmulator(secAuth, "http://127.0.0.1:9099", { disableWarnings: true });
              try {
                const cred = await createUserWithEmailAndPassword(secAuth, f.email, f.password);
                await setDoc(doc(db, "staff", cred.user.uid), {
                  name: f.name, email: f.email.toLowerCase(), position: f.position || "Personal", role: "staff",
                  active: true, perms, createdAt: serverTimestamp(), createdBy: ctx.staff.name,
                });
                await signOut(secAuth);
              } finally {
                deleteApp(sec).catch(() => {});
              }
              toast(`Usuario creado. Comparte el correo y la contraseña temporal con ${f.name}.`);
            } else {
              const data = { name: f.name, updatedAt: serverTimestamp() };
              if (!isOwner) { data.position = f.position; data.perms = perms; if (!self) data.active = f.active; }
              await updateDoc(doc(db, "staff", u.uid), data);
              toast("Cambios guardados.");
            }
            onDone();
          } catch (ex) {
            console.error(ex);
            toast(ex.code === "auth/email-already-in-use" ? "Ese correo ya tiene una cuenta." : ex.code === "auth/invalid-email" ? "Correo no válido." : "No se pudo guardar.", "error");
            return false;
          }
        },
      },
    ],
  });
}
