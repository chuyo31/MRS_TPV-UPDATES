# Guía: publicar releases en el hub chuyo31.github.io/releases

Esta guía explica cómo conectar **cualquier app de Electron** (GRAMDownloader,
MRS Suite, y las que vengan) al mismo sistema de auto-actualizaciones y
descargas: un hub público único en `chuyo31/releases`, servido por GitHub
Pages en **https://chuyo31.github.io/releases/**, con CI que publica ahí en
cada release.

Pégale esto al agente de Claude que trabaja en el repo de la app nueva y que
lo siga paso a paso. Si algo no encaja con la estructura real del proyecto
(nombre de scripts, si usa electron-builder o no, etc.), que lo adapte con
criterio, no que copie literalmente sin comprobar.

## 0. Arquitectura (contexto, no hay que montarla de nuevo)

- **`chuyo31/releases`** ya existe: repo público separado, con GitHub Pages activo
  sirviendo la raíz (`main` / root). Contiene `index.html` (el catálogo/hub) y una
  carpeta `apps/<slug>/` por cada app.
- El hub (`index.html`) **ya tiene reservada la entrada** para varias apps en su array
  `APPS`. Mientras `apps/<slug>/latest.json` no exista, esa tarjeta muestra
  "Próximamente" sola, sin romper nada. **No hace falta tocar el hub para dar de alta
  una app nueva si su slug ya está en la lista** — si no lo está, hay que añadir una
  entrada al array `APPS` en `chuyo31/releases/index.html` (`slug`, `name`, `tagline`,
  `accent`) — es la única parte que vive fuera del repo de la app. Ver sección 8 para
  el icono y el resto de convenciones visuales del hub.
- Cada app publica **solo dentro de su propia carpeta** `apps/<slug>/`. El CI de una
  app nunca debe tocar `apps/otra-app/`.
- **Un único repo (`chuyo31/releases`) sirve para todas las apps** — no hace falta
  crear un repo dedicado por app. Si una app necesita publicar binarios como GitHub
  Release en vez de comitearlos (ver sección 2.1), esa Release se crea **dentro de
  `chuyo31/releases`** con un tag namespaceado por app (`<slug>-vX.Y.Z`), no en un
  repo aparte: las Releases de GitHub se distinguen por tag, no por carpeta ni repo,
  así que conviven todas sin colisión en el mismo repo/Pages.
- El PAT (`RELEASES_REPO_TOKEN`) que da acceso de escritura a `chuyo31/releases` ya
  existe (se generó para GRAMDownloader, con permiso `repo`/`Contents: Read and write`
  sobre ese repo). **Se puede reutilizar el mismo valor** como secret en el repo de
  cada app nueva — no hace falta crear un PAT distinto por app, a menos que se quiera
  poder revocar el acceso de una app sin afectar a las demás.

## 1. Requisitos previos en el repo de la app nueva

Debe ser una app de **Electron empaquetada con `electron-builder`** y usar
**`electron-updater`** para las actualizaciones. Si no es así, esta guía no aplica
directamente — avisa al usuario en vez de forzarlo.

## 2. `package.json` — sección `build`

Añadir/ajustar (sustituyendo `<slug>` por el slug real, ej. `mrs-suite`):

```json
"build": {
  "appId": "com.chuyo31.<slug>",
  "productName": "<Nombre bonito, ej. MRS Suite>",
  "directories": { "output": "release" },
  "compression": "maximum",
  "electronLanguages": ["es", "es-419", "en-US", "en"],
  "win": {
    "icon": "build/icon.ico",
    "target": [
      { "target": "nsis", "arch": ["x64"] },
      { "target": "portable", "arch": ["x64"] }
    ]
  },
  "nsis": { "artifactName": "${productName}-Setup-${version}.${ext}" },
  "portable": { "artifactName": "${productName}-Portable-${version}.${ext}" },
  "publish": {
    "provider": "generic",
    "url": "https://chuyo31.github.io/releases/apps/<slug>/",
    "channel": "latest"
  }
}
```

Notas importantes (bugs reales que ya nos costaron tiempo con GRAMDownloader y MRS Suite):

- **`electronLanguages`**: sin esto, Electron empaqueta ~50 locales de Chromium que no
  se usan. Ponerlo solo a los idiomas que la app realmente necesita.
