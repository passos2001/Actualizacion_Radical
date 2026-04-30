/**
 * Exporta colecciones del app antiguo (p. ej. `clientes`, `Clientes`) a un .xlsx
 * antes de borrarlas. Requiere reglas de solo lectura en esas rutas (ver firestore.rules).
 */

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

function getXLSX() {
  return typeof window !== "undefined" ? window.XLSX : null;
}

function serializarValor(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && typeof v.toDate === "function") {
    try {
      return v.toDate().toISOString().slice(0, 10);
    } catch {
      return String(v);
    }
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function docsAObjetosPlano(docs) {
  return docs.map((d) => {
    const data = d.data();
    const row = { _idDocumento: d.id };
    Object.keys(data).forEach((k) => {
      row[k] = serializarValor(data[k]);
    });
    return row;
  });
}

function unirClavesFilas(filas) {
  const keys = new Set();
  filas.forEach((r) => Object.keys(r).forEach((k) => keys.add(k)));
  const orden = ["_idDocumento", ...[...keys].filter((k) => k !== "_idDocumento").sort()];
  return { filas, orden };
}

function appendSheetFromDocs(wb, nombreHoja, docs) {
  const XLSX = getXLSX();
  if (!docs.length) {
    const ws = XLSX.utils.json_to_sheet([{ mensaje: "Sin documentos en esta colección" }]);
    const safe = nombreHoja.slice(0, 31).replace(/[:\\/?*[\]]/g, "-");
    XLSX.utils.book_append_sheet(wb, ws, safe);
    return;
  }
  const filas = docsAObjetosPlano(docs);
  const { orden } = unirClavesFilas(filas);
  const filasOrdenadas = filas.map((r) => {
    const o = {};
    orden.forEach((k) => {
      o[k] = r[k] ?? "";
    });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(filasOrdenadas);
  const safe = nombreHoja.slice(0, 31).replace(/[:\\/?*[\]]/g, "-");
  XLSX.utils.book_append_sheet(wb, ws, safe);
}

function descargarWorkbook(wb, baseName) {
  const XLSX = getXLSX();
  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${baseName}-${stamp}.xlsx`);
}

async function leerColeccion(db, nombre) {
  const snap = await getDocs(collection(db, nombre));
  return snap.docs;
}

export function inicializarExportLegacyFirestore(db) {
  const btn = document.getElementById("btnExportLegacyClientes");
  const out = document.getElementById("resultadoExportLegacy");
  if (!btn || !out) return;

  btn.addEventListener("click", async () => {
    const XLSX = getXLSX();
    if (!XLSX) {
      out.textContent = "No está cargada la librería XLSX. Recarga la página.";
      return;
    }
    btn.disabled = true;
    out.textContent = "Leyendo Firestore…";
    try {
      const wb = XLSX.utils.book_new();
      let total = 0;
      const nombres = ["clientes", "Clientes"];

      for (const nombre of nombres) {
        try {
          const docs = await leerColeccion(db, nombre);
          appendSheetFromDocs(wb, nombre, docs);
          total += docs.length;
          out.textContent = `Hoja «${nombre}»: ${docs.length} filas…`;
        } catch (e) {
          if (e?.code === "permission-denied") {
            const ws = XLSX.utils.json_to_sheet([
              {
                error: `Sin permiso de lectura en «${nombre}». Despliega las reglas con lectura legacy (solo lectura) y vuelve a intentar.`,
              },
            ]);
            const safe = nombre.slice(0, 31).replace(/[:\\/?*[\]]/g, "-");
            XLSX.utils.book_append_sheet(wb, ws, safe);
          } else {
            throw e;
          }
        }
      }

      descargarWorkbook(wb, "export-firestore-legacy");
      out.textContent = `Listo: se descargó un Excel con hasta ${nombres.length} hojas (clientes / Clientes). Documentos leídos en total: ${total}. Puedes usar ese archivo en «Migrar desde Excel» cuando tengas las colecciones nuevas listas.`;
    } catch (err) {
      console.error(err);
      out.textContent = `Error: ${err.message || err}. Revisa la consola.`;
    } finally {
      btn.disabled = false;
    }
  });
}
