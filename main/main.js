/**
 * MRS_TPV - Proceso principal Electron
 * Reglas: contextIsolation true, nodeIntegration false.
 * PocketBase embebido si existe el ejecutable.
 */
const { app, BrowserWindow, ipcMain, dialog, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const os = require('os');
const net = require('net');

const CONFIG_FILE = 'mrs_tpv_config.json';
const SESSION_FILE = 'mrs_tpv_session.json';
const CATEGORIAS_FILE = 'mrs_tpv_categorias.json';
const PRODUCTOS_FILE = 'mrs_tpv_productos.json';
const CAJA_ACTUAL_FILE = 'mrs_tpv_caja_actual.json';
const CLIENTES_FILE = 'mrs_tpv_clientes.json';
const TICKETS_FILE = 'mrs_tpv_tickets.json';
const FACTURAS_FILE = 'mrs_tpv_facturas.json';
const GESTION_PRESUPUESTOS_FILE = 'mrs_tpv_gestion_presupuestos.json';
const GESTION_ALBARANES_FILE = 'mrs_tpv_gestion_albaranes.json';
const GESTION_SERIES_FILE = 'mrs_tpv_gestion_series.json';
const REPARACIONES_FILE = 'mrs_tpv_reparaciones.json';
const REPARACIONES_SERIES_FILE = 'mrs_tpv_reparaciones_series.json';
const DISTRIBUIDORES_FILE = 'mrs_tpv_distribuidores.json';
const REGISTROS_FISCALES_FILE = 'mrs_tpv_registros_fiscales.json';
const AUDIT_TRAIL_FILE = 'mrs_tpv_audit_trail.json';
const USER_ROLES_FILE = 'mrs_tpv_user_roles.json';
const USER_NAMES_FILE = 'mrs_tpv_user_names.json';
const PB_SUPERUSER_FILE = 'mrs_tpv_pb_superuser.json';
const LICENSE_FILE = 'mrs_tpv_license.json';
const LICENSE_TRIAL_DAYS = 15;
const LICENSE_PUBLIC_KEY_FILE = 'license_public_key.pem';
const LICENSE_SERVER_URL = String(process.env.MRS_LICENSE_SERVER_URL || 'http://localhost:4040/api').replace(/\/+$/, '');
const LICENSE_VALIDATE_INTERVAL_HOURS = Math.max(1, Number(process.env.MRS_LICENSE_VALIDATE_INTERVAL_HOURS || 12));
const LICENSE_OFFLINE_GRACE_DAYS = Math.max(1, Number(process.env.MRS_LICENSE_OFFLINE_GRACE_DAYS || 7));
let mainWindow = null;
let pocketbaseProcess = null;
let PB_PORT = 8090;
let updateState = { status: 'idle', message: '', source: 'none' };
let updateCheckInProgress = false;
let updateDownloadInProgress = false;
let cachedLicensePublicKeyPem = '';

function getLicensePath() {
  return path.join(app.getPath('userData'), LICENSE_FILE);
}

function getTrialAnchorPath() {
  // Archivo fuera de userData para que no se reinicie al reinstalar.
  return path.join(os.homedir(), '.mrs_tpv_trial_anchor.json');
}

function fromBase64Url(txt) {
  const str = String(txt || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str + pad, 'base64').toString('utf8');
}

function fromBase64UrlToBuffer(txt) {
  const str = String(txt || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str + pad, 'base64');
}

function getLicensePublicKeyPem() {
  if (cachedLicensePublicKeyPem) return cachedLicensePublicKeyPem;
  const envPem = String(process.env.MRS_LICENSE_PUBLIC_KEY_PEM || '').trim();
  if (envPem) {
    cachedLicensePublicKeyPem = envPem.replace(/\\n/g, '\n');
    return cachedLicensePublicKeyPem;
  }
  try {
    const p = path.join(__dirname, LICENSE_PUBLIC_KEY_FILE);
    if (fs.existsSync(p)) {
      cachedLicensePublicKeyPem = fs.readFileSync(p, 'utf8');
      return cachedLicensePublicKeyPem;
    }
  } catch (_) {
    return '';
  }
  return '';
}

function verifyLicenseSignature(payloadB64, sigB64Url) {
  const pubPem = getLicensePublicKeyPem();
  if (!pubPem) {
    return { ok: false, error: 'Sistema de licencias no configurado (falta clave pública).' };
  }
  try {
    const payloadBuf = Buffer.from(String(payloadB64 || ''), 'utf8');
    const sigBuf = fromBase64UrlToBuffer(sigB64Url);
    const ok = crypto.verify(null, payloadBuf, pubPem, sigBuf);
    return ok ? { ok: true } : { ok: false, error: 'Firma de licencia inválida.' };
  } catch (_) {
    return { ok: false, error: 'No se pudo validar la firma de la licencia.' };
  }
}

function pickStableMac() {
  try {
    const ifs = os.networkInterfaces() || {};
    const all = Object.values(ifs).flat().filter(Boolean);
    const candidate = all.find((n) => !n.internal && n.mac && n.mac !== '00:00:00:00:00:00');
    return candidate?.mac || '';
  } catch (_) {
    return '';
  }
}

function getDeviceId() {
  let user = '';
  try { user = os.userInfo().username || ''; } catch (_) {}
  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    user,
    pickStableMac()
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24);
}

function extractLicenseKeyFromText(raw) {
  const txt = String(raw || '').trim();
  if (!txt) return '';
  if (txt.startsWith('MRS-') || txt.startsWith('MRS2.')) return txt;
  const parsed = safeJsonParse(txt, null);
  if (parsed && typeof parsed === 'object') {
    const key = String(parsed.key || parsed.licenseKey || '').trim();
    if (key.startsWith('MRS-') || key.startsWith('MRS2.')) return key;
  }
  return '';
}