- **Dependencias solo-renderer coladas en el paquete final**: `electron-builder`
  empaqueta por defecto **todas** las `dependencies` de `package.json` dentro de
  `app.asar`, incluidas las que solo usa el renderer a través del bundle de Vite/webpack
  (`dist/`) y que el proceso principal (`electron/*.js`) nunca `require()`. En una app
  React típica esto es: `react`, `react-dom`, `react-router-dom` (y sus subdependencias
  `@remix-run/*`, `scheduler`), y cualquier librería de UI pesada tipo `lucide-react` o
  `pdf-lib` si solo se usan en componentes del renderer. En MRS Suite esto sumaba
  **~55MB muertos** (nunca cargados en runtime por ningún proceso). Antes de dar por
  bueno el tamaño del build:
  1. `grep -rn "from ['\"]<paquete>" electron/` para cada dependency "grande" del
     `package.json` — si NINGÚN archivo de `electron/` lo importa, es candidato a excluir.
  2. **Cuidado con las dependencias transitivas compartidas**: antes de excluir algo,
     comprobar que ningún paquete que SÍ se usa en el proceso principal dependa de él
     (`node -e "console.log(require('<paquete-que-si-se-usa>/package.json').dependencies)"`).
     Ejemplo real: `qrcode` (usado en el proceso principal) depende de `pngjs` — excluir
     `pngjs` a ciegas porque "parece" cosa de `pdf-lib` habría roto la generación de QR.
  3. Excluir en `files` los paquetes confirmados como solo-renderer:
     ```json
     "files": [
       "!**/node_modules/react/**",
       "!**/node_modules/react-dom/**",
       "!**/node_modules/react-router/**",
       "!**/node_modules/react-router-dom/**",
       "!**/node_modules/@remix-run/**",
       "!**/node_modules/scheduler/**"
     ]
     ```
     (la lista exacta depende de qué usa cada app — no copiar ciegamente, repetir el
     grep de arriba para ESTA app).
- **Binarios nativos de build-time**: herramientas usadas solo por Vite/webpack/etc.,
  nunca en runtime, que se cuelan en el paquete final. Ejemplo real: `@tailwindcss/oxide-*`
  y `lightningcss-*` (binarios nativos de Tailwind v4/Vite) se empaquetaban por error en
  GRAMDownloader, sumando ~12 MB sin ninguna función en la app instalada:
  ```json
  "files": [
    "!**/node_modules/@tailwindcss/oxide-*/**",
    "!**/node_modules/lightningcss-*/**"
  ]
  ```
  Hay que revisar qué paquetes nativos tiene ESTA app en
  `release/win-unpacked/resources/app.asar.unpacked/node_modules/` tras un build
  local, y excluir los que sean solo de build, no de runtime.
- `"compression": "maximum"` ayuda algo más, pero poco frente a lo anterior (el asar ya
  va comprimido dentro del NSIS; los MB que realmente cuentan son los que NO deberían
  estar ahí en absoluto).
- Añadir al **scripts** de `package.json`:
  ```json
  "build:electron": "npm run build && electron-builder --publish never",
  "release": "npm run build && electron-builder --publish never"
  ```
  (la publicación real la hace el workflow de CI, no `electron-builder --publish
  always` — así el instalador no se sube a "GitHub Releases" del repo privado, sino
  al hub público vía el workflow).

### 2.1 Si el build sigue pesando más de 100MB después de optimizar

El límite de 100MB es un límite duro de GitHub para archivos subidos con `git push`
normal — no es negociable ni tiene que ver con Pages en sí. **Git LFS NO es una
alternativa**: GitHub Pages no sirve el contenido de LFS, solo el puntero de texto
(unas líneas con el hash), así que el `.exe` "publicado" sería ese puntero roto, no el
binario real — puede incluso romper el build entero de Pages.

**Solución real**: en vez de comitear el `.exe` en `apps/<slug>/`, subirlo como asset
de una **GitHub Release** (hasta 2GB por asset, sin ese límite) con tag `<slug>-vX.Y.Z`
**dentro del mismo repo `chuyo31/releases`** (nunca en el repo de la app si es privado
— las Releases de un repo privado no son descargables sin token, inservibles para
autoupdate anónimo de clientes). El catálogo Pages sigue exactamente igual: solo se
comitea metadata de texto (`latest.json` + `latest.yml`), reescrita con **URLs
absolutas** al asset de la Release en vez de rutas relativas al fichero local —
`electron-updater` (provider `generic`) resuelve cada URL con `new URL(url, feedURL)`,
que al ser absoluta ignora el `feedURL` y descarga directo del asset.

