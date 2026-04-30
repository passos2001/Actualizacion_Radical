/**
 * Exportación del dashboard a Excel (.xlsx) usando SheetJS (global window.XLSX).
 */

function toDateSafe(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function parseFechaInput(str) {
  if (!str) return null;
  const parts = str.split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, day] = parts;
  return startOfDay(new Date(y, m - 1, day));
}

function aIsoFechaLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getXLSX() {
  return typeof window !== "undefined" ? window.XLSX : null;
}

function readExportRangeFromDom() {
  const desdeStr = document.getElementById("exportDesde")?.value?.trim() || "";
  const hastaStr = document.getElementById("exportHasta")?.value?.trim() || "";
  if (!desdeStr || !hastaStr) {
    return { ok: false, error: "Indica fecha «Desde» y «Hasta» para exportar." };
  }
  const desdeParsed = parseFechaInput(desdeStr);
  const hastaParsed = parseFechaInput(hastaStr);
  if (!desdeParsed || !hastaParsed) {
    return { ok: false, error: "Las fechas de exportación no son válidas." };
  }
  const desde0 = startOfDay(desdeParsed);
  const hastaEnd = endOfDay(hastaParsed);
  if (desde0 > hastaEnd) {
    return { ok: false, error: "«Desde» no puede ser posterior a «Hasta»." };
  }
  const spanDays = Math.floor((hastaEnd - desde0) / 86400000) + 1;
  if (spanDays > 365 * 5) {
    return { ok: false, error: "El rango máximo para exportar es 5 años." };
  }
  return { ok: true, desde0, hastaEnd, desdeStr, hastaStr };
}

function readPlanesRangeFromDom() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const periodo = document.getElementById("filtroPlanesPeriodo")?.value || "1";
  if (periodo !== "custom") {
    const meses = Number(periodo || 1);
    if (!Number.isFinite(meses) || meses <= 0) {
      return { ok: false, error: "Período de planes no válido." };
    }
    const desde = new Date(hoy.getFullYear(), hoy.getMonth() - meses + 1, 1);
    return { ok: true, desde0: startOfDay(desde), hastaEnd: endOfDay(hoy) };
  }
  const desdeStr = document.getElementById("planesFechaDesde")?.value?.trim() || "";
  const hastaStr = document.getElementById("planesFechaHasta")?.value?.trim() || "";
  if (!desdeStr || !hastaStr) {
    return { ok: false, error: "Indica fecha «Desde» y «Hasta» en el filtro de planes." };
  }
  const desdeParsed = parseFechaInput(desdeStr);
  const hastaParsed = parseFechaInput(hastaStr);
  if (!desdeParsed || !hastaParsed) {
    return { ok: false, error: "Las fechas del filtro de planes no son válidas." };
  }
  const desde0 = startOfDay(desdeParsed);
  const hastaEnd = endOfDay(hastaParsed);
  if (desde0 > hastaEnd) {
    return { ok: false, error: "En planes: «Desde» no puede ser posterior a «Hasta»." };
  }
  return { ok: true, desde0, hastaEnd };
}

