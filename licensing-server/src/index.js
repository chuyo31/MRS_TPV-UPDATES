const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PORT = Number(process.env.PORT || 4040);
const DATABASE_URL = String(process.env.DATABASE_URL || '');
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@mrstpv.local');
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'ChangeThisNow_123');
const ADMIN_JWT_SECRET = String(process.env.ADMIN_JWT_SECRET || 'change_this_jwt_secret');
const LICENSE_JWT_SECRET = String(process.env.LICENSE_JWT_SECRET || 'change_this_license_secret');
const OFFLINE_LICENSE_PRIVATE_KEY_PEM = String(process.env.OFFLINE_LICENSE_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n').trim();
const DEVICE_LIMIT_DEFAULT = Number(process.env.DEVICE_LIMIT_DEFAULT || 1);

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL no definido. Revisa licensing-server/.env');
}

const app = express();
const pool = new Pool({ connectionString: DATABASE_URL });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json());

const adminPanelCandidates = [
  path.resolve(__dirname, '../../licensing-admin'),
  path.resolve(__dirname, '../licensing-admin'),
  path.resolve(process.cwd(), 'licensing-admin')
];
const adminPanelPath = adminPanelCandidates.find((p) => fs.existsSync(path.join(p, 'index.html'))) || adminPanelCandidates[0];
app.use('/admin', express.static(adminPanelPath));
app.get('/', (_req, res) => res.redirect('/admin'));

function nowIso() {
  return new Date().toISOString();
}

function createLicenseKey() {
  const raw = uuidv4().replace(/-/g, '').toUpperCase();
  return `MRS-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function toBase64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function buildOfflineSignedKey(payloadObject) {
  if (!OFFLINE_LICENSE_PRIVATE_KEY_PEM) {
    throw new Error('OFFLINE_LICENSE_PRIVATE_KEY_PEM no configurada en entorno.');
  }
  const payloadJson = JSON.stringify(payloadObject || {});
  const payloadB64 = toBase64Url(payloadJson);
  const signature = require('crypto').sign(null, Buffer.from(payloadB64, 'utf8'), OFFLINE_LICENSE_PRIVATE_KEY_PEM);
  return `MRS2.${payloadB64}.${toBase64Url(signature)}`;
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

async function logAudit({ actorType, actorId, action, targetType, targetId, payload }) {
  await pool.query(
    `INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuidv4(), actorType, actorId || null, action, targetType || null, targetId || null, payload || {}]
  );
}

function adminAuth(req, res, next) {
  const token = String(req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET);
    req.admin = payload;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

async function ensureSchemaAndAdmin() {
  const sqlPath = path.resolve(__dirname, '../sql/init.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const adminCheck = await pool.query('SELECT id FROM admins WHERE email = $1 LIMIT 1', [ADMIN_EMAIL]);
  if (adminCheck.rowCount === 0) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await pool.query(
      'INSERT INTO admins (id, email, password_hash) VALUES ($1,$2,$3)',
      [uuidv4(), ADMIN_EMAIL, hash]
    );
    console.log(`[${nowIso()}] Admin inicial creado: ${ADMIN_EMAIL}`);
  }
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'mrs-licensing', now: nowIso() });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const result = await pool.query('SELECT id, email, password_hash FROM admins WHERE email = $1 LIMIT 1', [email]);
  if (result.rowCount === 0) return res.status(401).json({ error: 'Credenciales inválidas' });

  const admin = result.rows[0];
  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign({ sub: admin.id, email: admin.email, role: 'admin' }, ADMIN_JWT_SECRET, { expiresIn: '12h' });
  return res.json({ token });
});

app.get('/api/admin/licenses', adminAuth, async (_req, res) => {
  const result = await pool.query(
    `SELECT l.*, c.name as customer_name, c.email as customer_email
     FROM licenses l
     LEFT JOIN customers c ON c.id = l.customer_id
     ORDER BY l.created_at DESC`
  );
  return res.json({ items: result.rows });
});

