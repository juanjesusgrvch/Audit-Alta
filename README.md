# Audit Alta

Aplicacion `Next.js 15` para registrar operaciones de carga y administrar stock de envases con Firebase.

## Estado actual

- El proyecto compila correctamente con `npm run build`.
- El repo esta preparado para `Firebase App Hosting` con [`apphosting.yaml`](./apphosting.yaml) y [`.firebaserc`](./.firebaserc).
- GitHub ahora valida cada push con el workflow [`.github/workflows/ci-build.yml`](./.github/workflows/ci-build.yml).

## Despliegue recomendado: Firebase App Hosting

Este proyecto usa `firebase-admin`, rutas dinamicas y renderizado server-side, por lo que `App Hosting` es la opcion correcta.

### Lo que ya queda versionado

- Configuracion base del proyecto en `apphosting.yaml`
- Proyecto por defecto `lab-alta` en `.firebaserc`
- Validacion de build en GitHub Actions

### Lo que falta hacer una sola vez en Firebase

1. Reautenticar la CLI local:

   ```bash
   firebase login --reauth
   ```

2. En Firebase Console, abrir `App Hosting`.
3. Crear o editar el backend del proyecto `lab-alta`.
4. Conectar el repositorio `juanjesusgrvch/Audit-Alta`.
5. Definir:
   - Root directory: `/`
   - Live branch: `main`
   - Automatic rollouts: habilitado

Cuando eso quede conectado, cada `git push` a `main` deberia disparar un rollout automaticamente.

## Variables de entorno

Las variables base de proyecto y bucket ya estan definidas en `apphosting.yaml`.

Si el backend necesita mas variables o secretos, agregalos ahi usando la sintaxis de App Hosting. Para este proyecto, `firebase-admin` ya soporta `applicationDefault()`, asi que en App Hosting no hace falta forzar una service account por variables si el backend tiene permisos sobre Firestore y Storage.

## Desarrollo local

```bash
npm install
npm run dev
```

## Verificacion local

```bash
npm run build
```
