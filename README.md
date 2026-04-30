# App Web — Gimnasio (usuarios y pagos)

App web responsive para gestionar usuarios, planes y pagos de un gimnasio. Usa **Firebase Firestore** y está pensada para usarse desde el celular o el escritorio. Se puede desplegar en **GitHub Pages** u otro hosting estático.

## Contenido del proyecto

- **index.html** — Página principal (Inicio, Usuarios, Nuevo usuario, Registrar pago, Planes).
- **css/style.css** — Estilos responsive (mobile-first).
- **js/firebase-config.js** — Configuración de Firebase (debes completarla con tu proyecto).
- **js/app.js** — Lógica: conexión a Firestore, listados, formularios y actualización de membresías.
- **firestore/ejemplo-documentos.md** — Contrato de datos: colecciones, campos, tipos e índices que debe tener tu proyecto en Google Firebase.

## Modelo de datos en Firestore (resumen)

La app espera **exactamente** estas colecciones de nivel raíz:

| Colección   | Rol |
|------------|-----|
| `planes`   | Catálogo de membresías (precio, días, nombre). El **ID del documento** es el `planId` en formularios y pagos. |
| `usuarios` | Socios: nombre, apellido, teléfono, email, fechas y estado de membresía. |
| `pagos`    | Historial de cobros: vínculo a usuario y plan, montos, método y fechas. |

Detalle campo a campo, ejemplos de IDs de planes y el índice compuesto `pagos` (`usuarioId` + `fechaPago`): ver **`firestore/ejemplo-documentos.md`**.

**Checklist en Firebase Console**

1. Firestore Database → crear base `(default)` si aplica.  
2. Crear colección **`planes`** y documentos con IDs estables (`mensual_basic`, etc.) y campos `nombre`, `precio`, `duracionDias`, `activo`.  
3. Las colecciones **`usuarios`** y **`pagos`** se llenan desde la app; no hace falta crearlas a mano.  
4. Índices: si al usar “Registrar pago” aparece error de índice, créalo para `pagos` como en `ejemplo-documentos.md`.  
5. Reglas: permitir lectura/escritura en desarrollo (ver más abajo); en producción, autenticación y reglas restrictivas.

## Configuración de Firebase

1. En [Firebase Console](https://console.firebase.google.com) abre tu proyecto.
2. Ve a **Configuración del proyecto** (engranaje) → **Tus apps** → añade una app **Web** si no tienes.
3. Copia el objeto `firebaseConfig` que te muestra Firebase.
4. En el proyecto, abre **js/firebase-config.js** y reemplaza los valores de `firebaseConfig` con los de tu proyecto (apiKey, authDomain, projectId, etc.).

**Importante:** Si subes el repo a GitHub público, evita subir claves secretas. Puedes usar variables de entorno en tu proceso de despliegue o un archivo de config que no se suba (y dejar en el repo un ejemplo como `firebase-config.example.js`).

## Ejecutar en local

Abre **index.html** en el navegador (doble clic o “Abrir con” tu navegador).  
Para evitar problemas de CORS con módulos ES, es mejor usar un servidor local, por ejemplo:

- **VS Code:** extensión “Live Server” y “Go Live”.
- **Node:** `npx serve .` en la raíz del proyecto y entrar a la URL que indique (ej. `http://localhost:3000`).

## Desplegar en GitHub (GitHub Pages)

1. Crea un repositorio en GitHub (ej. `gym-app`).
2. En la raíz del proyecto (donde está `index.html`), inicializa Git y sube el código:

   ```bash
   git init
   git add .
   git commit -m "Initial commit - app gimnasio"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
   git push -u origin main
   ```

3. En GitHub: **Settings** → **Pages** → en “Source” elige **Deploy from a branch**.
4. Branch: **main**, carpeta **/ (root)**. Guardar.
5. En unos minutos la app quedará en `https://TU_USUARIO.github.io/TU_REPO/`.

El **archivo principal** que sirve de entrada es **index.html** en la raíz; GitHub Pages lo usará automáticamente.

## Reglas de Firestore recomendadas

En Firebase Console → Firestore → **Reglas**, puedes usar algo como esto (ajusta si más adelante añades autenticación):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /planes/{doc} { allow read: if true; allow write: if true; }
    match /usuarios/{doc} { allow read, write: if true; }
    match /pagos/{doc} { allow read, write: if true; }
  }
}
```

En producción conviene restringir `write` solo a usuarios autenticados (por ejemplo con Firebase Auth).

### Desplegar reglas e índices con Firebase CLI

En la raíz del repo (donde está `firebase.json`):

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,firestore:indexes
```

El proyecto por defecto está en **`.firebaserc`** (`radicaltraining-b1eec`); si usas otro, ejecuta `firebase use TU_PROJECT_ID` o edita ese archivo. El modelo de datos y el arranque “desde cero” en consola están en **`firestore/ejemplo-documentos.md`** y los precios/planes de ejemplo en **`firestore/seed-planes.example.json`**.

## Uso desde el celular

La app es responsive: en pantallas pequeñas el menú se abre con el botón ☰. Puedes añadir la URL de GitHub Pages a la pantalla de inicio del móvil para usarla como “app” (en algunos navegadores: menú → “Añadir a pantalla de inicio”).


Reglas anteriores:
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}