function readChartRangeFromDom({
  pagos = [],
  selectId,
  desdeId,
  hastaId,
  fallbackDesde0,
  fallbackHastaEnd,
  allowAll = false,
}) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const periodo = document.getElementById(selectId)?.value;
  if (!periodo) {
    return { ok: true, desde0: fallbackDesde0, hastaEnd: fallbackHastaEnd };
  }
  if (allowAll && periodo === "all") {
    const fechas = pagos
      .map((p) => toDateSafe(p.fechaPago))
      .filter(Boolean)
      .sort((a, b) => a - b);
    const primera = fechas[0] || fallbackDesde0 || hoy;
    return { ok: true, desde0: startOfDay(primera), hastaEnd: endOfDay(hoy) };
  }
  if (periodo !== "custom") {
    const meses = Number(periodo || 1);
    if (!Number.isFinite(meses) || meses <= 0) {
      return { ok: false, error: "Período no válido para exportar." };
    }
    const desde = new Date(hoy.getFullYear(), hoy.getMonth() - meses + 1, 1);
    return { ok: true, desde0: startOfDay(desde), hastaEnd: endOfDay(hoy) };
  }
  const desdeStr = document.getElementById(desdeId)?.value?.trim() || "";
  const hastaStr = document.getElementById(hastaId)?.value?.trim() || "";
  if (!desdeStr || !hastaStr) {
    return { ok: false, error: "Indica fecha «Desde» y «Hasta» del gráfico para exportar." };
  }
  const desdeParsed = parseFechaInput(desdeStr);
  const hastaParsed = parseFechaInput(hastaStr);
  if (!desdeParsed || !hastaParsed) {
    return { ok: false, error: "Las fechas del gráfico no son válidas." };
  }
  const desde0 = startOfDay(desdeParsed);
  const hastaEnd = endOfDay(hastaParsed);
  if (desde0 > hastaEnd) {
    return { ok: false, error: "«Desde» no puede ser posterior a «Hasta»." };
  }
  return { ok: true, desde0, hastaEnd };
}

function filtrarPagosPorRango(pagos, desde0, hastaEnd) {
  return pagos.filter((p) => {
    const f = toDateSafe(p.fechaPago);
    return f && f >= desde0 && f <= hastaEnd;
  });
}

function idsUsuariosConPagoEnRango(pagosFiltrados) {
  return new Set(pagosFiltrados.map((p) => p.usuarioId).filter(Boolean));
}

function usuarioTocaPeriodo(u, idsPagoEnRango, desde0, hastaEnd) {
  if (u.id && idsPagoEnRango.has(u.id)) return true;
  const fr = toDateSafe(u.fechaRegistro);
  if (fr && fr >= desde0 && fr <= hastaEnd) return true;
  const fin = toDateSafe(u.fechaFinMembresia);
  if (fin && fin >= desde0 && fin <= hastaEnd) return true;
  return false;
}

function estadoMembresiaAlCorte(u, fechaCorteInicioDia) {
  const fin = toDateSafe(u.fechaFinMembresia);
  if (!fin) return "Sin fecha fin";
  return fin >= fechaCorteInicioDia ? "Activo" : "Vencido";
}

function estadoConIndicador(estado) {
  const valor = String(estado || "").toLowerCase().trim();
  if (valor === "activo") return "🟢 Activo";
  if (valor === "vencido") return "🔴 Vencido";
  return "⚪ Sin fecha fin";
}

function buildMaps(usuarios, planes) {
  const uById = new Map(usuarios.map((x) => [x.id, x]));
  const pById = new Map(planes.map((x) => [x.id, x]));
  return { uById, pById };
}

function filasPagosDetalle(pagosFiltrados, uById, pById, opciones = {}) {
  const soloCamposPublicos = opciones.soloCamposPublicos === true;
  const incluirIds = opciones.incluirIds !== false;
  const incluirEmail = opciones.incluirEmail !== false;
  return pagosFiltrados.map((p) => {
    const u = uById.get(p.usuarioId) || {};
    const plan = pById.get(p.planId) || {};
    const fp = toDateSafe(p.fechaPago);
    const base = {
      "Fecha de pago": fp ? fp.toLocaleDateString("es-CO") : "",
      Nombre: u.nombre || "",
      Apellido: u.apellido || "",
      Teléfono: u.telefono || "",
      Plan: plan.nombre || p.planId || "",
      "Monto (COP)": Number(p.montoPagado || 0),
      "Método de pago": p.metodoPago || "",
    };
    if (soloCamposPublicos) return base;
    const detalle = { ...base };
    if (incluirEmail) {
      detalle.Email = u.email || "";
    }
    if (incluirIds) {
      detalle["Id pago"] = p.id;
      detalle["Id usuario"] = p.usuarioId || "";
    }
    return detalle;
  });
}

