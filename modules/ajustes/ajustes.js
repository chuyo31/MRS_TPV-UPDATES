/**
 * Módulo Ajustes - Configuración del sistema
 * IIFE - Sin dependencias externas
 * CRÍTICO: Solo accesible para administradores
 */

(function() {
  'use strict';

  let config = null;
  let currentSession = null;
  let usuarios = [];
  let distribuidores = [];
  let passwordModalShown = false;

  async function init() {
    currentSession = await window.mrsTpv.getSession();
    
    // Verificar que es administrador
    if (currentSession?.role !== 'administrador') {
      const content = document.getElementById('module-content');
      if (content) {
        content.innerHTML = '<div class="error-message">No tienes permisos para acceder a Ajustes</div>';
      }
      return;
    }

    // Mostrar modal de contraseña
    const passwordCorrecta = await mostrarModalPassword();
    if (!passwordCorrecta) {
      const content = document.getElementById('module-content');
      if (content) {
        content.innerHTML = '<div class="error-message">Contraseña incorrecta</div>';
      }
      return;
    }

    await loadData();
    render();
  }

  async function mostrarModalPassword() {
    return new Promise((resolve) => {
      if (passwordModalShown) {
        resolve(false);
        return;
      }
      passwordModalShown = true;

      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Autenticación Requerida</h3>
          </div>
          <div class="modal-body">
            <p>Introduce tu contraseña para acceder a Ajustes:</p>
            <div class="form-group">
              <input type="password" id="ajustes-password" autofocus>
            </div>
            <div class="error-message hidden" id="ajustes-password-error"></div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-password">Cancelar</button>
              <button type="button" class="btn btn-primary" id="btn-confirmar-password">Confirmar</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const input = document.getElementById('ajustes-password');
      const btnConfirmar = document.getElementById('btn-confirmar-password');
      const btnCancelar = document.getElementById('btn-cancelar-password');
      const errorBox = document.getElementById('ajustes-password-error');
      let verificando = false;

      const cerrarModal = (ok) => {
        if (modal.parentNode) {
          document.body.removeChild(modal);
        }
        passwordModalShown = false;
        resolve(ok);
      };

      const verificar = async () => {
        if (verificando) return;

        const password = String(input.value || '');
        if (!password) {
          errorBox.textContent = 'Introduce la contraseña.';
          errorBox.classList.remove('hidden');
          input.focus();
          return;
        }

        verificando = true;
        btnConfirmar.disabled = true;
        btnCancelar.disabled = true;
        input.disabled = true;
        errorBox.classList.add('hidden');

        try {
          await window.PocketBaseApi.init();
          const authResult = await window.PocketBaseApi.auth(currentSession.email, password);

          if (authResult.ok) {
            cerrarModal(true);
            return;
          }

          errorBox.textContent = 'Contraseña incorrecta. Inténtalo de nuevo.';
          errorBox.classList.remove('hidden');
          input.value = '';
          input.disabled = false;
          btnConfirmar.disabled = false;
          btnCancelar.disabled = false;
          input.focus();
        } catch (error) {
          errorBox.textContent = 'Error de verificación. Inténtalo de nuevo.';
          errorBox.classList.remove('hidden');
          input.disabled = false;
          btnConfirmar.disabled = false;
          btnCancelar.disabled = false;
          input.focus();
        } finally {
          verificando = false;
        }
      };

      btnCancelar.addEventListener('click', () => cerrarModal(false));
      btnConfirmar.addEventListener('click', verificar);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') verificar();
      });
    });
  }

  async function loadData() {
    config = await window.mrsTpv.getConfig() || {};
    distribuidores = await window.mrsTpv.getDistribuidores() || [];
    
    // Cargar usuarios
    await window.PocketBaseApi.init();
    const usuariosResult = await window.PocketBaseApi.listUsersAll();
    if (usuariosResult.ok && usuariosResult.data?.items) {
      usuarios = usuariosResult.data.items;

      // Reparación automática estable: si falta role en BD para el usuario admin inicial,
      // persistirlo usando adminEmail del config (evita cruces de roles por sesión temporal).
      const ownUser = usuarios.find(u => u.id === currentSession?.id);
      const ownRoleRaw = ownUser ? (ownUser.role ?? ownUser.rol) : undefined;
      const ownEmail = String(ownUser?.email || '').trim().toLowerCase();
      const adminEmail = String(config?.adminEmail || '').trim().toLowerCase();
      const shouldFixAsAdmin =
        !!ownUser &&
        (ownRoleRaw === undefined || ownRoleRaw === null || String(ownRoleRaw).trim() === '') &&
        !!ownEmail &&
        !!adminEmail &&
        ownEmail === adminEmail;
      if (shouldFixAsAdmin) {
        try {
          const fixRes = await window.PocketBaseApi.updateUser(ownUser.id, { role: 'administrador' });
          if (fixRes?.ok) {
            ownUser.role = 'administrador';
          }
        } catch (_) {
          // Silencioso: no bloquear la carga de Ajustes.
        }
      }

      // Normalización de nombres heredados para evitar mostrar alias/email en la columna "Nombre".
      await normalizeLegacyUserNames();
    }
  }

  function getPreferredNameForUser(user) {
    const email = String(user?.email || '').trim().toLowerCase();
    const emailLocal = email.includes('@') ? email.split('@')[0] : '';
    const nombre = String(user?.nombre || '').trim();
    const name = String(user?.name || '').trim();

    // El usuario activo debe conservar el nombre de sesión mostrado en topbar.
    if (currentSession?.id && user?.id === currentSession.id) {
      const sessionNombre = String(currentSession?.nombre || '').trim();
      if (sessionNombre) return sessionNombre;
    }

    // Si no existe nombre "real", usar campo legacy name cuando sea distinto al alias de email.
    if (!nombre && name && name.toLowerCase() !== emailLocal) {
      return name;
    }

    // Si el nombre guardado coincide con alias email y hay un name mejor, sustituir.
    if (nombre && emailLocal && nombre.toLowerCase() === emailLocal && name && name.toLowerCase() !== emailLocal) {
      return name;
    }

    return '';
  }

  async function normalizeLegacyUserNames() {
    if (!Array.isArray(usuarios) || usuarios.length === 0) return;

    for (const user of usuarios) {
      const preferred = getPreferredNameForUser(user);
      if (!preferred) continue;

      const currentNombre = String(user?.nombre || '').trim();
      if (preferred === currentNombre) continue;

      try {
        const result = await withTimeout(
          window.PocketBaseApi.updateUser(user.id, { nombre: preferred }),
          7000,
          'Timeout normalizando nombre de usuario.'
        );
        if (result?.ok) {
          user.nombre = preferred;
          if (currentSession?.id && user.id === currentSession.id) {
            currentSession.nombre = preferred;
            await window.mrsTpv.saveSession(currentSession);
          }
        }
      } catch (_) {
        // Silencioso: no bloquear la carga del módulo por un registro concreto.
      }
    }
  }

  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    content.innerHTML = `
      <div class="ajustes-module">
        <div class="module-header">
          <h2>Ajustes</h2>
        </div>

        <div class="ajustes-tabs">
          <button class="tab-btn active" data-tab="empresa">Empresa</button>
          <button class="tab-btn" data-tab="tienda">Tienda</button>
          <button class="tab-btn" data-tab="usuarios">Usuarios</button>
          <button class="tab-btn" data-tab="distribuidores">Distribuidores</button>
          <button class="tab-btn" data-tab="sistema">Sistema</button>
        </div>

        <div class="tab-content active" id="tab-empresa">
          ${renderTabEmpresa()}
        </div>

        <div class="tab-content" id="tab-tienda">
          ${renderTabTienda()}
        </div>

        <div class="tab-content" id="tab-usuarios">
          ${renderTabUsuarios()}
        </div>

        <div class="tab-content" id="tab-distribuidores">
          ${renderTabDistribuidores()}
        </div>

        <div class="tab-content" id="tab-sistema">
          ${renderTabSistema()}
        </div>
      </div>
    `;

    setupTabs();
    setupTabEmpresa();
    setupTabTienda();
    setupTabUsuarios();
    setupTabDistribuidores();
    setupTabSistema();
  }

  function renderTabEmpresa() {
    // Asegurar que config existe
    if (!config) config = {};
    
    return `
      <form id="form-empresa">
        <div class="form-section">
          <h3>Logo</h3>
          <div class="form-group">
            <div class="image-preview" id="logo-preview">
              ${config?.logoUrl ? `<img src="${escapeHtml(config.logoUrl)}" alt="Logo">` : ''}
            </div>
            <button type="button" class="btn btn-ghost" id="btn-select-logo">Seleccionar Logo</button>
            ${config?.logoUrl ? '<button type="button" class="btn btn-ghost" id="btn-quitar-logo">Quitar Logo</button>' : ''}
            <input type="hidden" id="logo-url" value="${escapeHtml(config?.logoUrl || '')}">
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="mostrar-logo-barra" ${config?.mostrarLogoEnBarra ? 'checked' : ''}>
              Mostrar logo en barra superior
            </label>
          </div>
        </div>

        <div class="form-section">
          <h3>Datos de la Empresa</h3>
          <div class="form-group">
            <label>Nombre de la empresa *</label>
            <input type="text" id="nombre-empresa" value="${escapeHtml(config?.nombreEmpresa || '')}" required>
          </div>
          <div class="form-group">
            <label>CIF/NIF</label>
            <input type="text" id="cif" value="${escapeHtml(config?.cif || '')}">
          </div>
          <div class="form-group">
            <label>Dirección</label>
            <input type="text" id="direccion" value="${escapeHtml(config?.direccion || '')}">
          </div>
          <div class="form-group">
            <label>Teléfono</label>
            <input type="tel" id="telefono" value="${escapeHtml(config?.telefono || '')}">
          </div>
          <div class="form-group">
            <label>WhatsApp</label>
            <input type="tel" id="whatsapp" value="${escapeHtml(config?.whatsapp || '')}">
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="email" value="${escapeHtml(config?.email || '')}">
          </div>
          <div class="form-group">
            <label>IBAN</label>
            <input type="text" id="iban" value="${escapeHtml(config?.numeroCuenta || '')}">
          </div>
          <div class="form-group">
            <label>IVA por defecto (%)</label>
            <input type="number" id="iva-defecto" value="${config?.ivaDefecto || 21}" min="0" max="100">
          </div>
          <div class="form-group">
            <label>Texto declaración de depósito</label>
            <textarea id="declaracion-deposito" rows="4" placeholder="Texto que aparecerá en el resguardo de reparación...">${escapeHtml(config?.declaracionDeposito || '')}</textarea>
            <button type="button" class="btn btn-ghost btn-sm mt-1" id="btn-restaurar-declaracion">Restaurar texto por defecto</button>
          </div>
          <div class="form-group">
            <label>Nota legal de factura</label>
            <textarea id="factura-nota-legal" rows="3" placeholder="Texto legal que aparecerá al pie de la factura...">${escapeHtml(config?.facturaNotaLegal || '')}</textarea>
            <button type="button" class="btn btn-ghost btn-sm mt-1" id="btn-restaurar-factura-nota-legal">Restaurar texto por defecto</button>
          </div>
          <div class="form-group">
            <label>Nota legal de presupuesto</label>
            <textarea id="presupuesto-nota-legal" rows="3" placeholder="Texto legal que aparecerá al pie del presupuesto...">${escapeHtml(config?.presupuestoNotaLegal || '')}</textarea>
            <button type="button" class="btn btn-ghost btn-sm mt-1" id="btn-restaurar-presupuesto-nota-legal">Restaurar texto por defecto</button>
          </div>
          <div class="form-group">
            <label>Nota legal de albarán</label>
            <textarea id="albaran-nota-legal" rows="3" placeholder="Texto legal que aparecerá al pie del albarán...">${escapeHtml(config?.albaranNotaLegal || '')}</textarea>
            <button type="button" class="btn btn-ghost btn-sm mt-1" id="btn-restaurar-albaran-nota-legal">Restaurar texto por defecto</button>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `;
  }

  function renderTabTienda() {
    return `
      <form id="form-tienda">
        <div class="form-section">
          <h3>Imágenes en Caja</h3>
          <div class="form-group">
            <label>Mostrar imágenes:</label>
            <select id="imagenes-caja">
              <option value="ambos" ${config?.imagenesEnCaja === 'ambos' ? 'selected' : ''}>En categorías y productos</option>
              <option value="categorias" ${config?.imagenesEnCaja === 'categorias' ? 'selected' : ''}>Solo categorías</option>
              <option value="productos" ${config?.imagenesEnCaja === 'productos' ? 'selected' : ''}>Solo productos</option>
              <option value="ninguno" ${config?.imagenesEnCaja === 'ninguno' ? 'selected' : ''}>Ninguno</option>
            </select>
          </div>
        </div>

        <div class="form-section">
          <h3>Contenido del Ticket</h3>
          <div class="form-group">
            <label>
              <input type="checkbox" id="ticket-logo" ${config?.ticketLogo ? 'checked' : ''}>
              Mostrar logo
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="ticket-email" ${config?.ticketEmail ? 'checked' : ''}>
              Mostrar email
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="ticket-razon-social" ${config?.ticketRazonSocial !== false ? 'checked' : ''}>
              Mostrar razón social
            </label>
          </div>
        </div>

        <div class="form-section">
          <h3>Contenido de la Factura</h3>
          <div class="form-group">
            <label>
              <input type="checkbox" id="factura-logo" ${config?.facturaLogo !== false ? 'checked' : ''}>
              Mostrar logo
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="factura-email" ${config?.facturaEmail !== false ? 'checked' : ''}>
              Mostrar email
            </label>
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" id="factura-razon-social" ${config?.facturaRazonSocial !== false ? 'checked' : ''}>
              Mostrar razón social
            </label>
          </div>
        </div>

        <div class="form-section">
          <h3>Impresora Térmica</h3>
          <div class="form-group">
            <label>Impresora ESC/POS</label>
            <select id="impresora-termica">
              <option value="">Seleccionar impresora...</option>
            </select>
          </div>
          <div class="form-group">
            <label>Ancho de papel (mm)</label>
            <select id="ancho-papel">
              <option value="80" ${config?.anchoPapel === 80 ? 'selected' : ''}>80 mm</option>
              <option value="78" ${config?.anchoPapel === 78 ? 'selected' : ''}>78 mm</option>
              <option value="76" ${config?.anchoPapel === 76 ? 'selected' : ''}>76 mm</option>
              <option value="58" ${config?.anchoPapel === 58 ? 'selected' : ''}>58 mm</option>
              <option value="57" ${config?.anchoPapel === 57 ? 'selected' : ''}>57 mm</option>
              <option value="44" ${config?.anchoPapel === 44 ? 'selected' : ''}>44 mm</option>
            </select>
          </div>
        </div>

        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `;
  }

  function renderTabUsuarios() {
    return `
      <div class="usuarios-section">
        <div class="module-header">
          <h3>Usuarios</h3>
          <button class="btn btn-primary" id="btn-nuevo-usuario">Nuevo Usuario</button>
        </div>

        <div class="table-container">
          <table id="usuarios-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="usuarios-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderTabDistribuidores() {
    return `
      <div class="distribuidores-section">
        <div class="module-header">
          <h3>Distribuidores</h3>
          <button class="btn btn-primary" id="btn-nuevo-distribuidor">Nuevo Distribuidor</button>
        </div>

        <div class="table-container">
          <table id="distribuidores-table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Email</th>
                <th>WhatsApp</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="distribuidores-tbody"></tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderTabSistema() {
    return `
      <div class="sistema-section">
        <div class="form-section">
          <h3>Licencia y Prueba</h3>
          <div id="license-status-display"></div>
          <div class="form-group">
            <label>Clave de licencia</label>
            <input type="text" id="license-key-input" placeholder="MRS2.xxxxx.yyyyy">
            <button type="button" class="btn btn-primary" id="btn-activar-licencia">Activar Licencia</button>
            <button type="button" class="btn btn-ghost" id="btn-cargar-licencia-archivo">Cargar licencia (archivo)</button>
          </div>
        </div>

        <div class="form-section">
          <h3>Preferencias</h3>
          <div class="form-group">
            <label>Tema por defecto</label>
            <select id="tema-defecto">
              <option value="dark" ${config?.temaDefecto === 'dark' ? 'selected' : ''}>Oscuro</option>
              <option value="light" ${config?.temaDefecto === 'light' ? 'selected' : ''}>Claro</option>
              <option value="system" ${config?.temaDefecto === 'system' ? 'selected' : ''}>Según sistema</option>
            </select>
          </div>
        </div>

        <div class="form-section">
          <h3>Backup y Restauración</h3>
          <div class="form-group">
            <button type="button" class="btn btn-primary" id="btn-exportar-backup">Exportar Backup</button>
            <button type="button" class="btn btn-primary" id="btn-restaurar-backup">Restaurar Backup</button>
          </div>
        </div>

        <div class="form-section">
          <h3>Actualizaciones</h3>
          <div class="form-group">
            <button type="button" class="btn btn-primary" id="btn-buscar-actualizaciones">Buscar Actualizaciones</button>
            <div id="update-status"></div>
          </div>
        </div>
      </div>
    `;
  }

  function setupTabs() {
    const tabBtns = document.querySelectorAll('.ajustes-tabs .tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.ajustes-module .tab-content').forEach(content => {
          content.classList.remove('active');
        });
        document.getElementById(`tab-${tab}`).classList.add('active');
      });
    });
  }

  async function setupTabEmpresa() {
    const defaultDeclaracion = 'Acepto dejar el dispositivo indicado para su revisión y/o reparación en la empresa. Autorizo la manipulación técnica necesaria para diagnóstico y reparación.';
    const defaultFacturaNotaLegal = 'Nota legal: Este documento tiene validez fiscal y mercantil. Salvo error tipografico u omision. Para cualquier aclaracion, contacte con la empresa emisora.';
    const defaultPresupuestoNotaLegal = 'Validez del presupuesto: 15 dias desde su fecha de emision. Los precios incluyen impuestos salvo indicacion en contrario. Una vez aceptado, no se admiten cambios sin autorizacion expresa del cliente.';
    const defaultAlbaranNotaLegal = 'Condiciones del albaran: La firma del cliente acredita la entrega/recepcion del material o servicio descrito. Cualquier incidencia debe comunicarse en un plazo maximo de 24 horas.';
    const formEmpresa = document.getElementById('form-empresa');

    document.getElementById('btn-select-logo')?.addEventListener('click', async () => {
      const logoUrl = await window.mrsTpv.selectLogo();
      if (logoUrl) {
        document.getElementById('logo-url').value = logoUrl;
        const preview = document.getElementById('logo-preview');
        preview.innerHTML = `<img src="${logoUrl}" alt="Logo">`;
      }
    });

    document.getElementById('btn-quitar-logo')?.addEventListener('click', () => {
      document.getElementById('logo-url').value = '';
      document.getElementById('logo-preview').innerHTML = '';
    });

    document.getElementById('btn-restaurar-declaracion')?.addEventListener('click', () => {
      const input = document.getElementById('declaracion-deposito');
      if (input) input.value = defaultDeclaracion;
    });
    document.getElementById('btn-restaurar-factura-nota-legal')?.addEventListener('click', () => {
      const input = document.getElementById('factura-nota-legal');
      if (input) input.value = defaultFacturaNotaLegal;
    });
    document.getElementById('btn-restaurar-presupuesto-nota-legal')?.addEventListener('click', () => {
      const input = document.getElementById('presupuesto-nota-legal');
      if (input) input.value = defaultPresupuestoNotaLegal;
    });
    document.getElementById('btn-restaurar-albaran-nota-legal')?.addEventListener('click', () => {
      const input = document.getElementById('albaran-nota-legal');
      if (input) input.value = defaultAlbaranNotaLegal;
    });

    formEmpresa?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Asegurar que config existe y tiene todas las propiedades
      if (!config) config = {};

      const getVal = (selector) => String(formEmpresa.querySelector(selector)?.value || '').trim();
      const getChecked = (selector) => !!formEmpresa.querySelector(selector)?.checked;

      config.nombreEmpresa = getVal('#nombre-empresa');
      config.cif = getVal('#cif');
      config.direccion = getVal('#direccion');
      config.telefono = getVal('#telefono');
      config.whatsapp = getVal('#whatsapp');
      config.email = getVal('#email');
      config.numeroCuenta = getVal('#iban');
      config.ivaDefecto = parseFloat(getVal('#iva-defecto')) || 21;
      config.declaracionDeposito = getVal('#declaracion-deposito');
      config.facturaNotaLegal = getVal('#factura-nota-legal');
      config.presupuestoNotaLegal = getVal('#presupuesto-nota-legal');
      config.albaranNotaLegal = getVal('#albaran-nota-legal');
      config.logoUrl = getVal('#logo-url');
      config.mostrarLogoEnBarra = getChecked('#mostrar-logo-barra');

      try {
        const ok = await window.mrsTpv.setConfig(config);
        if (!ok) {
          alert('No se pudo guardar la configuración de empresa.');
          return;
        }
        // Recargar config después de guardar para asegurar persistencia
        config = await window.mrsTpv.getConfig() || config;
        alert('Configuración de empresa guardada correctamente');
      } catch (error) {
        console.error('Error guardando configuración:', error);
        alert('Error al guardar la configuración. Por favor, intenta de nuevo.');
      }
    });
  }

  async function setupTabTienda() {
    const formTienda = document.getElementById('form-tienda');

    // Cargar impresoras
    const impresoras = await window.mrsTpv.getPrinters();
    const select = document.getElementById('impresora-termica');
    if (select) {
      impresoras.forEach(imp => {
        const option = document.createElement('option');
        option.value = imp.name;
        option.textContent = imp.name;
        if (config?.impresoraTermica === imp.name) {
          option.selected = true;
        }
        select.appendChild(option);
      });
    }

    formTienda?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!config) config = {};
      const getVal = (selector) => String(formTienda.querySelector(selector)?.value || '').trim();
      const getChecked = (selector) => !!formTienda.querySelector(selector)?.checked;

      config.imagenesEnCaja = getVal('#imagenes-caja') || 'ambos';
      config.ticketLogo = getChecked('#ticket-logo');
      config.ticketEmail = getChecked('#ticket-email');
      config.ticketRazonSocial = getChecked('#ticket-razon-social');
      config.facturaLogo = getChecked('#factura-logo');
      config.facturaEmail = getChecked('#factura-email');
      config.facturaRazonSocial = getChecked('#factura-razon-social');
      config.impresoraTermica = getVal('#impresora-termica');
      config.anchoPapel = parseInt(getVal('#ancho-papel'), 10) || 80;

      const ok = await window.mrsTpv.setConfig(config);
      if (!ok) {
        alert('No se pudo guardar la configuración de tienda.');
        return;
      }
      config = await window.mrsTpv.getConfig() || config;
      window.dispatchEvent(new CustomEvent('mrs:config-updated', {
        detail: {
          source: 'ajustes',
          keys: ['imagenesEnCaja', 'ticketLogo', 'ticketEmail', 'ticketRazonSocial', 'facturaLogo', 'facturaEmail', 'facturaRazonSocial', 'impresoraTermica', 'anchoPapel']
        }
      }));
      alert('Configuración de tienda guardada');
    });
  }

  async function setupTabUsuarios() {
    renderUsuariosList();

    document.getElementById('btn-nuevo-usuario')?.addEventListener('click', () => {
      mostrarModalUsuario();
    });
  }

  async function setupTabDistribuidores() {
    renderDistribuidoresList();

    document.getElementById('btn-nuevo-distribuidor')?.addEventListener('click', () => {
      mostrarModalDistribuidor();
    });
  }

  function renderDistribuidoresList() {
    const tbody = document.getElementById('distribuidores-tbody');
    if (!tbody) return;

    if (distribuidores.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-message">No hay distribuidores</td></tr>';
      return;
    }

    tbody.innerHTML = distribuidores.map(dist => {
      return `
        <tr>
          <td>${escapeHtml(dist.nombre || '-')}</td>
          <td>${escapeHtml(dist.email || '-')}</td>
          <td>${escapeHtml(dist.whatsapp || '-')}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="AjustesModule.editarDistribuidor('${dist.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="AjustesModule.eliminarDistribuidor('${dist.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function mostrarModalDistribuidor(distribuidorId = null) {
    const existingModal = document.querySelector('.modal-overlay.distribuidor-editor-modal');
    if (existingModal && existingModal.parentNode) {
      existingModal.parentNode.removeChild(existingModal);
    }

    const distribuidor = distribuidorId ? distribuidores.find(d => d.id === distribuidorId) : null;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay distribuidor-editor-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${distribuidor ? 'Editar' : 'Nuevo'} Distribuidor</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-distribuidor">
            <div class="form-group">
              <label>Nombre *</label>
              <input type="text" id="dist-nombre" value="${distribuidor ? escapeHtml(distribuidor.nombre || '') : ''}" required>
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="dist-email" value="${distribuidor ? escapeHtml(distribuidor.email || '') : ''}">
            </div>
            <div class="form-group">
              <label>WhatsApp</label>
              <input type="tel" id="dist-whatsapp" value="${distribuidor ? escapeHtml(distribuidor.whatsapp || '') : ''}" placeholder="Ej: +34612345678">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-distribuidor">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#dist-nombre')?.focus();

    modal.querySelector('#btn-cancelar-distribuidor').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#form-distribuidor').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const nombre = modal.querySelector('#dist-nombre').value.trim();
      const email = modal.querySelector('#dist-email').value.trim();
      const whatsapp = modal.querySelector('#dist-whatsapp').value.trim();

      if (!nombre) {
        alert('El nombre es obligatorio');
        return;
      }

      try {
        if (distribuidor) {
          // Actualizar distribuidor existente
          distribuidor.nombre = nombre;
          distribuidor.email = email;
          distribuidor.whatsapp = whatsapp;
        } else {
          // Crear nuevo distribuidor
          const nuevoDistribuidor = {
            id: 'dist_' + Date.now(),
            nombre: nombre,
            email: email,
            whatsapp: whatsapp
          };
          distribuidores.push(nuevoDistribuidor);
        }

        await window.mrsTpv.saveDistribuidores(distribuidores);
        document.body.removeChild(modal);
        renderDistribuidoresList();
        alert('Distribuidor guardado correctamente');
      } catch (error) {
        console.error('Error guardando distribuidor:', error);
        alert('Error al guardar el distribuidor. Por favor, intenta de nuevo.');
      }
    });
  }

  function renderUsuariosList() {
    const tbody = document.getElementById('usuarios-tbody');
    if (!tbody) return;

    if (usuarios.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-message">No hay usuarios</td></tr>';
      return;
    }

    tbody.innerHTML = usuarios.map(user => {
      const email = String(user.email || '').trim();
      const emailLocal = email.includes('@') ? email.split('@')[0] : '';
      let nombre = String(user.nombre || user.name || '').trim() || emailLocal || 'Sin nombre';
      if (currentSession?.id && user?.id === currentSession.id) {
        const sessionNombre = String(currentSession.nombre || '').trim();
        if (sessionNombre) nombre = sessionNombre;
      }
      const role = resolveUserRole(user);
      const roleLabels = {
        'administrador': 'Administrador',
        'tecnico': 'Técnico',
        'dependiente': 'Dependiente'
      };

      return `
        <tr>
          <td>${escapeHtml(nombre)}</td>
          <td>${escapeHtml(user.email)}</td>
          <td>${roleLabels[role] || role}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="AjustesModule.editarUsuario('${user.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="AjustesModule.eliminarUsuario('${user.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function normalizeRole(raw) {
    const r = String(raw || '').trim().toLowerCase();
    if (r === 'admin') return 'administrador';
    if (r === 'técnico') return 'tecnico';
    if (r === 'administrador' || r === 'dependiente' || r === 'tecnico') return r;
    return 'dependiente';
  }

  function withTimeout(promise, ms, message) {
    let timer = null;
    return Promise.race([
      promise.finally(() => {
        if (timer) clearTimeout(timer);
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || 'Tiempo de espera agotado.')), ms);
      })
    ]);
  }

  function resolveUserRole(user) {
    // Regla prioritaria de recuperación: adminEmail configurado siempre es admin.
    const userEmail = String(user?.email || '').trim().toLowerCase();
    const adminEmail = String(config?.adminEmail || '').trim().toLowerCase();
    if (userEmail && adminEmail && userEmail === adminEmail) {
      return 'administrador';
    }

    const raw = user ? (user.role ?? user.rol) : undefined;
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      return normalizeRole(raw);
    }

    // Si no hay adminEmail configurado, usar sesión solo para el usuario activo.
    if (user?.id && currentSession?.id && user.id === currentSession.id && currentSession?.role) {
      return normalizeRole(currentSession.role);
    }

    return 'dependiente';
  }

  function mostrarModalUsuario(usuarioId = null) {
    const existingModal = document.querySelector('.modal-overlay.user-editor-modal');
    if (existingModal && existingModal.parentNode) {
      existingModal.parentNode.removeChild(existingModal);
    }

    const usuario = usuarioId ? usuarios.find(u => u.id === usuarioId) : null;
    const selectedRole = usuario ? resolveUserRole(usuario) : 'dependiente';
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay user-editor-modal';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${usuario ? 'Editar' : 'Nuevo'} Usuario</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-usuario">
            <div class="form-group">
              <label>Nombre</label>
              <input type="text" id="edit-user-nombre" value="${usuario ? escapeHtml(usuario.nombre || usuario.name || '') : ''}">
            </div>
            <div class="form-group">
              <label>Email *</label>
              <input type="email" id="edit-user-email" value="${usuario ? escapeHtml(usuario.email || '') : ''}" ${usuario ? 'readonly' : 'required'}>
            </div>
            ${!usuario ? `
              <div class="form-group">
                <label>Contraseña *</label>
                <input type="password" id="edit-user-password" required minlength="6">
              </div>
              <div class="form-group">
                <label>Confirmar contraseña *</label>
                <input type="password" id="edit-user-password-confirm" required minlength="6">
              </div>
            ` : `
              <div class="form-group">
                <label>Nueva contraseña (opcional)</label>
                <input type="password" id="edit-user-password-new" minlength="6">
              </div>
            `}
            <div class="form-group">
              <label>Rol *</label>
              <select id="edit-user-role" required>
                <option value="dependiente" ${selectedRole === 'dependiente' ? 'selected' : ''}>Dependiente</option>
                <option value="tecnico" ${selectedRole === 'tecnico' ? 'selected' : ''}>Técnico</option>
                <option value="administrador" ${selectedRole === 'administrador' ? 'selected' : ''}>Administrador</option>
              </select>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-usuario">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#edit-user-nombre')?.focus();

    modal.querySelector('#btn-cancelar-usuario').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#form-usuario').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (modal.dataset.saving === '1') return;
      
      const nombre = modal.querySelector('#edit-user-nombre').value.trim();
      const email = modal.querySelector('#edit-user-email').value.trim().toLowerCase();
      const password = !usuario ? modal.querySelector('#edit-user-password').value : (modal.querySelector('#edit-user-password-new')?.value || '');
      const passwordConfirm = !usuario ? modal.querySelector('#edit-user-password-confirm').value : password;
      const role = modal.querySelector('#edit-user-role').value;
      const submitBtn = modal.querySelector('button[type="submit"]');
      const controls = modal.querySelectorAll('input, select, button, textarea');

      if (!usuario) {
        if (password !== passwordConfirm) {
          alert('Las contraseñas no coinciden');
          return;
        }
        if (password.length < 6) {
          alert('La contraseña debe tener al menos 6 caracteres');
          return;
        }
      }

      try {
        modal.dataset.saving = '1';
        controls.forEach((el) => { el.disabled = true; });
        if (submitBtn) submitBtn.textContent = 'Guardando...';

        // Verificar conexión con timeout para evitar bloqueos largos en UI
        await withTimeout(window.PocketBaseApi.init(), 8000, 'No se pudo conectar con PocketBase a tiempo.');

        if (usuario) {
          // Actualizar usuario
          const currentRole = resolveUserRole(usuario);
          const nextRole = normalizeRole(role);
          const roleChanged = nextRole !== currentRole;
          const updateData = { nombre };
          if (roleChanged) {
            updateData.role = nextRole;
          }
          if (password) {
            updateData.password = password;
          }
          const result = await window.PocketBaseApi.updateUser(usuario.id, updateData);
          if (!result.ok) {
            alert('Error al actualizar usuario: ' + (result.data?.message || 'Error desconocido'));
            return;
          }
          
          // Si se editó el usuario activo, actualizar sesión
          if (usuario.id === currentSession.id) {
            currentSession.nombre = nombre;
            if (roleChanged) {
              currentSession.role = nextRole;
            }
            await window.mrsTpv.saveSession(currentSession);
            // Actualizar topbar
            const userNombre = document.getElementById('user-nombre');
            const userRole = document.getElementById('user-role');
            if (userNombre) userNombre.textContent = nombre || email;
            if (userRole) {
              const roleLabels = {
                'administrador': 'Administrador',
                'tecnico': 'Técnico',
                'dependiente': 'Dependiente'
              };
              const roleNorm = normalizeRole(currentSession.role);
              userRole.textContent = roleLabels[roleNorm] || roleNorm;
            }
          }
        } else {
          // Crear usuario
          const result = await window.PocketBaseApi.createUserWithRole(email, password, passwordConfirm, role, nombre);
          if (!result.ok) {
            alert('Error al crear usuario: ' + (result.data?.message || 'Error desconocido'));
            return;
          }
        }

        // Cerrar modal cuanto antes para no dejar la UI "bloqueada" visualmente.
        if (modal.parentNode) {
          document.body.removeChild(modal);
        }
        await loadData();
        renderUsuariosList();
      } catch (error) {
        console.error('Error guardando usuario:', error);
        alert('Error: ' + error.message);
      } finally {
        if (modal.parentNode) {
          modal.dataset.saving = '0';
          controls.forEach((el) => { el.disabled = false; });
          if (submitBtn) submitBtn.textContent = 'Guardar';
        }
      }
    });
  }

  async function setupTabSistema() {
    // Cargar estado de licencia
    const licenseStatus = await window.mrsTpv.getLicenseStatus();
    const statusDiv = document.getElementById('license-status-display');
    if (statusDiv) {
      statusDiv.innerHTML = `
        <p><strong>Estado:</strong> ${licenseStatus.status === 'trial' ? 'Prueba' : licenseStatus.status === 'active' ? 'Activa' : 'Bloqueada'}</p>
        <p><strong>Mensaje:</strong> ${licenseStatus.message || '-'}</p>
        ${licenseStatus.daysLeft !== null ? `<p><strong>Días restantes:</strong> ${licenseStatus.daysLeft}</p>` : ''}
        <p><strong>ID Equipo:</strong> <code>${licenseStatus.deviceHint || '-'}</code> 
        <button class="btn btn-ghost btn-sm" id="btn-copy-device-id">Copiar</button></p>
      `;
      document.getElementById('btn-copy-device-id')?.addEventListener('click', async () => {
        await window.mrsTpv.copyText(licenseStatus.deviceId);
        alert('ID del equipo copiado');
      });
    }

    // Activar licencia
    document.getElementById('btn-activar-licencia')?.addEventListener('click', async () => {
      const key = document.getElementById('license-key-input').value.trim();
      if (!key) {
        alert('Introduce una clave de licencia');
        return;
      }
      const result = await window.mrsTpv.activateLicenseKey(key);
      if (result.ok) {
        alert('Licencia activada correctamente');
        location.reload();
      } else {
        alert('Error: ' + result.message);
      }
    });

    document.getElementById('btn-cargar-licencia-archivo')?.addEventListener('click', async () => {
      const result = await window.mrsTpv.importLicenseFile();
      if (result?.ok) {
        alert('Licencia cargada correctamente');
        location.reload();
        return;
      }
      if (result?.message && result.message !== 'Operación cancelada.') {
        alert('Error: ' + result.message);
      }
    });

    // Backup
    document.getElementById('btn-exportar-backup')?.addEventListener('click', async () => {
      const result = await window.mrsTpv.backupData();
      if (result.ok) {
        alert('Backup exportado correctamente');
      } else if (!result.canceled) {
        alert('Error al exportar backup: ' + (result.error || 'Error desconocido'));
      }
    });

    document.getElementById('btn-restaurar-backup')?.addEventListener('click', async () => {
      if (!confirm('¿Restaurar backup? Esto sobrescribirá los datos actuales.')) return;
      const result = await window.mrsTpv.restoreData();
      if (result.ok) {
        alert('Backup restaurado correctamente. La aplicación se reiniciará.');
        location.reload();
      } else if (!result.canceled) {
        alert('Error al restaurar backup: ' + (result.error || 'Error desconocido'));
      }
    });

    // Actualizaciones
    document.getElementById('btn-buscar-actualizaciones')?.addEventListener('click', async () => {
      const statusDiv = document.getElementById('update-status');
      statusDiv.innerHTML = 'Buscando actualizaciones...';
      const result = await window.mrsTpv.checkForUpdates({ manual: true });
      statusDiv.innerHTML = result.message || 'Comprobación completada';
      if (result.state?.status === 'available') {
        statusDiv.innerHTML += '<br><button class="btn btn-primary" id="btn-descargar-update">Descargar Actualización</button>';
        document.getElementById('btn-descargar-update')?.addEventListener('click', async () => {
          const downloadResult = await window.mrsTpv.downloadUpdate({ manual: true });
          statusDiv.innerHTML = downloadResult.message || 'Descarga iniciada';
        });
      }
    });
  }

  window.AjustesModule = window.AjustesModule || {};
  window.AjustesModule.editarUsuario = mostrarModalUsuario;
  window.AjustesModule.editarDistribuidor = mostrarModalDistribuidor;
  window.AjustesModule.eliminarDistribuidor = async function(distribuidorId) {
    const distribuidor = distribuidores.find(d => d.id === distribuidorId);
    if (!distribuidor) return;
    
    if (!confirm(`¿Estás seguro de eliminar el distribuidor "${distribuidor.nombre}"?`)) {
      return;
    }
    
    try {
      distribuidores = distribuidores.filter(d => d.id !== distribuidorId);
      await window.mrsTpv.saveDistribuidores(distribuidores);
      renderDistribuidoresList();
      alert('Distribuidor eliminado correctamente');
    } catch (error) {
      console.error('Error eliminando distribuidor:', error);
      alert('Error al eliminar el distribuidor. Por favor, intenta de nuevo.');
    }
  };
  window.AjustesModule.eliminarUsuario = async function(usuarioId) {
    const usuario = usuarios.find(u => u.id === usuarioId);
    if (!usuario) return;

    // No permitir eliminar al último administrador
    const administradores = usuarios.filter(u => resolveUserRole(u) === 'administrador');
    if (resolveUserRole(usuario) === 'administrador' && administradores.length === 1) {
      alert('No se puede eliminar al último administrador');
      return;
    }

    if (!confirm(`¿Eliminar el usuario "${usuario.nombre || usuario.name || usuario.email}"?`)) return;

    try {
      await window.PocketBaseApi.init();
      const result = await window.PocketBaseApi.deleteUser(usuarioId);
      if (!result.ok) {
        alert('Error al eliminar usuario: ' + (result.data?.message || 'Error desconocido'));
        return;
      }

      await loadData();
      renderUsuariosList();
    } catch (error) {
      console.error('Error eliminando usuario:', error);
      alert('Error: ' + error.message);
    }
  };

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  window.AjustesModule.init = init;
})();