app.post('/api/admin/licenses', adminAuth, async (req, res) => {
  const customerName = String(req.body?.customerName || '').trim();
  const customerEmail = String(req.body?.customerEmail || '').trim();
  const plan = String(req.body?.plan || 'standard').trim();
  const maxDevicesRaw = Number(req.body?.maxDevices || DEVICE_LIMIT_DEFAULT);
  const expiresAt = req.body?.expiresAt ? new Date(String(req.body.expiresAt)).toISOString() : null;
  const maxDevices = Number.isFinite(maxDevicesRaw) && maxDevicesRaw > 0 ? Math.floor(maxDevicesRaw) : DEVICE_LIMIT_DEFAULT;

  if (!customerName) return res.status(400).json({ error: 'customerName es requerido' });

  const customerId = uuidv4();
  await pool.query(
    `INSERT INTO customers (id, name, email) VALUES ($1,$2,$3)`,
    [customerId, customerName, customerEmail || null]
  );

  const licenseId = uuidv4();
  const licenseKey = createLicenseKey();
  const insert = await pool.query(
    `INSERT INTO licenses (id, license_key, customer_id, plan, status, max_devices, expires_at)
     VALUES ($1,$2,$3,$4,'active',$5,$6) RETURNING *`,
    [licenseId, licenseKey, customerId, plan, maxDevices, expiresAt]
  );

  await logAudit({
    actorType: 'admin',
    actorId: req.admin.sub,
    action: 'create_license',
    targetType: 'license',
    targetId: licenseId,
    payload: { customerName, plan, maxDevices, expiresAt }
  });

  return res.status(201).json({ item: insert.rows[0] });
});

