# Releases

Repositorio publico solo para artefactos de actualizacion de las Apps de Chuyo31.

## Hub de software (`index.html`)

Este repo también sirve, vía GitHub Pages, un catálogo público de apps en
[chuyo31.github.io/releases](https://chuyo31.github.io/releases/). Cada app nueva
publica sus artefactos en su propia carpeta `apps/<slug>/`, con un `latest.json`
(metadatos para la web) y un `latest.yml` (feed de `electron-updater`, provider
`generic` apuntando a `apps/<slug>/`). La primera en usar este esquema es
GramDownloader (`apps/gramdownloader/`, publicado automáticamente por su propio
CI en cada tag `v*.*.*`).

