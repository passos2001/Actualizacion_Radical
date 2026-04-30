import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { inicializarImportacion } from "./importar-excel.js";
import { inicializarMigracionRadical } from "./migrar-excel-radical.js";
import { inicializarExportLegacyFirestore } from "./export-legacy-firestore.js";
import { confirmarEliminacion } from "./modal.js";
import { inicializarDashboardExport } from "./dashboard-export.js";

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Referencias a elementos del DOM
const navToggle = document.getElementById("navToggle");
const nav = document.getElementById("nav");
const navLinks = document.querySelectorAll(".nav-link");
const sections = document.querySelectorAll(".section");
let chartEstadoMembresias = null;
let chartMetodosPago = null;
let chartIngresosMensuales = null;
let chartPlanesVendidos = null;
let filtroIngresosPeriodo = "1";
let filtroEstadoPeriodo = "1";
let filtroMetodosPeriodo = "1";
let filtroPlanesPeriodo = "1";
let dashboardFiltrosInicializados = false;
let usuariosPorPagina = 5;
let paginaUsuariosActual = 1;
let sortUsuariosModo = "fecha_reciente";
let vencidosPorPagina = 5;
let paginaVencidosActual = 1;
let filtroVencidosInicio = "";
let proximosPorPagina = window.matchMedia("(max-width: 640px)").matches ? 4 : 10;
let paginaProximosActual = 1;
let filtroProximosInicio = "";
/** 'fecha' | 'nombre' — próximos a vencer */
let sortProximosCol = "fecha";
/** 'asc' = fecha más cercana primero; 'desc' = más lejana en el rango */
let sortProximosDir = "asc";
let sortVencidosCol = "fecha";
/** 'desc' = venció más recientemente primero (más útil) */
let sortVencidosDir = "desc";

// Navegación por secciones
function showSection(sectionId) {
  sections.forEach((s) => s.classList.remove("active"));
  navLinks.forEach((l) => l.classList.remove("active"));
  const section = document.getElementById(sectionId);
  const link = document.querySelector(`.nav-link[href="#${sectionId}"]`);
  if (section) section.classList.add("active");
  if (link) link.classList.add("active");
  nav.classList.remove("is-open");
}

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const idRaw = link.getAttribute("href").slice(1);
    const id = idRaw === "importar-usuarios" ? "inicio" : idRaw;
    showSection(id);
  });
});

navToggle.addEventListener("click", () => nav.classList.toggle("is-open"));

function estabilizarLayoutEnCambioPantalla() {
  nav.classList.remove("is-open");
  cerrarMenuFiltrosUsuarios?.();
  cerrarMenuFiltrosProximos?.();
  cerrarMenuFiltrosVencidos?.();
}

window.addEventListener("resize", estabilizarLayoutEnCambioPantalla);
window.addEventListener("orientationchange", () => {
  window.setTimeout(estabilizarLayoutEnCambioPantalla, 140);
});
let dashboardResizeTimer = null;
function refrescarGraficosTrasResize() {
  if (dashboardResizeTimer) window.clearTimeout(dashboardResizeTimer);
  dashboardResizeTimer = window.setTimeout(() => {
    const dashboard = document.getElementById("dashboard");
    if (!dashboard?.classList.contains("active")) return;
    const usuariosActuales = window.__usuarios || [];
    const pagosActuales = window.__pagos || [];
    const planesActuales = window.__planes || [];
    if (!usuariosActuales.length && !pagosActuales.length && !planesActuales.length) return;
    renderDashboardCharts(usuariosActuales, pagosActuales, planesActuales);
  }, 180);
}
window.addEventListener("resize", refrescarGraficosTrasResize);
window.addEventListener("orientationchange", () => {
  window.setTimeout(refrescarGraficosTrasResize, 220);
});

// Sincronizar con hash
window.addEventListener("hashchange", () => {
  const rawId = (window.location.hash || "#inicio").slice(1);
  const id = rawId === "importar-usuarios" ? "inicio" : rawId;
  if (document.getElementById(id)) showSection(id);
});
const rawHash = (window.location.hash || "#inicio").slice(1);
const hash = rawHash === "importar-usuarios" ? "inicio" : rawHash;
if (document.getElementById(hash)) showSection(hash);

// --- Firestore: Planes ---
async function cargarPlanes() {
  const snap = await getDocs(collection(db, "planes"));
  const planes = [];
  snap.forEach((d) => planes.push({ id: d.id, ...d.data() }));
  // Ordenar: primero mensualidad, luego bimestre, luego trimestre (por duración)
  return planes
    .filter((p) => p.activo !== false)
    .sort((a, b) => (a.duracionDias || 0) - (b.duracionDias || 0));
}

