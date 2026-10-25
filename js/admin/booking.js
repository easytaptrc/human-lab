// Reservas hechas por el admin: un día, toda la semana, el mes, varios horarios y varios servicios a la vez.
import {
  db, collection, doc, getDocs, query, where, runTransaction, setDoc, serverTimestamp, Timestamp, increment,
} from "../firebase.js";
import { esc, ICONS, DIAS, todayStr, addDays, dowOf, startAt, fmtDate, digits, randomToken, toast } from "../utils.js";
import { getAll } from "./data.js";
import { openModal } from "./ui.js";
import { newPassCode } from "../qr.js";

const WEEK = [1, 2, 3, 4, 5, 6, 0];
const MAX = 62;
const RANGES = [["Solo ese día", 0], ["1 semana", 6], ["2 semanas", 13], ["1 mes", 29]];
const newRule = (svc, date) => ({ id: Math.random().toString(36).slice(2, 8), serviceId: svc?.id || "", time: "", custom: "", days: [dowOf(date)], from: date, to: date });

// Horas configuradas de un servicio (todas las de la semana, ordenadas)
const serviceTimes = (svc) => [...new Set(Object.keys(svc?.slots || {}).map((k) => k.slice(2)))].sort();

export async function openBooking(ctx, { date = todayStr(), memberId = "", onDone } = {}) {
  const services = (await getAll("services", { force: true })).filter((x) => x.active !== false).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  const members = await getAll("members").catch(() => []);
  if (!services.length) { toast("Primero crea un servicio con horarios.", "warn"); return; }
  let rules = [newRule(services[0], date)];
  let preview = []; // { key, svc, date, time, cap, left, state: ok|full|off|past, include }
  let used = {};

  const modal = openModal({
    title: "Nueva reserva",
    wide: true,
    body: `
      <h4 class="form-sec">¿Para quién?</h4>
      <div class="form-grid">
        <label class="field span-2"><span>Socio</span><select class="input" name="memberId"><option value="">— Cliente nuevo (sin ID) —</option>${members.sort((a, b) => String(a.name).localeCompare(b.name)).map((mb) => `<option value="${esc(mb.memberId)}" ${mb.memberId === memberId ? "selected" : ""}>${esc(mb.name)} · ${esc(mb.memberId)}</option>`).join("")}</select></label>
        <label class="field span-2"><span>Nombre completo</span><input class="input" name="name"></label>
        <label class="field"><span>Teléfono</span><input class="input" name="phone" inputmode="tel"></label>
        <label class="field"><span>Correo</span><input class="input" name="email" type="email"></label>
        <label class="field"><span>Edad</span><input class="input" name="age" type="number"></label>
        <label class="field"><span>Número de emergencia</span><input class="input" name="emergency" inputmode="tel"></label>
        <label class="field span-2"><span>Observaciones</span><textarea class="input" name="notes" rows="2"></textarea></label>
      </div>
      <h4 class="form-sec">¿Qué y cuándo?</h4>
      <div id="rules"></div>
      <button type="button" class="add-slot add-block" id="addRule">+ Agregar otro servicio u horario</button>
      <h4 class="form-sec">Vista previa <span class="muted" id="pvCount"></span></h4>
      <div id="preview" class="bk-preview"></div>`,
    onMount(body) {
      const $b = (s) => body.querySelector(s);
      const fillMember = () => {
        const mb = members.find((x) => x.memberId === $b("[name=memberId]").value);
        for (const k of ["name", "phone", "email", "age", "emergency", "notes"]) {
          const inp = $b(`[name=${k}]`);
          inp.value = mb ? mb[k] ?? "" : "";
          inp.readOnly = !!mb && k !== "notes";
        }
      };
      $b("[name=memberId]").addEventListener("change", fillMember);
      if (memberId) fillMember();

      const drawRules = () => {
        $b("#rules").innerHTML = rules.map((r, i) => {
          const svc = services.find((x) => x.id === r.serviceId);
          const times = serviceTimes(svc);
          if (!r.time) r.time = times[0] || "__custom";
          const span = Math.round((new Date(r.to) - new Date(r.from)) / 86400000);
          return `
          <div class="bk-rule" data-i="${i}">
            <div class="bk-rule-top"><b>${rules.length > 1 ? `Horario ${i + 1}` : "Horario"}</b>${rules.length > 1 ? `<button type="button" class="icon-btn" data-rm title="Quitar">${ICONS.trash}</button>` : ""}</div>
            <div class="bk-grid">
              <label class="field"><span>Servicio</span><select class="input" data-f="serviceId">${services.map((x) => `<option value="${esc(x.id)}" ${x.id === r.serviceId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
              <label class="field"><span>Hora</span><select class="input" data-f="time">${times.map((t) => `<option value="${t}" ${t === r.time ? "selected" : ""}>${t}</option>`).join("")}<option value="__custom" ${r.time === "__custom" ? "selected" : ""}>Otra hora (personalizada)…</option></select></label>
              ${r.time === "__custom" ? `<label class="field"><span>Hora personalizada</span><input class="input" type="time" data-f="custom" value="${esc(r.custom)}" step="300"></label>` : ""}
              <label class="field"><span>Desde</span><input class="input" type="date" data-f="from" value="${r.from}"></label>
              <label class="field"><span>Hasta</span><input class="input" type="date" data-f="to" value="${r.to}" min="${r.from}"></label>
            </div>
            <div class="bk-quick">${RANGES.map(([l, d]) => `<button type="button" class="chip-btn ${span === d ? "on" : ""}" data-range="${d}">${l}</button>`).join("")}</div>
            <div class="bk-days"><span class="muted">Días:</span>
              <div class="dow-pick">${WEEK.map((d) => `<label><input type="checkbox" data-day="${d}" ${r.days.includes(d) ? "checked" : ""}><span>${DIAS[d][0]}</span></label>`).join("")}</div>
              <button type="button" class="link" data-days="15">L–V</button><button type="button" class="link" data-days="16">L–S</button><button type="button" class="link" data-days="all">Todos</button>
            </div>
          </div>`;
        }).join("");
      };

      // Genera las citas de todas las reglas y revisa lugares
      const buildPreview = async () => {
        const today = todayStr();
        const now = Date.now();
        const items = [];
        for (const r of rules) {
          const svc = services.find((x) => x.id === r.serviceId);
          const time = r.time === "__custom" ? r.custom : r.time;
          if (!svc || !/^\d{2}:\d{2}$/.test(time || "") || !r.from || !r.to || r.to < r.from) continue;
          for (let d = r.from; d <= r.to && items.length < MAX + 20; d = addDays(d, 1)) {
            if (!r.days.includes(dowOf(d))) continue;
            const cap = Number((svc.slots || {})[`${dowOf(d)}_${time}`]) || 0;
            const closed = (svc.closedDates || []).includes(d);
            items.push({ key: `${svc.id}|${d}|${time}`, svc, date: d, time, cap, closed, past: d < today || startAt(d, time).getTime() < now });
          }
        }
        // Lugares ocupados del rango completo
        const dates = items.map((x) => x.date).sort();
        used = {};
        if (dates.length) {
          const snap = await getDocs(query(collection(db, "slots"), where("date", ">=", dates[0]), where("date", "<=", dates.at(-1))));
          snap.forEach((s) => { const x = s.data(); used[`${x.serviceId}|${x.date}|${x.time}`] = x.count || 0; });
        }
        const prevInclude = Object.fromEntries(preview.map((p) => [p.key, p.include]));
        const seen = new Set();
        preview = items.filter((x) => !seen.has(x.key) && seen.add(x.key)).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map((x) => {
          const left = x.cap ? Math.max(0, x.cap - (used[x.key] || 0)) : null;
          const state = x.past ? "past" : x.closed ? "closed" : !x.cap ? "off" : left > 0 ? "ok" : "full";
          const include = state === "ok" || state === "off" ? (prevInclude[x.key] ?? state === "ok") : false;
          return { ...x, left, state, include };
        });
        drawPreview();
      };

      const LBL = { ok: (p) => `${p.left} ${p.left === 1 ? "lugar" : "lugares"}`, full: () => "Lleno", off: () => "Fuera de horario (sin cupo)", past: () => "Ya pasó", closed: () => "Día cerrado" };
      const drawPreview = () => {
        const sel = preview.filter((p) => p.include);
        $b("#pvCount").textContent = preview.length ? `· ${sel.length} de ${preview.length} seleccionadas` : "";
        $b("#preview").innerHTML = preview.length ? preview.map((p, i) => `
          <label class="bk-item st-${p.state}">
            <input type="checkbox" data-pi="${i}" ${p.include ? "checked" : ""} ${p.state === "full" || p.state === "past" || p.state === "closed" ? "disabled" : ""}>
            <span class="bk-when"><b>${DIAS[dowOf(p.date)].slice(0, 3)} ${fmtDate(p.date)}</b><small>${p.time}</small></span>
            <span class="bk-svc">${esc(p.svc.name)}</span>
            <span class="bk-st">${LBL[p.state](p)}</span>
          </label>`).join("") : `<p class="muted" style="margin:0">Elige servicio, hora y fechas para ver las citas.</p>`;
        const save = modal.el.closest(".modal-box").querySelector(".modal-foot .btn-gold");
        if (save) save.textContent = sel.length > 1 ? `Guardar ${sel.length} reservas` : "Guardar reserva";
        if (preview.length > MAX) $b("#preview").insertAdjacentHTML("beforeend", `<p class="hint">Se muestran muchas citas; máximo ${MAX} por vez.</p>`);
      };

      const box = $b("#rules");
      let timer = null;
      const refresh = (redraw = true) => { if (redraw) drawRules(); clearTimeout(timer); timer = setTimeout(buildPreview, 150); };
      box.addEventListener("change", (e) => {
        const el = e.target.closest(".bk-rule");
        if (!el) return;
        const r = rules[Number(el.dataset.i)];
        if (e.target.dataset.day !== undefined) {
          const d = Number(e.target.dataset.day);
          r.days = e.target.checked ? [...new Set([...r.days, d])] : r.days.filter((x) => x !== d);
          refresh(false);
          return;
        }
        const f = e.target.dataset.f;
        if (!f) return;
        r[f] = e.target.value;
        if (f === "serviceId") r.time = "";
        if (f === "from" && r.to < r.from) r.to = r.from;
        // Reserva de un solo día: el día de la semana sigue a la fecha elegida
        if ((f === "from" || f === "to") && r.from === r.to) r.days = [dowOf(r.from)];
        // Rango corto: que incluya el día de la fecha inicial
        if (f === "from" && !r.days.includes(dowOf(r.from)) && r.from !== r.to) r.days = [...new Set([...r.days, dowOf(r.from)])];
        refresh();
      });
      box.addEventListener("click", (e) => {
        const el = e.target.closest(".bk-rule");
        if (!el) return;
        const i = Number(el.dataset.i);
        const r = rules[i];
        if (e.target.closest("[data-rm]")) { rules.splice(i, 1); refresh(); return; }
        const rg = e.target.closest("[data-range]");
        if (rg) {
          r.to = addDays(r.from, Number(rg.dataset.range));
          // Al ampliar a semana o mes, propone todos los días que tiene ese horario
          if (Number(rg.dataset.range) > 0 && r.days.length <= 1) r.days = WEEK.filter((d) => !r.time || r.time === "__custom" || (services.find((x) => x.id === r.serviceId)?.slots || {})[`${d}_${r.time}`]);
          refresh();
          return;
        }
        const dd = e.target.closest("[data-days]");
        if (dd) { r.days = dd.dataset.days === "all" ? [...WEEK] : dd.dataset.days === "15" ? [1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6]; refresh(); }
      });
      $b("#addRule").onclick = () => { const last = rules.at(-1); rules.push({ ...newRule(services[0], last?.from || date), from: last?.from || date, to: last?.to || date, days: [...(last?.days || [dowOf(date)])] }); refresh(); };
      $b("#preview").addEventListener("change", (e) => {
        const i = e.target.dataset.pi;
        if (i === undefined) return;
        preview[Number(i)].include = e.target.checked;
        drawPreview();
      });
      drawRules();
      buildPreview();
    },
    actions: [
      { label: "Cancelar" },
      {
        label: "Guardar reserva",
        cls: "btn-gold",
        onClick: async (wrap) => {
          const val = (n) => wrap.querySelector(`[name=${n}]`).value.trim();
          const mb = members.find((x) => x.memberId === val("memberId"));
          const f = { name: val("name"), phone: digits(val("phone")), email: val("email").toLowerCase(), age: Number(val("age")) || 0, emergency: digits(val("emergency")), notes: val("notes") };
          if (!f.name || f.phone.length < 10) { toast("Escribe nombre y teléfono de 10 dígitos.", "error"); return false; }
          const sel = preview.filter((p) => p.include).slice(0, MAX);
          if (!sel.length) { toast("Selecciona al menos una cita en la vista previa.", "error"); return false; }
          const passCode = newPassCode();
          const ok = [];
          const failed = [];
          for (const p of sel) {
            try { await saveOne(ctx, p, f, mb, passCode); ok.push(p); } catch (ex) { console.error(ex); failed.push(p); }
          }
          if (!ok.length) { toast("No se pudo guardar: esos horarios ya están llenos.", "error"); return false; }
          toast(failed.length
            ? `${ok.length} reservas guardadas. No se pudieron: ${failed.map((x) => `${fmtDate(x.date)} ${x.time}`).join(", ")} (lleno).`
            : ok.length > 1 ? `${ok.length} reservas guardadas para ${f.name}.` : "Reserva registrada.");
          onDone?.();
        },
      },
    ],
  });
}

// Guarda una cita: con horario configurado descuenta cupo; fuera de horario se registra sin cupo.
async function saveOne(ctx, p, f, mb, passCode) {
  const dow = dowOf(p.date);
  const slotRef = doc(db, "slots", `${p.svc.id}__${p.date}__${p.time}`);
  const resRef = doc(collection(db, "reservations"));
  await runTransaction(db, async (tx) => {
    if (p.cap) {
      const slot = await tx.get(slotRef);
      const count = slot.exists() ? slot.data().count || 0 : 0;
      if (count >= p.cap) throw new Error("FULL");
      if (slot.exists()) tx.update(slotRef, { count: increment(1), cap: p.cap });
      else tx.set(slotRef, { serviceId: p.svc.id, date: p.date, time: p.time, dow, cap: p.cap, count: 1 });
    }
    tx.set(resRef, {
      serviceId: p.svc.id, serviceName: p.svc.name, date: p.date, time: p.time, dow,
      startAt: Timestamp.fromDate(startAt(p.date, p.time)),
      name: f.name, phone: f.phone, email: f.email, age: f.age, emergency: f.emergency, notes: f.notes,
      memberId: mb?.memberId || "", memberIdTyped: "",
      status: "confirmada", attendance: "pendiente", token: randomToken(), passCode, reminderSent: false,
      source: "recepcion", by: ctx.staff.name, customTime: !p.cap, createdAt: serverTimestamp(),
    });
  });
  if (mb?.portalKey) {
    await setDoc(doc(db, "portal", mb.portalKey, "reservas", resRef.id), { serviceName: p.svc.name, date: p.date, time: p.time, status: "confirmada", createdAt: serverTimestamp() }).catch(() => {});
  }
}