⚠️ **Bug real encontrado (Internet Driver Rescue, 2026-08-20)**: no basta con que
`electron-updater` resuelva bien la URL absoluta — el propio `index.html` del hub tenía
un bug independiente. Los botones de descarga del modal armaban el `href` con
`` `apps/${app.slug}/${release.downloadUrl}` ``, asumiendo siempre una ruta relativa
(válido solo para el modelo "simple" de la sección 2). Con el modelo de GitHub Release,
`downloadUrl` ya es una URL absoluta, así que quedaba
`apps/<slug>/https://github.com/...` — un 404 en el navegador, aunque el asset de la
Release, el `latest.json` y el despliegue de Pages estuvieran todos perfectos. **Ya está
arreglado** en `chuyo31/releases/index.html` con un helper:
```js
function resolveDownloadUrl(slug, url) {
  return /^https?:\/\//i.test(url) ? url : `apps/${slug}/${url}`;
}
```
usado en los tres sitios donde el hub arma un link de descarga (instalador, portable,
versiones anteriores). **No reintroducir la concatenación directa `apps/${slug}/${url}`
en ningún sitio nuevo del hub** — usar siempre `resolveDownloadUrl`. Al publicar una app
con el modelo de GitHub Release, comprobar manualmente en el navegador (no solo que el
`latest.json` responda 200) que el botón "Descargar instalador" del modal apunta a
`github.com/.../releases/download/...` y no a `chuyo31.github.io/releases/apps/.../https://...`.

Implementación de referencia completa (script + workflow) ya funcionando en
`MRS-Suite/scripts/publish-release.cjs` y `MRS-Suite/.github/workflows/release.yml`
— cópialos de ahí si esta app también supera los 100MB, en vez de partir de los de
GRAMDownloader (que son el modelo "simple", comiteando el `.exe` directo, válido solo
si el build cabe en 100MB). Puntos clave de esa versión:

- Copia local del `.exe`/portable a un nombre **sin espacios** antes de subirlo como
  asset (`MRS-Suite-Setup-X.Y.Z.exe`) — evita depender de cómo GitHub sanea espacios al
  subir, el nombre final tiene que coincidir EXACTO entre el paso que sube el asset y
  el paso que escribe la URL en `latest.json`/`latest.yml`.
- `gh release view "$TAG" --repo chuyo31/releases` + `gh release delete ... --cleanup-tag`
  antes de crear, para poder re-lanzar el mismo tag sin fallar por "ya existe" si un
  run anterior falló a medias.
- No hace falta archivar copias de versiones anteriores (`previous/`): la propia
  GitHub Release de cada versión se conserva indefinidamente; `latest.json.previousReleases`
  solo enlaza su URL.

## 3. El main process debe requerir `electron-updater` DENTRO de `app.whenReady()`

**Bug real encontrado**: si `electron-updater` se requiere/usa a nivel de módulo
(fuera de `whenReady`), puede fallar con `Cannot read properties of undefined
(reading 'getVersion')` porque intenta leer `app.getVersion()` antes de que Electron
esté listo — depende de la combinación de versiones de Electron/electron-updater, así
que aunque hoy "funcione" en una versión, es frágil. Patrón correcto:

```js
let autoUpdater = null; // declarado arriba, no requerido aún

app.whenReady().then(() => {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://chuyo31.github.io/releases/apps/<slug>/',
  });
  autoUpdater.on('checking-for-update', /* ... */);
  // ... resto de listeners y autoUpdater.checkForUpdates() si app.isPackaged
  createWindow();
});
```

Cualquier `ipcMain.handle` que llame a `autoUpdater.checkForUpdates()` /
`.quitAndInstall()` sigue funcionando igual (ya se llama después de `whenReady`).

## 4. `scripts/publish-release.cjs` (copiar y adaptar)

Dos plantillas de referencia según el tamaño del build (ver sección 2.1):