function readLicenseRaw() {
  try {
    const p = getLicensePath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeLicenseRaw(data) {
  try {
    fs.writeFileSync(getLicensePath(), JSON.stringify(data || {}, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('write-license error', e);
    return false;
  }
}

function readTrialAnchor() {
  try {
    const p = getTrialAnchorPath();
    if (!fs.existsSync(p)) return null;
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeTrialAnchor(data) {
  try {
    const p = getTrialAnchorPath();
    fs.writeFileSync(p, JSON.stringify(data || {}, null, 2), 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

function resolveTrialStartIso() {
  const anchor = readTrialAnchor();
  const deviceId = getDeviceId();
  const anchorTs = parseIsoTs(anchor?.trialStartAt);
  if (anchorTs && String(anchor?.deviceId || '') === deviceId) {
    return new Date(anchorTs).toISOString();
  }
  const created = {
    version: 1,
    deviceId,
    trialStartAt: new Date().toISOString()
  };
  writeTrialAnchor(created);
  return created.trialStartAt;
}

function ensureLicenseStore() {
  const current = readLicenseRaw();
  if (current && typeof current === 'object') {
    const resolvedTrialStartAt = resolveTrialStartIso();
    const currentTs = parseIsoTs(current.trialStartAt);
    const anchorTs = parseIsoTs(resolvedTrialStartAt);
    const normalized = { ...current };
    // Si el archivo local fue reiniciado, respetamos la fecha ancla más antigua.
    if (!currentTs || (anchorTs && currentTs > anchorTs)) {
      normalized.trialStartAt = resolvedTrialStartAt;
    }
    normalized.trialDays = LICENSE_TRIAL_DAYS;
    if (JSON.stringify(normalized) !== JSON.stringify(current)) {
      writeLicenseRaw(normalized);
    }
    return normalized;
  }
  const created = {
    version: 1,
    deviceId: getDeviceId(),
    trialStartAt: resolveTrialStartIso(),
    trialDays: LICENSE_TRIAL_DAYS,
    activation: null
  };
  writeLicenseRaw(created);
  return created;
}

function parseIsoTs(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : null;
}

function asDayCeil(diffMs) {
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(String(text || ''));
  } catch (_) {
    return fallback;
  }
}

function decodeJwtPayloadUnsafe(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    return safeJsonParse(fromBase64Url(parts[1]), null);
  } catch (_) {
    return null;
  }
}

function isLegacySignedLicenseKey(key) {
  return String(key || '').trim().startsWith('MRS2.');
}

async function postJsonWithTimeout(url, body, timeoutMs = 5000) {
  if (typeof fetch !== 'function') {
    throw new Error('fetch no disponible en este entorno.');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    const text = await res.text();
    const json = safeJsonParse(text, {});
    if (!res.ok) {
      const err = new Error(String(json?.error || 'Error HTTP ' + res.status));
      err.status = res.status;
      err.payload = json;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function buildServerActivationStatus(base, activation, now) {
  const token = String(activation?.token || '');
  if (!token) {
    return { ...base, status: 'blocked', daysLeft: 0, message: 'Licencia remota inválida (sin token).' };
  }

  const payload = decodeJwtPayloadUnsafe(token) || {};
  const expTs = Number(payload?.exp) > 0 ? (Number(payload.exp) * 1000) : null;
  const validatedTs = parseIsoTs(activation?.validatedAt) || parseIsoTs(activation?.activatedAt) || now;
  const lastCheckTs = parseIsoTs(activation?.lastCheckAt) || null;
  const invalidReason = String(activation?.invalidReason || '').trim();

  if (invalidReason) {
    return { ...base, status: 'blocked', daysLeft: 0, message: 'Licencia rechazada por servidor: ' + invalidReason };
  }
  if (Number.isFinite(expTs) && now > expTs) {
    return { ...base, status: 'blocked', daysLeft: 0, message: 'La licencia remota está vencida.' };
  }

  const graceMs = LICENSE_OFFLINE_GRACE_DAYS * 86400000;
  const staleMs = now - validatedTs;
  if (staleMs > graceMs) {
    return {
      ...base,
      status: 'blocked',
      daysLeft: 0,
      message: 'No se pudo validar la licencia durante ' + LICENSE_OFFLINE_GRACE_DAYS + ' días. Conecta internet para reactivar.'
    };
  }

  const shouldRefresh = !lastCheckTs || ((now - lastCheckTs) > (LICENSE_VALIDATE_INTERVAL_HOURS * 3600000));
  const offlineGraceLeft = asDayCeil(graceMs - staleMs);
  return {
    ...base,
    status: 'active',
    daysLeft: Number.isFinite(expTs) ? asDayCeil(expTs - now) : null,
    message: shouldRefresh
      ? 'Licencia activa. Validación pendiente con servidor.'
      : 'Licencia activa.',
    license: {
      id: String(activation?.license?.id || payload?.sub || ''),
      customer: String(activation?.license?.customer || ''),
      plan: String(activation?.license?.plan || payload?.plan || ''),
      issuedAt: String(activation?.activatedAt || ''),
      expiresAt: Number.isFinite(expTs) ? new Date(expTs).toISOString() : '',
      source: 'server',
      serverUrl: LICENSE_SERVER_URL,
      offlineGraceDaysLeft: offlineGraceLeft
    }
  };
}

async function refreshServerActivationIfNeeded(force = false) {
  const store = ensureLicenseStore();
  const activation = store?.activation;
  if (!activation || activation.mode !== 'server' || !activation.token) {
    return getLicenseStatusInternal();
  }

  const now = Date.now();
  const lastCheckTs = parseIsoTs(activation.lastCheckAt) || 0;
  const intervalMs = LICENSE_VALIDATE_INTERVAL_HOURS * 3600000;
  if (!force && lastCheckTs && (now - lastCheckTs) < intervalMs) {
    return getLicenseStatusInternal();
  }

  try {
    const result = await postJsonWithTimeout(LICENSE_SERVER_URL + '/license/validate', { token: activation.token }, 5000);
    if (result?.valid) {
      store.activation = {
        ...activation,
        validatedAt: new Date().toISOString(),
        lastCheckAt: new Date().toISOString(),
        lastResult: 'ok',
        invalidReason: ''
      };
      writeLicenseRaw(store);
    }
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status === 401 || status === 403 || status === 404) {
      store.activation = {
        ...activation,
        lastCheckAt: new Date().toISOString(),
        lastResult: 'invalid',
        invalidReason: String(error?.message || 'token_invalido')
      };
      writeLicenseRaw(store);
    } else {
      store.activation = {
        ...activation,
        lastCheckAt: new Date().toISOString(),
        lastResult: 'network_error'
      };
      writeLicenseRaw(store);
    }
  }

  return getLicenseStatusInternal();
}

function decodeAndValidateLicenseKey(key) {
  const txt = String(key || '').trim();
  const parts = txt.split('.');
  if (parts.length !== 3 || parts[0] !== 'MRS2') {
    return { ok: false, error: 'Formato de licencia inválido. Se esperaba MRS2.' };
  }
  const payloadB64 = parts[1];
  const sig = parts[2];
  const check = verifyLicenseSignature(payloadB64, sig);
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  let payload = null;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64));
  } catch (_) {
    return { ok: false, error: 'Contenido de licencia inválido.' };
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: 'Licencia inválida.' };
  }
  const issuedAt = payload.issuedAt ? parseIsoTs(payload.issuedAt) : null;
  const expiresAt = payload.expiresAt ? parseIsoTs(payload.expiresAt) : null;
  if (payload.expiresAt && !expiresAt) {
    return { ok: false, error: 'Fecha de vencimiento inválida.' };
  }
  return {
    ok: true,
    payload: {
      ...payload,
      _issuedAtTs: issuedAt,
      _expiresAtTs: expiresAt
    }
  };
}

function getLicenseStatusInternal() {
  const lic = ensureLicenseStore();
  const now = Date.now();
  const deviceId = getDeviceId();
  const trialDays = Number(lic?.trialDays || LICENSE_TRIAL_DAYS);
  const trialStartTs = parseIsoTs(lic?.trialStartAt) || now;
  const trialEndTs = trialStartTs + (trialDays * 86400000);

  const base = {
    ok: true,
    deviceId,
    deviceHint: deviceId.slice(0, 8),
    trialDays,
    trialStartAt: new Date(trialStartTs).toISOString(),
    trialEndAt: new Date(trialEndTs).toISOString(),
    status: 'trial',
    daysLeft: asDayCeil(trialEndTs - now),
    message: ''
  };

  const activation = lic?.activation;
  if (activation?.key) {
    if (activation.mode === 'server') {
      return buildServerActivationStatus(base, activation, now);
    }
    const parsed = decodeAndValidateLicenseKey(activation.key);
    if (!parsed.ok) {
      return { ...base, status: 'blocked', daysLeft: 0, message: 'Licencia inválida: ' + parsed.error };
    }
    const payload = parsed.payload || {};
    if (payload.deviceId && String(payload.deviceId) !== deviceId) {
      return { ...base, status: 'blocked', daysLeft: 0, message: 'La licencia no corresponde a este equipo.' };
    }
    const expTs = payload._expiresAtTs;
    if (Number.isFinite(expTs) && now > expTs) {
      return {
        ...base,
        status: 'blocked',
        daysLeft: 0,
        message: 'La licencia está vencida.',
        license: { ...payload, expiresAt: new Date(expTs).toISOString() }
      };
    }
    return {
      ...base,
      status: 'active',
      daysLeft: Number.isFinite(expTs) ? asDayCeil(expTs - now) : null,
      message: Number.isFinite(expTs) ? 'Licencia activa.' : 'Licencia activa (sin vencimiento).',
      license: {
        id: payload.licenseId || '',
        customer: payload.customer || '',
        plan: payload.plan || '',
        issuedAt: payload.issuedAt || '',
        expiresAt: Number.isFinite(expTs) ? new Date(expTs).toISOString() : '',
        source: String(payload.source || 'legacy')
      }
    };
  }

  if (now > trialEndTs) {
    return { ...base, status: 'blocked', daysLeft: 0, message: 'El periodo de prueba de ' + trialDays + ' días ha finalizado.' };
  }
  if (base.daysLeft <= 10) {
    return { ...base, status: 'trial', message: 'Te quedan ' + base.daysLeft + ' días de prueba.' };
  }
  return { ...base, status: 'trial', message: 'Prueba activa.' };
}

function getConfigPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function getSessionPath() {
  return path.join(app.getPath('userData'), SESSION_FILE);
}

function getPbSuperuserPath() {
  return path.join(app.getPath('userData'), PB_SUPERUSER_FILE);
}

function getPocketBasePath() {
  const inDev = path.join(__dirname, '..', 'database', 'pocketbase.exe');
  const inProd = path.join(process.resourcesPath, 'database', 'pocketbase.exe');
  if (app.isPackaged) {
    return fs.existsSync(inProd) ? inProd : null;
  }
  return fs.existsSync(inDev) ? inDev : (fs.existsSync(inProd) ? inProd : null);
}

function getDatabaseDir() {
  return path.join(app.getPath('userData'), 'pb_data');
}

function getUserRolesPath() {
  return path.join(app.getPath('userData'), USER_ROLES_FILE);
}

function getUserNamesPath() {
  return path.join(app.getPath('userData'), USER_NAMES_FILE);
}

function readUserRolesMap() {
  try {
    const p = getUserRolesPath();
    if (!fs.existsSync(p)) return {};
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeUserRolesMap(map) {
  try {
    fs.writeFileSync(getUserRolesPath(), JSON.stringify(map || {}, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('writeUserRolesMap error:', e);
    return false;
  }
}

function readUserNamesMap() {
  try {
    const p = getUserNamesPath();
    if (!fs.existsSync(p)) return {};
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeUserNamesMap(map) {
  try {
    fs.writeFileSync(getUserNamesPath(), JSON.stringify(map || {}, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('writeUserNamesMap error:', e);
    return false;
  }
}

function getStoredRoleForUser(record) {
  const id = String(record?.id || '').trim();
  const email = String(record?.email || '').trim().toLowerCase();
  const map = readUserRolesMap();
  const byId = id ? map['id:' + id] : '';
  const byEmail = email ? map['email:' + email] : '';
  return pbNormalizeRole(byId || byEmail || '');
}

function storeRoleForUser(record, role) {
  const normalized = pbNormalizeRole(role);
  if (!normalized) return false;
  const id = String(record?.id || '').trim();
  const email = String(record?.email || '').trim().toLowerCase();
  if (!id && !email) return false;
  const map = readUserRolesMap();
  if (id) map['id:' + id] = normalized;
  if (email) map['email:' + email] = normalized;
  return writeUserRolesMap(map);
}

function getStoredNameForUser(record) {
  const id = String(record?.id || '').trim();
  const email = String(record?.email || '').trim().toLowerCase();
  const map = readUserNamesMap();
  const byId = id ? map['id:' + id] : '';
  const byEmail = email ? map['email:' + email] : '';
  return String(byId || byEmail || '').trim();
}

function storeNameForUser(record, nombre) {
  const normalized = String(nombre || '').trim();
  if (!normalized) return false;
  const id = String(record?.id || '').trim();
  const email = String(record?.email || '').trim().toLowerCase();
  if (!id && !email) return false;
  const map = readUserNamesMap();
  if (id) map['id:' + id] = normalized;
  if (email) map['email:' + email] = normalized;
  return writeUserNamesMap(map);
}

function applyRoleFallback(record) {
  if (!record || typeof record !== 'object') return record;
  const raw = String(record.role ?? record.rol ?? '').trim();
  if (raw) {
    const normalized = pbNormalizeRole(raw);
    return { ...record, role: normalized };
  }
  const stored = getStoredRoleForUser(record);
  if (!stored) return record;
  return { ...record, role: stored };
}

function applyUserFallback(record) {
  const withRole = applyRoleFallback(record);
  const rawName = String(withRole?.nombre || withRole?.name || '').trim();
  if (rawName) {
    return { ...withRole, nombre: rawName };
  }
  const stored = getStoredNameForUser(withRole);
  if (!stored) return withRole;
  return { ...withRole, nombre: stored };
}

async function ensureUsersCollectionFields() {
  try {
    // Obtener la colección de usuarios
    const collectionRes = await pbAdminRequest('GET', '/api/collections/users');
    if (!collectionRes.ok) {
      console.error('No se pudo obtener la colección users:', collectionRes.data);
      return { ok: false, error: 'No se pudo obtener la colección users' };
    }
    
    const collection = collectionRes.data;
    const fields = Array.isArray(collection?.fields)
      ? collection.fields
      : (Array.isArray(collection?.schema?.fields) ? collection.schema.fields : []);
    
    // Verificar si el campo 'role' existe
    const hasRoleField = fields.some(f => f?.name === 'role' || f?.name === 'rol');
    const hasNombreField = fields.some(f => f?.name === 'nombre' || f?.name === 'name');
    
    let needsUpdate = false;
    const updatedFields = [...fields];
    
    // Añadir campo 'role' si no existe
    if (!hasRoleField) {
      console.log('Campo "role" no existe, creándolo...');
      updatedFields.push({
        id: 'role',
        name: 'role',
        type: 'select',
        required: false,
        presentable: false,
        unique: false,
        options: {
          maxSelect: 1,
          values: ['administrador', 'tecnico', 'dependiente']
        }
      });
      needsUpdate = true;
    }
    
    // Añadir campo 'nombre' si no existe
    if (!hasNombreField) {
      console.log('Campo "nombre" no existe, creándolo...');
      updatedFields.push({
        id: 'nombre',
        name: 'nombre',
        type: 'text',
        required: false,
        presentable: false,
        unique: false,
        options: {
          min: null,
          max: 80,
          pattern: ''
        }
      });
      needsUpdate = true;
    }
    
    // Actualizar la colección si es necesario
    if (needsUpdate) {
      console.log('Actualizando esquema de la colección users...');
      const candidates = [
        { fields: updatedFields },
        { schema: { fields: updatedFields } },
        { ...collection, fields: updatedFields },
        { ...collection, schema: { ...(collection.schema || {}), fields: updatedFields } }
      ];

      let lastErr = null;
      let patched = false;
      for (const body of candidates) {
        const res = await pbAdminRequest('PATCH', '/api/collections/users', body);
        if (res.ok) {
          patched = true;
          break;
        }
        lastErr = res;
      }

      if (!patched) {
        console.error('Error actualizando colección users:', lastErr?.data || lastErr);
        return { ok: false, error: 'No se pudo actualizar la colección users.' };
      }

      // Revalidar tras actualizar.
      const checkRes = await pbAdminRequest('GET', '/api/collections/users');
      if (!checkRes.ok) {
        return { ok: false, error: 'Colección users actualizada, pero no se pudo verificar.' };
      }
      const checkFields = Array.isArray(checkRes.data?.fields)
        ? checkRes.data.fields
        : (Array.isArray(checkRes.data?.schema?.fields) ? checkRes.data.schema.fields : []);
      const okRole = checkFields.some(f => f?.name === 'role' || f?.name === 'rol');
      const okNombre = checkFields.some(f => f?.name === 'nombre' || f?.name === 'name');
      if (!okRole || !okNombre) {
        return { ok: false, error: 'La colección users no reflejó los campos role/nombre tras el update.' };
      }

      console.log('Campos añadidos correctamente a la colección users');
      return { ok: true, fieldsAdded: { role: !hasRoleField, nombre: !hasNombreField } };
    } else {
      console.log('Todos los campos necesarios ya existen en la colección users');
      return { ok: true, fieldsAdded: { role: false, nombre: false } };
    }
  } catch (e) {
    console.error('ensureUsersCollectionFields error:', e);
    return { ok: false, error: String(e) };
  }
}

function runPocketBaseMigrations(pbExe, dbDir) {
  try {
    // Copiar migraciones al directorio de datos de PocketBase
    const migrationsSourceDir = path.join(__dirname, '..', 'database', 'pb_migrations');
    const migrationsTargetDir = path.join(dbDir, 'migrations');
    
    console.log('Ejecutando migraciones de PocketBase...');
    console.log('Directorio fuente:', migrationsSourceDir);
    console.log('Directorio destino:', migrationsTargetDir);
    
    if (fs.existsSync(migrationsSourceDir)) {
      if (!fs.existsSync(migrationsTargetDir)) {
        fs.mkdirSync(migrationsTargetDir, { recursive: true });
        console.log('Directorio de migraciones creado:', migrationsTargetDir);
      }
      
      // Copiar cada archivo de migración
      const migrationFiles = fs.readdirSync(migrationsSourceDir);
      console.log('Archivos de migración encontrados:', migrationFiles.length);
      
      for (const file of migrationFiles) {
        if (file.endsWith('.js')) {
          const sourcePath = path.join(migrationsSourceDir, file);
          const targetPath = path.join(migrationsTargetDir, file);
          fs.copyFileSync(sourcePath, targetPath);
          console.log('Migración copiada:', file);
        }
      }
    } else {
      console.warn('No se encontró el directorio de migraciones fuente:', migrationsSourceDir);
    }
    
    // Ejecutar migraciones
    console.log('Ejecutando migraciones con PocketBase...');
    const out = spawnSync(pbExe, ['migrate', 'up', '--dir=' + dbDir], {
      cwd: path.dirname(pbExe),
      stdio: 'pipe',
      windowsHide: true,
      encoding: 'utf8'
    });
    
    if (out.status !== 0) {
      const errTxt = (out.stderr || out.stdout || '').toString().trim();
      console.error('PocketBase migrate up error:', errTxt);
      console.error('Exit code:', out.status);
      return { ok: false, error: errTxt, exitCode: out.status };
    } else {
      const outTxt = (out.stdout || '').toString().trim();
      if (outTxt) console.log('PocketBase migrations output:', outTxt);
      console.log('Migraciones ejecutadas correctamente');
      return { ok: true, output: outTxt };
    }
  } catch (e) {
    console.error('runPocketBaseMigrations error:', e);
    return { ok: false, error: String(e) };
  }
}

function ensurePocketBaseSuperuser(pbExe, dbDir) {
  try {
    const p = getPbSuperuserPath();
    let creds = null;
    if (fs.existsSync(p)) {
      try {
        creds = JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (_) {
        creds = null;
      }
    }
    const email = String(creds?.email || 'system-admin@mrs.local').trim().toLowerCase();
    let password = String(creds?.password || '').trim();
    if (!password) {
      password = crypto.randomBytes(24).toString('base64url');
      fs.writeFileSync(p, JSON.stringify({ email, password }, null, 2), 'utf8');
    }
    const out = spawnSync(pbExe, ['superuser', 'upsert', email, password, '--dir=' + dbDir], {
      cwd: path.dirname(pbExe),
      stdio: 'pipe',
      windowsHide: true
    });
    if (out.status !== 0) {
      const errTxt = (out.stderr || '').toString().trim();
      if (errTxt) console.error('PocketBase superuser upsert:', errTxt);
    }
  } catch (e) {
    console.error('ensurePocketBaseSuperuser error:', e);
  }
}

function readPbSuperuserCreds() {
  try {
    const p = getPbSuperuserPath();
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const email = String(raw?.email || '').trim();
    const password = String(raw?.password || '').trim();
    if (!email || !password) return null;
    return { email, password };
  } catch (_) {
    return null;
  }
}

async function getPocketBaseUsersCount() {
  try {
    const creds = readPbSuperuserCreds();
    if (!creds) return null;
    const authRes = await fetch('http://127.0.0.1:' + PB_PORT + '/api/collections/_superusers/auth-with-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: creds.email, password: creds.password })
    });
    if (!authRes.ok) return null;
    const authData = await authRes.json().catch(() => null);
    const token = authData?.token;
    if (!token) return null;
    const usersRes = await fetch('http://127.0.0.1:' + PB_PORT + '/api/collections/users/records?perPage=1&page=1', {
      method: 'GET',
      headers: { Authorization: token }
    });
    if (!usersRes.ok) return null;
    const usersData = await usersRes.json().catch(() => null);
    return Number(usersData?.totalItems || 0);
  } catch (_) {
    return null;
  }
}

function pbNormalizeRole(raw) {
  const r = String(raw || '').trim().toLowerCase();
  if (r === 'admin') return 'administrador';
  if (r === 'técnico') return 'tecnico';
  if (r === 'administrador' || r === 'dependiente' || r === 'tecnico') return r;
  return r || 'dependiente';
}

function pbRoleVariants(role) {
  const raw = String(role || '').trim();
  return Array.from(new Set([
    raw,
    raw.toLowerCase(),
    raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(),
    raw.toUpperCase()
  ])).filter(Boolean);
}

async function pbSuperuserToken() {
  try {
    const creds = readPbSuperuserCreds();
    if (!creds) return { ok: false, error: 'Credenciales internas de PocketBase no disponibles.' };
    const authRes = await fetch('http://127.0.0.1:' + PB_PORT + '/api/collections/_superusers/auth-with-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: creds.email, password: creds.password })
    });
    const authData = await authRes.json().catch(() => ({}));
    if (!authRes.ok || !authData?.token) {
      return { ok: false, error: authData?.message || 'No se pudo autenticar superusuario en PocketBase.' };
    }
    return { ok: true, token: authData.token };
  } catch (e) {
    return { ok: false, error: String(e?.message || e || 'Error autenticando superusuario.') };
  }
}

async function pbAdminRequest(method, endpoint, body) {
  const auth = await pbSuperuserToken();
  if (!auth.ok) return { ok: false, status: 0, data: { message: auth.error } };
  try {
    const res = await fetch('http://127.0.0.1:' + PB_PORT + endpoint, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + auth.token
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { message: 'No se pudo conectar con PocketBase.' }, error: String(e) };
  }
}

function isTcpPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function pickPocketBasePort(preferredPort) {
  const base = Number(preferredPort || 8090);
  if (await isTcpPortFree(base)) return base;
  for (let i = 1; i <= 40; i += 1) {
    const candidate = base + i;
    if (await isTcpPortFree(candidate)) return candidate;
  }
  return null;
}

async function startPocketBase() {
  const pbExe = getPocketBasePath();
  if (!pbExe) return false;
  const pickedPort = await pickPocketBasePort(8090);
  if (!pickedPort) {
    console.error('No se encontró puerto libre para PocketBase.');
    return false;
  }
  PB_PORT = pickedPort;
  const dbDir = getDatabaseDir();
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  runPocketBaseMigrations(pbExe, dbDir);
  ensurePocketBaseSuperuser(pbExe, dbDir);
  pocketbaseProcess = spawn(pbExe, ['serve', '--http=127.0.0.1:' + PB_PORT, '--dir=' + dbDir], {
    cwd: path.dirname(pbExe),
    stdio: 'ignore',
    detached: false
  });
  pocketbaseProcess.on('error', (err) => console.error('PocketBase error:', err));
  pocketbaseProcess.on('exit', (code) => { if (code != null && code !== 0) console.error('PocketBase exit code:', code); });
  
  // Verificar y crear campos necesarios después de que PocketBase esté listo
  // Hacerlo con múltiples intentos para asegurar que PocketBase esté completamente iniciado
  let attempts = 0;
  const maxAttempts = 10;
  const checkFields = async () => {
    attempts++;
    const result = await ensureUsersCollectionFields();
    if (result.ok) {
      console.log('Verificación de campos completada:', result.fieldsAdded);
      if (result.fieldsAdded.role || result.fieldsAdded.nombre) {
        console.log('✅ Campos creados exitosamente. Los usuarios ahora pueden tener roles.');
      }
    } else {
      console.error('Error verificando campos (intento ' + attempts + '):', result.error);
      if (attempts < maxAttempts) {
        setTimeout(checkFields, 2000);
      }
    }
  };
  setTimeout(checkFields, 2000);
  
  return true;
}

function stopPocketBase() {
  return new Promise((resolve) => {
    if (!pocketbaseProcess) {
      resolve();
      return;
    }
    const pid = pocketbaseProcess.pid;
    pocketbaseProcess = null;
    try {
      if (os.platform() === 'win32') {
        const child = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', shell: true });
        child.on('close', () => setTimeout(resolve, 400));
        child.on('error', () => setTimeout(resolve, 400));
      } else {
        process.kill(pid, 'SIGTERM');
        setTimeout(resolve, 400);
      }
    } catch (_) {
      setTimeout(resolve, 400);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    title: 'MRS_TPV',
    autoHideMenuBar: false
  });
  mainWindow.setMenuBarVisibility(true);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function setUpdateState(status, message) {
  updateState = { ...updateState, status, message: message || '' };
}

function versionOf(v) {
  return String(v || '').replace(/^v/i, '').trim();
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    setUpdateState('disabled', 'Actualizaciones solo disponibles en la app instalada.');
    return;
  }
  updateState.source = 'github-releases';
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('checking-for-update', () => setUpdateState('checking', 'Buscando actualizaciones...'));
  autoUpdater.on('update-available', (info) => {
    const next = versionOf(info?.version);
    setUpdateState('available', 'Nueva versión detectada: ' + (next || 'disponible') + '.');
  });
  autoUpdater.on('update-not-available', () => setUpdateState('not-available', 'No hay actualizaciones disponibles.'));
  autoUpdater.on('download-progress', (progress) => {
    const pct = Number(progress?.percent || 0).toFixed(0);
    setUpdateState('downloading', 'Descargando actualización... ' + pct + '%');
  });
  autoUpdater.on('update-downloaded', (info) => {
    const v = versionOf(info?.version);
    setUpdateState('downloaded', 'Actualización descargada' + (v ? ' (' + v + ')' : '') + '. Pulsa "Reiniciar e instalar".');
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    dialog.showMessageBox(win || null, {
      type: 'info',
      title: 'Actualización lista',
      message: 'La actualización ya está descargada.',
      detail: '¿Quieres reiniciar ahora para instalarla?',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      defaultId: 0,
      cancelId: 1
    }).then((res) => {
      if (res.response === 0) {
        setUpdateState('installing', 'Reiniciando para instalar la actualización...');
        autoUpdater.quitAndInstall(false, true);
      }
    }).catch(() => {});
  });
  autoUpdater.on('error', (err) => {
    setUpdateState('error', 'Error comprobando actualizaciones: ' + String(err?.message || err));
  });
}

async function checkForUpdates(manual) {
  if (!app.isPackaged) {
    const msg = 'Actualizaciones solo disponibles en la app instalada.';
    setUpdateState('disabled', msg);
    return { ok: false, message: msg, state: updateState };
  }
  if (updateCheckInProgress) {
    return { ok: true, message: 'Ya hay una comprobación en curso.', state: updateState };
  }
  try {
    updateCheckInProgress = true;
    setUpdateState('checking', 'Buscando actualizaciones...');
    const result = await autoUpdater.checkForUpdates();
    const current = versionOf(app.getVersion());
    const next = versionOf(result?.updateInfo?.version);
    if (next && next !== current) {
      const msg = 'Nueva versión detectada: ' + next + '.';
      setUpdateState('available', msg);
      return { ok: true, message: msg, state: updateState };
    }
    const msg = 'No hay actualizaciones disponibles.';
    setUpdateState('not-available', msg);
    return { ok: true, message: msg, state: updateState };
  } catch (e) {
    const msg = 'Error comprobando actualizaciones: ' + String(e?.message || e);
    setUpdateState('error', msg);
    return { ok: false, message: msg, state: updateState };
  } finally {
    updateCheckInProgress = false;
    if (manual && updateState.status === 'checking') setUpdateState('idle', '');
  }
}

async function downloadUpdate(manual) {
  if (!app.isPackaged) {
    const msg = 'Descarga de actualización solo disponible en la app instalada.';
    setUpdateState('disabled', msg);
    return { ok: false, message: msg, state: updateState };
  }
  if (updateDownloadInProgress) {
    return { ok: true, message: 'Ya hay una descarga en curso.', state: updateState };
  }
  try {
    updateDownloadInProgress = true;
    if (updateState.status !== 'available' && updateState.status !== 'downloading') {
      const checked = await checkForUpdates(false);
      if (!checked.ok) return checked;
      if (updateState.status !== 'available') {
        return { ok: false, message: 'No hay una actualización disponible para descargar.', state: updateState };
      }
    }
    setUpdateState('downloading', 'Iniciando descarga de actualización...');
    await autoUpdater.downloadUpdate();
    return { ok: true, message: updateState.message || 'Descarga finalizada.', state: updateState };
  } catch (e) {
    const msg = 'Error descargando actualización: ' + String(e?.message || e);
    setUpdateState('error', msg);
    return { ok: false, message: msg, state: updateState };
  } finally {
    updateDownloadInProgress = false;
    if (manual && updateState.status === 'downloading') setUpdateState('idle', '');
  }
}

async function installDownloadedUpdate() {
  if (!app.isPackaged) {
    const msg = 'Instalación de actualización solo disponible en la app instalada.';
    setUpdateState('disabled', msg);
    return { ok: false, message: msg, state: updateState };
  }
  if (updateState.status !== 'downloaded') {
    const msg = 'Todavía no hay una actualización descargada para instalar.';
    return { ok: false, message: msg, state: updateState };
  }
  setUpdateState('installing', 'Reiniciando para instalar la actualización...');
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(false, true);
    } catch (_) {}
  }, 300);
  return { ok: true, message: 'La app se reiniciará para instalar la actualización.', state: updateState };
}

// IPC: comprobar si existe configuración inicial
ipcMain.handle('get-config', () => {
  try {
    const p = getConfigPath();
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('get-config error', e);
  }
  return null;
});

// IPC: guardar configuración (asistente inicial)
ipcMain.handle('set-config', (_event, config) => {
  try {
    const p = getConfigPath();
    fs.writeFileSync(p, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('set-config error', e);
    return false;
  }
});

// IPC: lista de impresoras del sistema
ipcMain.handle('get-printers', async () => {
  try {
    const win = mainWindow || BrowserWindow.getFocusedWindow();
    if (win?.webContents) {
      const wc = win.webContents;
      if (wc.getPrintersAsync) {
        const list = await wc.getPrintersAsync();
        return Array.isArray(list) ? list : [];
      }
      if (wc.getPrinters) {
        const list = wc.getPrinters();
        return Array.isArray(list) ? list : [];
      }
    }
  } catch (e) {
    console.error('get-printers error', e);
  }
  return [];
});

// IPC: seleccionar imagen para logo (devuelve base64 data URL)
ipcMain.handle('select-logo', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow || null, {
      title: 'Seleccionar logo',
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.length) return null;
    const buf = fs.readFileSync(result.filePaths[0]);
    const ext = path.extname(result.filePaths[0]).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[ext] || 'image/png';
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  } catch (e) {
    console.error('select-logo error', e);
    return null;
  }
});

// IPC: URL de PocketBase y si está disponible
ipcMain.handle('get-pb-url', () => ({
  url: 'http://127.0.0.1:' + PB_PORT,
  available: !!getPocketBasePath()
}));
ipcMain.handle('has-pb-users', async () => {
  const count = await getPocketBaseUsersCount();
  if (count == null) return true;
  return count > 0;
});

ipcMain.handle('run-pb-migrations', async () => {
  const pbExe = getPocketBasePath();
  if (!pbExe) {
    return { ok: false, error: 'PocketBase no está disponible' };
  }
  const dbDir = getDatabaseDir();
  const result = runPocketBaseMigrations(pbExe, dbDir);
  // También verificar campos después de ejecutar migraciones
  if (result.ok) {
    const fieldsResult = await ensureUsersCollectionFields();
    return { ...result, fieldsCheck: fieldsResult };
  }
  return result;
});

ipcMain.handle('ensure-pb-fields', async () => {
  return await ensureUsersCollectionFields();
});

ipcMain.handle('pb-admin-list-users', async () => {
  const perPage = 200;
  const first = await pbAdminRequest('GET', '/api/collections/users/records?perPage=' + perPage + '&page=1');
  if (!first.ok) return first;
  const all = Array.isArray(first.data?.items) ? [...first.data.items] : [];
  const totalPages = Number(first.data?.totalPages || 1);
  for (let page = 2; page <= totalPages; page += 1) {
    const res = await pbAdminRequest('GET', '/api/collections/users/records?perPage=' + perPage + '&page=' + page);
    if (!res.ok) return res;
    if (Array.isArray(res.data?.items)) all.push(...res.data.items);
  }
  const withUserData = all.map((u) => applyUserFallback(u));
  return { ok: true, status: first.status, data: { ...first.data, items: withUserData, totalItems: withUserData.length, totalPages: 1 } };
});

ipcMain.handle('pb-admin-get-user', async (_event, recordId) => {
  const id = String(recordId || '').trim();
  if (!id) return { ok: false, status: 400, data: { message: 'Falta recordId.' } };
  const res = await pbAdminRequest('GET', '/api/collections/users/records/' + encodeURIComponent(id));
  if (!res.ok) return res;
  return { ...res, data: applyUserFallback(res.data) };
});

ipcMain.handle('pb-admin-create-user', async (_event, payload) => {
  try {
    const email = String(payload?.email || '').trim().toLowerCase();
    const password = String(payload?.password || '');
    const passwordConfirm = String(payload?.passwordConfirm || password);
    const nombre = String(payload?.nombre || '').trim();
    const roleWanted = pbNormalizeRole(payload?.role);
    
    if (!email || !password) {
      return { ok: false, status: 400, data: { message: 'Email y contraseña son obligatorios.' } };
    }

    const ensured = await ensureUsersCollectionFields();
    if (!ensured.ok) {
      console.warn('No se pudo preparar el esquema users (continuando con fallback de roles):', ensured.error);
    }

    // Verificar que PocketBase esté disponible
    const pbPath = getPocketBasePath();
    if (!pbPath) {
      return { ok: false, status: 503, data: { message: 'PocketBase no está disponible. Asegúrate de que pocketbase.exe esté en database/' } };
    }

    // Verificar si el usuario ya existe
    const emailFilter = encodeURIComponent(`email="${String(email).replace(/"/g, '\\"')}"`);
    const checkExisting = await pbAdminRequest('GET', '/api/collections/users/records?filter=' + emailFilter + '&perPage=1');
    if (checkExisting.ok && checkExisting.data?.items && checkExisting.data.items.length > 0) {
      const existingUser = checkExisting.data.items[0];
      return { 
        ok: false, 
        status: 409, 
        data: { 
          message: 'El email ya está registrado. Si quieres actualizar el usuario, usa la función de edición.',
          existingUserId: existingUser.id
        } 
      };
    }

    const firstBody = { email, password, passwordConfirm, role: roleWanted, nombre };
    let created = await pbAdminRequest('POST', '/api/collections/users/records', firstBody);
    let last = created;
    let lastErrorDetails = created?.data || null;

    // Segundo intento controlado solo si el error apunta a nombre/role no reconocido.
    const roleErr = created?.data?.data?.role?.message || '';
    const nombreErr = created?.data?.data?.nombre?.message || '';
    const needsFallback =
      !created.ok &&
      /unknown|invalid|not found|no such/i.test(String(roleErr + ' ' + nombreErr));

    if (needsFallback) {
      const fallbackBody = { email, password, passwordConfirm, rol: roleWanted, name: nombre };
      created = await pbAdminRequest('POST', '/api/collections/users/records', fallbackBody);
      last = created;
      lastErrorDetails = created?.data || lastErrorDetails;
    }

    if (created.ok) {
      const id = String(created.data?.id || '').trim();
      if (!id) return created;
      const check = await pbAdminRequest('GET', '/api/collections/users/records/' + encodeURIComponent(id));
      if (!check.ok) return created;
      const gotRole = pbNormalizeRole(check.data?.role || check.data?.rol);
      if (gotRole === roleWanted) {
        storeRoleForUser(check.data, roleWanted);
        storeNameForUser(check.data, nombre || check.data?.nombre || check.data?.name);
        return { ...check, data: applyUserFallback(check.data) };
      }
      // Intento corto de reparación del rol, sin bucles.
      const repairCandidates = [
        { role: roleWanted },
        { rol: roleWanted },
        { role: roleWanted, rol: roleWanted }
      ];
      for (const repairBody of repairCandidates) {
        const repairRole = await pbAdminRequest('PATCH', '/api/collections/users/records/' + encodeURIComponent(id), repairBody);
        if (!repairRole.ok) continue;
        const check2 = await pbAdminRequest('GET', '/api/collections/users/records/' + encodeURIComponent(id));
        if (check2.ok) {
          const gotRole2 = pbNormalizeRole(check2.data?.role || check2.data?.rol);
          if (gotRole2 === roleWanted) return check2;
        }
      }
      // Evitar usuarios inconsistentes: si no se pudo aplicar rol, revertir creación.
      // Último fallback: conservar usuario y persistir rol en mapa local.
      storeRoleForUser(check.data || { id, email }, roleWanted);
      storeNameForUser(check.data || { id, email }, nombre);
      const finalCheck = await pbAdminRequest('GET', '/api/collections/users/records/' + encodeURIComponent(id));
      if (finalCheck.ok) {
        storeNameForUser(finalCheck.data, nombre || finalCheck.data?.nombre || finalCheck.data?.name);
        return { ...finalCheck, data: applyUserFallback(finalCheck.data) };
      }
      return { ok: true, status: created.status, data: applyUserFallback(created.data || { id, email, role: roleWanted, nombre }) };
    }
    
    // Construir mensaje de error detallado
    let errorMessage = 'No se pudo crear el usuario.';
    if (lastErrorDetails) {
      // Verificar si es error de email duplicado
      if (lastErrorDetails.data && typeof lastErrorDetails.data === 'object' && lastErrorDetails.data.email) {
        const emailError = lastErrorDetails.data.email;
        if (emailError.code === 'validation_not_unique' || emailError.message?.includes('unique')) {
          return { 
            ok: false, 
            status: 409, 
            data: { 
              message: 'El email ya está registrado en el sistema.',
              code: 'email_exists'
            } 
          };
        }
      }
      
      const details = [];
      if (lastErrorDetails.message) details.push(lastErrorDetails.message);
      if (lastErrorDetails.data && typeof lastErrorDetails.data === 'object') {
        Object.keys(lastErrorDetails.data).forEach(key => {
          const fieldError = lastErrorDetails.data[key];
          if (fieldError && typeof fieldError === 'object' && fieldError.message) {
            details.push(`${key}: ${fieldError.message}`);
          } else if (fieldError) {
            details.push(`${key}: ${String(fieldError)}`);
          }
        });
      }
      if (details.length > 0) {
        errorMessage += ' Detalles: ' + details.join(' | ');
      }
    }
    
    console.error('Error final al crear usuario:', errorMessage, last);
    return last || { ok: false, status: 500, data: { message: errorMessage } };
  } catch (error) {
    console.error('Error crítico en pb-admin-create-user:', error);
    return { ok: false, status: 500, data: { message: 'Error crítico: ' + String(error?.message || error) } };
  }
});

function getPocketBaseUrl() {
  return 'http://127.0.0.1:' + PB_PORT;
}

ipcMain.handle('pb-admin-update-user', async (_event, recordId, patch) => {
  const id = String(recordId || '').trim();
  if (!id) return { ok: false, status: 400, data: { message: 'Falta recordId.' } };
  const nombre = patch?.nombre;
  const role = patch?.role;
  const password = patch?.password;
  const passwordConfirm = patch?.passwordConfirm || password;
  const roleWanted = role === undefined ? undefined : pbNormalizeRole(role);

  const ensured = await ensureUsersCollectionFields();
  if (!ensured.ok) {
    console.warn('No se pudo preparar el esquema users en update (continuando con fallback de roles):', ensured.error);
  }

  const body = {};
  if (password) {
    body.password = String(password);
    body.passwordConfirm = String(passwordConfirm || password);
  }
  if (nombre !== undefined) body.nombre = String(nombre || '').trim();
  if (roleWanted !== undefined) body.role = roleWanted;

  if (!Object.keys(body).length) {
    return { ok: false, status: 400, data: { message: 'No hay cambios para guardar.' } };
  }

  let updated = await pbAdminRequest('PATCH', '/api/collections/users/records/' + encodeURIComponent(id), body);

  // Fallback único si el backend no reconoce role/nombre con esos nombres.
  if (!updated.ok) {
    const roleErr = updated?.data?.data?.role?.message || '';
    const nombreErr = updated?.data?.data?.nombre?.message || '';
    const needsFallback =
      /unknown|invalid|not found|no such/i.test(String(roleErr + ' ' + nombreErr));
    if (needsFallback) {
      const fallback = {};
      if (password) {
        fallback.password = String(password);
        fallback.passwordConfirm = String(passwordConfirm || password);
      }
      if (nombre !== undefined) fallback.name = String(nombre || '').trim();
      if (roleWanted !== undefined) fallback.rol = roleWanted;
      updated = await pbAdminRequest('PATCH', '/api/collections/users/records/' + encodeURIComponent(id), fallback);
    }
  }

  if (!updated.ok) {
    if (nombre !== undefined) {
      storeNameForUser({ id }, nombre);
    }
    return updated;
  }

  const check = await pbAdminRequest('GET', '/api/collections/users/records/' + encodeURIComponent(id));
  if (!check.ok) return updated;
  if (roleWanted !== undefined && pbNormalizeRole(check.data?.role || check.data?.rol) !== roleWanted) {
    // Reparación adicional: algunos esquemas heredados usan "rol" o ignoran "role" silenciosamente.
    const repairCandidates = [
      { role: roleWanted },
      { rol: roleWanted }
    ];
    for (const repairBody of repairCandidates) {
      const repaired = await pbAdminRequest('PATCH', '/api/collections/users/records/' + encodeURIComponent(id), repairBody);
      if (!repaired.ok) continue;
      const recheck = await pbAdminRequest('GET', '/api/collections/users/records/' + encodeURIComponent(id));
      if (recheck.ok && pbNormalizeRole(recheck.data?.role || recheck.data?.rol) === roleWanted) {
        storeRoleForUser(recheck.data, roleWanted);
        if (nombre !== undefined) storeNameForUser(recheck.data, nombre);
        return { ...recheck, data: applyUserFallback(recheck.data) };
      }
    }
    // Fallback final: persistir rol en almacenamiento local para mantener consistencia.
    storeRoleForUser(check.data, roleWanted);
    if (nombre !== undefined) storeNameForUser(check.data, nombre);
    const fallbackCheck = await pbAdminRequest('GET', '/api/collections/users/records/' + encodeURIComponent(id));
    if (fallbackCheck.ok) {
      return { ...fallbackCheck, data: applyUserFallback(fallbackCheck.data) };
    }
    return { ...check, data: applyUserFallback({ ...check.data, role: roleWanted, nombre: nombre !== undefined ? nombre : check.data?.nombre }) };
  }
  if (roleWanted !== undefined) {
    storeRoleForUser(check.data, roleWanted);
  }
  if (nombre !== undefined) {
    storeNameForUser(check.data, nombre);
  }
  return { ...check, data: applyUserFallback(check.data) };
});

ipcMain.handle('pb-admin-delete-user', async (_event, recordId) => {
  const id = String(recordId || '').trim();
  if (!id) return { ok: false, status: 400, data: { message: 'Falta recordId.' } };
  return pbAdminRequest('DELETE', '/api/collections/users/records/' + encodeURIComponent(id));
});

// IPC: versión de la app
ipcMain.handle('get-version', () => {
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    return pkg.version || '0.0.1';
  } catch (_) {
    return '0.0.1';
  }
});

ipcMain.handle('copy-text', (_event, text) => {
  try {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e?.message || e) };
  }
});

ipcMain.handle('get-license-status', async () => {
  return refreshServerActivationIfNeeded(false);
});

async function activateLicenseByKey(key) {
  const trimmedKey = String(key || '').trim();
  if (!trimmedKey) {
    return { ok: false, message: 'Debes introducir una licencia.', status: getLicenseStatusInternal() };
  }

  if (isLegacySignedLicenseKey(trimmedKey)) {
    const parsed = decodeAndValidateLicenseKey(trimmedKey);
    if (!parsed.ok) {
      return { ok: false, message: parsed.error, status: getLicenseStatusInternal() };
    }
    const payload = parsed.payload || {};
    const deviceId = getDeviceId();
    if (payload.deviceId && String(payload.deviceId) !== deviceId) {
      return { ok: false, message: 'La licencia no pertenece a este equipo.', status: getLicenseStatusInternal() };
    }
    if (Number.isFinite(payload._expiresAtTs) && Date.now() > payload._expiresAtTs) {
      return { ok: false, message: 'La licencia está vencida.', status: getLicenseStatusInternal() };
    }
    const store = ensureLicenseStore();
    store.activation = {
      mode: 'legacy',
      key: trimmedKey,
      activatedAt: new Date().toISOString()
    };
    const saved = writeLicenseRaw(store);
    if (!saved) {
      return { ok: false, message: 'No se pudo guardar la licencia en disco.', status: getLicenseStatusInternal() };
    }
    return { ok: true, message: 'Licencia activada correctamente.', status: getLicenseStatusInternal() };
  }

  try {
    const response = await postJsonWithTimeout(LICENSE_SERVER_URL + '/license/activate', {
      licenseKey: trimmedKey,
      deviceFingerprint: getDeviceId(),
      appVersion: String(app.getVersion() || '0.0.0')
    }, 7000);

    if (!response?.ok || !response?.token) {
      return { ok: false, message: 'Respuesta inválida del servidor de licencias.', status: getLicenseStatusInternal() };
    }

    const store = ensureLicenseStore();
    store.activation = {
      mode: 'server',
      key: trimmedKey,
      token: String(response.token),
      license: response.license || {},
      activatedAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
      lastCheckAt: new Date().toISOString(),
      lastResult: 'ok',
      invalidReason: ''
    };
    const saved = writeLicenseRaw(store);
    if (!saved) {
      return { ok: false, message: 'No se pudo guardar la licencia en disco.', status: getLicenseStatusInternal() };
    }
    const status = await refreshServerActivationIfNeeded(true);
    return { ok: true, message: 'Licencia activada correctamente por servidor.', status };
  } catch (error) {
    return {
      ok: false,
      message: String(error?.message || 'No se pudo contactar con el servidor de licencias.'),
      status: getLicenseStatusInternal()
    };
  }
}

ipcMain.handle('activate-license-key', async (_event, key) => {
  return activateLicenseByKey(key);
});

ipcMain.handle('import-license-file', async () => {
  try {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar archivo de licencia',
      properties: ['openFile'],
      filters: [
        { name: 'Licencia', extensions: ['json', 'txt', 'lic', 'key'] },
        { name: 'Todos', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePaths?.length) {
      return { ok: false, message: 'Operación cancelada.' };
    }
    const filePath = String(result.filePaths[0] || '');
    const raw = fs.readFileSync(filePath, 'utf8');
    const extractedKey = extractLicenseKeyFromText(raw);
    if (!extractedKey) {
      return { ok: false, message: 'No se encontró una clave válida en el archivo seleccionado.' };
    }
    return activateLicenseByKey(extractedKey);
  } catch (error) {
    return { ok: false, message: 'No se pudo importar licencia: ' + String(error?.message || error) };
  }
});

ipcMain.handle('check-for-updates', async (_event, opts) => {
  const manual = !!(opts && opts.manual);
  return checkForUpdates(manual);
});

ipcMain.handle('get-update-status', () => updateState);
ipcMain.handle('download-update', async (_event, opts) => {
  const manual = !!(opts && opts.manual);
  return downloadUpdate(manual);
});
ipcMain.handle('install-downloaded-update', async () => installDownloadedUpdate());

// IPC: sesión (token guardado hasta cerrar sesión)
ipcMain.handle('get-session', () => {
  try {
    const p = getSessionPath();
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('get-session error', e);
  }
  return null;
});

ipcMain.handle('save-session', (_event, session) => {
  try {
    const p = getSessionPath();
    fs.writeFileSync(p, JSON.stringify(session), 'utf8');
    return true;
  } catch (e) {
    console.error('save-session error', e);
    return false;
  }
});

ipcMain.handle('clear-session', () => {
  try {
    const p = getSessionPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (e) {
    console.error('clear-session error', e);
    return false;
  }
});

function getDataPath(filename) {
  return path.join(app.getPath('userData'), filename);
}

function readJsonFile(filename, defaultVal) {
  try {
    const p = getDataPath(filename);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    console.error('readJson error', e);
  }
  return defaultVal;
}

function writeJsonFile(filename, data) {
  try {
    fs.writeFileSync(getDataPath(filename), JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('writeJson error', e);
    return false;
  }
}

ipcMain.handle('get-categorias', () => readJsonFile(CATEGORIAS_FILE, []));
ipcMain.handle('save-categorias', (_e, data) => writeJsonFile(CATEGORIAS_FILE, data));
ipcMain.handle('get-productos', () => readJsonFile(PRODUCTOS_FILE, []));
ipcMain.handle('save-productos', (_e, data) => writeJsonFile(PRODUCTOS_FILE, data));

ipcMain.handle('get-caja-actual', () => readJsonFile(CAJA_ACTUAL_FILE, null));
ipcMain.handle('save-caja-actual', (_e, data) => writeJsonFile(CAJA_ACTUAL_FILE, data));

ipcMain.handle('get-clientes', () => readJsonFile(CLIENTES_FILE, []));
ipcMain.handle('save-clientes', (_e, data) => writeJsonFile(CLIENTES_FILE, data));

ipcMain.handle('get-tickets', () => readJsonFile(TICKETS_FILE, []));
ipcMain.handle('save-tickets', (_e, data) => writeJsonFile(TICKETS_FILE, data));
ipcMain.handle('get-facturas', () => readJsonFile(FACTURAS_FILE, []));
ipcMain.handle('save-facturas', (_e, data) => writeJsonFile(FACTURAS_FILE, data));
ipcMain.handle('get-gestion-presupuestos', () => readJsonFile(GESTION_PRESUPUESTOS_FILE, []));
ipcMain.handle('save-gestion-presupuestos', (_e, data) => writeJsonFile(GESTION_PRESUPUESTOS_FILE, data));
ipcMain.handle('get-gestion-albaranes', () => readJsonFile(GESTION_ALBARANES_FILE, []));
ipcMain.handle('save-gestion-albaranes', (_e, data) => writeJsonFile(GESTION_ALBARANES_FILE, data));
ipcMain.handle('get-gestion-series', () => readJsonFile(GESTION_SERIES_FILE, {}));
ipcMain.handle('save-gestion-series', (_e, data) => writeJsonFile(GESTION_SERIES_FILE, data));
ipcMain.handle('get-reparaciones', () => readJsonFile(REPARACIONES_FILE, []));
ipcMain.handle('save-reparaciones', (_e, data) => writeJsonFile(REPARACIONES_FILE, data));
ipcMain.handle('get-reparaciones-series', () => readJsonFile(REPARACIONES_SERIES_FILE, {}));
ipcMain.handle('save-reparaciones-series', (_e, data) => writeJsonFile(REPARACIONES_SERIES_FILE, data));
ipcMain.handle('get-distribuidores', () => readJsonFile(DISTRIBUIDORES_FILE, []));
ipcMain.handle('save-distribuidores', (_e, data) => writeJsonFile(DISTRIBUIDORES_FILE, data));
ipcMain.handle('get-registros-fiscales', () => readJsonFile(REGISTROS_FISCALES_FILE, []));
ipcMain.handle('save-registros-fiscales', (_e, data) => writeJsonFile(REGISTROS_FISCALES_FILE, data));
ipcMain.handle('get-audit-trail', () => readJsonFile(AUDIT_TRAIL_FILE, []));
ipcMain.handle('save-audit-trail', (_e, data) => writeJsonFile(AUDIT_TRAIL_FILE, data));

function formatEuro(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
}

function formatFecha(iso) {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escHtml(v) {
  return String(v || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildPatternGridHtml(patternArr) {
  const seq = Array.isArray(patternArr) ? patternArr.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [];
  const selected = new Set(seq);
  let cells = '';
  for (let i = 1; i <= 9; i += 1) {
    const on = selected.has(i);
    cells += `<div class="pt-dot ${on ? 'on' : ''}">${i}</div>`;
  }
  const seqTxt = seq.length ? seq.join('-') : 'No indicado';
  return `
    <div class="pt-wrap">
      <div class="pt-grid">${cells}</div>
      <p class="pt-seq">Secuencia: ${escHtml(seqTxt)}</p>
    </div>
  `;
}

function buildRepairReceiptHtml(receipt, config) {
  const empresa = config || {};
  const rep = receipt || {};
  const themeRaw = String(empresa?.currentTheme || empresa?.temaDefecto || '').toLowerCase();
  const isDarkTheme = themeRaw === 'dark';
  const printedAt = new Date().toISOString();
  const printedDateOnly = new Date(printedAt).toLocaleDateString('es-ES');
  const accesoTipo = String(rep?.accesoTipo || 'ninguno').toLowerCase();
  const accesoLabel = accesoTipo === 'pin' ? 'PIN' : accesoTipo === 'password' ? 'Contraseña' : accesoTipo === 'patron' ? 'Patrón' : 'Sin bloqueo';
  const accesoValor = accesoTipo === 'patron'
    ? buildPatternGridHtml(rep?.accesoPatron || [])
    : `<p>${escHtml(rep?.accesoCodigo || (accesoTipo === 'ninguno' ? 'No aplica' : 'No indicado'))}</p>`;
  const nombreEmpresa = escHtml(empresa?.nombreEmpresa || 'MOBILE RING');
  const logoUrl = String(empresa?.logoUrl || '').trim();
  const companyVisual = logoUrl
    ? `<span class="logo-plate"><img src="${escHtml(logoUrl)}" alt="Logo empresa" class="company-logo js-auto-contrast-logo"></span>`
    : `<p><strong>${nombreEmpresa}</strong></p>`;
  const empresaLine = [empresa?.direccion, empresa?.telefono, empresa?.email, empresa?.cif].filter(Boolean).map((x) => escHtml(x)).join(' · ');
  const clienteLine = [rep?.clienteTelefono, rep?.clienteWhatsapp].filter(Boolean).map((x) => escHtml(x)).join(' · ');
  const stampTopTxt = 'SERVICIO TECNICO';
  const stampBottomTxt = 'RECIBIDO';
  const stampBandTxt = escHtml((empresa?.nombreEmpresa || 'EMPRESA').toUpperCase());
  const declaracionDepositoText = String(
    empresa?.declaracionDeposito ||
    `Acepto dejar el dispositivo indicado para su revisión y/o reparación en ${empresa?.nombreEmpresa || 'la empresa'}. Autorizo la manipulación técnica necesaria para diagnóstico y reparación.`
  );
  const declaracionDepositoHtml = escHtml(declaracionDepositoText).replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#222;padding:20px;background:#fff}
body.theme-dark{background:#0f172a;color:#e5e7eb}
h1{font-size:18px;margin:0 0 6px 0}
h2{font-size:14px;margin:0 0 8px 0}
.head{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}
.box{border:1px solid #d7d7d7;border-radius:8px;padding:10px}
body.theme-dark .box{border-color:#334155;background:#111827}
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.field{margin-bottom:7px}
.label{font-size:11px;color:#555;margin-bottom:2px}
body.theme-dark .label{color:#94a3b8}
.value{padding:6px 8px;border:1px solid #e6e6e6;border-radius:6px;min-height:30px;background:#fafafa}
body.theme-dark .value{border-color:#475569;background:#0b1220;color:#e2e8f0}
.accept{margin-top:14px;border:1px solid #cfcfcf;border-radius:8px;padding:10px;background:#f8f8f8}
body.theme-dark .accept{border-color:#475569;background:#111827}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px}
.sign-box{height:90px;border:1px dashed #999;border-radius:8px;padding:8px}
body.theme-dark .sign-box{border-color:#64748b}
.stamp{margin-top:10px;font-size:11px;color:#666}
.pt-grid{display:grid;grid-template-columns:repeat(3,32px);gap:8px;justify-content:flex-start;margin-top:4px}
.pt-dot{width:32px;height:32px;border-radius:50%;border:1px solid #999;display:flex;align-items:center;justify-content:center;font-size:10px;color:#777;background:#fff}
body.theme-dark .pt-dot{border-color:#64748b;color:#cbd5e1;background:#0f172a}
.pt-dot.on{background:#111;color:#fff;border-color:#111}
body.theme-dark .pt-dot.on{background:#e2e8f0;color:#111827;border-color:#e2e8f0}
.pt-seq{font-size:11px;color:#555;margin:8px 0 0 0}
body.theme-dark .pt-seq{color:#94a3b8}
.logo-plate{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  margin-bottom:8px;
  padding:6px 8px;
  border:1px solid #d8deea;
  border-radius:8px;
  background:#fff;
}
body.theme-dark .logo-plate{border-color:#475569;background:#0b1220}
.company-logo{max-width:140px;max-height:54px;object-fit:contain;display:block}
body.theme-light .company-logo{
  filter: brightness(0) invert(0);
}
body.theme-dark .company-logo{
  filter: brightness(0) invert(1);
}
.stamp-wrap{margin-top:-6px;display:flex;align-items:flex-start;gap:10px}
.stamp-circle{
  width:142px;
  height:142px;
  border:3px solid rgba(37,99,235,0.92);
  border-radius:50%;
  display:flex;
  align-items:center;
  justify-content:center;
  position:relative;
  background:transparent;
  overflow:hidden;
  box-shadow: inset 0 0 0 1px rgba(37,99,235,0.35);
  margin-top:-10px;
}
.stamp-circle::before{
  content:'';
  position:absolute;
  inset:11px;
  border:2px solid rgba(37,99,235,0.88);
  border-radius:50%;
}
.stamp-circle::after{
  content:'';
  position:absolute;
  inset:19px;
  border:1px dashed rgba(37,99,235,0.45);
  border-radius:50%;
}
body.theme-dark .stamp-circle{
  border-color:rgba(255,255,255,0.96);
  background:transparent;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.52);
}
body.theme-dark .stamp-circle::before{border-color:rgba(255,255,255,0.92)}
body.theme-dark .stamp-circle::after{border-color:rgba(255,255,255,0.45)}
.stamp-top,.stamp-bottom{
  position:absolute;
  left:8px;
  right:8px;
  text-align:center;
  font-size:8.5px;
  font-weight:700;
  color:#1d4ed8;
  letter-spacing:.8px;
  text-transform:uppercase;
  white-space:nowrap;
  transform:rotate(-8deg);
  transform-origin:center;
  z-index:2;
}
.stamp-top{top:18px}
.stamp-bottom{bottom:18px}
body.theme-dark .stamp-top,body.theme-dark .stamp-bottom{color:#ffffff}
.stamp-center-mark{
  position:absolute;
  inset:0;
  display:flex;
  align-items:center;
  justify-content:center;
  opacity:.18;
  transform:rotate(-8deg);
}
.logo-invert-dark{filter:invert(1) brightness(0.22) contrast(1.25) !important}
.logo-invert-light{filter:invert(1) brightness(1.2) contrast(1.05) !important}
.stamp-initials{font-weight:700;font-size:16px;color:#333}
body.theme-dark .stamp-initials{color:#dbeafe}
.stamp-band{
  position:absolute;
  left:6px;
  right:6px;
  top:50%;
  transform:translateY(-50%) rotate(-8deg);
  border:2px solid rgba(37,99,235,0.95);
  border-radius:9px;
  background:rgba(255,255,255,0.14);
  padding:6px 8px;
  text-align:center;
  box-shadow:0 0 0 1px rgba(255,255,255,0.5) inset;
  z-index:2;
  min-height:40px;
  display:flex;
  align-items:center;
  justify-content:center;
}
.stamp-band span{
  display:block;
  width:100%;
  font-size:18px;
  font-weight:900;
  color:#1d4ed8;
  letter-spacing:1px;
  line-height:1;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:clip;
  text-align:center;
  text-transform:uppercase;
}
body.theme-dark .stamp-band{
  border-color:rgba(255,255,255,0.96);
  background:rgba(255,255,255,0.12);
  box-shadow:0 0 0 1px rgba(255,255,255,0.52) inset;
}
body.theme-dark .stamp-band span{color:#ffffff}
.stamp-meta{font-size:11px;color:#555;line-height:1.4}
</style></head><body class="${isDarkTheme ? 'theme-dark' : 'theme-light'}">
<h1>Resguardo de reparación</h1>
<div class="head">
  <div class="box">
    <h2>Cliente</h2>
    <p><strong>${escHtml(rep?.clienteNombre || '-')}</strong></p>
    <p>${clienteLine || '-'}</p>
  </div>
  <div class="box">
    <h2>Empresa</h2>
    ${companyVisual}
    <p>${empresaLine || '-'}</p>
  </div>
</div>
<div class="row">
  <div class="box">
    <div class="field"><div class="label">Nº orden</div><div class="value">${escHtml(rep?.numero || 'BORRADOR')}</div></div>
    <div class="field"><div class="label">Fecha</div><div class="value">${escHtml(formatFecha(rep?.updatedAt || rep?.createdAt || new Date().toISOString()))}</div></div>
    <div class="field"><div class="label">Equipo</div><div class="value">${escHtml(rep?.marcaModelo || '-')}</div></div>
    <div class="field"><div class="label">IMEI / Serie</div><div class="value">${escHtml(rep?.imeiSerie || '-')}</div></div>
    <div class="field"><div class="label">Avería reportada</div><div class="value">${escHtml(rep?.averiaReportada || '-')}</div></div>
    <div class="field"><div class="label">Diagnóstico</div><div class="value">${escHtml(rep?.diagnostico || '-')}</div></div>
  </div>
  <div class="box">
    <div class="field"><div class="label">Estado</div><div class="value">${escHtml(rep?.estadoLabel || rep?.estado || '-')}</div></div>
    <div class="field"><div class="label">Tipo de acceso</div><div class="value">${escHtml(accesoLabel)}</div></div>
    <div class="field"><div class="label">Código / Patrón</div><div class="value">${accesoValor}</div></div>
    <div class="field"><div class="label">Importe estimado</div><div class="value">${escHtml(formatEuro(rep?.totalCliente || 0))}</div></div>
  </div>
</div>
<div class="accept">
  <strong>Declaración de depósito</strong>
  <p style="margin-top:8px">${declaracionDepositoHtml}</p>
</div>
<div class="sign">
  <div class="sign-box">
    <strong>Firma cliente</strong>
  </div>
  <div class="sign-box">
    <strong>Firma y sello empresa</strong>
    <div class="stamp-wrap">
      <div class="stamp-circle">
        <span class="stamp-top">★ ${stampTopTxt} ★</span>
        <div class="stamp-band"><span class="stamp-band-text">${stampBandTxt}</span></div>
        <span class="stamp-bottom">★ ${stampBottomTxt} ★</span>
      </div>
      <div class="stamp-meta">
        <div>Recibido por ${nombreEmpresa}</div>
        <div>Fecha sello: ${escHtml(formatFecha(printedAt))}</div>
        <div>Fecha (día): ${escHtml(printedDateOnly)}</div>
      </div>
    </div>
  </div>
</div>
<script>
function applyLogoContrast(img){
  // La inversión se aplica por CSS según theme-light/theme-dark.
  // Se mantiene la función para compatibilidad.
  return;
}

function prepareAndPrint(){
  fitStampBandText();
  const logos = Array.from(document.querySelectorAll('.js-auto-contrast-logo'));
  if (!logos.length) {
    setTimeout(function(){ window.print(); }, 260);
    return;
  }
  let pending = logos.length;
  let printed = false;
  const done = function () {
    pending -= 1;
    if (pending <= 0 && !printed) {
      printed = true;
      setTimeout(function(){ window.print(); }, 180);
    }
  };
  logos.forEach(function (img) {
    if (img.complete) {
      applyLogoContrast(img);
      done();
      return;
    }
    img.addEventListener('load', function () { applyLogoContrast(img); done(); }, { once: true });
    img.addEventListener('error', done, { once: true });
  });
  setTimeout(function(){
    if (!printed) {
      printed = true;
      window.print();
    }
  }, 900);
}

function fitStampBandText(){
  try {
    const textEl = document.querySelector('.stamp-band-text');
    const bandEl = textEl?.parentElement;
    if (!textEl || !bandEl) return;
    let size = 18;
    textEl.style.fontSize = size + 'px';
    const maxWidth = Math.max(30, bandEl.clientWidth - 12);
    while (size > 9 && textEl.scrollWidth > maxWidth) {
      size -= 1;
      textEl.style.fontSize = size + 'px';
    }
  } catch (_) {}
}

window.onload = prepareAndPrint;
</script>
</body></html>`;
}

function buildTicketHtml(ticket, config) {
  const nombreEmpresa = config?.nombreEmpresa || 'MRS_TPV';
  const emailEmpresa = config?.email || '';
  // Compatibilidad: soporta claves antiguas (ticketMostrar*) y nuevas (ticket*)
  const mostrarLogo = ((config?.ticketLogo ?? config?.ticketMostrarLogo) === true) && config?.logoUrl;
  const mostrarEmail = (config?.ticketEmail ?? config?.ticketMostrarEmail) === true;
  const mostrarRazonSocial = (config?.ticketRazonSocial ?? config?.ticketMostrarRazonSocial) !== false;
  const headerTicket = [];
  if (mostrarLogo && config.logoUrl) {
    headerTicket.push(`<p style="text-align:center;margin-bottom:6px"><img src="${config.logoUrl}" alt="Logo" style="max-width:120px;max-height:60px;object-fit:contain"></p>`);
  }
  if (mostrarRazonSocial) headerTicket.push(`<h2>${nombreEmpresa}</h2>`);
  if (mostrarEmail && emailEmpresa) headerTicket.push(`<p style="font-size:10px;text-align:center">${emailEmpresa.replace(/</g, '&lt;')}</p>`);
  if (headerTicket.length === 0) headerTicket.push(`<h2>${nombreEmpresa}</h2>`);
  const lineasHtml = (ticket.lineas || []).map(l => {
    const subtotal = (l.precio || 0) * (l.cantidad || 1);
    return `<tr><td>${(l.nombre || '-').substring(0, 24)}</td><td>${l.cantidad || 1}</td><td>${formatEuro(l.precio)}</td><td>${formatEuro(subtotal)}</td></tr>`;
  }).join('');
  const ivaHtml = Object.entries(ticket.ivaPorTipo || {}).map(([iva, d]) =>
    `<tr><td colspan="3">IVA ${iva}%</td><td>${formatEuro(d.cuota)}</td></tr>`
  ).join('');
  const clienteInfo = ticket.cliente ? `<p>Cliente: ${(ticket.cliente.nombre || '-').substring(0, 30)}</p>` : '';
  const hashInfo = ticket.hash ? `<p style="font-size:10px">HASH: ${ticket.hash}</p>` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:monospace;font-size:12px;padding:12px;max-width:80mm;margin:0 auto}
h2{text-align:center;font-size:14px;margin-bottom:8px;border-bottom:1px dashed #000;padding-bottom:4px}
table{width:100%;border-collapse:collapse;margin:8px 0}
td{padding:2px 4px}
td:last-child{text-align:right}
.tot{font-weight:bold;margin-top:6px;border-top:1px solid #000;padding-top:4px}
.footer{text-align:center;margin-top:12px;font-size:10px}
</style></head><body>
${headerTicket.join('')}
<p><strong>${ticket.numero || '-'}</strong></p>
<p>${formatFecha(ticket.fechaHora)}</p>
${ticket.atendidoPor ? `<p>Atendido por: ${(ticket.atendidoPor || '').replace(/</g, '&lt;')}</p>` : ''}
<p>Pago: ${ticket.formaPago || '-'}</p>
${clienteInfo}
<table>
<tr><td>Producto</td><td>Cant</td><td>P.U.</td><td>Total</td></tr>
${lineasHtml}
${ivaHtml}
</table>
<p class="tot">TOTAL: ${formatEuro(ticket.total)}</p>
${hashInfo}
<p class="footer">Gracias por su compra</p>
<script>
window.onload=function(){
  setTimeout(function(){ window.print(); }, 300);
};
</script>
</body></html>`;
}

function buildFacturaHtml(factura, config) {
  const nombreEmpresa = config?.nombreEmpresa || 'MRS_TPV';
  const cif = config?.cif || '';
  const direccion = config?.direccion || '';
  const emailEmpresa = config?.email || '';
  const mostrarLogo = config?.facturaLogo !== false && !!config?.logoUrl;
  const mostrarEmail = config?.facturaEmail !== false;
  const mostrarRazonSocial = config?.facturaRazonSocial !== false;
  const lineasHtml = (factura.lineas || []).map(l => {
    const subtotal = (l.precio || 0) * (l.cantidad || 1);
    return `<tr><td>${(l.nombre || '-').replace(/</g, '&lt;')}</td><td>${l.cantidad || 1}</td><td>${formatEuro(l.precio)}</td><td>${formatEuro(subtotal)}</td></tr>`;
  }).join('');
  const ivaHtml = Object.entries(factura.ivaPorTipo || {}).map(([iva, d]) =>
    `<tr><td colspan="3">IVA ${iva}%</td><td>${formatEuro(d.cuota)}</td></tr>`
  ).join('');
  const clienteInfo = factura.cliente ? `
    <div class="cliente-block">
      <strong>Cliente:</strong> ${(factura.cliente.nombre || '-').replace(/</g, '&lt;')}<br>
      ${factura.cliente.telefono ? 'Tel: ' + factura.cliente.telefono + '<br>' : ''}
      ${factura.cliente.email ? 'Email: ' + factura.cliente.email : ''}
    </div>
  ` : '';
  const hashInfo = factura.hash ? `<p style="font-size:10px;margin-top:8px">HASH: ${factura.hash}</p>` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Georgia,serif;font-size:12px;padding:24px;max-width:210mm;margin:0 auto}
h1{font-size:18px;margin-bottom:4px}
.empresa{font-size:11px;color:#666;margin-bottom:16px}
.factura-header{display:flex;justify-content:space-between;margin-bottom:20px;border-bottom:2px solid #000;padding-bottom:12px}
.factura-num{font-size:16px;font-weight:bold}
table{width:100%;border-collapse:collapse;margin:12px 0}
th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #ddd}
th{background:#f5f5f5}
td:last-child,th:last-child{text-align:right}
.tot{font-size:14px;font-weight:bold;margin-top:12px;text-align:right}
.cliente-block{margin:12px 0;padding:8px;background:#f9f9f9;border-radius:4px}
.footer{text-align:center;margin-top:24px;font-size:10px;color:#666}
</style></head><body>
<div class="empresa">
  ${mostrarLogo && config?.logoUrl ? `<p style="margin-bottom:8px"><img src="${String(config.logoUrl).replace(/"/g, '&quot;')}" alt="Logo" style="max-width:180px;max-height:70px;object-fit:contain"></p>` : ''}
  ${mostrarRazonSocial ? `<h1>${nombreEmpresa.replace(/</g, '&lt;')}</h1>` : ''}
  ${cif ? '<p>CIF: ' + cif + '</p>' : ''}
  ${direccion ? '<p>' + direccion.replace(/</g, '&lt;') + '</p>' : ''}
  ${mostrarEmail && emailEmpresa ? '<p>Email: ' + String(emailEmpresa).replace(/</g, '&lt;') + '</p>' : ''}
</div>
<div class="factura-header">
  <div><span class="factura-num">FACTURA ${factura.numero || '-'}</span><br>${formatFecha(factura.fechaHora)}<br>Ticket: ${factura.ticketNumero || '-'}${factura.atendidoPor ? '<br>Atendido por: ' + (factura.atendidoPor || '').replace(/</g, '&lt;') : ''}</div>
</div>
${clienteInfo}
<table>
<tr><th>Concepto</th><th>Cant</th><th>P.U.</th><th>Total</th></tr>
${lineasHtml}
${ivaHtml}
</table>
<p class="tot">TOTAL: ${formatEuro(factura.total)}</p>
${hashInfo}
<p class="footer">Gracias por su confianza</p>
<script>
window.onload=function(){
  setTimeout(function(){ window.print(); }, 300);
};
</script>
</body></html>`;
}

ipcMain.handle('print-factura', async (_event, { factura, config }) => {
  try {
    const html = buildFacturaHtml(factura, config);
    const tmpFile = path.join(app.getPath('temp'), 'mrs_tpv_factura_' + Date.now() + '.html');
    fs.writeFileSync(tmpFile, html, 'utf8');

    const printWin = new BrowserWindow({
      show: true,
      width: 600,
      height: 800,
      webPreferences: { nodeIntegration: false }
    });

    printWin.on('closed', () => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    });

    await printWin.loadFile(tmpFile);
    return { ok: true };
  } catch (e) {
    console.error('print-factura error', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('print-ticket', async (_event, { ticket, config }) => {
  try {
    const html = buildTicketHtml(ticket, config);
    const tmpFile = path.join(app.getPath('temp'), 'mrs_tpv_ticket_' + Date.now() + '.html');
    fs.writeFileSync(tmpFile, html, 'utf8');

    const printWin = new BrowserWindow({
      show: true,
      width: 400,
      height: 600,
      webPreferences: { nodeIntegration: false }
    });

    printWin.on('closed', () => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    });

    await printWin.loadFile(tmpFile);
    return { ok: true };
  } catch (e) {
    console.error('print-ticket error', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('print-repair-receipt', async (_event, { receipt, config }) => {
  try {
    const html = buildRepairReceiptHtml(receipt, config);
    const tmpFile = path.join(app.getPath('temp'), 'mrs_tpv_repair_receipt_' + Date.now() + '.html');
    fs.writeFileSync(tmpFile, html, 'utf8');

    const printWin = new BrowserWindow({
      show: true,
      width: 900,
      height: 900,
      webPreferences: { nodeIntegration: false }
    });

    printWin.on('closed', () => {
      try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}
    });

    await printWin.loadFile(tmpFile);
    return { ok: true };
  } catch (e) {
    console.error('print-repair-receipt error', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('show-save-dialog', async (_event, options) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win || null, options);
  return result;
});

ipcMain.handle('export-to-pdf', async (_event, { html, defaultPath }) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win || null, {
      defaultPath: defaultPath || 'documento.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    const tmpFile = path.join(app.getPath('temp'), 'mrs_tpv_export_' + Date.now() + '.html');
    fs.writeFileSync(tmpFile, html, 'utf8');

    const pdfWin = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
    await pdfWin.loadFile(tmpFile);
    const pdfData = await pdfWin.webContents.printToPDF({ printBackground: true });
    pdfWin.close();
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch (_) {}

    fs.writeFileSync(result.filePath, pdfData);
    return { ok: true, path: result.filePath };
  } catch (e) {
    console.error('export-to-pdf error', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('export-to-csv', async (_event, { content, defaultPath }) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showSaveDialog(win || null, {
      defaultPath: defaultPath || 'export.csv',
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, '\ufeff' + content, 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    console.error('export-to-csv error', e);
    return { ok: false, error: String(e) };
  }
});

const BACKUP_VERSION = 1;
function createBackupData() {
  const userData = app.getPath('userData');
  const backup = {
    version: BACKUP_VERSION,
    fecha: new Date().toISOString(),
    config: readJsonFile(CONFIG_FILE, null),
    categorias: readJsonFile(CATEGORIAS_FILE, []),
    productos: readJsonFile(PRODUCTOS_FILE, []),
    cajaActual: readJsonFile(CAJA_ACTUAL_FILE, null),
    clientes: readJsonFile(CLIENTES_FILE, []),
    tickets: readJsonFile(TICKETS_FILE, []),
    facturas: readJsonFile(FACTURAS_FILE, []),
    gestionPresupuestos: readJsonFile(GESTION_PRESUPUESTOS_FILE, []),
    gestionAlbaranes: readJsonFile(GESTION_ALBARANES_FILE, []),
    gestionSeries: readJsonFile(GESTION_SERIES_FILE, {}),
    reparaciones: readJsonFile(REPARACIONES_FILE, []),
    reparacionesSeries: readJsonFile(REPARACIONES_SERIES_FILE, {}),
    distribuidores: readJsonFile(DISTRIBUIDORES_FILE, []),
    licencia: readLicenseRaw()
  };
  return backup;
}

function isValidBackup(obj) {
  return obj && typeof obj === 'object' && obj.version === BACKUP_VERSION &&
    Array.isArray(obj.categorias) && Array.isArray(obj.productos) &&
    Array.isArray(obj.clientes) && Array.isArray(obj.tickets) && Array.isArray(obj.facturas);
}

ipcMain.handle('backup-data', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const fecha = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(win || null, {
      defaultPath: `mrs_tpv_backup_${fecha}.json`,
      filters: [{ name: 'Backup MRS_TPV', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const backup = createBackupData();
    fs.writeFileSync(result.filePath, JSON.stringify(backup, null, 2), 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    console.error('backup-data error', e);
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('restore-data', async () => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const result = await dialog.showOpenDialog(win || null, {
      title: 'Seleccionar archivo de backup',
      filters: [{ name: 'Backup MRS_TPV', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths?.length) return { ok: false, canceled: true };
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const backup = JSON.parse(raw);
    if (!isValidBackup(backup)) {
      return { ok: false, error: 'Archivo de backup no válido o versión incompatible.' };
    }
    if (backup.config) writeJsonFile(CONFIG_FILE, backup.config);
    writeJsonFile(CATEGORIAS_FILE, backup.categorias);
    writeJsonFile(PRODUCTOS_FILE, backup.productos);
    writeJsonFile(CAJA_ACTUAL_FILE, backup.cajaActual);
    writeJsonFile(CLIENTES_FILE, backup.clientes);
    writeJsonFile(TICKETS_FILE, backup.tickets);
    writeJsonFile(FACTURAS_FILE, backup.facturas);
    writeJsonFile(GESTION_PRESUPUESTOS_FILE, Array.isArray(backup.gestionPresupuestos) ? backup.gestionPresupuestos : []);
    writeJsonFile(GESTION_ALBARANES_FILE, Array.isArray(backup.gestionAlbaranes) ? backup.gestionAlbaranes : []);
    writeJsonFile(GESTION_SERIES_FILE, backup.gestionSeries && typeof backup.gestionSeries === 'object' ? backup.gestionSeries : {});
    writeJsonFile(REPARACIONES_FILE, Array.isArray(backup.reparaciones) ? backup.reparaciones : []);
    writeJsonFile(REPARACIONES_SERIES_FILE, backup.reparacionesSeries && typeof backup.reparacionesSeries === 'object' ? backup.reparacionesSeries : {});
    writeJsonFile(DISTRIBUIDORES_FILE, Array.isArray(backup.distribuidores) ? backup.distribuidores : []);
    if (backup.licencia && typeof backup.licencia === 'object') writeLicenseRaw(backup.licencia);
    return { ok: true };
  } catch (e) {
    console.error('restore-data error', e);
    return { ok: false, error: String(e) };
  }
});

app.whenReady().then(async () => {
  setupAutoUpdater();
  await startPocketBase();
  createWindow();
});

app.on('window-all-closed', () => {
  stopPocketBase().then(() => app.quit());
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