function renderPlanes(planes) {
  const list = document.getElementById("listaPlanes");
  const selectPago = document.getElementById("pagoPlanId");
  const selectNuevo = document.getElementById("nuevoUsuarioPlanId");
  [selectPago, selectNuevo].forEach((select) => {
    const options = select.querySelectorAll("option:not(:first-child)");
    options.forEach((o) => o.remove());
  });

  const planesHTML = planes.length === 0
    ? "<li class='empty'>No hay planes cargados.</li>"
    : planes
      .map(
        (p) =>
          `<li>
              <span class="plan-item__nombre">${p.nombre || p.id}</span>
              <span class="plan-item__duracion">${p.duracionDias || 0} días</span>
              <div class="plan-item__editor">
                <label class="visually-hidden" for="precioPlan-${p.id}">Precio del plan ${p.nombre || p.id}</label>
                <input type="number" id="precioPlan-${p.id}" class="input plan-item__input" min="0" step="1" value="${Number(p.precio || 0)}" />
                <button type="button" class="btn btn--primary btn--small" data-accion="guardar-precio-plan" data-plan-id="${p.id}">Guardar</button>
              </div>
              <span class="plan-item__precio">Actual: $${Number(p.precio || 0).toLocaleString()}</span>
            </li>`
      )
      .join("");

  // Renderizar en la sección de Planes (si existe)
  if (list) {
    list.innerHTML = planesHTML;
  }

  planes.forEach((p) => {
    [selectPago, selectNuevo].forEach((select) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.nombre || p.id} — $${Number(p.precio || 0).toLocaleString()} (${p.duracionDias} días)`;
      opt.dataset.duracionDias = p.duracionDias;
      opt.dataset.precio = p.precio;
      select.appendChild(opt);
    });
  });
}

function normalizarTextoBusqueda(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function coincideBusquedaUsuario(usuario, textoNormalizado) {
  if (!textoNormalizado) return true;
  const nombre = normalizarTextoBusqueda(usuario?.nombre);
  const apellido = normalizarTextoBusqueda(usuario?.apellido);
  const nombreCompleto = `${nombre} ${apellido}`.trim();
  const telefono = String(usuario?.telefono || "");
  const email = normalizarTextoBusqueda(usuario?.email);
  return (
    nombre.includes(textoNormalizado) ||
    apellido.includes(textoNormalizado) ||
    nombreCompleto.includes(textoNormalizado) ||
    telefono.includes(textoNormalizado) ||
    email.includes(textoNormalizado)
  );
}

async function actualizarPrecioPlan(planId) {
  const input = document.getElementById(`precioPlan-${planId}`);
  if (!input) return;
  const precioNuevo = Number(input.value);
  if (!Number.isFinite(precioNuevo) || precioNuevo < 0) {
    alert("Ingresa un precio válido (número mayor o igual a 0).");
    input.focus();
    return;
  }
  const btn = document.querySelector(`[data-accion="guardar-precio-plan"][data-plan-id="${planId}"]`);
  if (btn) btn.disabled = true;
  try {
    await updateDoc(doc(db, "planes", planId), { precio: precioNuevo });
    // Refresca planes y selects con el nuevo precio
    planes = await cargarPlanes();
    window.__planes = planes;
    renderPlanes(planes);
    mostrarMensaje(
      "mensajePlanesAdmin",
      `✓ Precio actualizado $${precioNuevo.toLocaleString("es-CO")}`,
      "exito"
    );
  } catch (err) {
    console.error("Error actualizando precio del plan:", err);
    mostrarMensaje(
      "mensajePlanesAdmin",
      "✗ No se pudo actualizar el precio en la colección planes. Revisa permisos/reglas de Firestore.",
      "error"
    );
  } finally {
    if (btn) btn.disabled = false;
  }
}

function normalizarIdPlan(nombre = "") {
  const base = String(nombre)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "";
  return base.endsWith("_basic") ? base : `${base}_basic`;
}

async function crearPlanDesdeAdmin() {
  const nombreInput = document.getElementById("nuevoPlanNombre");
  const duracionInput = document.getElementById("nuevoPlanDuracionDias");
  const precioInput = document.getElementById("nuevoPlanPrecio");
  if (!nombreInput || !duracionInput || !precioInput) return;

  const nombre = (nombreInput.value || "").trim();
  const duracionDias = Number(duracionInput.value);
  const precio = Number(precioInput.value);
  const planId = normalizarIdPlan(nombre);

  if (!planId) {
    mostrarMensaje("mensajePlanesAdmin", "✗ Escribe un nombre válido para generar el ID del plan.", "error");
    nombreInput.focus();
    return;
  }
  if (!Number.isFinite(duracionDias) || duracionDias <= 0) {
    mostrarMensaje("mensajePlanesAdmin", "✗ La duración debe ser un número mayor a 0.", "error");
    duracionInput.focus();
    return;
  }
  if (!Number.isFinite(precio) || precio < 0) {
    mostrarMensaje("mensajePlanesAdmin", "✗ El precio debe ser un número mayor o igual a 0.", "error");
    precioInput.focus();
    return;
  }
  const yaExiste = (window.__planes || []).some((p) => p.id === planId);
  if (yaExiste) {
    mostrarMensaje("mensajePlanesAdmin", `✗ Ya existe un plan con ID ${planId}. Cambia el nombre.`, "error");
    nombreInput.focus();
    return;
  }

  try {
    await setDoc(doc(db, "planes", planId), {
      id: planId,
      nombre,
      precio,
      duracionDias,
      activo: true,
      tipo: "basic",
    });
    planes = await cargarPlanes();
    window.__planes = planes;
    renderPlanes(planes);
    mostrarMensaje("mensajePlanesAdmin", `✓ Plan creado (${planId})`, "exito");
    document.getElementById("formNuevoPlan")?.reset();
    const cardNuevoPlan = document.getElementById("tarjetaNuevoPlan");
    const btnToggle = document.getElementById("btnToggleNuevoPlan");
    if (cardNuevoPlan) cardNuevoPlan.hidden = true;
    btnToggle?.setAttribute("aria-expanded", "false");
  } catch (err) {
    console.error("Error creando plan:", err);
    mostrarMensaje("mensajePlanesAdmin", "✗ No se pudo crear el plan. Revisa permisos/reglas.", "error");
  }
}

function toggleCardNuevoPlan(forceOpen) {
  const cardNuevoPlan = document.getElementById("tarjetaNuevoPlan");
  const btnToggle = document.getElementById("btnToggleNuevoPlan");
  if (!cardNuevoPlan || !btnToggle) return;
  const debeAbrir = typeof forceOpen === "boolean" ? forceOpen : cardNuevoPlan.hidden;
  cardNuevoPlan.hidden = !debeAbrir;
  btnToggle.setAttribute("aria-expanded", String(debeAbrir));
  if (debeAbrir) {
    document.getElementById("nuevoPlanNombre")?.focus();
  }
}

// --- Firestore: Usuarios ---
async function cargarUsuarios() {
  const snap = await getDocs(collection(db, "usuarios"));
  const usuarios = [];
  snap.forEach((d) => usuarios.push({ id: d.id, ...d.data() }));
  return usuarios;
}

async function cargarPagos() {
  const snap = await getDocs(collection(db, "pagos"));
  const pagos = [];
  snap.forEach((d) => pagos.push({ id: d.id, ...d.data() }));
  return pagos;
}

function renderUsuarios(usuarios, filtro = "") {
  const list = document.getElementById("listaUsuarios");
  const paginacion = document.getElementById("paginacionUsuarios");
  if (!list || !paginacion) return;
  const texto = normalizarTextoBusqueda(filtro);
  const filtrados = texto
    ? usuarios.filter((u) => coincideBusquedaUsuario(u, texto))
    : usuarios;

  if (filtrados.length === 0) {
    list.innerHTML = "<li class='empty'>No hay usuarios o no coincide la búsqueda.</li>";
    paginacion.hidden = true;
    paginacion.innerHTML = "";
  } else {
    const ordenados = [...filtrados].sort((a, b) => {
      const nombreA = `${(a.nombre || "").trim()} ${(a.apellido || "").trim()}`.trim().toLowerCase();
      const nombreB = `${(b.nombre || "").trim()} ${(b.apellido || "").trim()}`.trim().toLowerCase();
      const fechaA = a.fechaFinMembresia?.toDate?.()?.getTime() ?? 0;
      const fechaB = b.fechaFinMembresia?.toDate?.()?.getTime() ?? 0;
      if (sortUsuariosModo === "nombre_az") return nombreA.localeCompare(nombreB, "es");
      if (sortUsuariosModo === "nombre_za") return nombreB.localeCompare(nombreA, "es");
      if (sortUsuariosModo === "fecha_antigua") return fechaA - fechaB;
      return fechaB - fechaA; // fecha_reciente
    });

    const totalPaginas = Math.max(1, Math.ceil(ordenados.length / usuariosPorPagina));
    if (paginaUsuariosActual > totalPaginas) paginaUsuariosActual = totalPaginas;
    if (paginaUsuariosActual < 1) paginaUsuariosActual = 1;
    const inicio = (paginaUsuariosActual - 1) * usuariosPorPagina;
    const fin = inicio + usuariosPorPagina;
    const visibles = ordenados.slice(inicio, fin);

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    list.innerHTML = visibles
      .map(
        (u) => {
          const fin = u.fechaFinMembresia?.toDate?.();
          const finStr = fin ? fin.toLocaleDateString("es") : "—";

          // Calcular estado dinámicamente basándose en la fecha
          let estado = "vencida";
          let estadoTexto = "Vencida";
          if (fin) {
            if (fin >= hoy) {
              estado = "activa";
              estadoTexto = "Activa";
            }
          }

          const msgWa = `Hola ${(u.nombre || "").trim()}, te contacto desde Fuerza Delta.`;
          const wa = urlWhatsApp(u.telefono, msgWa);
          const linkWa = wa
            ? `<a href="${wa}" target="_blank" rel="noopener" class="btn btn--whatsapp" title="WhatsApp"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i><span class="visually-hidden">WhatsApp</span></a>`
            : "";
          return `<li class="user-item">
            <span class="user-item__name">${u.nombre || ""} ${u.apellido || ""}</span>
            <span class="user-item__meta">
              ${u.telefono || ""} · Vence: ${finStr} - <span class="user-item__estado-inline user-item__estado-inline--${estado}">${estadoTexto}</span>
            </span>
            <div class="user-item__actions">
              ${linkWa}
              <button type="button" class="btn btn--renovar" data-user-id="${u.id}">Renovar</button>
              <button type="button" class="btn btn--eliminar" data-user-id="${u.id}">Eliminar</button>
            </div>
          </li>`;
        }
      )
      .join("");

    if (totalPaginas <= 1) {
      paginacion.hidden = true;
      paginacion.innerHTML = "";
    } else {
      paginacion.hidden = false;
      paginacion.innerHTML = `
        <button type="button" class="list-paginacion__btn" data-accion="prev" ${paginaUsuariosActual === 1 ? "disabled" : ""}>Anterior</button>
        <span class="list-paginacion__info">Página ${paginaUsuariosActual} de ${totalPaginas}</span>
        <button type="button" class="list-paginacion__btn" data-accion="next" ${paginaUsuariosActual === totalPaginas ? "disabled" : ""}>Siguiente</button>
      `;
    }
  }
}

async function eliminarUsuarioConPagos(usuarioId) {
  // Obtener información del usuario para mostrar su nombre
  const usuarios = window.__usuarios || [];
  const usuario = usuarios.find((u) => u.id === usuarioId);
  const nombreCompleto = usuario
    ? `${usuario.nombre || ""} ${usuario.apellido || ""}`.trim()
    : "este usuario";

  // Mostrar modal de confirmación personalizado
  const confirmar = await confirmarEliminacion(nombreCompleto);
  if (!confirmar) return;

  try {
    // Borrar pagos del usuario
    const q = query(collection(db, "pagos"), where("usuarioId", "==", usuarioId));
    const pagosSnap = await getDocs(q);
    const borrados = pagosSnap.docs.map((d) => deleteDoc(d.ref));
    await Promise.all(borrados);

    // Borrar el usuario
    await deleteDoc(doc(db, "usuarios", usuarioId));

    await init();

    // Mostrar mensaje de éxito (opcional)
    mostrarMensaje("mensajeNuevoUsuario", `✓ Usuario ${nombreCompleto} eliminado correctamente.`, "exito");
  } catch (err) {
    console.error("Error eliminando usuario:", err);
    mostrarMensaje("mensajeNuevoUsuario", "✗ No se pudo eliminar el usuario. Revisa la consola y las reglas de Firestore.", "error");
  }
}

async function rellenarCamposConInfoUsuario(usuarioId) {
  try {
    const usuarios = window.__usuarios || [];
    const usuario = usuarios.find((x) => x.id === usuarioId);
    if (!usuario) return;

    // 1) Prioridad: plan actual registrado en el usuario
    const selectPlan = document.getElementById("pagoPlanId");
    const planUsuario = usuario.membresiaActual || "";
    if (selectPlan && planUsuario) {
      const existePlanUsuario = Array.from(selectPlan.options).some((o) => o.value === planUsuario);
      if (existePlanUsuario) {
        selectPlan.value = planUsuario;
        // Dispara autocompletado de monto por precio del plan si aplica
        selectPlan.dispatchEvent(new Event("change"));
      }
    }

    // 2) Respaldo: último pago del usuario (si existe y se puede consultar)
    let ultimoPago = null;
    try {
      const q = query(
        collection(db, "pagos"),
        where("usuarioId", "==", usuarioId),
        orderBy("fechaPago", "desc")
      );
      const pagosSnap = await getDocs(q);
      if (!pagosSnap.empty) {
        ultimoPago = pagosSnap.docs[0].data();
      }
    } catch (errPagos) {
      console.warn("No se pudo leer último pago, se usa plan actual del usuario:", errPagos);
    }

    // Si el usuario no tiene membresíaActual válida, caer al último pago
    const planIdPreferido = (selectPlan && selectPlan.value) ? selectPlan.value : "";
    const planIdFallback = ultimoPago?.planId || "";
    if (selectPlan && !planIdPreferido && planIdFallback) {
      const existePlanFallback = Array.from(selectPlan.options).some((o) => o.value === planIdFallback);
      if (existePlanFallback) {
        selectPlan.value = planIdFallback;
        selectPlan.dispatchEvent(new Event("change"));
      }
    }

    // Rellenar Monto pagado: priorizar último monto pagado, si no hay, usar precio del plan
    const montoInput = document.getElementById("montoPagado");
    if (montoInput) {
      if (ultimoPago?.montoPagado) {
        // Si hay último pago, usar ese monto
        montoInput.value = ultimoPago.montoPagado;
      } else if (selectPlan?.value) {
        // Si no hay último pago pero hay plan, usar el precio del plan
        const opt = selectPlan?.selectedOptions[0];
        if (opt?.dataset.precio) {
          montoInput.value = opt.dataset.precio;
        }
      }
    }

    // Método de pago: por defecto Transferencia; si existe último pago, usar ese
    const metodoSelect = document.getElementById("metodoPago");
    if (metodoSelect) {
      metodoSelect.value = ultimoPago?.metodoPago || "Transferencia";
    }

    // La fecha de pago se mantiene como hoy (ya está configurada por defecto)
  } catch (err) {
    console.error("Error obteniendo información del usuario:", err);
    // Si hay error, no hacer nada, dejar los campos como están
  }
}

function irARenovarUsuario(usuarioId) {
  const usuarios = window.__usuarios || [];
  const u = usuarios.find((x) => x.id === usuarioId);
  if (!u) return;
  document.getElementById("pagoUsuarioId").value = u.id;
  document.getElementById("pagoUsuarioBuscar").value = `${u.nombre || ""} ${u.apellido || ""} · ${u.telefono || ""}`;
  showSection("registrar-pago");
  // Rellenar campos con la información del usuario
  rellenarCamposConInfoUsuario(u.id);
}

function filtrarUsuariosParaCombobox(usuarios, texto) {
  const t = normalizarTextoBusqueda(texto);
  if (!t) return usuarios;
  return usuarios.filter((u) => coincideBusquedaUsuario(u, t));
}

function abrirComboboxUsuarios(texto) {
  const usuarios = window.__usuarios || [];
  const filtrados = filtrarUsuariosParaCombobox(usuarios, texto);
  const dropdown = document.getElementById("comboboxDropdown");
  dropdown.innerHTML = "";
  dropdown.setAttribute("aria-hidden", "false");
  dropdown.classList.add("is-open");
  if (filtrados.length === 0) {
    dropdown.innerHTML = '<div class="combobox-empty">Sin resultados</div>';
    return;
  }
  filtrados.forEach((u) => {
    const opt = document.createElement("div");
    opt.setAttribute("role", "option");
    opt.dataset.userId = u.id;
    opt.innerHTML = `<span class="option-name">${u.nombre || ""} ${u.apellido || ""}</span><span class="option-meta">${u.telefono || ""}</span>`;
    opt.addEventListener("click", async () => {
      document.getElementById("pagoUsuarioId").value = u.id;
      document.getElementById("pagoUsuarioBuscar").value = `${u.nombre || ""} ${u.apellido || ""} · ${u.telefono || ""}`;
      dropdown.classList.remove("is-open");
      dropdown.setAttribute("aria-hidden", "true");
      // Rellenar campos automáticamente con la información del usuario
      await rellenarCamposConInfoUsuario(u.id);
    });
    dropdown.appendChild(opt);
  });
}

function cerrarComboboxUsuarios() {
  const dropdown = document.getElementById("comboboxDropdown");
  dropdown.classList.remove("is-open");
  dropdown.setAttribute("aria-hidden", "true");
}


// --- Dashboard ---
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function formatearTelefonoWhatsApp(telefono) {
  const digits = (telefono || "").replace(/\D/g, "");
  if (digits.length === 10) return "57" + digits;
  if (digits.length === 12 && digits.startsWith("57")) return digits;
  return digits || "";
}

function urlWhatsApp(telefono, mensaje) {
  const num = formatearTelefonoWhatsApp(telefono);
  if (!num) return "";
  const text = encodeURIComponent(mensaje || "");
  return `https://wa.me/${num}${text ? "?text=" + text : ""}`;
}

function nombreUsuarioSort(u) {
  return `${(u.nombre || "").trim()} ${(u.apellido || "").trim()}`.trim().toLowerCase();
}

function ordenarListaProximos(list) {
  const copy = [...list];
  if (sortProximosCol === "nombre") {
    copy.sort((a, b) => {
      const c = nombreUsuarioSort(a).localeCompare(nombreUsuarioSort(b), "es");
      return sortProximosDir === "asc" ? c : -c;
    });
  } else {
    copy.sort((a, b) => {
      const fa = a.fechaFinMembresia?.toDate?.()?.getTime() ?? 0;
      const fb = b.fechaFinMembresia?.toDate?.()?.getTime() ?? 0;
      return sortProximosDir === "asc" ? fa - fb : fb - fa;
    });
  }
  return copy;
}

function ordenarListaVencidos(list) {
  const copy = [...list];
  if (sortVencidosCol === "nombre") {
    copy.sort((a, b) => {
      const c = nombreUsuarioSort(a).localeCompare(nombreUsuarioSort(b), "es");
      return sortVencidosDir === "asc" ? c : -c;
    });
  } else {
    copy.sort((a, b) => {
      const fa = a.fechaFinMembresia?.toDate?.()?.getTime() ?? 0;
      const fb = b.fechaFinMembresia?.toDate?.()?.getTime() ?? 0;
      return sortVencidosDir === "asc" ? fa - fb : fb - fa;
    });
  }
  return copy;
}

function actualizarIndicadoresEncabezados(tabla) {
  const colActiva = tabla === "proximos" ? sortProximosCol : sortVencidosCol;
  const dirActiva = tabla === "proximos" ? sortProximosDir : sortVencidosDir;
  document.querySelectorAll(`[data-sort-tabla="${tabla}"]`).forEach((btn) => {
    const col = btn.dataset.sortCol;
    const hint = btn.querySelector(".data-table__sort-hint");
    const active = colActiva === col;
    btn.classList.toggle("is-active", active);
    if (!active) {
      if (hint) hint.textContent = "";
      btn.removeAttribute("aria-sort");
      return;
    }
    if (col === "nombre") {
      if (hint) hint.textContent = dirActiva === "asc" ? "A→Z" : "Z→A";
      btn.setAttribute("aria-sort", dirActiva === "asc" ? "ascending" : "descending");
      btn.title = dirActiva === "asc" ? "Orden: A a Z" : "Orden: Z a A";
    } else {
      if (hint) hint.textContent = dirActiva === "asc" ? "Antes" : "Después";
      btn.setAttribute("aria-sort", dirActiva === "asc" ? "ascending" : "descending");
      if (tabla === "proximos") {
        btn.title =
          dirActiva === "asc"
            ? "Orden: vence antes (más cercano)"
            : "Orden: vence después (más lejano en estos 7 días)";
      } else {
        btn.title =
          dirActiva === "asc"
            ? "Orden: venció antes (más tiempo atrás)"
            : "Orden: venció más recientemente";
      }
    }
  });
}

function renderVencidosPaginados(vencidosList) {
  const tbodyVencidos = document.getElementById("tbodyVencidos");
  const paginacion = document.getElementById("paginacionVencidos");
  if (!tbodyVencidos || !paginacion) return;

  if (vencidosList.length === 0) {
    tbodyVencidos.innerHTML =
      "<tr><td colspan=\"4\" class=\"data-table__empty\">Ninguno.</td></tr>";
    paginacion.hidden = true;
    paginacion.innerHTML = "";
    return;
  }

  const texto = normalizarTextoBusqueda(filtroVencidosInicio);
  const filtrados = texto
    ? vencidosList.filter((u) => coincideBusquedaUsuario(u, texto))
    : vencidosList;

  if (filtrados.length === 0) {
    tbodyVencidos.innerHTML =
      "<tr><td colspan=\"4\" class=\"data-table__empty\">No hay vencidos que coincidan con la búsqueda.</td></tr>";
    paginacion.hidden = true;
    paginacion.innerHTML = "";
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / vencidosPorPagina));
  if (paginaVencidosActual > totalPaginas) paginaVencidosActual = totalPaginas;
  if (paginaVencidosActual < 1) paginaVencidosActual = 1;

  const inicio = (paginaVencidosActual - 1) * vencidosPorPagina;
  const fin = inicio + vencidosPorPagina;
  const ordenados = ordenarListaVencidos(filtrados);
  const visibles = ordenados.slice(inicio, fin);

  const nombreCompleto = (u) =>
    `${(u.nombre || "").trim()} ${(u.apellido || "").trim()}`.trim() || "—";

  tbodyVencidos.innerHTML = visibles
    .map((u) => {
      const finFecha = u.fechaFinMembresia?.toDate?.();
      const finStr = finFecha ? finFecha.toLocaleDateString("es") : "";
      const msg = `Hola ${(u.nombre || "").trim()}, tu membresía en Radical Training venció el ${finStr}. ¡Te esperamos para seguir entrenando!`;
      const wa = urlWhatsApp(u.telefono, msg);
      const linkWa = wa
        ? `<a href="${wa}" target="_blank" rel="noopener" class="link-whatsapp" title="Abrir WhatsApp"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i><span class="visually-hidden">WhatsApp</span></a>`
        : "—";
      return `<tr>
        <td class="data-table__usuario" data-label="Usuario">${nombreCompleto(u)}</td>
        <td class="data-table__fecha" data-label="Fecha de vencimiento">${finStr}</td>
        <td class="data-table__contacto" data-label="Contacto">${linkWa}</td>
        <td class="data-table__acciones" data-label="Acciones"><button type="button" class="btn btn--renovar btn--small" data-user-id="${u.id}">Renovar</button></td>
      </tr>`;
    })
    .join("");

  if (totalPaginas <= 1) {
    paginacion.hidden = true;
    paginacion.innerHTML = "";
    return;
  }

  paginacion.hidden = false;
  paginacion.innerHTML = `
    <button type="button" class="list-paginacion__btn" data-accion="prev" ${paginaVencidosActual === 1 ? "disabled" : ""}>Anterior</button>
    <span class="list-paginacion__info">Página ${paginaVencidosActual} de ${totalPaginas}</span>
    <button type="button" class="list-paginacion__btn" data-accion="next" ${paginaVencidosActual === totalPaginas ? "disabled" : ""}>Siguiente</button>
  `;
}

function renderProximosPaginados(proximosVencer) {
  const tbodyProximos = document.getElementById("tbodyProximosVencer");
  const paginacion = document.getElementById("paginacionProximos");
  if (!tbodyProximos || !paginacion) return;
  const porPagina = proximosPorPagina;

  if (proximosVencer.length === 0) {
    tbodyProximos.innerHTML =
      "<tr><td colspan=\"3\" class=\"data-table__empty\">Ninguno en los próximos 7 días.</td></tr>";
    paginacion.hidden = true;
    paginacion.innerHTML = "";
    return;
  }

  const texto = normalizarTextoBusqueda(filtroProximosInicio);
  const filtrados = texto
    ? proximosVencer.filter((u) => coincideBusquedaUsuario(u, texto))
    : proximosVencer;

  if (filtrados.length === 0) {
    tbodyProximos.innerHTML =
      "<tr><td colspan=\"3\" class=\"data-table__empty\">No hay próximos a vencer que coincidan con la búsqueda.</td></tr>";
    paginacion.hidden = true;
    paginacion.innerHTML = "";
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / porPagina));
  if (paginaProximosActual > totalPaginas) paginaProximosActual = totalPaginas;
  if (paginaProximosActual < 1) paginaProximosActual = 1;

  const ordenados = ordenarListaProximos(filtrados);
  const inicio = (paginaProximosActual - 1) * porPagina;
  const fin = inicio + porPagina;
  const visibles = ordenados.slice(inicio, fin);

  const nombreCompleto = (u) =>
    `${(u.nombre || "").trim()} ${(u.apellido || "").trim()}`.trim() || "—";

  tbodyProximos.innerHTML = visibles
    .map((u) => {
      const finFecha = u.fechaFinMembresia?.toDate?.();
      const finStr = finFecha ? finFecha.toLocaleDateString("es") : "";
      const msg = `Hola ${(u.nombre || "").trim()}, tu membresía en Radical Training vence el ${finStr}. ¡Te esperamos para seguir entrenando!`;
      const wa = urlWhatsApp(u.telefono, msg);
      const linkWa = wa
        ? `<a href="${wa}" target="_blank" rel="noopener" class="link-whatsapp" title="Abrir WhatsApp"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i><span class="visually-hidden">WhatsApp</span></a>`
        : "—";
      return `<tr>
        <td class="data-table__usuario" data-label="Usuario">${nombreCompleto(u)}</td>
        <td class="data-table__fecha" data-label="Fecha de vencimiento">${finStr}</td>
        <td class="data-table__contacto" data-label="Contacto">${linkWa}</td>
      </tr>`;
    })
    .join("");

  if (totalPaginas <= 1) {
    paginacion.hidden = true;
    paginacion.innerHTML = "";
    return;
  }

  paginacion.hidden = false;
  paginacion.innerHTML = `
    <button type="button" class="list-paginacion__btn" data-accion="prev" ${paginaProximosActual === 1 ? "disabled" : ""}>Anterior</button>
    <span class="list-paginacion__info">Página ${paginaProximosActual} de ${totalPaginas}</span>
    <button type="button" class="list-paginacion__btn" data-accion="next" ${paginaProximosActual === totalPaginas ? "disabled" : ""}>Siguiente</button>
  `;
}