function nombrePlanDesdeId(planId, pById) {
  if (!planId || !(pById instanceof Map)) return planId || "";
  const plan = pById.get(planId);
  return plan?.nombre || planId || "";
}

function filasSociosPeriodo(usuarios, pagosFiltrados, desde0, hastaEnd, fechaCorteInicioDia, pById) {
  const ids = idsUsuariosConPagoEnRango(pagosFiltrados);
  const mapaPlanes = pById instanceof Map ? pById : new Map();
  return usuarios
    .filter((u) => usuarioTocaPeriodo(u, ids, desde0, hastaEnd))
    .map((u) => {
      const fin = toDateSafe(u.fechaFinMembresia);
      const ini = toDateSafe(u.fechaInicioMembresia);
      const reg = toDateSafe(u.fechaRegistro);
      const planId = u.membresiaActual || "";
      const estado = estadoMembresiaAlCorte(u, fechaCorteInicioDia);
      return {
        Nombre: u.nombre || "",
        Apellido: u.apellido || "",
        Teléfono: u.telefono || "",
        Estado: estadoConIndicador(estado),
        "Fecha Inicio": ini ? ini.toLocaleDateString("es-CO") : "",
        "Fecha Fin": fin ? fin.toLocaleDateString("es-CO") : "",
        "Fecha Registro": reg ? reg.toLocaleDateString("es-CO") : "",
        "Plan Actual": nombrePlanDesdeId(planId, mapaPlanes),
      };
    });
}

function filasResumenMetodos(pagosFiltrados) {
  const acc = {};
  pagosFiltrados.forEach((p) => {
    const m = p.metodoPago || "Sin definir";
    if (!acc[m]) acc[m] = { cantidad: 0, total: 0 };
    acc[m].cantidad += 1;
    acc[m].total += Number(p.montoPagado || 0);
  });
  return Object.entries(acc).map(([metodo, v]) => ({
    "Método de pago": metodo,
    Cantidad: v.cantidad,
    "Total (COP)": v.total,
  }));
}

function filasResumenPlanes(pagosFiltrados, pById) {
  const acc = {};
  pagosFiltrados.forEach((p) => {
    const plan = pById.get(p.planId);
    const nombre = plan?.nombre || p.planId || "Sin plan";
    if (!acc[nombre]) acc[nombre] = { cantidad: 0, total: 0 };
    acc[nombre].cantidad += 1;
    acc[nombre].total += Number(p.montoPagado || 0);
  });
  return Object.entries(acc)
    .sort((a, b) => b[1].cantidad - a[1].cantidad)
    .map(([plan, v]) => ({
      Plan: plan,
      "Cantidad de pagos": v.cantidad,
      "Total ingresos (COP)": v.total,
    }));
}

function filasResumenActivosVencidos(usuarios, fechaCorteInicioDia) {
  let activos = 0;
  let vencidos = 0;
  let sinFecha = 0;
  usuarios.forEach((u) => {
    const fin = toDateSafe(u.fechaFinMembresia);
    if (!fin) {
      sinFecha += 1;
      return;
    }
    if (fin >= fechaCorteInicioDia) activos += 1;
    else vencidos += 1;
  });
  return [
    { Métrica: "Fecha de corte (hasta)", Valor: fechaCorteInicioDia.toLocaleDateString("es-CO") },
    { Métrica: "Socios activos (al corte)", Valor: activos },
    { Métrica: "Socios vencidos (al corte)", Valor: vencidos },
    { Métrica: "Sin fecha fin de membresía", Valor: sinFecha },
    { Métrica: "Total socios en base", Valor: usuarios.length },
  ];
}

function appendSheet(wb, rows, name) {
  const XLSX = getXLSX();
  const safeName = String(name).slice(0, 31).replace(/[:\\/?*[\]]/g, "-");
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Mensaje: "Sin datos en este rango" }]);
  XLSX.utils.book_append_sheet(wb, ws, safeName);
}

