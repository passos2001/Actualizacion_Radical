/**
 * Migra filas exportadas desde el app antiguo (colección `clientes` / Excel)
 * al esquema actual: `usuarios` + un documento en `pagos` por fila.
 *
 * Columnas reconocidas (mayúsculas / espacios / sin acentos, flexibles):
 * - nombre (nombre completo; se parte en nombre + apellido)
 * - telefono
 * - fechaIngreso / fecha ingreso / fecha_inicio …
 * - fechaVencimiento / fecha vencimiento / fecha_fin …
 * - tipoPlan (número del app viejo: select fijo 1–5 Semanal…Trimestral; se empareja con `planes` por duración)
 * - metodoPago (número → texto; app viejo típico 1 Efectivo, 2 Transferencia)
 * - valorPago / monto
 */

import {
  collection,
  doc,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

function getXLSX() {
  return typeof window !== "undefined" ? window.XLSX : null;
}

function normalizeHeaderKey(k) {
  return String(k ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildRowGetter(row) {
  const map = {};
  Object.keys(row).forEach((k) => {
    map[normalizeHeaderKey(k)] = row[k];
  });
  return (aliases) => {
    for (const a of aliases) {
      const v = map[normalizeHeaderKey(a)];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return "";
  };
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}

function parseFlexibleDate(val) {
  if (val === undefined || val === null || val === "") return null;
  if (val instanceof Date && !Number.isNaN(val.getTime())) return startOfDay(val);
  if (typeof val === "number" && val > 20000) {
    const utc = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!Number.isNaN(utc.getTime())) return startOfDay(utc);
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(s)) {
    const [y, m, day] = s.split(/[-T]/).map((n) => parseInt(n, 10));
    return startOfDay(new Date(y, m - 1, day));
  }
  const parts = s.split(/[\/\-.]/).map((n) => parseInt(n, 10));
  if (parts.length >= 3 && parts.every((n) => !Number.isNaN(n))) {
    const [a, b, c] = parts;
    if (a > 31) return startOfDay(new Date(a, b - 1, c));
    return startOfDay(new Date(c, b - 1, a));
  }
  const tryDate = new Date(s);
  return Number.isNaN(tryDate.getTime()) ? null : startOfDay(tryDate);
}

function splitNombreCompleto(full) {
  const s = String(full || "").trim().replace(/\s+/g, " ");
  if (!s) return { nombre: "", apellido: "" };
  const bits = s.split(" ");
  if (bits.length === 1) return { nombre: bits[0], apellido: "" };
  return { nombre: bits[0], apellido: bits.slice(1).join(" ") };
}

/** Valores del select `#metodoPago` del app antiguo (solo Efectivo / Transferencia en el formulario que mostraste). */
const METODO_NUM_A_TEXTO = {
  1: "Efectivo",
  2: "Transferencia",
  3: "Tarjeta",
};

function metodoPagoDesdeNumero(n) {
  const key = Number(n);
  if (Number.isFinite(key) && METODO_NUM_A_TEXTO[key] !== undefined) {
    return METODO_NUM_A_TEXTO[key];
  }
  const t = String(n ?? "").trim();
  if (!t) return "Efectivo";
  if (/efectivo/i.test(t)) return "Efectivo";
  if (/transfer/i.test(t)) return "Transferencia";
  if (/tarjeta/i.test(t)) return "Tarjeta";
  return t;
}

function inferirPlanPorFechas(fechaInicio, fechaFin, planesActivos) {
  if (!planesActivos.length || !fechaInicio || !fechaFin) return null;
  const a = startOfDay(fechaInicio);
  const b = startOfDay(fechaFin);
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  const candidatos = Array.from(new Set([diff, diff + 1, diff - 1])).filter((x) => x > 0);
  let mejor = planesActivos[0];
  let score = Infinity;
  for (const p of planesActivos) {
    const d = Number(p.duracionDias) || 30;
    const local = Math.min(...candidatos.map((c) => Math.abs(c - d)));
    if (local < score) {
      score = local;
      mejor = p;
    }
  }
  return mejor;
}

/**
 * Select `#plan` del app antiguo (valores en código, no en Firebase):
 * 1 Semanal, 2 Quincenal, 3 Mensual, 4 Bimestral, 5 Trimestral.
 * Se elige el documento de `planes` cuya `duracionDias` esté más cerca de esos días objetivo.
 */
const LEGACY_TIPO_PLAN_DIAS_OBJETIVO = {
  1: 7,
  2: 15,
  3: 30,
  4: 60,
  5: 90,
};

function planMasCercanoPorDuracionObjetivo(diasObjetivo, planesActivos) {
  if (!planesActivos.length) return null;
  let mejor = planesActivos[0];
  let errMin = Infinity;
  for (const p of planesActivos) {
    const d = Number(p.duracionDias) || 0;
    const e = Math.abs(d - diasObjetivo);
    if (e < errMin) {
      errMin = e;
      mejor = p;
    }
  }
  return mejor;
}

function planPorTipoLegadoRadical(tipoPlanRaw, planesActivos) {
  const n = Math.floor(Number(tipoPlanRaw));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  const dias = LEGACY_TIPO_PLAN_DIAS_OBJETIVO[n];
  return planMasCercanoPorDuracionObjetivo(dias, planesActivos);
}

function errorDuracionVsFechas(plan, fechaInicio, fechaFin) {
  if (!plan || !fechaInicio || !fechaFin) return Infinity;
  const a = startOfDay(fechaInicio);
  const b = startOfDay(fechaFin);
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000);
  const d = Number(plan.duracionDias) || 30;
  return Math.min(
    Math.abs(diff - d),
    Math.abs(diff + 1 - d),
    Math.abs(diff - 1 - d)
  );
}

function elegirPlan(get, fechaInicio, fechaFin, planesActivos) {
  if (!planesActivos.length) return null;
  const porFechas = inferirPlanPorFechas(fechaInicio, fechaFin, planesActivos);
  const tipoRaw = get(["tipoplan", "tipo_plan", "tipo", "plan"]);
  const porLegado = planPorTipoLegadoRadical(tipoRaw, planesActivos);

  if (porLegado && porFechas) {
    if (porLegado.id === porFechas.id) return porLegado;
    const errLeg = errorDuracionVsFechas(porLegado, fechaInicio, fechaFin);
    const errFe = errorDuracionVsFechas(porFechas, fechaInicio, fechaFin);
    if (errFe + 2 < errLeg) return porFechas;
    return porLegado;
  }
  return porLegado || porFechas || planesActivos[0];
}

function leerWorkbookDesdeFile(file) {
  const XLSX = getXLSX();
  if (!XLSX) throw new Error("No se cargó SheetJS (XLSX). Recarga la página.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        resolve(wb);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsArrayBuffer(file);
  });
}

async function listarHojasXlsx(file) {
  const wb = await leerWorkbookDesdeFile(file);
  return wb.SheetNames || [];
}

function filasDesdeHoja(wb, sheetName) {
  const XLSX = getXLSX();
  const name =
    sheetName && wb.Sheets[sheetName] ? sheetName : wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

async function leerFilasDesdeXlsx(file, sheetName) {
  const wb = await leerWorkbookDesdeFile(file);
  return filasDesdeHoja(wb, sheetName);
}

export function inicializarMigracionRadical(db, getPlanes, getUsuarios, reiniciarApp) {
  const input = document.getElementById("archivoMigracionXlsx");
  const btn = document.getElementById("btnMigrarRadical");
  const out = document.getElementById("resultadoMigracionRadical");
  const chk = document.getElementById("migrarOmitirDuplicadosTelefono");
  const sheetSel = document.getElementById("migrarExcelSheet");
  const sheetWrap = document.getElementById("migrarExcelSheetWrap");

  if (!input || !btn || !out) return;

  let archivo = null;
  input.addEventListener("change", async (e) => {
    archivo = e.target.files[0] || null;
    btn.disabled = !archivo;
    out.textContent = "";
    if (!archivo || !sheetSel) return;
    try {
      const names = await listarHojasXlsx(archivo);
      sheetSel.innerHTML = "";
      names.forEach((n) => {
        const o = document.createElement("option");
        o.value = n;
        o.textContent = n;
        sheetSel.appendChild(o);
      });
      if (sheetWrap) sheetWrap.hidden = names.length <= 1;
    } catch {
      if (sheetWrap) sheetWrap.hidden = true;
    }
  });

  btn.addEventListener("click", async () => {
    if (!archivo) return;
    btn.disabled = true;
    out.textContent = "Leyendo Excel y migrando…";
    let ok = 0;
    let omitidos = 0;
    let errores = 0;
    try {
      const planes = (getPlanes() || []).filter((p) => p.activo !== false);
      if (!planes.length) {
        out.textContent = "No hay planes en Firestore. Crea primero la colección `planes`.";
        return;
      }
      const existentes = new Set(
        (getUsuarios() || [])
          .map((u) => String(u.telefono || "").replace(/\D/g, ""))
          .filter(Boolean)
      );
      const omitirDup = chk?.checked;
      const hoja = sheetSel?.value || "";
      const rows = await leerFilasDesdeXlsx(archivo, hoja);
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);

      const buffer = [];
      const flush = async () => {
        if (!buffer.length) return;
        const batch = writeBatch(db);
        buffer.forEach(({ refU, dataU, refP, dataP }) => {
          batch.set(refU, dataU);
          batch.set(refP, dataP);
        });
        await batch.commit();
        buffer.length = 0;
      };

      const MAX_OPS = 500;
      let ops = 0;

      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const get = buildRowGetter(row);
        let telefonoRaw = get(["telefono", "teléfono", "celular", "movil", "móvil"]);
        if (!String(telefonoRaw || "").trim()) {
          telefonoRaw = get(["_iddocumento", "iddocumento", "iddocumentofirestore"]);
        }
        const telefono = String(telefonoRaw || "").replace(/\D/g, "");
        if (!telefono) {
          errores += 1;
          continue;
        }
        if (omitirDup && existentes.has(telefono)) {
          omitidos += 1;
          continue;
        }

        const nombreCompleto = get(["nombre", "nombres", "nombrecompleto", "cliente"]);
        const { nombre, apellido } = splitNombreCompleto(nombreCompleto);
        const fi = parseFlexibleDate(
          get([
            "fechaingreso",
            "fechainicio",
            "fecha_inicio",
            "inicio",
            "fecharegistro",
            "fechapago",
          ])
        );
        const fv = parseFlexibleDate(
          get(["fechavencimiento", "fechafin", "fecha_fin", "vencimiento", "fin"])
        );
        if (!fi || !fv) {
          errores += 1;
          continue;
        }

        const plan = elegirPlan(get, fi, fv, planes);
        if (!plan) {
          errores += 1;
          continue;
        }

        const metodoPago = metodoPagoDesdeNumero(get(["metodopago", "metodo_pago", "metodo"]));
        const montoRaw = get(["valorpago", "valor_pago", "monto", "montopagado", "pago"]);
        const montoPagado = Number(String(montoRaw).replace(/[^\d.-]/g, "")) || 0;

        const estadoMembresia = fv >= hoy ? "activa" : "vencida";
        const fechaRegistroTs = Timestamp.fromDate(fi);

        const colU = collection(db, "usuarios");
        const colP = collection(db, "pagos");
        const refU = doc(colU);
        const refP = doc(colP);

        const emailRaw = get(["email", "correo", "mail"]);
        const emailTrim = String(emailRaw || "").trim();

        const dataU = {
          nombre: nombre || "—",
          apellido: apellido || "",
          telefono,
          email: emailTrim ? emailTrim : null,
          fechaRegistro: fechaRegistroTs,
          estadoMembresia,
          membresiaActual: plan.id,
          fechaInicioMembresia: Timestamp.fromDate(fi),
          fechaFinMembresia: Timestamp.fromDate(fv),
        };

        const dataP = {
          usuarioId: refU.id,
          planId: plan.id,
          montoPagado,
          metodoPago,
          fechaPago: Timestamp.fromDate(fi),
          fechaInicio: Timestamp.fromDate(fi),
          fechaFin: Timestamp.fromDate(fv),
        };

        buffer.push({ refU, dataU, refP, dataP });
        ops += 2;
        ok += 1;
        existentes.add(telefono);

        if (ops >= MAX_OPS) {
          await flush();
          ops = 0;
        }
      }

      await flush();

      out.textContent = `Migración terminada: ${ok} socios importados (cada uno con su pago). Omitidos (teléfono ya existía): ${omitidos}. Filas no importadas: ${errores}.`;
      input.value = "";
      archivo = null;
      btn.disabled = true;
      await reiniciarApp();
    } catch (err) {
      console.error(err);
      out.textContent = `Error: ${err.message || err}. Revisa la consola y las reglas de Firestore.`;
    } finally {
      btn.disabled = !archivo;
    }
  });
}
