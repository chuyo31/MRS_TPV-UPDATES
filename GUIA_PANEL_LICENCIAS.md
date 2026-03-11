# Guia rapida del panel de licencias (Docker)

Esta guia explica como arrancar, asegurar y mantener el panel de licencias de `MRS_TPV`.

## 1) Requisitos

- Docker Desktop instalado y abierto.
- WSL activo (en Windows).
- Proyecto en: `C:\MRS_TPV-CURSOR`.

## 2) Archivos clave

- `docker-compose.licensing.yml`: define base de datos + servidor de licencias.
- `.env.licensing`: credenciales y secretos reales (privado).
- `.env.licensing.example`: plantilla para nuevos equipos.
- `licensing-admin/index.html`: panel web.
- `licensing-server/src/index.js`: API de licencias.

## 3) Arranque del sistema

Desde PowerShell en `C:\MRS_TPV-CURSOR`:

```powershell
docker compose -f docker-compose.licensing.yml up -d --build
```

Comprobar estado:

```powershell
docker compose -f docker-compose.licensing.yml ps
```

Comprobar salud API:

```powershell
Invoke-RestMethod -Uri "http://localhost:4040/api/health" -Method GET
```

Acceso panel:

- URL: `http://localhost:4040/admin`
- Usuario/clave: definidos en `.env.licensing`

## 4) Parar y reiniciar

Parar servicios:

```powershell
docker compose -f docker-compose.licensing.yml down
```

Reiniciar servicios:

```powershell
docker compose -f docker-compose.licensing.yml up -d
```

Ver logs en vivo:

```powershell
docker compose -f docker-compose.licensing.yml logs -f licensing-server
```

## 5) Cambiar credenciales y secretos

1. Edita `C:\MRS_TPV-CURSOR\.env.licensing`
2. Cambia al menos:
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `ADMIN_JWT_SECRET`
   - `LICENSE_JWT_SECRET`
3. Reinicia contenedores:

```powershell
docker compose -f docker-compose.licensing.yml up -d --build
```

Nota: si ya existia un admin en la base, debes actualizar su password/email en DB o crear endpoint de cambio de password.

## 6) Backup y restauracion

### Backup de la base

```powershell
docker exec mrs-licensing-db pg_dump -U postgres -d mrs_licensing > C:\MRS_TPV-CURSOR\backup_licencias.sql
```

### Restaurar backup

```powershell
Get-Content C:\MRS_TPV-CURSOR\backup_licencias.sql | docker exec -i mrs-licensing-db psql -U postgres -d mrs_licensing
```

## 7) Migrar a otro PC

En el PC nuevo:

1. Instalar Docker Desktop.
2. Clonar el proyecto.
3. Copiar:
   - `.env.licensing`
   - `backup_licencias.sql` (o restaurar desde copia segura)
4. Levantar servicios:

```powershell
docker compose -f docker-compose.licensing.yml up -d --build
```

5. Restaurar DB si aplica (paso backup/restauracion).

## 8) Checklist de seguridad minima

- No subir `.env.licensing` al repositorio.
- Usar contrasenas largas y unicas.
- Rotar secretos si se comparte el proyecto.
- Hacer backup diario de base de datos.
- En produccion, publicar con HTTPS y proxy inverso.

## 9) Problemas frecuentes

- `docker no se reconoce`: Docker Desktop no instalado o no reiniciado.
- `failed to connect docker engine`: abrir Docker Desktop y esperar "Engine running".
- `401 en login`: revisar email/password actuales en `.env.licensing` y usuario admin en DB.
- `puerto 4040 ocupado`: cambiar mapeo en `docker-compose.licensing.yml` (ej. `4041:4040`).

## 10) Conexion con la app Electron

La app ya soporta activacion remota con claves `MRS-...`.

Variables opcionales para la app (proceso principal):

- `MRS_LICENSE_SERVER_URL` (default: `http://localhost:4040/api`)
- `MRS_LICENSE_VALIDATE_INTERVAL_HOURS` (default: `12`)
- `MRS_LICENSE_OFFLINE_GRACE_DAYS` (default: `7`)

Si no defines variables, usa los valores por defecto.

## 11) Flujo offline (sin internet en cliente)

Este flujo permite activar equipos sin conexion usando un archivo firmado.

### En el panel admin

1. Crear licencia normal.
2. En la tabla, pulsar `Offline`.
3. Pegar el `ID del equipo` (se copia desde la pantalla de licencia de la app).
4. Indicar duracion en dias (ej. `30`, `90`, `365`).
5. Descargar el archivo `mrs_offline_...json`.

### En la app cliente (sin internet)

1. En pantalla de licencia, pulsar `Importar archivo`.
2. Seleccionar el `.json` generado por el panel.
3. La app activa la licencia offline hasta su fecha de vencimiento.

Importante:

- La clave offline queda ligada al `deviceId`.
- Al vencer la fecha, se bloquea automaticamente.
- Para renovar, se genera un nuevo archivo offline en el panel.