function actualizarDashboard(usuarios) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const en7Dias = addDays(hoy, 7);

  // Calcular membresías activas: aquellas cuya fecha de fin es hoy o después
  const activos = usuarios.filter((u) => {
    const fin = u.fechaFinMembresia?.toDate?.();
    return fin && fin >= hoy;
  });

  // Calcular membresías vencidas: aquellas cuya fecha de fin ya pasó
  const vencidosList = usuarios.filter((u) => {
    const fin = u.fechaFinMembresia?.toDate?.();
    return fin && fin < hoy;
  });

  // Próximos a vencer en los siguientes 7 días (el orden lo define ordenarListaProximos)
  const proximosVencer = activos.filter((u) => {
    const fin = u.fechaFinMembresia?.toDate?.() || new Date(0);
    return fin >= hoy && fin <= en7Dias;
  });

  document.getElementById("countActivos").textContent = activos.length;
  document.getElementById("countVencidas").textContent = vencidosList.length;

  renderProximosPaginados(proximosVencer);
  renderVencidosPaginados(vencidosList);
  actualizarIndicadoresEncabezados("proximos");
  actualizarIndicadoresEncabezados("vencidos");
  actualizarEstadoMenuFiltrosProximos();
  actualizarEstadoMenuFiltrosVencidos();
}