- **App que cabe en 100MB** → copiar de GRAMDownloader
  (`family-tdl/scripts/publish-release.cjs`): comitea el `.exe` directo en
  `apps/<slug>/`, calcula SHA256, archiva la versión anterior en `apps/<slug>/previous/`
  (máximo 10).
- **App que supera 100MB** → copiar de MRS Suite
  (`MRS-Suite/scripts/publish-release.cjs`): NO comitea binarios, solo reescribe
  `latest.json`/`latest.yml` con URLs absolutas a una GitHub Release ya creada por el
  workflow (recibe `RELEASE_ASSET_BASE` por variable de entorno).

En ambos casos, cambiar solo estas constantes cerca del principio del archivo:

```js
const APP_NAME = 'MRS Suite';   // nombre "bonito", se usa en los nombres de archivo
const APP_SLUG = 'mrs-suite';   // debe coincidir con el slug del hub y con la URL de publish
```

No toca nada fuera de `apps/<slug>/`.

## 5. `.github/workflows/release.yml` (copiar y adaptar)

Misma bifurcación que el script: copiar `family-tdl/.github/workflows/release.yml`
(modelo simple) o `MRS-Suite/.github/workflows/release.yml` (modelo con GitHub Release
para binarios grandes) según el tamaño del build. Cambiar solo:

- El nombre del step de empaquetado si hace referencia al nombre de la app.
- **Si la app no usa credenciales embebidas de Telegram** (el caso normal), **quitar**
  el step "Generar credenciales embebidas de Telegram" — eso es específico de
  GRAMDownloader, no lo repliques si no aplica.
- Si se usa el modelo de GitHub Release: el tag de la Release dentro de
  `chuyo31/releases` debe ir prefijado con el slug (`<slug>-vX.Y.Z`), nunca solo
  `vX.Y.Z` a secas — si dos apps usan el mismo tag "pelado" colisionarían entre sí en
  ese repo compartido.
- **`runs-on: windows-2022`, NUNCA `windows-latest`** si la app tiene dependencias
  nativas que se recompilan con `node-gyp`/`@electron/rebuild` (ej. `better-sqlite3`,
  o cualquier otro módulo nativo). **Bug real encontrado**: la imagen `windows-latest`
  se actualizó a una versión de Visual Studio que `node-gyp` todavía no reconoce
  (`gyp ERR! find VS unsupported version: 18` → `Could not find any Visual Studio
  installation to use`), rompiendo `npm ci`/`postinstall` por completo. `windows-2022`
  es una imagen fija y estable que sí trae una VS compatible.
- Nada más debería cambiar: el checkout de `chuyo31/releases`, la lectura de las
  notas del tag, y el commit+push final ya son genéricos.

⚠️ **Cuidado con YAML y los dos puntos**: si algún `name:` de step contiene `:`
seguido de espacio (ej. `Empaquetar (Windows x64: instalador)`), YAML lo interpreta
como un mapeo nuevo y **rompe el parseo de todo el workflow** — falla al instante,
sin crear ningún job, con el mensaje "This run likely failed because of a workflow
file issue" en la pestaña Actions. Si un nombre de step necesita `:`, ponlo entre
comillas: `- name: "Empaquetar (Windows x64: instalador)"`. Antes de hacer push de un
tag, vale la pena validar el YAML:
```
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8')); console.log('OK')"
```
(usa `js-yaml`, que ya suele venir como dependencia transitiva de `electron-builder`
en `node_modules` — si no está, `npm i -D js-yaml` temporalmente solo para validar).

## 6. Secrets a configurar en el repo de la app nueva

`Settings → Secrets and variables → Actions` del repo de la app (ej.
`chuyo31/mrs-suite` o como se llame):