/** Hoja con autofiltro y anchos (se ve como tabla en Excel). */
function appendSheetTabla(wb, rows, name, anchosCol) {
  const XLSX = getXLSX();
  const safeName = String(name).slice(0, 31).replace(/[:\\/?*[\]]/g, "-");
  const data = rows.length ? rows : [{ Mensaje: "Sin datos en este rango" }];
  const ws = XLSX.utils.json_to_sheet(data);
  const ref = ws["!ref"];
  if (ref && rows.length) {
    ws["!autofilter"] = { ref };
    const n = Object.keys(rows[0]).length;
    const defaultW = Array.from({ length: n }, (_, i) => ({
      wch: anchosCol?.[i] ?? (i === n - 1 ? 28 : 16),
    }));
    ws["!cols"] = defaultW;
  }
  XLSX.utils.book_append_sheet(wb, ws, safeName);
}

/**
 * Colorea la columna "Estado" (Activo/Vencido) en la hoja.
 * Nota: depende del soporte de estilos del motor XLSX del navegador.
 */
function colorearColumnaEstado(ws, rows, keyEstado = "Estado") {
  const XLSX = getXLSX();
  if (!ws || !rows?.length || !XLSX?.utils) return;
  const headers = Object.keys(rows[0] || {});
  const colEstado = headers.indexOf(keyEstado);
  if (colEstado < 0) return;

  const estiloActivo = {
    fill: { patternType: "solid", fgColor: { rgb: "D9EAD3" } },
    font: { color: { rgb: "1B5E20" }, bold: true },
  };
  const estiloVencido = {
    fill: { patternType: "solid", fgColor: { rgb: "F4CCCC" } },
    font: { color: { rgb: "9C0006" }, bold: true },
  };

  for (let i = 0; i < rows.length; i += 1) {
    const valorEstado = String(rows[i]?.[keyEstado] || "").toLowerCase().trim();
    const ref = XLSX.utils.encode_cell({ c: colEstado, r: i + 1 }); // +1 por encabezado
    if (!ws[ref]) continue;
    if (valorEstado.includes("activo")) ws[ref].s = estiloActivo;
    else if (valorEstado.includes("vencido")) ws[ref].s = estiloVencido;
  }
}

function descargar(wb, baseName) {
  const XLSX = getXLSX();
  const stamp = `${aIsoFechaLocal(new Date())}_${Date.now().toString(36).slice(-4)}`;
  XLSX.writeFile(wb, `${baseName}-${stamp}.xlsx`, { cellStyles: true });
}

function exportActivosVencidosExcel({ usuarios, pagos, planes, desde0, hastaEnd, hastaStr }) {
  const XLSX = getXLSX();
  if (!XLSX) return false;
  const rango = readChartRangeFromDom({
    pagos,
    selectId: "filtroEstadoPeriodo",
    desdeId: "estadoFechaDesde",
    hastaId: "estadoFechaHasta",
    fallbackDesde0: desde0,
    fallbackHastaEnd: hastaEnd,
  });
  if (!rango.ok) {
    window.alert(rango.error || "No se pudo determinar el período para Activos vs vencidos.");
    return false;
  }
  const pagosF = filtrarPagosPorRango(pagos, rango.desde0, rango.hastaEnd);
  const fechaCorte = startOfDay(rango.hastaEnd || parseFechaInput(hastaStr) || new Date());
  const { pById } = buildMaps(usuarios, planes || []);
  const socios = filasSociosPeriodo(usuarios, pagosF, rango.desde0, rango.hastaEnd, fechaCorte, pById);
  const resumen = filasResumenActivosVencidos(usuarios, fechaCorte);
  const wb = XLSX.utils.book_new();
  appendSheetTabla(wb, socios, "Socios en periodo", [14, 14, 14, 12, 14, 14, 16, 26]);
  colorearColumnaEstado(wb.Sheets["Socios en periodo"], socios, "Estado");
  appendSheet(wb, resumen, "Resumen al corte");
  descargar(wb, "RT-activos-vencidos");
  return true;
}