function toDateSafe(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatearCOP(valor) {
  return "$" + Number(valor || 0).toLocaleString("es-CO", { maximumFractionDigits: 0 });
}

function formatearCOPCompacto(valor) {
  const n = Number(valor || 0);
  const abs = Math.abs(n);
  if (abs >= 1000000) {
    return `$${(n / 1000000).toLocaleString("es-CO", { maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1000) {
    return `$${(n / 1000).toLocaleString("es-CO", { maximumFractionDigits: 0 })}k`;
  }
  return formatearCOP(n);
}

function limpiarTextoGrafico(selector, texto) {
  const el = document.querySelector(selector);
  if (el) {
    el.innerHTML = `<p class="empty">${texto}</p>`;
  }
}

function descargarImagenGrafico(chart, nombreBase) {
  if (!chart || typeof chart.dataURI !== "function") {
    alert("El gráfico aún no está listo para exportar.");
    return;
  }
  chart.dataURI().then(({ imgURI }) => {
    const stamp = `${aIsoFechaLocal(new Date())}_${Date.now().toString(36).slice(-4)}`;
    const safe = String(nombreBase || "grafico")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const link = document.createElement("a");
    link.href = imgURI;
    link.download = `${safe || "grafico"}-${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }).catch(() => {
    alert("No se pudo exportar la imagen del gráfico.");
  });
}

function inicializarMenuExportGrafico(toggleId, menuId) {
  const toggle = document.getElementById(toggleId);
  const menu = document.getElementById(menuId);
  if (!toggle || !menu) return null;
  const abrir = () => {
    menu.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
  };
  const cerrar = () => {
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
  };
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) abrir();
    else cerrar();
  });
  menu.addEventListener("click", () => {
    cerrar();
  });
  return { toggle, menu, cerrar };
}

function obtenerTituloPeriodoIngresos(filtro, mesesCalculados) {
  if (filtro === "all") {
    return mesesCalculados <= 1 ? "Ingresos del histórico" : `Ingresos del histórico (${mesesCalculados} meses)`;
  }
  const meses = Number(filtro || 6);
  if (meses === 1) return "Ingresos del último mes";
  if (meses === 12) return "Ingresos del último año";
  return `Ingresos últimos ${meses} meses`;
}

function aIsoFechaLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
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

/**
 * Construye buckets { key, label, inicio, fin } para el gráfico de ingresos en un rango personalizado.
 * Hasta 62 días: por día; hasta 400 días: por semanas de 7 días; más: por mes calendario (máx. 5 años).
 */
