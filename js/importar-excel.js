import {
  collection,
  doc,
  writeBatch,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

const PLANTILLA_CSV = "nombre;apellido;telefono;email;fechaRegistro;plan\nJuan;Pérez;3001234567;juan@ejemplo.com;01/02/2026;mensual_basic\nMaría;García;3109876543;;05/01/2026;bimestre_basic";

function parseFecha(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(/[\/\-.]/).map((n) => parseInt(n, 10));
  if (parts.length < 3) return null;
  const [a, b, c] = parts;
  if (s.match(/^\d{4}-\d{1,2}-\d{1,2}/)) return new Date(a, b - 1, c);
  if (c > 31) return new Date(c, b - 1, a);
  return new Date(c, b - 1, a);
}

function parseCSV(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  if (lineas.length < 2) return [];
  const sep = lineas[0].includes(";") ? ";" : ",";
  const headers = lineas[0].split(sep).map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ""));
  const filas = [];
  for (let i = 1; i < lineas.length; i++) {
    const valores = [];
    let rest = lineas[i];
    while (rest.length) {
      if (rest.startsWith('"')) {
        const end = rest.indexOf('"', 1);
        valores.push(end === -1 ? rest.slice(1) : rest.slice(1, end));
        rest = end === -1 ? "" : rest.slice(end + 1).replace(/^[\s,;]/, "");
      } else {
        const idx = rest.search(new RegExp(`[${sep}]`));
        valores.push(idx === -1 ? rest.trim() : rest.slice(0, idx).trim());
        rest = idx === -1 ? "" : rest.slice(idx + 1);
      }
    }
    const obj = {};
    headers.forEach((h, j) => (obj[h] = (valores[j] || "").trim()));
    if (obj.nombre || obj.apellido || obj.telefono) filas.push(obj);
  }
  return filas;
}

export function inicializarImportacion(db, getPlanes, reiniciarApp) {
  let archivoCsvSeleccionado = null;

  // Descargar plantilla CSV
  document.getElementById("descargarPlantilla").addEventListener("click", (e) => {
    e.preventDefault();
    const blob = new Blob(["\uFEFF" + PLANTILLA_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla_usuarios.csv";
    a.click();
    URL.revokeObjectURL(url);
  });

  // Seleccionar archivo CSV
  document.getElementById("archivoCsv").addEventListener("change", (e) => {
    archivoCsvSeleccionado = e.target.files[0] || null;
    document.getElementById("btnImportar").disabled = !archivoCsvSeleccionado;
    document.getElementById("resultadoImportacion").textContent = "";
  });

  // Importar usuarios desde CSV
  document.getElementById("btnImportar").addEventListener("click", async () => {
    if (!archivoCsvSeleccionado) return;
    const btn = document.getElementById("btnImportar");
    const resultado = document.getElementById("resultadoImportacion");
    btn.disabled = true;
    resultado.textContent = "Importando...";
    try {
      const texto = await archivoCsvSeleccionado.text();
      const filas = parseCSV(texto);
      if (filas.length === 0) {
        resultado.textContent = "No se encontraron filas válidas (nombre, apellido o teléfono). Revisa el CSV.";
        btn.disabled = false;
        return;
      }
      
      const planes = getPlanes();
      const colRef = collection(db, "usuarios");
      const BATCH_SIZE = 500;
      let importados = 0;
      const hoy = new Date();
      hoy.setHours(0, 0, 0, 0);
      
      for (let i = 0; i < filas.length; i += BATCH_SIZE) {
        const batch = writeBatch(db);
        const chunk = filas.slice(i, i + BATCH_SIZE);
        for (const row of chunk) {
          const fechaRegistroDate = parseFecha(row.fecharegistro || row.fecha_registro) || new Date();
          const planIdRaw = (row.plan || row.tipomembresia || row.membresia || "").trim();
          const planEncontrado = planIdRaw
            ? planes.find(
                (p) =>
                  p.id === planIdRaw ||
                  (p.nombre || "").toLowerCase() === planIdRaw.toLowerCase()
              )
            : null;
          const datos = {
            nombre: (row.nombre || "").trim(),
            apellido: (row.apellido || "").trim(),
            telefono: (row.telefono || "").trim(),
            email: (row.email || "").trim() || null,
            fechaRegistro: Timestamp.fromDate(fechaRegistroDate),
            estadoMembresia: "vencida",
          };
          if (planEncontrado) {
            const duracionDias = planEncontrado.duracionDias || 30;
            const fechaFin = new Date(fechaRegistroDate);
            // El día de pago cuenta como día 1: fin = pago + (duración - 1) días
            fechaFin.setDate(fechaFin.getDate() + duracionDias - 1);
            datos.membresiaActual = planEncontrado.id;
            datos.fechaInicioMembresia = Timestamp.fromDate(fechaRegistroDate);
            datos.fechaFinMembresia = Timestamp.fromDate(fechaFin);
            datos.estadoMembresia = fechaFin >= hoy ? "activa" : "vencida";
          }
          const ref = doc(colRef);
          batch.set(ref, datos);
          importados++;
        }
        await batch.commit();
      }
      resultado.textContent = `Se importaron ${importados} usuarios. Puedes ir a Usuarios para verlos y renovar cuando paguen.`;
      document.getElementById("archivoCsv").value = "";
      archivoCsvSeleccionado = null;
      btn.disabled = true;
      await reiniciarApp();
    } catch (err) {
      console.error(err);
      resultado.textContent = "Error al importar. Revisa que el CSV tenga columnas nombre, apellido, telefono, email.";
    } finally {
      btn.disabled = false;
    }
  });
}