function exportMetodosPagoExcel({ usuarios, pagos, planes, desde0, hastaEnd }) {
  const XLSX = getXLSX();
  if (!XLSX) return false;
  const rango = readChartRangeFromDom({
    pagos,
    selectId: "filtroMetodosPeriodo",
    desdeId: "metodosFechaDesde",
    hastaId: "metodosFechaHasta",
    fallbackDesde0: desde0,
    fallbackHastaEnd: hastaEnd,
  });
  if (!rango.ok) {
    window.alert(rango.error || "No se pudo determinar el período para Métodos de pago.");
    return false;
  }
  const pagosF = filtrarPagosPorRango(pagos, rango.desde0, rango.hastaEnd);
  const { uById, pById } = buildMaps(usuarios, planes);
  const detalle = filasPagosDetalle(pagosF, uById, pById, { soloCamposPublicos: true });
  const resumen = filasResumenMetodos(pagosF);
  const wb = XLSX.utils.book_new();
  appendSheetTabla(wb, detalle, "Pagos detalle", [14, 14, 18, 12, 22, 14, 18]);
  appendSheetTabla(wb, resumen, "Resumen metodos", [22, 12, 16]);
  descargar(wb, "RT-metodos-pago");
  return true;
}

function exportIngresosExcel({ usuarios, pagos, planes, desde0, hastaEnd }) {
  const XLSX = getXLSX();
  if (!XLSX) return false;
  const rango = readChartRangeFromDom({
    pagos,
    selectId: "filtroIngresosPeriodo",
    desdeId: "ingresoFechaDesde",
    hastaId: "ingresoFechaHasta",
    fallbackDesde0: desde0,
    fallbackHastaEnd: hastaEnd,
    allowAll: true,
  });
  if (!rango.ok) {
    window.alert(rango.error || "No se pudo determinar el período para Ingresos.");
    return false;
  }
  const pagosF = filtrarPagosPorRango(pagos, rango.desde0, rango.hastaEnd);
  const { uById, pById } = buildMaps(usuarios, planes);
  const detalle = filasPagosDetalle(pagosF, uById, pById, { incluirIds: false, incluirEmail: false });
  const totales = [
    {
      Concepto: "Total ingresos en rango (COP)",
      Valor: pagosF.reduce((s, p) => s + Number(p.montoPagado || 0), 0),
    },
    { Concepto: "Cantidad de pagos", Valor: pagosF.length },
  ];
  const wb = XLSX.utils.book_new();
  appendSheetTabla(wb, detalle, "Ingresos detalle", [14, 14, 14, 20, 14, 18, 18]);
  appendSheetTabla(wb, totales, "Totales", [30, 20]);
  descargar(wb, "RT-ingresos");
  return true;
}

function exportPlanesVendidosExcel({ usuarios, pagos, planes, desde0, hastaEnd }) {
  const XLSX = getXLSX();
  if (!XLSX) return false;
  const rangoPlanes = readChartRangeFromDom({
    pagos,
    selectId: "filtroPlanesPeriodo",
    desdeId: "planesFechaDesde",
    hastaId: "planesFechaHasta",
    fallbackDesde0: desde0,
    fallbackHastaEnd: hastaEnd,
  });
  if (!rangoPlanes.ok) {
    window.alert(rangoPlanes.error || "No se pudo determinar el período para Planes vendidos.");
    return false;
  }
  const pagosF = filtrarPagosPorRango(pagos, rangoPlanes.desde0, rangoPlanes.hastaEnd);
  const { uById, pById } = buildMaps(usuarios, planes);
  const detalle = filasPagosDetalle(pagosF, uById, pById, { incluirIds: false, incluirEmail: false });
  const resumen = filasResumenPlanes(pagosF, pById);
  const wb = XLSX.utils.book_new();
  appendSheetTabla(wb, resumen, "Planes resumen", [22, 20, 20]);
  appendSheetTabla(wb, detalle, "Pagos por plan");
  descargar(wb, "RT-planes-vendidos");
  return true;
}