- **`RELEASES_REPO_TOKEN`** — el mismo PAT ya usado para GRAMDownloader (permiso
  `repo`/Contents R+W sobre `chuyo31/releases`; si se usa el modelo de GitHub Release
  de la sección 2.1, ese mismo PAT necesita también poder crear Releases ahí, lo cual
  ya cubre el scope `repo`). Se puede setear con:
  ```
  gh secret set RELEASES_REPO_TOKEN --repo chuyo31/<repo-de-la-app>
  ```
  (pegar el token cuando lo pida).

  ⚠️ **Gotcha real y repetido en esta máquina**: si `gh` da `Bad credentials` / `failed
  to fetch public key` aunque `gh auth status` muestre la cuenta buena logueada, es casi
  seguro que hay una variable de entorno `GH_TOKEN`/`GITHUB_TOKEN` (con un token viejo o
  inválido) tapando el login del keyring — `gh` siempre prioriza la env var sobre el
  login guardado. Para esa sesión de shell:
  ```powershell
  Remove-Item Env:GH_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:GITHUB_TOKEN -ErrorAction SilentlyContinue
  ```
  Para que no vuelva a pasar nunca en ninguna sesión nueva (arreglo permanente, ya
  aplicado en esta máquina el 2026-08-13): comprobar si está seteada a nivel de
  usuario/máquina y borrarla de ahí —
  ```powershell
  [Environment]::GetEnvironmentVariable('GH_TOKEN','User')
  [Environment]::SetEnvironmentVariable('GH_TOKEN', $null, 'User')
  ```
  (el nivel `Machine` requiere PowerShell como administrador).
- Cualquier otro secret específico de ESA app (si tiene sus propias credenciales de
  API, licencias, etc.) — no reutilizar los de Telegram, esos son solo de
  GRAMDownloader.

## 7. Publicar el primer release

1. Confirmar que el build local pesa menos de 100 MB (`npm run build:electron` y
   mirar `release/*.exe`) — si no, aplicar la sección 2.1 (GitHub Release) antes de
   seguir, no intentar forzarlo a base de recortar dependencias indefinidamente.
2. Commitear y pushear los cambios normales a `main`.
3. Crear y pushear el tag (dispara el workflow):
   ```
   git tag -a v0.1.0 -m "Notas de la release..."
   git push origin v0.1.0
   ```
4. Comprobar en la pestaña **Actions** del repo que el run termina en verde. Si falla,
   mirar primero: problema de YAML (sección 5), runner `windows-latest` roto (sección
   5), tamaño >100MB (sección 2.1), o el guard-rail de SemVer rechazando el tag porque
   ya existía uno con igual o mayor precedencia (borrar el tag local+remoto y
   recrearlo, o subir de versión — nunca reutilizar un tag "quemado" por un run
   fallido intentando forzarlo con el mismo número si el guard-rail ya lo comparó
   contra sí mismo).
5. Comprobar que aparecieron los archivos en `chuyo31/releases/apps/<slug>/`
   (`latest.yml`, `latest.json`, y si el modelo es "simple" también `<Nombre>-Setup.exe`;
   si es el modelo de Release, el `.exe` está en
   `chuyo31/releases/releases/tag/<slug>-vX.Y.Z` en vez de comiteado) y que la tarjeta en
   **https://chuyo31.github.io/releases/** ya no dice "Próximamente".
6. Si el slug de la app **no** estaba ya en el array `APPS` de
   `chuyo31/releases/index.html`, añadirlo ahí (clonar `chuyo31/releases`, editar,
   commit, push) — es el único paso que toca el repo del hub en vez del repo de la app.

## 8. Identidad visual del hub (mantener esta línea con cada app nueva)

El `index.html` del hub se rediseñó para dejar de depender de iniciales sueltas y de
notas de versión, y para tener una cabecera con presentación fija. Esto ya está hecho
y no hay que rehacerlo, pero cualquier app nueva tiene que encajar en las mismas
convenciones:

- **Cabecera/hero fija, no tocar por app**: el título grande ("Software de chuyo31"),
  la etiqueta "❤️ Hecho con mucha IA por chuyo31" y el párrafo de presentación
  (hobby, sin ser programador profesional, apoyo en IA, trayectoria en mods de
  consolas, catálogo en expansión) son contenido genérico del hub, no de una app
  concreta. Dar de alta una app nueva **nunca** implica tocar esa cabecera.
