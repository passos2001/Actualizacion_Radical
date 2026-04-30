# Firestore — modelo que debe coincidir con la app

La aplicación solo usa **tres colecciones de nivel raíz**: `planes`, `usuarios`, `pagos`.  
Los nombres de campo deben ser **exactamente** los indicados (camelCase).

---

## 0. Inicio desde cero (consola Google Firebase)

1. **Exporta** lo del app viejo: en la app web, sección **Importar usuarios → Exportar datos antiguos a Excel** (colecciones `clientes` y `Clientes`). Publica antes las **reglas** que permiten solo lectura en esas rutas (`firestore.rules` del repo).  
2. En **Firestore → Datos**, elimina colecciones incorrectas del modelo anterior, por ejemplo:
   - `Clientes` (con documento `clientes` vacío o mal armado)
   - `clientes` en minúsculas  
   La app nueva **no** las usa; solo generan confusión.
3. Crea la colección **`planes`** y los documentos iniciales (IDs fijos). Puedes copiar valores de ejemplo desde **`firestore/seed-planes.example.json`** (ajusta precios en COP).
4. Las colecciones **`usuarios`** y **`pagos`** pueden quedar vacías: la app las rellena al registrar socios y pagos, o con **Importar CSV** / **Migrar Excel**.
5. **Reglas e índices** desde tu PC (recomendado):
   - Instala [Firebase CLI](https://firebase.google.com/docs/cli) e inicia sesión: `firebase login`
   - En la raíz de este repo: `firebase use radicaltraining-b1eec` (o el `projectId` de `js/firebase-config.js`)
   - Publica reglas e índices:  
     `firebase deploy --only firestore:rules,firestore:indexes`
6. Si no usas CLI, copia el contenido de **`firestore.rules`** a **Firestore → Reglas** y crea el índice compuesto de la sección 4 a mano.

Archivos en el repo:

| Archivo | Uso |
|---------|-----|
| `firebase.json` | Configura rutas de reglas e índices para el CLI |
| `firestore.rules` | Solo `planes`, `usuarios`, `pagos` (desarrollo: lectura/escritura abierta) |
| `firestore.indexes.json` | Índice `pagos`: `usuarioId` + `fechaPago` |
| `.firebaserc` | Proyecto por defecto (debe coincidir con `firebase-config.js`) |

---

## 1. Colección `planes`

Cada documento es un plan de membresía. El **ID del documento** es el que usa la app como `planId` (ej. `mensual_basic`).

| Campo       | Tipo      | Obligatorio | Notas |
|------------|-----------|-------------|--------|
| `nombre`   | string    | recomendado | Texto mostrado en listas y selects. |
| `precio`   | number    | recomendado | COP, número entero. |
| `duracionDias` | number | **sí** | Días de vigencia; el día de pago cuenta como día 1 (la app calcula fin = pago + duración − 1). |
| `activo`   | boolean   | opcional    | Si es `false`, el plan **no** aparece en la app. Si falta, se trata como activo. |
| `tipo`     | string    | opcional    | La app **no** lo lee hoy; puedes usarlo para administración. |

### Ejemplo (3 documentos)

- ID `mensual_basic`: `nombre` "Mensual", `precio` 100000, `duracionDias` 30, `activo` true  
- ID `bimestre_basic`: `nombre` "Bimestre", `precio` 180000, `duracionDias` 60, `activo` true  
- ID `trimestre_basic`: `nombre` "Trimestre", `precio` …, `duracionDias` 90, `activo` true  

Si migraste desde el app antiguo con semanal / quincenal, añade planes con `duracionDias` 7 y 15 si los sigues vendiendo.

---

## 2. Colección `usuarios`

| Campo                  | Tipo      | Obligatorio | Notas |
|------------------------|-----------|-------------|--------|
| `nombre`               | string    | sí          | |
| `apellido`             | string    | sí          | Puede ser cadena vacía `""`. |
| `telefono`             | string    | sí          | La app valida 10 dígitos en formularios; en datos importados puede variar. |
| `email`                | string \| null | opcional | `null` si no hay. |
| `fechaRegistro`        | timestamp | sí          | |
| `estadoMembresia`      | string    | recomendado | Valores usados: `"activa"` \| `"vencida"`. La lista también calcula por `fechaFinMembresia`. |
| `membresiaActual`      | string    | recomendado | Debe ser el **ID** de un documento en `planes`. |
| `fechaInicioMembresia` | timestamp | recomendado | Inicio vigencia actual. |
| `fechaFinMembresia`    | timestamp | recomendado | Fin vigencia actual. |

---

## 3. Colección `pagos`

| Campo        | Tipo      | Obligatorio | Notas |
|--------------|-----------|-------------|--------|
| `usuarioId`  | string    | **sí**      | ID del documento en `usuarios`. |
| `planId`     | string    | **sí**      | ID del documento en `planes`. |
| `montoPagado`| number    | **sí**      | COP. |
| `metodoPago` | string    | recomendado | Valores típicos en la UI: `"Efectivo"`, `"Transferencia"`, `"Tarjeta"`. |
| `fechaPago`  | timestamp | **sí**      | |
| `fechaInicio`| timestamp | **sí**      | Suele coincidir con `fechaPago` al registrar. |
| `fechaFin`   | timestamp | **sí**      | Fin del periodo pagado. |

---

## 4. Índice compuesto (recomendado)

La pantalla **Registrar pago** consulta pagos por usuario ordenados por fecha:

- Colección: `pagos`  
- Campos: `usuarioId` (Ascending), `fechaPago` (Descending)  

Si Firebase te pide crear el índice, usa el enlace del error de consola o créalo en **Firestore → Índices → Compuesto**.

---

## 5. Limpieza respecto al app antiguo

La app nueva **no** lee `clientes` ni `Clientes`. Tras migrar datos a `usuarios` + `pagos`, puedes archivar o eliminar esas colecciones en la consola para evitar duplicidad.

---

## 6. Reglas mínimas (solo desarrollo)

Ver `README.md` → sección reglas. En producción usa **Firebase Auth** y reglas que restrinjan `write`.