app.patch('/api/admin/licenses/:id/status', adminAuth, async (req, res) => {
  const licenseId = String(req.params.id || '');
  const status = String(req.body?.status || '').toLowerCase();
  const allowed = new Set(['active', 'revoked', 'expired']);
  if (!allowed.has(status)) return res.status(400).json({ error: 'Estado inválido' });

  const result = await pool.query(
    `UPDATE licenses SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [licenseId, status]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Licencia no encontrada' });

  await logAudit({
    actorType: 'admin',
    actorId: req.admin.sub,
    action: 'change_license_status',
    targetType: 'license',
    targetId: licenseId,
    payload: { status }
  });

  return res.json({ item: result.rows[0] });
});

app.post('/api/admin/licenses/:id/offline-key', adminAuth, async (req, res) => {
  const licenseId = String(req.params.id || '').trim();
  const deviceId = String(req.body?.deviceId || '').trim();
  const durationDaysRaw = Number(req.body?.durationDays || 30);
  const durationDays = Number.isFinite(durationDaysRaw) && durationDaysRaw > 0 ? Math.floor(durationDaysRaw) : 30;
  if (!licenseId) return res.status(400).json({ error: 'Falta license id' });
  if (!deviceId) return res.status(400).json({ error: 'deviceId es obligatorio para modo offline' });

  const licResult = await pool.query(
    `SELECT l.*, c.name as customer_name
     FROM licenses l
     LEFT JOIN customers c ON c.id = l.customer_id
     WHERE l.id = $1 LIMIT 1`,
    [licenseId]
  );
  if (licResult.rowCount === 0) return res.status(404).json({ error: 'Licencia no encontrada' });

  const license = licResult.rows[0];
  if (license.status !== 'active') return res.status(403).json({ error: 'La licencia debe estar activa para generar clave offline' });

  const now = Date.now();
  const contractExpTs = license.expires_at ? new Date(license.expires_at).getTime() : null;
  const requestedExpTs = now + (durationDays * 86400000);
  const finalExpTs = Number.isFinite(contractExpTs) ? Math.min(contractExpTs, requestedExpTs) : requestedExpTs;

  const payload = {
    licenseId: String(license.id),
    customer: String(license.customer_name || ''),
    plan: String(license.plan || ''),
    deviceId,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(finalExpTs).toISOString(),
    source: 'offline-admin'
  };

  try {
    const key = buildOfflineSignedKey(payload);
    await logAudit({
      actorType: 'admin',
      actorId: req.admin.sub,
      action: 'generate_offline_key',
      targetType: 'license',
      targetId: licenseId,
      payload: { deviceId, durationDays, expiresAt: payload.expiresAt }
    });
    return res.json({
      ok: true,
      key,
      payload
    });
  } catch (error) {
    return res.status(500).json({ error: String(error?.message || error) });
  }
});

app.post('/api/license/activate', async (req, res) => {
  const licenseKey = String(req.body?.licenseKey || '').trim().toUpperCase();
  const deviceFingerprint = String(req.body?.deviceFingerprint || '').trim();
  const appVersion = String(req.body?.appVersion || '').trim();
  const requestIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

  if (!licenseKey || !deviceFingerprint) {
    return res.status(400).json({ error: 'licenseKey y deviceFingerprint son obligatorios' });
  }

  const licResult = await pool.query(
    `SELECT * FROM licenses WHERE UPPER(license_key) = $1 LIMIT 1`,
    [licenseKey]
  );
  if (licResult.rowCount === 0) {
    await pool.query(
      `INSERT INTO activations (id, request_ip, app_version, result, details) VALUES ($1,$2,$3,$4,$5)`,
      [uuidv4(), String(requestIp), appVersion || null, 'rejected', 'license_not_found']
    );
    return res.status(404).json({ error: 'Licencia no encontrada' });
  }

  const license = licResult.rows[0];
  if (license.status !== 'active') {
    await pool.query(
      `INSERT INTO activations (id, license_id, request_ip, app_version, result, details) VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv4(), license.id, String(requestIp), appVersion || null, 'rejected', `status_${license.status}`]
    );
    return res.status(403).json({ error: `Licencia no activa (${license.status})` });
  }

  if (isExpired(license.expires_at)) {
    await pool.query(`UPDATE licenses SET status = 'expired', updated_at = NOW() WHERE id = $1`, [license.id]);
    await pool.query(
      `INSERT INTO activations (id, license_id, request_ip, app_version, result, details) VALUES ($1,$2,$3,$4,$5,$6)`,
      [uuidv4(), license.id, String(requestIp), appVersion || null, 'rejected', 'expired']
    );
    return res.status(403).json({ error: 'Licencia expirada' });
  }

  const deviceQuery = await pool.query(
    `SELECT * FROM devices WHERE license_id = $1 AND device_fingerprint = $2 LIMIT 1`,
    [license.id, deviceFingerprint]
  );

  let deviceId;
  if (deviceQuery.rowCount > 0) {
    deviceId = deviceQuery.rows[0].id;
    await pool.query(
      `UPDATE devices SET last_seen_at = NOW(), app_version = $2 WHERE id = $1`,
      [deviceId, appVersion || null]
    );
  } else {
    const countQuery = await pool.query(`SELECT COUNT(*)::int AS total FROM devices WHERE license_id = $1`, [license.id]);
    const total = Number(countQuery.rows[0]?.total || 0);
    if (total >= Number(license.max_devices || DEVICE_LIMIT_DEFAULT)) {
      await pool.query(
        `INSERT INTO activations (id, license_id, request_ip, app_version, result, details) VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv4(), license.id, String(requestIp), appVersion || null, 'rejected', 'max_devices_reached']
      );
      return res.status(403).json({ error: 'Límite de dispositivos alcanzado' });
    }
    deviceId = uuidv4();
    await pool.query(
      `INSERT INTO devices (id, license_id, device_fingerprint, app_version) VALUES ($1,$2,$3,$4)`,
      [deviceId, license.id, deviceFingerprint, appVersion || null]
    );
  }

  await pool.query(
    `INSERT INTO activations (id, license_id, device_id, request_ip, app_version, result, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [uuidv4(), license.id, deviceId, String(requestIp), appVersion || null, 'ok', 'activated']
  );

  const token = jwt.sign(
    {
      sub: license.id,
      licenseKey: license.license_key,
      deviceId,
      status: license.status,
      maxDevices: license.max_devices,
      plan: license.plan
    },
    LICENSE_JWT_SECRET,
    { expiresIn: '30d' }
  );

  return res.json({
    ok: true,
    token,
    license: {
      id: license.id,
      licenseKey: license.license_key,
      status: license.status,
      plan: license.plan,
      maxDevices: license.max_devices,
      expiresAt: license.expires_at
    }
  });
});

app.post('/api/license/validate', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  try {
    const payload = jwt.verify(token, LICENSE_JWT_SECRET);
    const check = await pool.query('SELECT status, expires_at FROM licenses WHERE id = $1 LIMIT 1', [payload.sub]);
    if (check.rowCount === 0) return res.status(404).json({ valid: false, error: 'Licencia no existe' });
    const lic = check.rows[0];
    if (lic.status !== 'active' || isExpired(lic.expires_at)) {
      return res.status(403).json({ valid: false, error: 'Licencia no válida actualmente' });
    }
    return res.json({ valid: true, payload });
  } catch (_error) {
    return res.status(401).json({ valid: false, error: 'Token inválido' });
  }
});

async function bootstrap() {
  await ensureSchemaAndAdmin();
  app.listen(PORT, () => {
    console.log(`[${nowIso()}] Licensing server escuchando en http://localhost:${PORT}`);
    console.log(`[${nowIso()}] Panel admin en http://localhost:${PORT}/admin`);
  });
}

bootstrap().catch((error) => {
  console.error('No se pudo iniciar licensing-server:', error);
  process.exit(1);
});