- **Icono real por app, no iniciales**: cada entrada de `APPS` en `index.html` ya no
  tiene campo `initial` — las tarjetas y el modal usan
  `<img src="icons/<slug>.png">`. Ese fichero vive en la **raíz** del repo del hub,
  en `chuyo31/releases/icons/<slug>.png` (no dentro de `apps/<slug>/`, que es la
  carpeta que reescribe el CI en cada release).
  - Formato: PNG cuadrado, 512×512, con las esquinas ya redondeadas mediante canal
    alfa (mismo radio que las demás: `rx`/`ry` ≈ 96 sobre 512, es decir ~18.75% del
    lado) para que combine visualmente con el resto sin depender de que el CSS
    recorte bien un PNG cuadrado a pelo.
  - **Pedir el logo real de la app al usuario antes de improvisar uno.** Si el
    usuario ya tiene un icono tipo "badge" (cuadrado, con su color de marca, pensado
    para verse pequeño), es ese el que hay que usar — redimensionado y con el
    redondeado de esquinas aplicado si no lo trae ya. Solo si no existe ningún
    asset cuadrado utilizable vale la pena componer uno (recortar la marca de un
    logo más grande, ponerla en blanco sobre un fondo con degradado a juego con el
    `accent` de la tarjeta) — y aun así, mejor confirmar con el usuario el
    resultado antes de darlo por bueno.
- **Sin "Notas de la versión" en el modal**: se quitó a propósito (el usuario no
  quería verlas, "se ve bastante feo") — no reintroducir esa sección aunque
  `latest.json` siga trayendo un campo `notes` (los scripts `publish-release.cjs`
  lo siguen escribiendo porque no molesta tenerlo en el JSON; el hub simplemente no
  lo renderiza). Los campos que sí se muestran en el modal: instalador, portable,
  requisitos, fecha de publicación y SHA256.
- **Un `accent` (degradado Tailwind) distinto por app**, para que las tarjetas se
  distingan de un vistazo: `from-sky-500 to-brand-600` (GramDownloader),
  `from-emerald-500 to-teal-600` (MRS Suite), `from-amber-500 to-orange-600` (PCPI).
  Para una app nueva, elegir otro par de tonos Tailwind que no choque con los ya
  usados.
- **Altura de tarjeta uniforme**: el `<button>` de cada tarjeta usa
  `flex flex-col h-full` y la banda de color superior tiene altura fija (`h-20`,
  `shrink-0`), así todas las tarjetas de una misma fila quedan alineadas sin
  importar cuánto ocupe la descripción de cada app. No hace falta tocar nada de
  esto al añadir una app — simplemente no romper esas clases.

## 9. Checklist rápido para el otro agente

- [ ] `package.json`: `build.publish` → `generic` + URL `.../apps/<slug>/`, target
      `nsis`+`portable`, `electronLanguages`, `compression: maximum`.
- [ ] Build local < 100 MB tras excluir dependencias solo-renderer (`react`, `react-dom`,
      `react-router-dom`, etc. — comprobado con `grep` en `electron/`, sin romper
      dependencias transitivas compartidas) y binarios nativos de build-time.
      Si sigue > 100MB después de optimizar: modelo de GitHub Release (sección 2.1),
      no seguir recortando indefinidamente.
- [ ] `electron-updater` requerido dentro de `whenReady`, no a nivel de módulo.
- [ ] `scripts/publish-release.cjs` copiado (modelo simple o Release según tamaño) con
      `APP_NAME`/`APP_SLUG` correctos.
- [ ] `.github/workflows/release.yml` copiado y adaptado (sin el step de Telegram si
      no aplica, `runs-on: windows-2022`, tag de Release namespaceado por slug si aplica
      el modelo grande), YAML validado antes de pushear.
- [ ] Secret `RELEASES_REPO_TOKEN` configurado en el repo de la app (y `GH_TOKEN`/
      `GITHUB_TOKEN` limpiados del entorno si `gh` da `Bad credentials`).
- [ ] Tag `vX.Y.Z` pusheado → Actions en verde → archivos en
      `chuyo31/releases/apps/<slug>/` → tarjeta visible en el hub.
- [ ] Si es el modelo de GitHub Release (sección 2.1): abrir la tarjeta en
      **https://chuyo31.github.io/releases/** y comprobar a mano que el botón
      "Descargar instalador" apunta a `github.com/.../releases/download/...`, no a un
      404 tipo `chuyo31.github.io/releases/apps/<slug>/https://...` — ver el bug real
      documentado en la sección 2.1.
- [ ] Icono `chuyo31/releases/icons/<slug>.png` (512×512, esquinas redondeadas,
      logo real de la app pedido al usuario) añadido al hub — ver sección 8.
