/**
 * API PocketBase desde el renderer (solo fetch, sin Node).
 * Usar después de tener window.mrsTpv.getPbUrl().
 */
window.PocketBaseApi = {
  _baseUrl: null,
  _token: null,
  _lastError: '',

  _roleVariants(role) {
    const raw = String(role || '').trim();
    return Array.from(new Set([
      raw,
      raw.toLowerCase(),
      raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(),
      raw.toUpperCase()
    ])).filter(Boolean);
  },

  _nameVariants(nombre) {
    const n = String(nombre || '').trim();
    return n ? [n] : [''];
  },

  _normalizeRole(role) {
    const r = String(role || '').trim().toLowerCase();
    if (r === 'admin') return 'administrador';
    if (r === 'técnico') return 'tecnico';
    if (r === 'administrador' || r === 'dependiente' || r === 'tecnico') return r;
    return r;
  },

  _withPbDetails(payload, fallbackMessage) {
    const out = payload && typeof payload === 'object' ? { ...payload } : {};
    const baseMsg = String(out.message || fallbackMessage || 'Error de PocketBase.');
    const details = out.data && typeof out.data === 'object' ? out.data : null;
    if (!details) {
      out.message = baseMsg;
      return out;
    }
    const extra = [];
    Object.keys(details).forEach((k) => {
      const d = details[k];
      const msg = String(d?.message || d || '').trim();
      if (msg) extra.push(k + ': ' + msg);
    });
    out.message = extra.length ? (baseMsg + ' | ' + extra.join(' · ')) : baseMsg;
    return out;
  },

  async init() {
    if (window.mrsTpv && window.mrsTpv.getPbUrl) {
      for (let i = 0; i < 20; i += 1) {
        const info = await window.mrsTpv.getPbUrl();
        this._baseUrl = info?.url || null;
        this._lastError = info?.error || '';
        if (!this._baseUrl) {
          if (info?.available && !info?.running) {
            await new Promise((r) => setTimeout(r, 250));
            continue;
          }
          return null;
        }
        try {
          const res = await fetch(this._baseUrl + '/api/health');
          if (res.ok) return this._baseUrl;
          this._baseUrl = null;
          this._lastError = 'PocketBase no respondió healthy (HTTP ' + res.status + ').';
        } catch (_) {
          this._baseUrl = null;
          this._lastError = this._lastError || 'No se pudo conectar al servicio local de PocketBase.';
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    return this._baseUrl;
  },

  setToken(token) {
    this._token = token || null;
  },

  clearToken() {
    this._token = null;
  },

  async _fetch(endpoint, options = {}) {
    const base = this._baseUrl || await this.init();
    if (!base) {
      const extra = this._lastError ? (' Detalle: ' + this._lastError) : '';
      return { ok: false, data: { message: 'PocketBase no disponible o no iniciado.' + extra }, status: 0 };
    }
    const url = base + endpoint;
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this._token) {
      const raw = String(this._token || '').trim();
      headers['Authorization'] = raw.toLowerCase().startsWith('bearer ') ? raw : ('Bearer ' + raw);
    }
    try {
      const res = await fetch(url, { ...options, headers });
      const raw = res.ok ? await res.json().catch(() => ({})) : await res.json().catch(() => ({ message: res.statusText }));
      const data = res.ok ? raw : this._withPbDetails(raw, res.statusText);
      if (res.status === 501) {
        return { ok: false, data: { message: 'Servicio local no compatible detectado. Reinicia la app para reconectar PocketBase.' }, status: res.status };
      }
      return { ok: res.ok, data, status: res.status };
    } catch (e) {
      return { ok: false, data: { message: 'No se pudo conectar con PocketBase local.' }, status: 0, error: String(e) };
    }
  },

  async createUser(email, password, passwordConfirm) {
    return this._fetch('/api/collections/users/records', {
      method: 'POST',
      body: JSON.stringify({ email, password, passwordConfirm })
    });
  },

  async createUserWithRole(email, password, passwordConfirm, role, nombre) {
    // Priorizar operación de superusuario si está disponible
    if (window.mrsTpv?.pbAdminCreateUser) {
      try {
        const res = await window.mrsTpv.pbAdminCreateUser({ email, password, passwordConfirm, role, nombre });
        if (res && typeof res === 'object') {
          console.log('Usuario creado con pbAdminCreateUser:', res);
          return res;
        }
      } catch (error) {
        console.error('Error en pbAdminCreateUser:', error);
      }
    }
    
    // Fallback corto: máximo 2 intentos para evitar micro-bloqueos.
    const firstBody = { email, password, passwordConfirm, role, nombre: nombre || undefined };
    let first = await this._fetch('/api/collections/users/records', {
      method: 'POST',
      body: JSON.stringify(firstBody)
    });
    if (first.ok) return first;

    const roleErr = first?.data?.data?.role?.message || '';
    const nombreErr = first?.data?.data?.nombre?.message || '';
    const needsFallback = /unknown|invalid|not found|no such/i.test(String(roleErr + ' ' + nombreErr));
    if (!needsFallback) return first;

    return this._fetch('/api/collections/users/records', {
      method: 'POST',
      body: JSON.stringify({ email, password, passwordConfirm, rol: role, name: nombre || undefined })
    });
  },

  async updateUserName(recordId, nombre) {
    return this._fetch('/api/collections/users/records/' + recordId, {
      method: 'PATCH',
      body: JSON.stringify({ nombre: String(nombre || '').trim() })
    });
  },

  async updateUser(recordId, { nombre, role, password }) {
    if (window.mrsTpv?.pbAdminUpdateUser) {
      const res = await window.mrsTpv.pbAdminUpdateUser(recordId, { nombre, role, password });
      if (res && typeof res === 'object') return res;
    }
    const base = {};
    if (password) {
      base.password = password;
      base.passwordConfirm = password;
    }
    if (nombre !== undefined) base.nombre = String(nombre || '').trim();
    if (role !== undefined) base.role = role;

    let res = await this._fetch('/api/collections/users/records/' + recordId, {
      method: 'PATCH',
      body: JSON.stringify(base)
    });

    if (!res.ok) {
      const roleErr = res?.data?.data?.role?.message || '';
      const nombreErr = res?.data?.data?.nombre?.message || '';
      const needsFallback = /unknown|invalid|not found|no such/i.test(String(roleErr + ' ' + nombreErr));
      if (!needsFallback) return res;
      const fallback = {};
      if (password) {
        fallback.password = password;
        fallback.passwordConfirm = password;
      }
      if (nombre !== undefined) fallback.name = String(nombre || '').trim();
      if (role !== undefined) fallback.rol = role;
      res = await this._fetch('/api/collections/users/records/' + recordId, {
        method: 'PATCH',
        body: JSON.stringify(fallback)
      });
    }

    if (!res.ok) return res;
    if (role === undefined) return res;

    const check = await this.getUser(recordId);
    if (!check.ok) return res;
    const currentRole = this._normalizeRole(check.data?.role || check.data?.rol || '');
    const expectedRole = this._normalizeRole(role);
    if (currentRole === expectedRole) return res;
    return {
      ok: false,
      status: 409,
      data: { message: 'El rol no se pudo aplicar en PocketBase. Revisa el campo role en users.' }
    };
  },

  async getUser(recordId) {
    if (window.mrsTpv?.pbAdminGetUser) {
      const res = await window.mrsTpv.pbAdminGetUser(recordId);
      if (res && typeof res === 'object') return res;
    }
    return this._fetch('/api/collections/users/records/' + recordId, {
      method: 'GET'
    });
  },

  async deleteUser(recordId) {
    if (window.mrsTpv?.pbAdminDeleteUser) {
      const res = await window.mrsTpv.pbAdminDeleteUser(recordId);
      if (res && typeof res === 'object') return res;
    }
    return this._fetch('/api/collections/users/records/' + recordId, {
      method: 'DELETE'
    });
  },

  async listUsers() {
    if (window.mrsTpv?.pbAdminListUsers) {
      const res = await window.mrsTpv.pbAdminListUsers();
      if (res && typeof res === 'object') return res;
    }
    return this._fetch('/api/collections/users/records?perPage=100');
  },

  async listUsersAll() {
    if (window.mrsTpv?.pbAdminListUsers) {
      const res = await window.mrsTpv.pbAdminListUsers();
      if (res && typeof res === 'object') return res;
    }
    const perPage = 200;
    const first = await this._fetch('/api/collections/users/records?perPage=' + perPage + '&page=1');
    if (!first.ok) return first;
    const all = Array.isArray(first.data?.items) ? [...first.data.items] : [];
    const totalPages = Number(first.data?.totalPages || 1);
    for (let page = 2; page <= totalPages; page += 1) {
      const res = await this._fetch('/api/collections/users/records?perPage=' + perPage + '&page=' + page);
      if (!res.ok) return res;
      if (Array.isArray(res.data?.items)) all.push(...res.data.items);
    }
    return { ok: true, data: { ...first.data, items: all, totalItems: all.length, totalPages: 1 }, status: first.status };
  },

  async auth(email, password) {
    const body = {
      identity: String(email || '').trim(),
      password: String(password || '')
    };
    return this._fetch('/api/collections/users/auth-with-password', {
      method: 'POST',
      body: JSON.stringify(body)
    });
  },

  async authRefresh() {
    return this._fetch('/api/collections/users/auth-refresh', { method: 'POST' });
  },

  async updatePassword(recordId, oldPassword, newPassword) {
    return this._fetch('/api/collections/users/records/' + recordId, {
      method: 'PATCH',
      body: JSON.stringify({
        oldPassword,
        password: newPassword,
        passwordConfirm: newPassword
      })
    });
  }
};
