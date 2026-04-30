// Sistema de modales personalizados para Fuerza Delta

class Modal {
  constructor() {
    this.modalContainer = null;
    this.currentResolve = null;
    this.init();
  }

  init() {
    // Crear el contenedor del modal si no existe
    if (!document.getElementById("modalContainer")) {
      const modalHTML = `
        <div id="modalContainer" class="modal-overlay" aria-hidden="true">
          <div class="modal-dialog" role="dialog" aria-modal="true">
            <div class="modal-content">
              <div class="modal-header">
                <h3 class="modal-title" id="modalTitle"></h3>
              </div>
              <div class="modal-body">
                <p class="modal-message" id="modalMessage"></p>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn--secondary" id="modalBtnCancelar">Cancelar</button>
                <button type="button" class="btn btn--danger" id="modalBtnAceptar">Aceptar</button>
              </div>
            </div>
          </div>
        </div>
      `;
      document.body.insertAdjacentHTML("beforeend", modalHTML);
      
      this.modalContainer = document.getElementById("modalContainer");
      this.setupEventListeners();
    }
  }

  setupEventListeners() {
    const btnAceptar = document.getElementById("modalBtnAceptar");
    const btnCancelar = document.getElementById("modalBtnCancelar");
    
    btnAceptar.addEventListener("click", () => this.handleAccept());
    btnCancelar.addEventListener("click", () => this.handleCancel());
    
    // Cerrar al hacer clic en el overlay (fondo oscuro)
    this.modalContainer.addEventListener("click", (e) => {
      if (e.target === this.modalContainer) {
        this.handleCancel();
      }
    });
    
    // Cerrar con la tecla ESC
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.modalContainer.getAttribute("aria-hidden") === "false") {
        this.handleCancel();
      }
    });
  }

  show(options = {}) {
    const {
      title = "Confirmar acción",
      message = "¿Estás seguro?",
      acceptText = "Aceptar",
      cancelText = "Cancelar",
      danger = false
    } = options;

    return new Promise((resolve) => {
      this.currentResolve = resolve;
      
      // Configurar contenido
      document.getElementById("modalTitle").textContent = title;
      document.getElementById("modalMessage").textContent = message;
      document.getElementById("modalBtnAceptar").textContent = acceptText;
      document.getElementById("modalBtnCancelar").textContent = cancelText;
      
      // Configurar estilo del botón aceptar
      const btnAceptar = document.getElementById("modalBtnAceptar");
      if (danger) {
        btnAceptar.className = "btn btn--danger";
      } else {
        btnAceptar.className = "btn btn--primary";
      }
      
      // Mostrar modal
      this.modalContainer.setAttribute("aria-hidden", "false");
      this.modalContainer.classList.add("is-open");
      
      // Enfocar el botón cancelar por defecto (más seguro)
      document.getElementById("modalBtnCancelar").focus();
    });
  }

  hide() {
    this.modalContainer.setAttribute("aria-hidden", "true");
    this.modalContainer.classList.remove("is-open");
  }

  handleAccept() {
    this.hide();
    if (this.currentResolve) {
      this.currentResolve(true);
      this.currentResolve = null;
    }
  }

  handleCancel() {
    this.hide();
    if (this.currentResolve) {
      this.currentResolve(false);
      this.currentResolve = null;
    }
  }
}

// Crear instancia global del modal
const modal = new Modal();

// Funciones de utilidad para usar el modal fácilmente
export async function confirmar(options) {
  return await modal.show(options);
}

export async function confirmarEliminacion(nombreUsuario) {
  return await modal.show({
    title: "Eliminar usuario",
    message: `¿Eliminar a ${nombreUsuario} y TODOS sus pagos asociados? Esta acción no se puede deshacer.`,
    acceptText: "Eliminar",
    cancelText: "Cancelar",
    danger: true
  });
}
