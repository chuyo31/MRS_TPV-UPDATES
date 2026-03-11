# Licensing Server (MRS_TPV)

Servidor de licencias + panel de administración para gestionar activaciones.

## 1) Arranque local (sin Docker)

1. Copia variables:

```bash
cp .env.example .env
```

2. Instala dependencias:

```bash
npm install
```

3. Asegura que PostgreSQL está accesible y que `DATABASE_URL` en `.env` es correcto.

4. Inicia el servidor:

```bash
npm run dev
```

Panel: `http://localhost:4040/admin`

## 2) Arranque con Docker (recomendado)

Desde la raíz del proyecto:

```bash
docker compose -f docker-compose.licensing.yml up -d --build
```

Antes de levantar por primera vez, crea `/.env.licensing` desde `/.env.licensing.example` y cambia credenciales/secretos.

Panel: `http://localhost:4040/admin`

API health: `http://localhost:4040/api/health`

## Endpoints principales

- `POST /api/auth/login`
- `GET /api/admin/licenses`
- `POST /api/admin/licenses`
- `PATCH /api/admin/licenses/:id/status`
- `POST /api/admin/licenses/:id/offline-key`
- `POST /api/license/activate`
- `POST /api/license/validate`

## Nota de seguridad (importante)

- Cambia en producción:
  - `ADMIN_PASSWORD`
  - `ADMIN_JWT_SECRET`
  - `LICENSE_JWT_SECRET`
- Configura también `OFFLINE_LICENSE_PRIVATE_KEY_PEM` si vas a emitir licencias offline firmadas.
- Usa HTTPS detrás de un proxy reverse (Nginx/Caddy/Traefik).