function exportTodoExcel({ usuarios, pagos, planes, desde0, hastaEnd, desdeStr, hastaStr }) {
  const XLSX = getXLSX();
  if (!XLSX) return false;
  const pagosF = filtrarPagosPorRango(pagos, desde0, hastaEnd);
  const { uById, pById } = buildMaps(usuarios, planes);
  const fechaCorte = startOfDay(parseFechaInput(hastaStr));
  const detallePagos = filasPagosDetalle(pagosF, uById, pById);
  const socios = filasSociosPeriodo(usuarios, pagosF, desde0, hastaEnd, fechaCorte, pById);
  const resumenMetodos = filasResumenMetodos(pagosF);
  const resumenPlanes = filasResumenPlanes(pagosF, pById);
  const resumenCorte = filasResumenActivosVencidos(usuarios, fechaCorte);
  const portada = [
    { Campo: "Rango exportación (desde)", Valor: desdeStr },
    { Campo: "Rango exportación (hasta)", Valor: hastaStr },
    { Campo: "Nota", Valor: "Pagos filtrados por fecha de pago. Socios: con actividad o fechas en el rango." },
  ];
  const wb = XLSX.utils.book_new();
  appendSheet(wb, portada, "Info");
  appendSheet(wb, detallePagos, "Todos los pagos");
  appendSheetTabla(wb, socios, "Socios periodo", [14, 14, 14, 12, 14, 14, 16, 26]);
  colorearColumnaEstado(wb.Sheets["Socios periodo"], socios, "Estado");
  appendSheet(wb, resumenMetodos, "Metodos resumen");
  appendSheet(wb, resumenPlanes, "Planes resumen");
  appendSheet(wb, resumenCorte, "Activos vs vencidos");
  descargar(wb, "RT-reporte-completo");
  return true;
}

function defaultExportDates() {
  const expDesde = document.getElementById("exportDesde");
  const expHasta = document.getElementById("exportHasta");
  if (!expDesde || !expHasta) return;
  if (expDesde.value && expHasta.value) return;
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  expHasta.value = aIsoFechaLocal(h);
  const d = new Date(h);
  d.setDate(d.getDate() - 29);
  expDesde.value = aIsoFechaLocal(d);
}

/**
 * @param {() => { usuarios: any[], pagos: any[], planes: any[] }} getSnapshot
 */
export function inicializarDashboardExport(getSnapshot) {
  defaultExportDates();

  const run = (fn) => {
    const r = readExportRangeFromDom();
    if (!r.ok) {
      window.alert(r.error);
      return;
    }
    const XLSX = getXLSX();
    if (!XLSX) {
      window.alert("No se cargó la librería de Excel. Recarga la página.");
      return;
    }
    const { usuarios, pagos, planes } = getSnapshot();
    if (!Array.isArray(usuarios) || !Array.isArray(pagos)) {
      window.alert("Aún no hay datos cargados. Espera un momento e inténtalo de nuevo.");
      return;
    }
    fn({ usuarios, pagos, planes: planes || [], ...r });
  };

  const map = [
    ["btnExportExcelActivos", exportActivosVencidosExcel],
    ["btnExportExcelMetodos", exportMetodosPagoExcel],
    ["btnExportExcelIngresos", exportIngresosExcel],
    ["btnExportExcelPlanes", exportPlanesVendidosExcel],
    ["btnExportExcelTodo", exportTodoExcel],
    ["btnExportExcelActivosInline", exportActivosVencidosExcel],
    ["btnExportExcelMetodosInline", exportMetodosPagoExcel],
    ["btnExportExcelIngresosInline", exportIngresosExcel],
    ["btnExportExcelPlanesInline", exportPlanesVendidosExcel],
  ];

  map.forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", () => run(fn));
  });
}
