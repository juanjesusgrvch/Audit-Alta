# Audit Alta

Aplicacion `Next.js 15` para gestionar descargas, cargas y envases con Firebase.

## Estado actual

- Base modular con rutas principales:
  - `/descargas`: ingresos de mercaderia.
  - `/cargas`: egresos, cargas y despachos.
  - `/envases`: catalogo y stock operativo de envases.
- Escrituras server-side hacia Firestore con validacion Zod, subida de PDF a Storage y rollback del archivo si falla la transaccion.
- Referencias visuales activas en `ejemplos/`, aplicadas como consola tecnica dark/light al estilo Aetheria Logistics.
- Las rutas heredadas `/ingresos`, `/egresos` y `/operaciones/cargas` redirigen a la nueva arquitectura.
- Preparado para incorporar login con Firebase Auth + Turnstile, menu de usuario/logout y exportacion a PDF.

## Colecciones Firebase

- `descargas`: registros de ingresos de mercaderia.
- `cargas`: registros de egresos de mercaderia.
- `envases`: catalogo y stock consolidado de envases.
- `operaciones_keys`: claves de idempotencia por carta de porte/remito.
- `dashboard_resumen_diario`: acumulados diarios.

Las colecciones heredadas `envase_tipos`, `envase_stock`, `envase_movimientos` y `operaciones` se mantienen como compatibilidad de migracion.

## Desarrollo local

```bash
npm ci
npm run dev
```

La app queda disponible en `http://localhost:3000`.

## Verificacion local

```bash
npm run build
```

## Limpieza

Los artefactos generados que se pueden borrar sin tocar fuentes son:

```bash
.next
node_modules
.npm-cache*
.tmp-*
```

No borrar `ejemplos/`, `stitch/stitch`, `.env.local`, Firebase config, reglas, lockfile, codigo fuente ni `.git`.

## Despliegue recomendado

Este proyecto usa `firebase-admin`, rutas dinamicas y renderizado server-side, por lo que `Firebase App Hosting` es la opcion recomendada.

Las variables publicas y privadas deben configurarse por entorno. El repo no versiona secretos reales.

Para produccion:

- `firebase-admin` usa la service account administrada del backend de App Hosting via `applicationDefault()`.
- Firebase App Hosting inyecta `FIREBASE_WEBAPP_CONFIG` y `FIREBASE_CONFIG`, que el proyecto usa como fallback para evitar versionar configuracion publica innecesaria.
- No subir un JSON de service account al repositorio ni configurar `GOOGLE_APPLICATION_CREDENTIALS` en `apphosting.yaml`.
- `TURNSTILE_SECRET_KEY` debe cargarse en Secret Manager y exponerse al backend con la referencia declarada en `apphosting.yaml`.
- Si reutilizas este repo para otro proyecto, reemplaza tambien los valores publicos del cliente definidos en `apphosting.yaml`.

Para desarrollo local:

- copiar `.env.example` a `.env.local` y completar tus propios valores
- usar `GOOGLE_APPLICATION_CREDENTIALS=./firebase-service-account.json` en `.env.local`
- mantener ese JSON fuera de git
