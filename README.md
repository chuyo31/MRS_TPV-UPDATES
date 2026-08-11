# MRS_TPV Updates

Repositorio p�blico solo para artefactos de actualizaci�n de MRS_TPV.

Los archivos de MRS_TPV en la raíz (`MRS_TPV-Setup-*.exe`, `latest.yml`) son el feed
de actualizaciones en producción de esa app — no se tocan ni se mueven.

## Hub de software (`index.html`)

Este repo también sirve, vía GitHub Pages, un catálogo público de apps en
[chuyo31.github.io/releases](https://chuyo31.github.io/releases/). Cada app nueva
publica sus artefactos en su propia carpeta `apps/<slug>/`, con un `latest.json`
(metadatos para la web) y un `latest.yml` (feed de `electron-updater`, provider
`generic` apuntando a `apps/<slug>/`). La primera en usar este esquema es
GramDownloader (`apps/gramdownloader/`, publicado automáticamente por su propio
CI en cada tag `v*.*.*`).