function construirBucketsIngresosRango(desdeStr, hastaStr) {
  const desde = parseFechaInput(desdeStr);
  const hasta = parseFechaInput(hastaStr);
  if (!desde || !hasta) {
    return { error: "Indica fecha «Desde» y «Hasta».", buckets: [], desde0: null, hastaEnd: null, agrupacion: null };
  }
  if (desde > hasta) {
    return { error: "«Desde» no puede ser posterior a «Hasta».", buckets: [], desde0: null, hastaEnd: null, agrupacion: null };
  }
  const desde0 = startOfDay(desde);
  const hastaEnd = endOfDay(hasta);
  const spanMs = hastaEnd.getTime() - desde0.getTime();
  const spanDays = Math.floor(spanMs / 86400000) + 1;
  if (spanDays > 365 * 5) {
    return { error: "El rango máximo es 5 años. Reduce el intervalo.", buckets: [], desde0, hastaEnd, agrupacion: null };
  }

  const buckets = [];
  if (spanDays <= 62) {
    for (let d = new Date(desde0); d <= hastaEnd; d.setDate(d.getDate() + 1)) {
      const inicio = startOfDay(d);
      const fin = endOfDay(d);
      const key = `${inicio.getFullYear()}-${String(inicio.getMonth() + 1).padStart(2, "0")}-${String(inicio.getDate()).padStart(2, "0")}`;
      const label = inicio.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
      buckets.push({ key, label, inicio, fin });
    }
  } else if (spanDays <= 400) {
    let d = new Date(desde0);
    while (d <= hastaEnd) {
      const inicio = startOfDay(d);
      const finDate = new Date(d);
      finDate.setDate(finDate.getDate() + 6);
      const finLim = finDate > hastaEnd ? new Date(hastaEnd) : finDate;
      const fin = endOfDay(finLim);
      const key = `w-${inicio.getFullYear()}-${inicio.getMonth() + 1}-${inicio.getDate()}`;
      const label = `${inicio.toLocaleDateString("es-CO", { day: "numeric", month: "short" })} – ${finLim.toLocaleDateString("es-CO", { day: "numeric", month: "short" })}`;
      buckets.push({ key, label, inicio, fin });
      d.setDate(d.getDate() + 7);
    }
  } else {
    let cur = new Date(desde0.getFullYear(), desde0.getMonth(), 1);
    while (cur <= hastaEnd) {
      const monthStart = startOfDay(cur);
      const monthEnd = endOfDay(new Date(cur.getFullYear(), cur.getMonth() + 1, 0));
      const inicio = monthStart < desde0 ? new Date(desde0) : monthStart;
      const fin = monthEnd > hastaEnd ? new Date(hastaEnd) : monthEnd;
      if (inicio <= fin) {
        const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`;
        const label = cur.toLocaleDateString("es-CO", { month: "long", year: "numeric" });
        buckets.push({ key, label, inicio: startOfDay(inicio), fin: endOfDay(fin) });
      }
      cur.setMonth(cur.getMonth() + 1);
      cur.setDate(1);
    }
  }

  const agrupacion = spanDays <= 62 ? "día" : spanDays <= 400 ? "semana" : "mes";
  return { error: null, buckets, desde0, hastaEnd, agrupacion };
}

function agregarIngresosPorBuckets(pagos, buckets, desde0, hastaEnd) {
  const totals = {};
  buckets.forEach((b) => {
    totals[b.key] = 0;
  });
  pagos.forEach((p) => {
    const fecha = toDateSafe(p.fechaPago);
    if (!fecha || fecha < desde0 || fecha > hastaEnd) return;
    for (let i = 0; i < buckets.length; i += 1) {
      const b = buckets[i];
      if (fecha >= b.inicio && fecha <= b.fin) {
        totals[b.key] += Number(p.montoPagado || 0);
        break;
      }
    }
  });
  return buckets.map((b) => totals[b.key] || 0);
}

function bucketsDesdeMesesPreset(hoy, cantidadMeses) {
  const meses = construirRangoMeses(hoy, cantidadMeses);
  return meses.map((m) => {
    const [yy, mm] = m.key.split("-").map(Number);
    const inicio = startOfDay(new Date(yy, mm - 1, 1));
    const fin = endOfDay(new Date(yy, mm, 0));
    return { key: m.key, label: m.label, inicio, fin };
  });
}

function construirRangoPlanes(desdeStr, hastaStr) {
  const desde = parseFechaInput(desdeStr);
  const hasta = parseFechaInput(hastaStr);
  if (!desde || !hasta) {
    return { error: "Indica fecha «Desde» y «Hasta».", desde0: null, hastaEnd: null, titulo: "" };
  }
  if (desde > hasta) {
    return { error: "«Desde» no puede ser posterior a «Hasta».", desde0: null, hastaEnd: null, titulo: "" };
  }
  const desde0 = startOfDay(desde);
  const hastaEnd = endOfDay(hasta);
  const spanDays = Math.floor((hastaEnd - desde0) / 86400000) + 1;
  if (spanDays > 365 * 5) {
    return { error: "El rango máximo es 5 años. Reduce el intervalo.", desde0: null, hastaEnd: null, titulo: "" };
  }
  const titulo = `Planes más vendidos del ${desde.toLocaleDateString("es-CO")} al ${hasta.toLocaleDateString("es-CO")}`;
  return { error: null, desde0, hastaEnd, titulo };
}

function resolverRangoPorPeriodo(filtro, hoy, desdeStr = "", hastaStr = "", tituloBase = "") {
  if (filtro === "custom") {
    const custom = construirRangoPlanes(desdeStr, hastaStr);
    if (custom.error) {
      return { error: custom.error, desde0: null, hastaEnd: null, titulo: tituloBase };
    }
    return {
      error: null,
      desde0: custom.desde0,
      hastaEnd: custom.hastaEnd,
      titulo: `${tituloBase} del ${parseFechaInput(desdeStr).toLocaleDateString("es-CO")} al ${parseFechaInput(hastaStr).toLocaleDateString("es-CO")}`,
    };
  }
  const meses = Number(filtro || 1);
  const inicio = new Date(hoy);
  inicio.setMonth(inicio.getMonth() - meses + 1);
  inicio.setDate(1);
  const desde0 = startOfDay(inicio);
  const hastaEnd = endOfDay(hoy);
  const titulo = meses === 12
    ? `${tituloBase} (último año)`
    : `${tituloBase} (último mes)`;
  return { error: null, desde0, hastaEnd, titulo };
}

function calcularMesesHistoricos(pagos, hoy) {
  const fechas = pagos
    .map((p) => toDateSafe(p.fechaPago))
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (fechas.length === 0) return 1;
  const primera = fechas[0];
  const diffYears = hoy.getFullYear() - primera.getFullYear();
  const diffMonths = hoy.getMonth() - primera.getMonth();
  const total = diffYears * 12 + diffMonths + 1;
  return Math.max(1, total);
}

function construirRangoMeses(hoy, cantidadMeses) {
  const meses = [];
  for (let i = cantidadMeses - 1; i >= 0; i -= 1) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("es-CO", { month: "short", year: "2-digit" }),
    });
  }
  return meses;
}

function renderDashboardCharts(usuarios, pagos, planes) {
  if (typeof ApexCharts === "undefined") {
    limpiarTextoGrafico("#chartEstadoMembresias", "No se pudo cargar ApexCharts.");
    limpiarTextoGrafico("#chartMetodosPago", "No se pudo cargar ApexCharts.");
    limpiarTextoGrafico("#chartIngresosMensuales", "No se pudo cargar ApexCharts.");
    limpiarTextoGrafico("#chartPlanesVendidos", "No se pudo cargar ApexCharts.");
    return;
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59, 999);

  const errEstado = document.getElementById("estadoRangoError");
  if (errEstado) {
    errEstado.hidden = true;
    errEstado.textContent = "";
  }
  const rangoEstado = resolverRangoPorPeriodo(
    filtroEstadoPeriodo,
    hoy,
    document.getElementById("estadoFechaDesde")?.value || "",
    document.getElementById("estadoFechaHasta")?.value || "",
    "Activos vs vencidos"
  );
  if (rangoEstado.error && errEstado) {
    errEstado.textContent = rangoEstado.error;
    errEstado.hidden = false;
  }
  const pagosEstado = pagos.filter((p) => {
    const fecha = toDateSafe(p.fechaPago);
    if (!fecha || !rangoEstado.desde0 || !rangoEstado.hastaEnd) return false;
    return fecha >= rangoEstado.desde0 && fecha <= rangoEstado.hastaEnd;
  });
  const idsEstado = new Set(pagosEstado.map((p) => p.usuarioId).filter(Boolean));
  const usuariosEstado = usuarios.filter((u) => idsEstado.has(u.id));
  const corteEstado = rangoEstado.hastaEnd || hoy;
  const activos = usuariosEstado.filter((u) => {
    const fin = toDateSafe(u.fechaFinMembresia);
    return fin && fin >= corteEstado;
  }).length;
  const vencidos = usuariosEstado.filter((u) => {
    const fin = toDateSafe(u.fechaFinMembresia);
    return fin && fin < corteEstado;
  }).length;

  const tituloChartEstado = document.getElementById("tituloChartEstado");
  if (tituloChartEstado) tituloChartEstado.textContent = rangoEstado.titulo || "Activos vs vencidos";

  const pagosMes = pagos.filter((p) => {
    const fecha = toDateSafe(p.fechaPago);
    return fecha && fecha >= inicioMes && fecha <= finMes;
  });
  const ingresoMes = pagosMes.reduce((acc, p) => acc + Number(p.montoPagado || 0), 0);
  const ticketPromedio = pagosMes.length ? ingresoMes / pagosMes.length : 0;

  const kpiActivos = document.getElementById("kpiActivos");
  const kpiVencidos = document.getElementById("kpiVencidos");
  const kpiIngresoMes = document.getElementById("kpiIngresoMes");
  const kpiTicketPromedio = document.getElementById("kpiTicketPromedio");
  if (kpiActivos) kpiActivos.textContent = activos;
  if (kpiVencidos) kpiVencidos.textContent = vencidos;
  if (kpiIngresoMes) kpiIngresoMes.textContent = formatearCOP(ingresoMes);
  if (kpiTicketPromedio) kpiTicketPromedio.textContent = formatearCOP(ticketPromedio);

  const palette = ["#6d7c3d", "#c94a4a", "#e8e4dc", "#8fa15a", "#7d8c4a"];

  if (chartEstadoMembresias) chartEstadoMembresias.destroy();
  chartEstadoMembresias = new ApexCharts(document.querySelector("#chartEstadoMembresias"), {
    chart: { type: "donut", height: 300, toolbar: { show: false } },
    series: [activos, vencidos],
    labels: ["Activos", "Vencidos"],
    colors: [palette[0], palette[1]],
    legend: { labels: { colors: "#e8e4dc" } },
    dataLabels: { enabled: true },
    theme: { mode: "dark" },
  });
  chartEstadoMembresias.render();

  const errMetodos = document.getElementById("metodosRangoError");
  if (errMetodos) {
    errMetodos.hidden = true;
    errMetodos.textContent = "";
  }
  const rangoMetodos = resolverRangoPorPeriodo(
    filtroMetodosPeriodo,
    hoy,
    document.getElementById("metodosFechaDesde")?.value || "",
    document.getElementById("metodosFechaHasta")?.value || "",
    "Métodos de pago"
  );
  if (rangoMetodos.error && errMetodos) {
    errMetodos.textContent = rangoMetodos.error;
    errMetodos.hidden = false;
  }
  const pagosMetodos = pagos.filter((p) => {
    const fecha = toDateSafe(p.fechaPago);
    if (!fecha || !rangoMetodos.desde0 || !rangoMetodos.hastaEnd) return false;
    return fecha >= rangoMetodos.desde0 && fecha <= rangoMetodos.hastaEnd;
  });
  const conteoMetodos = pagosMetodos.reduce((acc, p) => {
    const metodo = p.metodoPago || "Sin definir";
    acc[metodo] = (acc[metodo] || 0) + 1;
    return acc;
  }, {});
  const metodosLabels = Object.keys(conteoMetodos);
  const metodosSeries = metodosLabels.map((k) => conteoMetodos[k]);
  const tituloChartMetodos = document.getElementById("tituloChartMetodos");
  if (tituloChartMetodos) tituloChartMetodos.textContent = rangoMetodos.titulo || "Métodos de pago";

  if (chartMetodosPago) chartMetodosPago.destroy();
  chartMetodosPago = new ApexCharts(document.querySelector("#chartMetodosPago"), {
    chart: { type: "pie", height: 300, toolbar: { show: false } },
    series: metodosSeries.length ? metodosSeries : [1],
    labels: metodosLabels.length ? metodosLabels : ["Sin datos"],
    colors: [palette[0], palette[2], palette[4], "#4a5528"],
    legend: { labels: { colors: "#e8e4dc" } },
    dataLabels: { enabled: true },
    theme: { mode: "dark" },
  });
  chartMetodosPago.render();

  const errRango = document.getElementById("ingresosRangoError");
  if (errRango) {
    errRango.hidden = true;
    errRango.textContent = "";
  }

  let bucketsIngresos = [];
  let tituloIngresos = "";
  let desdeIngresos = null;
  let hastaIngresos = null;

  if (filtroIngresosPeriodo === "custom") {
    const desdeStr = document.getElementById("ingresoFechaDesde")?.value || "";
    const hastaStr = document.getElementById("ingresoFechaHasta")?.value || "";
    const rango = construirBucketsIngresosRango(desdeStr, hastaStr);
    if (rango.error) {
      if (errRango) {
        errRango.textContent = rango.error;
        errRango.hidden = false;
      }
      bucketsIngresos = [];
    } else {
      bucketsIngresos = rango.buckets;
      desdeIngresos = rango.desde0;
      hastaIngresos = rango.hastaEnd;
      const d0 = parseFechaInput(desdeStr);
      const d1 = parseFechaInput(hastaStr);
      tituloIngresos = `Ingresos del ${d0.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })} al ${d1.toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })} (por ${rango.agrupacion})`;
    }
  } else {
    const mesesHistoricos = filtroIngresosPeriodo === "all"
      ? calcularMesesHistoricos(pagos, hoy)
      : Number(filtroIngresosPeriodo || 6);
    bucketsIngresos = bucketsDesdeMesesPreset(hoy, mesesHistoricos);
    desdeIngresos = bucketsIngresos.length ? bucketsIngresos[0].inicio : hoy;
    hastaIngresos = bucketsIngresos.length ? bucketsIngresos[bucketsIngresos.length - 1].fin : hoy;
    tituloIngresos = obtenerTituloPeriodoIngresos(filtroIngresosPeriodo, mesesHistoricos);
  }

  const tituloChartIngresos = document.getElementById("tituloChartIngresos");
  if (tituloChartIngresos) {
    tituloChartIngresos.textContent = tituloIngresos || "Ingresos";
  }

  const ingresosRangoOk = Boolean(bucketsIngresos.length && desdeIngresos && hastaIngresos);
  const datosIngresos = ingresosRangoOk
    ? agregarIngresosPorBuckets(pagos, bucketsIngresos, desdeIngresos, hastaIngresos)
    : [0];
  const categoriasIngresos = ingresosRangoOk
    ? bucketsIngresos.map((b) => b.label)
    : ["Sin rango válido"];
  const esMobileGrafico = window.matchMedia("(max-width: 640px)").matches;
  const demasiadasBarras = categoriasIngresos.length >= 6;
  const mostrarDataLabels = !esMobileGrafico && !demasiadasBarras;

  if (chartIngresosMensuales) chartIngresosMensuales.destroy();
  chartIngresosMensuales = new ApexCharts(document.querySelector("#chartIngresosMensuales"), {
    chart: { type: "bar", height: 320, toolbar: { show: false } },
    plotOptions: {
      bar: {
        borderRadius: 4,
        columnWidth: esMobileGrafico ? "58%" : "45%",
      },
    },
    series: [{ name: "Ingresos", data: datosIngresos }],
    xaxis: {
      categories: categoriasIngresos,
      labels: {
        rotate: esMobileGrafico ? -40 : -28,
        rotateAlways: esMobileGrafico || demasiadasBarras,
        hideOverlappingLabels: true,
        trim: true,
        style: { colors: "#9a958a", fontSize: esMobileGrafico ? "10px" : "12px" },
      },
    },
    yaxis: {
      labels: {
        style: { colors: "#9a958a" },
        formatter: (v) => formatearCOPCompacto(v),
      },
    },
    tooltip: {
      y: { formatter: (v) => formatearCOP(v) },
    },
    dataLabels: {
      enabled: mostrarDataLabels,
      formatter: (v) => formatearCOPCompacto(v),
      style: {
        colors: ["#ffffff"],
      },
    },
    colors: [palette[0]],
    theme: { mode: "dark" },
  });
  chartIngresosMensuales.render();

  const errPlanes = document.getElementById("planesRangoError");
  if (errPlanes) {
    errPlanes.hidden = true;
    errPlanes.textContent = "";
  }
  let desdePlanes = null;
  let hastaPlanes = null;
  let tituloPlanes = "";
  if (filtroPlanesPeriodo === "custom") {
    const desdeStr = document.getElementById("planesFechaDesde")?.value || "";
    const hastaStr = document.getElementById("planesFechaHasta")?.value || "";
    const rangoPlanes = construirRangoPlanes(desdeStr, hastaStr);
    if (rangoPlanes.error) {
      if (errPlanes) {
        errPlanes.textContent = rangoPlanes.error;
        errPlanes.hidden = false;
      }
    } else {
      desdePlanes = rangoPlanes.desde0;
      hastaPlanes = rangoPlanes.hastaEnd;
      tituloPlanes = rangoPlanes.titulo;
    }
  } else {
    const meses = Number(filtroPlanesPeriodo || 1);
    const inicio = new Date(hoy);
    inicio.setMonth(inicio.getMonth() - meses + 1);
    inicio.setDate(1);
    desdePlanes = startOfDay(inicio);
    hastaPlanes = endOfDay(hoy);
    tituloPlanes = meses === 12 ? "Planes más vendidos (último año)" : "Planes más vendidos (último mes)";
  }

  const tituloChartPlanesVendidos = document.getElementById("tituloChartPlanesVendidos");
  if (tituloChartPlanesVendidos) {
    tituloChartPlanesVendidos.textContent = tituloPlanes || "Planes más vendidos";
  }

  const nombresPlan = planes.reduce((acc, p) => {
    acc[p.id] = p.nombre || p.id;
    return acc;
  }, {});
  const pagosPlanes = pagos.filter((p) => {
    const fecha = toDateSafe(p.fechaPago);
    if (!fecha || !desdePlanes || !hastaPlanes) return false;
    return fecha >= desdePlanes && fecha <= hastaPlanes;
  });
  const conteoPlanes = pagosPlanes.reduce((acc, p) => {
    const nombre = nombresPlan[p.planId] || p.planId || "Sin plan";
    acc[nombre] = (acc[nombre] || 0) + 1;
    return acc;
  }, {});
  const topPlanes = Object.entries(conteoPlanes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  if (chartPlanesVendidos) chartPlanesVendidos.destroy();
  chartPlanesVendidos = new ApexCharts(document.querySelector("#chartPlanesVendidos"), {
    chart: { type: "bar", height: 320, toolbar: { show: false } },
    plotOptions: { bar: { horizontal: true, borderRadius: 4 } },
    series: [{ name: "Pagos", data: topPlanes.length ? topPlanes.map((p) => p[1]) : [0] }],
    xaxis: {
      categories: topPlanes.length ? topPlanes.map((p) => p[0]) : ["Sin datos en el período"],
      labels: { style: { colors: "#9a958a" } },
    },
    yaxis: { labels: { style: { colors: "#9a958a" } } },
    colors: [palette[4]],
    dataLabels: { enabled: true },
    theme: { mode: "dark" },
  });
  chartPlanesVendidos.render();
}

function actualizarPanelRangoIngresosCustom() {
  const selectPeriodo = document.getElementById("filtroIngresosPeriodo");
  const panel = document.getElementById("ingresosRangoPersonalizado");
  if (!selectPeriodo || !panel) return;
  const esCustom = selectPeriodo.value === "custom";
  panel.hidden = !esCustom;
  if (esCustom) {
    const desdeIn = document.getElementById("ingresoFechaDesde");
    const hastaIn = document.getElementById("ingresoFechaHasta");
    if (desdeIn && hastaIn && (!desdeIn.value || !hastaIn.value)) {
      const h = new Date();
      h.setHours(0, 0, 0, 0);
      hastaIn.value = aIsoFechaLocal(h);
      const d = new Date(h);
      d.setDate(d.getDate() - 14);
      desdeIn.value = aIsoFechaLocal(d);
    }
  }
}

function actualizarPanelRangoPlanesCustom() {
  const selectPeriodo = document.getElementById("filtroPlanesPeriodo");
  const panel = document.getElementById("planesRangoPersonalizado");
  if (!selectPeriodo || !panel) return;
  const esCustom = selectPeriodo.value === "custom";
  panel.hidden = !esCustom;
  if (esCustom) {
    const desdeIn = document.getElementById("planesFechaDesde");
    const hastaIn = document.getElementById("planesFechaHasta");
    if (desdeIn && hastaIn && (!desdeIn.value || !hastaIn.value)) {
      const h = new Date();
      h.setHours(0, 0, 0, 0);
      hastaIn.value = aIsoFechaLocal(h);
      const d = new Date(h);
      d.setDate(d.getDate() - 29);
      desdeIn.value = aIsoFechaLocal(d);
    }
  }
}

function actualizarPanelRangoCustomGenerico(selectId, panelId, desdeId, hastaId, diasPorDefecto = 29) {
  const select = document.getElementById(selectId);
  const panel = document.getElementById(panelId);
  if (!select || !panel) return;
  const esCustom = select.value === "custom";
  panel.hidden = !esCustom;
  if (!esCustom) return;
  const desdeIn = document.getElementById(desdeId);
  const hastaIn = document.getElementById(hastaId);
  if (desdeIn && hastaIn && (!desdeIn.value || !hastaIn.value)) {
    const h = new Date();
    h.setHours(0, 0, 0, 0);
    hastaIn.value = aIsoFechaLocal(h);
    const d = new Date(h);
    d.setDate(d.getDate() - diasPorDefecto);
    desdeIn.value = aIsoFechaLocal(d);
  }
}

function inicializarFiltrosDashboard() {
  if (dashboardFiltrosInicializados) return;
  const selectPeriodoIngresos = document.getElementById("filtroIngresosPeriodo");
  const selectPeriodoEstado = document.getElementById("filtroEstadoPeriodo");
  const selectPeriodoMetodos = document.getElementById("filtroMetodosPeriodo");
  const selectPeriodoPlanes = document.getElementById("filtroPlanesPeriodo");
  if (!selectPeriodoIngresos || !selectPeriodoEstado || !selectPeriodoMetodos || !selectPeriodoPlanes) return;
  selectPeriodoIngresos.value = filtroIngresosPeriodo;
  selectPeriodoEstado.value = filtroEstadoPeriodo;
  selectPeriodoMetodos.value = filtroMetodosPeriodo;
  selectPeriodoPlanes.value = filtroPlanesPeriodo;
  actualizarPanelRangoIngresosCustom();
  actualizarPanelRangoCustomGenerico("filtroEstadoPeriodo", "estadoRangoPersonalizado", "estadoFechaDesde", "estadoFechaHasta");
  actualizarPanelRangoCustomGenerico("filtroMetodosPeriodo", "metodosRangoPersonalizado", "metodosFechaDesde", "metodosFechaHasta");
  actualizarPanelRangoPlanesCustom();
  selectPeriodoIngresos.addEventListener("change", () => {
    filtroIngresosPeriodo = selectPeriodoIngresos.value;
    actualizarPanelRangoIngresosCustom();
    renderDashboardCharts(usuarios, pagos, planes);
  });
  selectPeriodoEstado.addEventListener("change", () => {
    filtroEstadoPeriodo = selectPeriodoEstado.value;
    actualizarPanelRangoCustomGenerico("filtroEstadoPeriodo", "estadoRangoPersonalizado", "estadoFechaDesde", "estadoFechaHasta");
    renderDashboardCharts(usuarios, pagos, planes);
  });
  selectPeriodoMetodos.addEventListener("change", () => {
    filtroMetodosPeriodo = selectPeriodoMetodos.value;
    actualizarPanelRangoCustomGenerico("filtroMetodosPeriodo", "metodosRangoPersonalizado", "metodosFechaDesde", "metodosFechaHasta");
    renderDashboardCharts(usuarios, pagos, planes);
  });
  selectPeriodoPlanes.addEventListener("change", () => {
    filtroPlanesPeriodo = selectPeriodoPlanes.value;
    actualizarPanelRangoPlanesCustom();
    renderDashboardCharts(usuarios, pagos, planes);
  });
  const btnAplicar = document.getElementById("btnAplicarRangoIngresos");
  if (btnAplicar) {
    btnAplicar.addEventListener("click", () => {
      if (document.getElementById("filtroIngresosPeriodo")?.value === "custom") {
        renderDashboardCharts(usuarios, pagos, planes);
      }
    });
  }
  const btnAplicarPlanes = document.getElementById("btnAplicarRangoPlanes");
  if (btnAplicarPlanes) {
    btnAplicarPlanes.addEventListener("click", () => {
      if (document.getElementById("filtroPlanesPeriodo")?.value === "custom") {
        renderDashboardCharts(usuarios, pagos, planes);
      }
    });
  }
  const btnAplicarEstado = document.getElementById("btnAplicarRangoEstado");
  if (btnAplicarEstado) {
    btnAplicarEstado.addEventListener("click", () => {
      if (document.getElementById("filtroEstadoPeriodo")?.value === "custom") {
        renderDashboardCharts(usuarios, pagos, planes);
      }
    });
  }
  const btnAplicarMetodos = document.getElementById("btnAplicarRangoMetodos");
  if (btnAplicarMetodos) {
    btnAplicarMetodos.addEventListener("click", () => {
      if (document.getElementById("filtroMetodosPeriodo")?.value === "custom") {
        renderDashboardCharts(usuarios, pagos, planes);
      }
    });
  }
  document.getElementById("btnExportImagenEstadoInline")?.addEventListener("click", () => {
    descargarImagenGrafico(chartEstadoMembresias, "rt-activos-vencidos");
  });
  document.getElementById("btnExportImagenMetodosInline")?.addEventListener("click", () => {
    descargarImagenGrafico(chartMetodosPago, "rt-metodos-pago");
  });
  document.getElementById("btnExportImagenIngresosInline")?.addEventListener("click", () => {
    descargarImagenGrafico(chartIngresosMensuales, "rt-ingresos");
  });
  document.getElementById("btnExportImagenPlanesInline")?.addEventListener("click", () => {
    descargarImagenGrafico(chartPlanesVendidos, "rt-planes-vendidos");
  });

  const menusExport = [
    inicializarMenuExportGrafico("btnToggleExportEstado", "menuExportEstado"),
    inicializarMenuExportGrafico("btnToggleExportMetodos", "menuExportMetodos"),
    inicializarMenuExportGrafico("btnToggleExportIngresos", "menuExportIngresos"),
    inicializarMenuExportGrafico("btnToggleExportPlanes", "menuExportPlanes"),
  ].filter(Boolean);

  document.addEventListener("click", (e) => {
    menusExport.forEach((ctx) => {
      if (!ctx.menu.hidden && !ctx.menu.contains(e.target) && !ctx.toggle.contains(e.target)) {
        ctx.cerrar();
      }
    });
  });
  dashboardFiltrosInicializados = true;
}

// --- Formulario nuevo usuario (incluye primer pago) ---
const nuevoUsuarioPlanId = document.getElementById("nuevoUsuarioPlanId");
const nuevoUsuarioMonto = document.getElementById("nuevoUsuarioMonto");
const nuevoUsuarioMetodoPago = document.getElementById("nuevoUsuarioMetodoPago");
nuevoUsuarioPlanId.addEventListener("change", () => {
  const opt = nuevoUsuarioPlanId.selectedOptions[0];
  if (opt?.dataset.precio) nuevoUsuarioMonto.value = opt.dataset.precio;
});

document.getElementById("nuevoUsuarioFechaPago").value = new Date().toISOString().slice(0, 10);
if (nuevoUsuarioMetodoPago) nuevoUsuarioMetodoPago.value = "Transferencia";

// Validación del campo de teléfono: solo números
const campoTelefono = document.getElementById("telefono");
campoTelefono.addEventListener("input", (e) => {
  // Remover cualquier carácter que no sea número
  e.target.value = e.target.value.replace(/\D/g, "");
});

campoTelefono.addEventListener("keypress", (e) => {
  // Prevenir la entrada de caracteres no numéricos
  if (!/[0-9]/.test(e.key) && e.key !== "Backspace" && e.key !== "Delete" && e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Tab") {
    e.preventDefault();
  }
});

// Función para limpiar el formulario de nuevo usuario
function limpiarFormularioNuevoUsuario() {
  document.getElementById("formUsuario").reset();
  document.getElementById("nuevoUsuarioFechaPago").value = new Date().toISOString().slice(0, 10);
  if (nuevoUsuarioMetodoPago) nuevoUsuarioMetodoPago.value = "Transferencia";
  document.getElementById("mensajeNuevoUsuario").textContent = "";
  document.getElementById("mensajeNuevoUsuario").className = "mensaje-resultado";
}

// Botón para limpiar campos
document.getElementById("btnLimpiarNuevoUsuario").addEventListener("click", limpiarFormularioNuevoUsuario);

// Función para mostrar mensaje
function mostrarMensaje(elementId, mensaje, tipo) {
  const el = document.getElementById(elementId);
  el.textContent = mensaje;
  el.className = `mensaje-resultado mensaje-resultado--${tipo}`;
  setTimeout(() => {
    el.textContent = "";
    el.className = "mensaje-resultado";
  }, 5000);
}

document.getElementById("formUsuario").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const mensajeEl = document.getElementById("mensajeNuevoUsuario");
  btn.disabled = true;
  mensajeEl.textContent = "";
  mensajeEl.className = "mensaje-resultado";

  try {
    const nombre = document.getElementById("nombre").value.trim();
    const apellido = document.getElementById("apellido").value.trim();
    const telefono = document.getElementById("telefono").value.trim();
    const email = document.getElementById("email").value.trim();
    const planId = document.getElementById("nuevoUsuarioPlanId").value;
    const opt = nuevoUsuarioPlanId.selectedOptions[0];
    const duracionDias = Number(opt?.dataset.duracionDias || 30);
    const monto = Number(document.getElementById("nuevoUsuarioMonto").value) || 0;
    const metodoPago = document.getElementById("nuevoUsuarioMetodoPago").value;
    const fechaPagoStr = document.getElementById("nuevoUsuarioFechaPago").value;
    const fechaPago = new Date(fechaPagoStr + "T12:00:00");
    // El día de pago cuenta como día 1: fin = pago + (duración - 1) días
    const fechaFin = addDays(fechaPago, duracionDias - 1);

    // Determinar el estado de la membresía basándose en la fecha de fin
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const estadoMembresia = fechaFin >= hoy ? "activa" : "vencida";

    const userRef = await addDoc(collection(db, "usuarios"), {
      nombre,
      apellido,
      telefono,
      email: email || null,
      fechaRegistro: Timestamp.now(),
      estadoMembresia,
      membresiaActual: planId,
      fechaInicioMembresia: Timestamp.fromDate(fechaPago),
      fechaFinMembresia: Timestamp.fromDate(fechaFin),
    });

    await addDoc(collection(db, "pagos"), {
      usuarioId: userRef.id,
      planId,
      montoPagado: monto,
      metodoPago,
      fechaPago: Timestamp.fromDate(fechaPago),
      fechaInicio: Timestamp.fromDate(fechaPago),
      fechaFin: Timestamp.fromDate(fechaFin),
    });

    mostrarMensaje("mensajeNuevoUsuario", `✓ Usuario ${nombre} ${apellido} guardado correctamente.`, "exito");
    e.target.reset();
    document.getElementById("nuevoUsuarioFechaPago").value = new Date().toISOString().slice(0, 10);
    if (nuevoUsuarioMetodoPago) nuevoUsuarioMetodoPago.value = "Transferencia";
    await init();

    // Redirigir al inicio después de 2 segundos
    setTimeout(() => {
      showSection("inicio");
    }, 2000);
  } catch (err) {
    console.error(err);
    mostrarMensaje("mensajeNuevoUsuario", "✗ Error al guardar el usuario. Revisa la consola y la configuración de Firebase.", "error");
  } finally {
    btn.disabled = false;
  }
});

// --- Formulario registrar pago ---
const pagoPlanId = document.getElementById("pagoPlanId");
const montoPagado = document.getElementById("montoPagado");
pagoPlanId.addEventListener("change", () => {
  const opt = pagoPlanId.selectedOptions[0];
  if (opt?.dataset.precio) montoPagado.value = opt.dataset.precio;
});

function limpiarFormularioPago() {
  const formPago = document.getElementById("formPago");
  if (!formPago) return;
  formPago.reset();
  document.getElementById("pagoUsuarioId").value = "";
  document.getElementById("pagoUsuarioBuscar").value = "";
  document.getElementById("metodoPago").value = "Transferencia";
  document.getElementById("fechaPago").value = new Date().toISOString().slice(0, 10);
  cerrarComboboxUsuarios();
}

document.getElementById("formPago").addEventListener("submit", async (e) => {
  e.preventDefault();
  const usuarioId = document.getElementById("pagoUsuarioId").value;
  if (!usuarioId) {
    document.getElementById("pagoUsuarioBuscar").focus();
    alert("Selecciona un usuario de la lista.");
    return;
  }
  const btn = e.target.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    const planId = document.getElementById("pagoPlanId").value;
    const opt = pagoPlanId.selectedOptions[0];
    const duracionDias = Number(opt?.dataset.duracionDias || 30);
    const monto = Number(document.getElementById("montoPagado").value) || 0;
    const metodoPago = document.getElementById("metodoPago").value;
    const fechaPagoStr = document.getElementById("fechaPago").value;
    const fechaPago = new Date(fechaPagoStr + "T12:00:00");
    // El día de pago cuenta como día 1: fin = pago + (duración - 1) días
    const fechaFin = addDays(fechaPago, duracionDias - 1);

    // Determinar el estado de la membresía basándose en la fecha de fin
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const estadoMembresia = fechaFin >= hoy ? "activa" : "vencida";

    await addDoc(collection(db, "pagos"), {
      usuarioId,
      planId,
      montoPagado: monto,
      metodoPago,
      fechaPago: Timestamp.fromDate(fechaPago),
      fechaInicio: Timestamp.fromDate(fechaPago),
      fechaFin: Timestamp.fromDate(fechaFin),
    });

    await updateDoc(doc(db, "usuarios", usuarioId), {
      membresiaActual: planId,
      fechaInicioMembresia: Timestamp.fromDate(fechaPago),
      fechaFinMembresia: Timestamp.fromDate(fechaFin),
      estadoMembresia,
    });

    limpiarFormularioPago();
    await init();
    showSection("inicio");
  } catch (err) {
    console.error(err);
    alert("Error al registrar el pago. Revisa la consola y Firebase.");
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnLimpiarPago")?.addEventListener("click", limpiarFormularioPago);

// Fecha de pago por defecto: hoy
document.getElementById("fechaPago").value = new Date().toISOString().slice(0, 10);
document.getElementById("metodoPago").value = "Transferencia";

// --- Buscador desplegable (combobox) en Registrar pago ---
const pagoUsuarioBuscar = document.getElementById("pagoUsuarioBuscar");
const comboboxDropdown = document.getElementById("comboboxDropdown");
pagoUsuarioBuscar.addEventListener("focus", () => abrirComboboxUsuarios(pagoUsuarioBuscar.value));
pagoUsuarioBuscar.addEventListener("input", () => {
  document.getElementById("pagoUsuarioId").value = "";
  abrirComboboxUsuarios(pagoUsuarioBuscar.value);
});
pagoUsuarioBuscar.addEventListener("blur", () => {
  setTimeout(cerrarComboboxUsuarios, 200);
});
// Al cambiar de sección, limpiar combobox si no hay usuario seleccionado
document.querySelector('.nav-link[href="#registrar-pago"]').addEventListener("click", () => {
  const id = document.getElementById("pagoUsuarioId").value;
  if (!id) {
    pagoUsuarioBuscar.value = "";
  }
});

// Búsqueda de usuarios
document.getElementById("buscarUsuario").addEventListener("input", (e) => {
  paginaUsuariosActual = 1;
  renderUsuarios(window.__usuarios || [], e.target.value);
});

document.getElementById("paginacionUsuarios")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".list-paginacion__btn");
  if (!btn) return;
  if (btn.dataset.accion === "prev") paginaUsuariosActual -= 1;
  if (btn.dataset.accion === "next") paginaUsuariosActual += 1;
  const filtroActual = document.getElementById("buscarUsuario")?.value || "";
  renderUsuarios(window.__usuarios || [], filtroActual);
});

function actualizarEstadoMenuFiltrosUsuarios() {
  const menu = document.getElementById("usuariosFiltrosMenu");
  if (!menu) return;
  menu.querySelectorAll("[data-sort-usuarios]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.sortUsuarios === sortUsuariosModo);
  });
  menu.querySelectorAll("[data-size-usuarios]").forEach((item) => {
    item.classList.toggle("is-active", Number(item.dataset.sizeUsuarios) === usuariosPorPagina);
  });
}

function estadoSortProximosMenu() {
  if (sortProximosCol === "nombre") return sortProximosDir === "asc" ? "nombre_az" : "nombre_za";
  return sortProximosDir === "asc" ? "fecha_antigua" : "fecha_reciente";
}

function estadoSortVencidosMenu() {
  if (sortVencidosCol === "nombre") return sortVencidosDir === "asc" ? "nombre_az" : "nombre_za";
  return sortVencidosDir === "asc" ? "fecha_antigua" : "fecha_reciente";
}

function actualizarEstadoMenuFiltrosProximos() {
  const menu = document.getElementById("proximosFiltrosMenu");
  if (!menu) return;
  const activo = estadoSortProximosMenu();
  menu.querySelectorAll("[data-sort-proximos]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.sortProximos === activo);
  });
  menu.querySelectorAll("[data-size-proximos]").forEach((item) => {
    item.classList.toggle("is-active", Number(item.dataset.sizeProximos) === proximosPorPagina);
  });
}

function actualizarEstadoMenuFiltrosVencidos() {
  const menu = document.getElementById("vencidosFiltrosMenu");
  if (!menu) return;
  const activo = estadoSortVencidosMenu();
  menu.querySelectorAll("[data-sort-vencidos]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.sortVencidos === activo);
  });
  menu.querySelectorAll("[data-size-vencidos]").forEach((item) => {
    item.classList.toggle("is-active", Number(item.dataset.sizeVencidos) === vencidosPorPagina);
  });
}

const btnFiltrosUsuarios = document.getElementById("usuariosFiltrosToggle");
const menuFiltrosUsuarios = document.getElementById("usuariosFiltrosMenu");
const btnFiltrosProximos = document.getElementById("proximosFiltrosToggle");
const menuFiltrosProximos = document.getElementById("proximosFiltrosMenu");
const btnFiltrosVencidos = document.getElementById("vencidosFiltrosToggle");
const menuFiltrosVencidos = document.getElementById("vencidosFiltrosMenu");
const DURACION_ANIMACION_MENU_FILTROS_MS = 180;

function abrirMenuFiltrosUsuarios() {
  if (!menuFiltrosUsuarios) return;
  menuFiltrosUsuarios.hidden = false;
  requestAnimationFrame(() => {
    menuFiltrosUsuarios.classList.add("is-open");
  });
  btnFiltrosUsuarios?.setAttribute("aria-expanded", "true");
  actualizarEstadoMenuFiltrosUsuarios();
}

function cerrarMenuFiltrosUsuarios() {
  if (!menuFiltrosUsuarios || menuFiltrosUsuarios.hidden) return;
  menuFiltrosUsuarios.classList.remove("is-open");
  btnFiltrosUsuarios?.setAttribute("aria-expanded", "false");
  window.setTimeout(() => {
    if (!menuFiltrosUsuarios.classList.contains("is-open")) {
      menuFiltrosUsuarios.hidden = true;
    }
  }, DURACION_ANIMACION_MENU_FILTROS_MS);
}

function abrirMenuFiltrosProximos() {
  if (!menuFiltrosProximos) return;
  menuFiltrosProximos.hidden = false;
  requestAnimationFrame(() => {
    menuFiltrosProximos.classList.add("is-open");
  });
  btnFiltrosProximos?.setAttribute("aria-expanded", "true");
  actualizarEstadoMenuFiltrosProximos();
}

function cerrarMenuFiltrosProximos() {
  if (!menuFiltrosProximos || menuFiltrosProximos.hidden) return;
  menuFiltrosProximos.classList.remove("is-open");
  btnFiltrosProximos?.setAttribute("aria-expanded", "false");
  window.setTimeout(() => {
    if (!menuFiltrosProximos.classList.contains("is-open")) {
      menuFiltrosProximos.hidden = true;
    }
  }, DURACION_ANIMACION_MENU_FILTROS_MS);
}

function abrirMenuFiltrosVencidos() {
  if (!menuFiltrosVencidos) return;
  menuFiltrosVencidos.hidden = false;
  requestAnimationFrame(() => {
    menuFiltrosVencidos.classList.add("is-open");
  });
  btnFiltrosVencidos?.setAttribute("aria-expanded", "true");
  actualizarEstadoMenuFiltrosVencidos();
}

function cerrarMenuFiltrosVencidos() {
  if (!menuFiltrosVencidos || menuFiltrosVencidos.hidden) return;
  menuFiltrosVencidos.classList.remove("is-open");
  btnFiltrosVencidos?.setAttribute("aria-expanded", "false");
  window.setTimeout(() => {
    if (!menuFiltrosVencidos.classList.contains("is-open")) {
      menuFiltrosVencidos.hidden = true;
    }
  }, DURACION_ANIMACION_MENU_FILTROS_MS);
}

btnFiltrosUsuarios?.addEventListener("click", () => {
  const abierto = menuFiltrosUsuarios?.hidden === false && menuFiltrosUsuarios.classList.contains("is-open");
  if (abierto) cerrarMenuFiltrosUsuarios();
  else abrirMenuFiltrosUsuarios();
});

btnFiltrosProximos?.addEventListener("click", () => {
  const abierto = menuFiltrosProximos?.hidden === false && menuFiltrosProximos.classList.contains("is-open");
  if (abierto) cerrarMenuFiltrosProximos();
  else abrirMenuFiltrosProximos();
});

btnFiltrosVencidos?.addEventListener("click", () => {
  const abierto = menuFiltrosVencidos?.hidden === false && menuFiltrosVencidos.classList.contains("is-open");
  if (abierto) cerrarMenuFiltrosVencidos();
  else abrirMenuFiltrosVencidos();
});

menuFiltrosUsuarios?.addEventListener("click", (e) => {
  const itemSort = e.target.closest("[data-sort-usuarios]");
  const itemSize = e.target.closest("[data-size-usuarios]");
  if (!itemSort && !itemSize) return;
  if (itemSort) {
    sortUsuariosModo = itemSort.dataset.sortUsuarios || "fecha_reciente";
  }
  if (itemSize) {
    usuariosPorPagina = Number(itemSize.dataset.sizeUsuarios) || 5;
  }
  paginaUsuariosActual = 1;
  cerrarMenuFiltrosUsuarios();
  const filtroActual = document.getElementById("buscarUsuario")?.value || "";
  renderUsuarios(window.__usuarios || [], filtroActual);
});

menuFiltrosProximos?.addEventListener("click", (e) => {
  const itemSort = e.target.closest("[data-sort-proximos]");
  const itemSize = e.target.closest("[data-size-proximos]");
  if (!itemSort && !itemSize) return;
  if (itemSort) {
    const mode = itemSort.dataset.sortProximos || "fecha_antigua";
    if (mode === "nombre_az") {
      sortProximosCol = "nombre";
      sortProximosDir = "asc";
    } else if (mode === "nombre_za") {
      sortProximosCol = "nombre";
      sortProximosDir = "desc";
    } else if (mode === "fecha_reciente") {
      sortProximosCol = "fecha";
      sortProximosDir = "desc";
    } else {
      sortProximosCol = "fecha";
      sortProximosDir = "asc";
    }
  }
  if (itemSize) {
    proximosPorPagina = Number(itemSize.dataset.sizeProximos) || 10;
  }
  paginaProximosActual = 1;
  cerrarMenuFiltrosProximos();
  actualizarDashboard(window.__usuarios || []);
});

menuFiltrosVencidos?.addEventListener("click", (e) => {
  const itemSort = e.target.closest("[data-sort-vencidos]");
  const itemSize = e.target.closest("[data-size-vencidos]");
  if (!itemSort && !itemSize) return;
  if (itemSort) {
    const mode = itemSort.dataset.sortVencidos || "fecha_reciente";
    if (mode === "nombre_az") {
      sortVencidosCol = "nombre";
      sortVencidosDir = "asc";
    } else if (mode === "nombre_za") {
      sortVencidosCol = "nombre";
      sortVencidosDir = "desc";
    } else if (mode === "fecha_antigua") {
      sortVencidosCol = "fecha";
      sortVencidosDir = "asc";
    } else {
      sortVencidosCol = "fecha";
      sortVencidosDir = "desc";
    }
  }
  if (itemSize) {
    vencidosPorPagina = Number(itemSize.dataset.sizeVencidos) || 5;
  }
  paginaVencidosActual = 1;
  cerrarMenuFiltrosVencidos();
  actualizarDashboard(window.__usuarios || []);
});

document.addEventListener("click", (e) => {
  if (
    menuFiltrosUsuarios &&
    !menuFiltrosUsuarios.hidden &&
    e.target !== btnFiltrosUsuarios &&
    !btnFiltrosUsuarios?.contains(e.target) &&
    !menuFiltrosUsuarios.contains(e.target)
  ) {
    cerrarMenuFiltrosUsuarios();
  }
  if (
    menuFiltrosProximos &&
    !menuFiltrosProximos.hidden &&
    e.target !== btnFiltrosProximos &&
    !btnFiltrosProximos?.contains(e.target) &&
    !menuFiltrosProximos.contains(e.target)
  ) {
    cerrarMenuFiltrosProximos();
  }
  if (
    menuFiltrosVencidos &&
    !menuFiltrosVencidos.hidden &&
    e.target !== btnFiltrosVencidos &&
    !btnFiltrosVencidos?.contains(e.target) &&
    !menuFiltrosVencidos.contains(e.target)
  ) {
    cerrarMenuFiltrosVencidos();
  }
});

// Botones de renovar en la lista de usuarios vencidos del inicio
document.getElementById("tbodyVencidos")?.addEventListener("click", (e) => {
  const btnRenovar = e.target.closest(".btn--renovar");
  if (btnRenovar) {
    const userId = btnRenovar.dataset.userId;
    if (userId) irARenovarUsuario(userId);
  }
});

document.getElementById("paginacionVencidos")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".list-paginacion__btn");
  if (!btn) return;
  if (btn.dataset.accion === "prev") paginaVencidosActual -= 1;
  if (btn.dataset.accion === "next") paginaVencidosActual += 1;
  const usuariosActuales = window.__usuarios || [];
  actualizarDashboard(usuariosActuales);
});

document.getElementById("paginacionProximos")?.addEventListener("click", (e) => {
  const btn = e.target.closest(".list-paginacion__btn");
  if (!btn) return;
  if (btn.dataset.accion === "prev") paginaProximosActual -= 1;
  if (btn.dataset.accion === "next") paginaProximosActual += 1;
  const usuariosActuales = window.__usuarios || [];
  actualizarDashboard(usuariosActuales);
});

document.getElementById("buscarProximosInicio")?.addEventListener("input", (e) => {
  filtroProximosInicio = e.target.value || "";
  paginaProximosActual = 1;
  const usuariosActuales = window.__usuarios || [];
  actualizarDashboard(usuariosActuales);
});

document.getElementById("inicio")?.addEventListener("click", (e) => {
  const sortBtn = e.target.closest("[data-sort-tabla][data-sort-col]");
  if (!sortBtn) return;
  const tabla = sortBtn.dataset.sortTabla;
  const col = sortBtn.dataset.sortCol;
  if (col !== "nombre" && col !== "fecha") return;
  if (tabla === "proximos") {
    if (sortProximosCol === col) {
      sortProximosDir = sortProximosDir === "asc" ? "desc" : "asc";
    } else {
      sortProximosCol = col;
      sortProximosDir = "asc";
    }
    paginaProximosActual = 1;
  } else if (tabla === "vencidos") {
    if (sortVencidosCol === col) {
      sortVencidosDir = sortVencidosDir === "asc" ? "desc" : "asc";
    } else {
      sortVencidosCol = col;
      sortVencidosDir = col === "nombre" ? "asc" : "desc";
    }
    paginaVencidosActual = 1;
  } else {
    return;
  }
  actualizarDashboard(window.__usuarios || []);
});

document.getElementById("buscarVencidosInicio")?.addEventListener("input", (e) => {
  filtroVencidosInicio = e.target.value || "";
  paginaVencidosActual = 1;
  const usuariosActuales = window.__usuarios || [];
  actualizarDashboard(usuariosActuales);
});

const btnInfoTicketPromedio = document.getElementById("btnInfoTicketPromedio");
const infoTicketPromedio = document.getElementById("infoTicketPromedio");
const cardTicketPromedio = document.getElementById("cardTicketPromedio");

btnInfoTicketPromedio?.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!infoTicketPromedio) return;
  const abierto = infoTicketPromedio.hidden === false;
  infoTicketPromedio.hidden = abierto;
  btnInfoTicketPromedio.setAttribute("aria-expanded", String(!abierto));
});

document.addEventListener("click", (e) => {
  if (!infoTicketPromedio || infoTicketPromedio.hidden) return;
  if (cardTicketPromedio?.contains(e.target)) return;
  infoTicketPromedio.hidden = true;
  btnInfoTicketPromedio?.setAttribute("aria-expanded", "false");
});

// Botones en la lista de usuarios: Renovar / Eliminar
document.getElementById("listaUsuarios").addEventListener("click", (e) => {
  const btnEliminar = e.target.closest(".btn--eliminar");
  if (btnEliminar) {
    const userId = btnEliminar.dataset.userId;
    if (userId) eliminarUsuarioConPagos(userId);
    return;
  }
  const btnRenovar = e.target.closest(".btn--renovar");
  if (btnRenovar) {
    const userId = btnRenovar.dataset.userId;
    if (userId) irARenovarUsuario(userId);
  }
});

document.getElementById("listaPlanes")?.addEventListener("click", (e) => {
  const btnGuardar = e.target.closest('[data-accion="guardar-precio-plan"]');
  if (!btnGuardar) return;
  const planId = btnGuardar.dataset.planId;
  if (planId) actualizarPrecioPlan(planId);
});

document.getElementById("formNuevoPlan")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  await crearPlanDesdeAdmin();
});

document.getElementById("btnToggleNuevoPlan")?.addEventListener("click", () => {
  toggleCardNuevoPlan();
});

// Inicialización
let planes = [];
let usuarios = [];
let pagos = [];

async function init() {
  try {
    [planes, usuarios, pagos] = await Promise.all([cargarPlanes(), cargarUsuarios(), cargarPagos()]);
    window.__usuarios = usuarios;
    window.__pagos = pagos;
    window.__planes = planes;
    renderPlanes(planes);
    renderUsuarios(usuarios);
    actualizarDashboard(usuarios);
    renderDashboardCharts(usuarios, pagos, planes);
  } catch (err) {
    console.error("Error cargando datos:", err);
    const msg = err.code === "permission-denied"
      ? "Firestore: acceso denegado. En Firebase Console → Firestore → Reglas, habilita lectura/escritura para desarrollo (ver README)."
      : `Error: ${err.message || err}. Revisa js/firebase-config.js y las reglas de Firestore.`;
    document.getElementById("listaPlanes").innerHTML =
      "<li class='empty'>" + msg + "</li>";
  }
}

// Inicializar módulo de importación de usuarios
inicializarImportacion(db, () => planes, init);
inicializarMigracionRadical(db, () => planes, () => window.__usuarios || [], init);
inicializarExportLegacyFirestore(db);
inicializarFiltrosDashboard();
inicializarDashboardExport(() => ({
  usuarios: window.__usuarios || [],
  pagos: window.__pagos || [],
  planes: window.__planes || [],
}));

init();
