/**
 * MRS_TPV - Aplicación principal
 * Maneja el flujo de arranque, autenticación y navegación
 */

(function() {
  'use strict';

  let currentSession = null;
  let currentConfig = null;
  let currentModule = null;
  let currentTheme = 'dark';
  const loadedModuleScripts = new Set();
  let moduleLoadSeq = 0;

  // Inicialización
  async function init() {
    // Cargar tema guardado
    const savedTheme = localStorage.getItem('mrs_tpv_theme') || 'dark';
    setTheme(savedTheme);

    // Verificar estado de licencia
    const licenseStatus = await window.mrsTpv.getLicenseStatus();
    if (licenseStatus.status === 'blocked') {
      showScreen('license');
      document.getElementById('deviceIdDisplay').textContent = licenseStatus.deviceHint || 'N/A';
      setupLicenseActivation();
      return;
    }

    // Mostrar advertencia de licencia si quedan ≤10 días
    if (licenseStatus.status === 'trial' && licenseStatus.daysLeft <= 10) {
      showLicenseWarning(licenseStatus.daysLeft);
    }

    // PRIMERO verificar si hay usuarios en PocketBase (esto es lo más importante)
    // Inicializar PocketBase para poder verificar usuarios
    await window.PocketBaseApi.init();
    const hasUsers = await window.mrsTpv.hasPbUsers();
    
    // Si NO hay usuarios, mostrar asistente (configuración inicial)
    if (!hasUsers) {
      showScreen('asistente');
      setupAsistente();
      return;
    }

    // Si HAY usuarios, verificar configuración
    currentConfig = await window.mrsTpv.getConfig();
    
    // Si hay usuarios pero no hay configuración, intentar crear configuración básica
    // pero mostrar login (no asistente)
    if (!currentConfig) {
      // Crear configuración mínima para evitar que vuelva a mostrar el asistente
      const defaultConfig = {
        nombreEmpresa: 'Mi Empresa',
        temaDefecto: currentTheme,
        ticketLogo: true,
        ticketEmail: true,
        ticketRazonSocial: true,
        imagenesEnCaja: 'ambos',
        ivaDefecto: 21
      };
      await window.mrsTpv.setConfig(defaultConfig);
      currentConfig = defaultConfig;
      // Continuar al login (no al asistente)
    }

    // Asegura adminEmail en config para resolver roles de forma estable.
    await ensureConfigAdminEmail();

    // Repara roles inconsistentes al arrancar (asegura que siempre haya administrador).
    await ensureAdminRoleIntegrity();

    // Verificar sesión guardada
    currentSession = await window.mrsTpv.getSession();
    if (currentSession && currentSession.token) {
      // Validar sesión con PocketBase
      await window.PocketBaseApi.init();
      window.PocketBaseApi.setToken(currentSession.token);
      const refreshResult = await window.PocketBaseApi.authRefresh();
      
      if (refreshResult.ok) {
        // Sesión válida, obtener datos completos del usuario
        let userData = refreshResult.data?.record;
        
        // SIEMPRE obtener datos completos usando el handler de admin para asegurar campos personalizados
        if (window.mrsTpv?.pbAdminGetUser && userData?.id) {
          try {
            const adminGetResult = await window.mrsTpv.pbAdminGetUser(userData.id);
            if (adminGetResult.ok && adminGetResult.data) {
              console.log('Datos completos del usuario obtenidos (sesión guardada):', adminGetResult.data);
              userData = adminGetResult.data;
            }
          } catch (err) {
            console.warn('No se pudo obtener datos completos con admin handler (sesión guardada):', err);
            // Fallback: intentar con getUser normal
            const getUserResult = await window.PocketBaseApi.getUser(userData.id);
            if (getUserResult.ok && getUserResult.data) {
              userData = getUserResult.data;
            }
          }
        }
        
        if (userData) {
          const userRole = resolveSessionRole(userData, currentSession.role, userData.email);
          
          currentSession.email = userData.email;
          currentSession.role = userRole;
          currentSession.nombre = userData.nombre || userData.name || currentSession.nombre || userData.email;
          currentSession.id = userData.id;
          
          console.log('Sesión restaurada:', { email: currentSession.email, role: currentSession.role, nombre: currentSession.nombre });
          
          await window.mrsTpv.saveSession(currentSession);
          showScreen('dashboard');
          setupDashboard();
          return;
        }
      }
    }

    // Mostrar login
    showScreen('login');
    setupLogin();
  }

  // Normalizar rol
  function normalizeRole(raw) {
    const r = String(raw || '').trim().toLowerCase();
    if (r === 'admin') return 'administrador';
    if (r === 'técnico') return 'tecnico';
    if (r === 'administrador' || r === 'dependiente' || r === 'tecnico') return r;
    return 'dependiente';
  }

  function resolveSessionRole(userData, fallbackRole, userEmail) {
    const emailNorm = String(userEmail || userData?.email || '').trim().toLowerCase();
    const adminEmailNorm = String(currentConfig?.adminEmail || '').trim().toLowerCase();

    // Regla prioritaria de recuperación: el adminEmail configurado siempre es administrador.
    if (emailNorm && adminEmailNorm && emailNorm === adminEmailNorm) {
      return 'administrador';
    }

    const rawRole = userData?.role ?? userData?.rol;
    if (rawRole !== undefined && rawRole !== null && String(rawRole).trim() !== '') {
      return normalizeRole(rawRole);
    }

    if (fallbackRole) return normalizeRole(fallbackRole);
    return 'dependiente';
  }

  async function ensureConfigAdminEmail() {
    try {
      const existing = String(currentConfig?.adminEmail || '').trim().toLowerCase();
      if (existing) return;
      if (!window.mrsTpv?.pbAdminListUsers) return;

      const usersRes = await window.mrsTpv.pbAdminListUsers();
      if (!usersRes?.ok) return;
      const users = Array.isArray(usersRes.data?.items) ? usersRes.data.items : [];
      if (!users.length) return;

      const roleOf = (u) => normalizeRole(u?.role || u?.rol);
      const byCreated = [...users].sort((a, b) => {
        const ta = Date.parse(String(a?.created || a?.createdAt || '')) || 0;
        const tb = Date.parse(String(b?.created || b?.createdAt || '')) || 0;
        return ta - tb;
      });
      const adminInData = users.find((u) => roleOf(u) === 'administrador');
      const fallback = adminInData || byCreated[0] || users[0];
      const email = String(fallback?.email || '').trim().toLowerCase();
      if (!email) return;

      currentConfig = { ...(currentConfig || {}), adminEmail: email };
      await window.mrsTpv.setConfig(currentConfig);
    } catch (error) {
      console.warn('No se pudo fijar adminEmail en configuración:', error);
    }
  }

  async function ensureAdminRoleIntegrity() {
    try {
      if (!window.mrsTpv?.pbAdminListUsers || !window.mrsTpv?.pbAdminUpdateUser) return;

      const usersRes = await window.mrsTpv.pbAdminListUsers();
      if (!usersRes?.ok) return;
      const users = Array.isArray(usersRes.data?.items) ? usersRes.data.items : [];
      if (!users.length) return;

      const cfg = currentConfig || await window.mrsTpv.getConfig();
      const adminEmail = String(cfg?.adminEmail || '').trim().toLowerCase();
      const getEmail = (u) => String(u?.email || '').trim().toLowerCase();
      const getRole = (u) => normalizeRole(u?.role || u?.rol);

      if (adminEmail) {
        const configuredAdmin = users.find((u) => getEmail(u) === adminEmail);
        if (configuredAdmin && getRole(configuredAdmin) !== 'administrador') {
          await window.mrsTpv.pbAdminUpdateUser(configuredAdmin.id, { role: 'administrador' });
        }
      }

      const usersAfter = await window.mrsTpv.pbAdminListUsers();
      if (!usersAfter?.ok) return;
      const refreshed = Array.isArray(usersAfter.data?.items) ? usersAfter.data.items : [];
      const admins = refreshed.filter((u) => getRole(u) === 'administrador');
      if (admins.length > 0) return;

      const sorted = [...refreshed].sort((a, b) => {
        const ta = Date.parse(String(a?.created || a?.createdAt || '')) || 0;
        const tb = Date.parse(String(b?.created || b?.createdAt || '')) || 0;
        return ta - tb;
      });
      const fallbackAdmin = sorted[0] || refreshed[0];
      if (fallbackAdmin?.id) {
        await window.mrsTpv.pbAdminUpdateUser(fallbackAdmin.id, { role: 'administrador' });
      }
    } catch (error) {
      console.warn('No se pudo verificar/reparar roles admin:', error);
    }
  }

  async function ensureCurrentUserCanBeAdmin(currentUserId, currentUserEmail) {
    try {
      if (!window.mrsTpv?.pbAdminListUsers || !window.mrsTpv?.pbAdminUpdateUser) return false;
      const usersRes = await window.mrsTpv.pbAdminListUsers();
      if (!usersRes?.ok) return false;
      const users = Array.isArray(usersRes.data?.items) ? usersRes.data.items : [];
      if (!users.length) return false;

      const adminCount = users.filter((u) => normalizeRole(u?.role || u?.rol) === 'administrador').length;
      if (adminCount > 0) return false;

      const targetEmail = String(currentUserEmail || '').trim().toLowerCase();
      let target = users.find((u) => String(u?.email || '').trim().toLowerCase() === targetEmail);
      if (!target && currentUserId) {
        target = users.find((u) => String(u?.id || '') === String(currentUserId));
      }
      if (!target?.id) return false;

      const fix = await window.mrsTpv.pbAdminUpdateUser(target.id, { role: 'administrador' });
      return !!fix?.ok;
    } catch (_) {
      return false;
    }
  }

  // Mostrar pantalla
  function showScreen(screenName) {
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.add('hidden');
    });
    const screen = document.getElementById(`screen-${screenName}`);
    if (screen) {
      screen.classList.remove('hidden');
    }
  }

  // Configurar asistente de configuración inicial
  function setupAsistente() {
    const form = document.getElementById('form-asistente');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      // Deshabilitar botón y mostrar loading
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Procesando...';
      }

      // Deshabilitar todos los inputs
      const inputs = form.querySelectorAll('input, select, textarea, button');
      inputs.forEach(input => {
        if (input !== submitBtn) input.disabled = true;
      });

      const nombreEmpresa = document.getElementById('nombreEmpresa').value.trim();
      const cif = document.getElementById('cif').value.trim();
      const direccion = document.getElementById('direccion').value.trim();
      const telefono = document.getElementById('telefono').value.trim();
      const whatsapp = document.getElementById('whatsapp').value.trim();
      const email = document.getElementById('email').value.trim();
      const numeroCuenta = document.getElementById('numeroCuenta').value.trim();
      const ivaDefecto = parseFloat(document.getElementById('ivaDefecto').value) || 21;

      const adminNombre = document.getElementById('adminNombre').value.trim();
      const adminEmail = document.getElementById('adminEmail').value.trim().toLowerCase();
      const adminPassword = document.getElementById('adminPassword').value;
      const adminPasswordConfirm = document.getElementById('adminPasswordConfirm').value;

      // Validar contraseñas
      if (adminPassword !== adminPasswordConfirm) {
        alert('Las contraseñas no coinciden');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Continuar';
        }
        inputs.forEach(input => {
          if (input !== submitBtn) input.disabled = false;
        });
        return;
      }

      if (adminPassword.length < 6) {
        alert('La contraseña debe tener al menos 6 caracteres');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Continuar';
        }
        inputs.forEach(input => {
          if (input !== submitBtn) input.disabled = false;
        });
        return;
      }

      try {
        // Inicializar PocketBase
        const pbInitResult = await window.PocketBaseApi.init();
        if (!pbInitResult) {
          alert('Error: No se pudo conectar con PocketBase. Asegúrate de que pocketbase.exe esté en la carpeta database/');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continuar';
          }
          inputs.forEach(input => {
            if (input !== submitBtn) input.disabled = false;
          });
          return;
        }
        
        // Verificar si ya hay usuarios ANTES de intentar crear uno nuevo
        const hasUsers = await window.mrsTpv.hasPbUsers();
        if (hasUsers) {
          alert('Ya hay usuarios registrados en el sistema.\n\nLa aplicación se reiniciará y te llevará a la pantalla de login.');
          setTimeout(() => {
            location.reload();
          }, 1500);
          return;
        }
        
        // Esperar un momento para que las migraciones se ejecuten completamente
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Usar operación de superusuario para crear el usuario (más confiable)
        let createResult;
        if (window.mrsTpv && window.mrsTpv.pbAdminCreateUser) {
          console.log('Usando pbAdminCreateUser para crear usuario administrador');
          createResult = await window.mrsTpv.pbAdminCreateUser({
            email: adminEmail,
            password: adminPassword,
            passwordConfirm: adminPasswordConfirm,
            role: 'administrador',
            nombre: adminNombre
          });
          console.log('Resultado de pbAdminCreateUser:', createResult);
        } else {
          console.log('pbAdminCreateUser no disponible, usando createUserWithRole');
          // Fallback al método normal
          createResult = await window.PocketBaseApi.createUserWithRole(
            adminEmail,
            adminPassword,
            adminPasswordConfirm,
            'administrador',
            adminNombre
          );
          console.log('Resultado de createUserWithRole:', createResult);
        }

        if (!createResult.ok) {
          let errorMsg = 'Error desconocido';
          
          // Manejar error específico de email duplicado (en el asistente, no intentamos autenticar)
          if (createResult.status === 409 || createResult.data?.code === 'email_exists' || 
              (createResult.data?.message && createResult.data.message.includes('ya está registrado')) ||
              (createResult.data?.data && createResult.data.data.email && 
               (createResult.data.data.email.code === 'validation_not_unique' || 
                createResult.data.data.email.message?.includes('unique')))) {
            errorMsg = 'El email "' + adminEmail + '" ya está registrado en el sistema.\n\n' +
                      'Esto significa que ya hay usuarios configurados.\n\n' +
                      'La aplicación se reiniciará automáticamente y te llevará a la pantalla de login.';
            
            // Reiniciar inmediatamente para ir al login
            setTimeout(() => {
              location.reload();
            }, 2000);
          } else if (createResult.data) {
            if (typeof createResult.data === 'string') {
              errorMsg = createResult.data;
            } else if (createResult.data.message) {
              errorMsg = createResult.data.message;
              // Detectar error de email único
              if (createResult.data.data && createResult.data.data.email) {
                const emailError = createResult.data.data.email;
                if (emailError.code === 'validation_not_unique' || emailError.message?.includes('unique')) {
                  errorMsg = 'El email "' + adminEmail + '" ya está registrado en el sistema.\n\n' +
                            'Esto significa que ya hay usuarios configurados.\n\n' +
                            'La aplicación se reiniciará automáticamente y te llevará a la pantalla de login.';
                  
                  // Reiniciar inmediatamente para ir al login
                  setTimeout(() => {
                    location.reload();
                  }, 2000);
                }
              }
            } else {
              // Intentar extraer detalles de campos
              const details = [];
              if (createResult.data.data && typeof createResult.data.data === 'object') {
                Object.keys(createResult.data.data).forEach(key => {
                  const fieldError = createResult.data.data[key];
                  if (fieldError && typeof fieldError === 'object') {
                    if (fieldError.code === 'validation_not_unique' || fieldError.message?.includes('unique')) {
                      if (key === 'email') {
                        details.push('El email "' + adminEmail + '" ya está registrado. La app se reiniciará para ir al login.');
                        // Reiniciar después de mostrar el error
                        setTimeout(() => {
                          location.reload();
                        }, 2000);
                      } else {
                        details.push(`${key}: ${fieldError.message || 'Valor duplicado'}`);
                      }
                    } else if (fieldError.message) {
                      details.push(`${key}: ${fieldError.message}`);
                    }
                  }
                });
              }
              if (details.length > 0) {
                errorMsg = details.join(' | ');
              }
            }
          } else if (createResult.error) {
            errorMsg = createResult.error;
          }
          
          console.error('Error detallado al crear usuario:', createResult);
          alert('Error al crear usuario:\n\n' + errorMsg);
          
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continuar';
          }
          inputs.forEach(input => {
            if (input !== submitBtn) input.disabled = false;
          });
          return;
        }

        // Guardar configuración
        const config = {
          nombreEmpresa,
          cif,
          direccion,
          telefono,
          whatsapp,
          email,
          numeroCuenta,
          ivaDefecto,
          temaDefecto: currentTheme,
          ticketLogo: true,
          ticketEmail: true,
          ticketRazonSocial: true,
          imagenesEnCaja: 'ambos',
          adminEmail
        };

        const saved = await window.mrsTpv.setConfig(config);
        if (!saved) {
          alert('Error al guardar la configuración');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continuar';
          }
          inputs.forEach(input => {
            if (input !== submitBtn) input.disabled = false;
          });
          return;
        }

        currentConfig = config;

        // Iniciar sesión automáticamente
        const authResult = await window.PocketBaseApi.auth(adminEmail, adminPassword);
        if (authResult.ok) {
          const userData = authResult.data?.record;
          
          // Obtener datos completos del usuario para asegurar que tenemos role y nombre
          let finalUserData = userData;
          if (createResult.data && createResult.data.id) {
            const getUserResult = await window.PocketBaseApi.getUser(createResult.data.id);
            if (getUserResult.ok && getUserResult.data) {
              finalUserData = getUserResult.data;
            }
          }
          
          const session = {
            token: authResult.data?.token,
            email: adminEmail,
            role: normalizeRole(finalUserData?.role || finalUserData?.rol || 'administrador'),
            nombre: finalUserData?.nombre || finalUserData?.name || adminNombre,
            id: finalUserData?.id || createResult.data?.id
          };
          await syncSessionName(session);
          await window.mrsTpv.saveSession(session);
          currentSession = session;
          showScreen('dashboard');
          setupDashboard();
        } else {
          showScreen('login');
          setupLogin();
        }
      } catch (error) {
        console.error('Error en asistente:', error);
        alert('Error durante la configuración: ' + error.message);
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Continuar';
        }
        inputs.forEach(input => {
          if (input !== submitBtn) input.disabled = false;
        });
      }
    });
  }

  // Configurar login
  async function resolveLoginIdentity(inputValue) {
    const raw = String(inputValue || '').trim();
    if (!raw) return { ok: false, message: 'Introduce usuario o email.' };
    const normalized = raw.toLowerCase();

    // Si parece email, usar directamente.
    if (normalized.includes('@')) {
      return { ok: true, email: normalized };
    }

    // Si es usuario, intentar resolver por nombre/nick contra usuarios existentes.
    if (!window.mrsTpv?.pbAdminListUsers) {
      return { ok: false, message: 'No se pudo resolver el usuario. Usa email.' };
    }

    const usersResult = await window.mrsTpv.pbAdminListUsers();
    if (!usersResult?.ok) {
      return { ok: false, message: 'No se pudo resolver el usuario. Usa email.' };
    }

    const items = usersResult.data?.items || [];
    const exactMatches = items.filter((u) => {
      const nombre = String(u?.nombre || u?.name || '').trim().toLowerCase();
      const email = String(u?.email || '').trim().toLowerCase();
      const localPart = email.split('@')[0] || '';
      return nombre === normalized || localPart === normalized;
    });

    if (exactMatches.length === 1) {
      const email = String(exactMatches[0]?.email || '').trim().toLowerCase();
      if (!email) return { ok: false, message: 'Usuario sin email válido.' };
      return { ok: true, email };
    }

    if (exactMatches.length > 1) {
      return { ok: false, message: 'Hay varios usuarios con ese nombre. Inicia con email.' };
    }

    return { ok: false, message: 'Usuario no encontrado. Usa nombre exacto o email.' };
  }

  async function syncSessionName(session) {
    try {
      if (!window.mrsTpv?.pbAdminUpdateUser) return;
      const id = String(session?.id || '').trim();
      const nombre = String(session?.nombre || '').trim();
      if (!id || !nombre) return;
      await window.mrsTpv.pbAdminUpdateUser(id, { nombre });
    } catch (err) {
      console.warn('No se pudo sincronizar nombre de sesión:', err);
    }
  }

  function setupLoginBranding() {
    const logo = document.getElementById('login-logo');
    const nameEl = document.getElementById('login-brand-name');
    if (!logo || !nameEl) return;

    const nombreEmpresa = currentConfig?.nombreEmpresa || 'MRS_TPV';
    const hasLogo = !!currentConfig?.logoUrl;

    if (hasLogo) {
      logo.src = currentConfig.logoUrl;
      logo.classList.remove('hidden');
      nameEl.textContent = '';
      nameEl.classList.add('hidden');
    } else {
      logo.classList.add('hidden');
      logo.removeAttribute('src');
      nameEl.textContent = nombreEmpresa;
      nameEl.classList.remove('hidden');
    }
  }

  function setupLogin() {
    setupLoginBranding();
    const form = document.getElementById('form-login');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const loginIdentity = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;

      const errorDiv = document.getElementById('login-error');
      errorDiv.classList.add('hidden');

      try {
        await window.PocketBaseApi.init();
        const identityResult = await resolveLoginIdentity(loginIdentity);
        if (!identityResult.ok) {
          errorDiv.textContent = identityResult.message || 'Credenciales incorrectas';
          errorDiv.classList.remove('hidden');
          return;
        }

        const email = identityResult.email;
        const authResult = await window.PocketBaseApi.auth(email, password);

        if (!authResult.ok) {
          errorDiv.textContent = authResult.data?.message || 'Credenciales incorrectas';
          errorDiv.classList.remove('hidden');
          return;
        }

        const userData = authResult.data?.record;
        
        // Hacer refresh para obtener datos completos
        window.PocketBaseApi.setToken(authResult.data.token);
        const refreshResult = await window.PocketBaseApi.authRefresh();
        
        let finalUserData = userData;
        if (refreshResult.ok && refreshResult.data?.record) {
          finalUserData = refreshResult.data.record;
        }

        // SIEMPRE obtener datos completos usando el handler de admin para asegurar campos personalizados
        // Esto es especialmente importante para obtener el campo 'role' que puede no estar en auth response
        if (window.mrsTpv?.pbAdminGetUser && finalUserData?.id) {
          try {
            const adminGetResult = await window.mrsTpv.pbAdminGetUser(finalUserData.id);
            if (adminGetResult.ok && adminGetResult.data) {
              console.log('Datos completos del usuario obtenidos:', adminGetResult.data);
              finalUserData = adminGetResult.data;
            }
          } catch (err) {
            console.warn('No se pudo obtener datos completos con admin handler:', err);
            // Fallback: intentar con getUser normal
            const getUserResult = await window.PocketBaseApi.getUser(finalUserData.id);
            if (getUserResult.ok && getUserResult.data) {
              finalUserData = getUserResult.data;
            }
          }
        } else if (!finalUserData.role && !finalUserData.rol) {
          // Fallback si no hay admin handler disponible
          const getUserResult = await window.PocketBaseApi.getUser(finalUserData.id);
          if (getUserResult.ok && getUserResult.data) {
            finalUserData = getUserResult.data;
          }
        }

        const userRole = resolveSessionRole(finalUserData, null, email);

        const session = {
          token: authResult.data.token,
          email: email,
          role: userRole || 'dependiente',
          nombre: finalUserData.nombre || finalUserData.name || email,
          id: finalUserData.id
        };

        // Recuperación de emergencia: si no hay administradores en BD, promover al usuario actual.
        if (session.role !== 'administrador') {
          const promoted = await ensureCurrentUserCanBeAdmin(session.id, session.email);
          if (promoted) {
            session.role = 'administrador';
          }
        }
        
        console.log('Sesión creada:', { email: session.email, role: session.role, nombre: session.nombre });

        await syncSessionName(session);
        await window.mrsTpv.saveSession(session);
        currentSession = session;
        showScreen('dashboard');
        setupDashboard();
      } catch (error) {
        console.error('Error en login:', error);
        errorDiv.textContent = 'Error al iniciar sesión: ' + error.message;
        errorDiv.classList.remove('hidden');
      }
    });
  }

  // Configurar activación de licencia
  function setupLicenseActivation() {
    const form = document.getElementById('form-license');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const key = document.getElementById('licenseKey').value.trim();
      const errorDiv = document.getElementById('license-error');
      errorDiv.classList.add('hidden');

      try {
        const result = await window.mrsTpv.activateLicenseKey(key);
        if (result.ok) {
          // Recargar para continuar con el flujo normal
          location.reload();
        } else {
          errorDiv.textContent = result.message || 'Error al activar la licencia';
          errorDiv.classList.remove('hidden');
        }
      } catch (error) {
        console.error('Error activando licencia:', error);
        errorDiv.textContent = 'Error: ' + error.message;
        errorDiv.classList.remove('hidden');
      }
    });

    document.getElementById('copyDeviceId').addEventListener('click', async () => {
      const licenseStatus = await window.mrsTpv.getLicenseStatus();
      await window.mrsTpv.copyText(licenseStatus.deviceId);
      alert('ID del equipo copiado al portapapeles');
    });
  }

  // Mostrar advertencia de licencia
  function showLicenseWarning(daysLeft) {
    const warningDiv = document.getElementById('license-warning');
    if (warningDiv) {
      warningDiv.textContent = `Te quedan ${daysLeft} días de prueba. Activa tu licencia en Ajustes → Sistema.`;
      warningDiv.classList.remove('hidden');
    }
  }

  // Configurar dashboard
  async function setupDashboard() {
    // Cargar configuración
    await loadConfig();

    // Configurar topbar
    setupTopbar();

    // Configurar navegación
    setupNavigation();

    // Cargar módulo inicial
    loadModule('caja');
  }

  // Cargar configuración
  async function loadConfig() {
    currentConfig = await window.mrsTpv.getConfig();
  }

  // Configurar topbar
  function setupTopbar() {
    // Logo y nombre empresa
    if (currentConfig) {
      const nombreSpan = document.getElementById('topbar-nombre');
      const logoImg = document.getElementById('topbar-logo');
      const hasLogoInBar = !!(currentConfig.logoUrl && currentConfig.mostrarLogoEnBarra);

      if (nombreSpan) {
        if (hasLogoInBar) {
          nombreSpan.textContent = '';
          nombreSpan.classList.add('hidden');
        } else {
          nombreSpan.textContent = currentConfig.nombreEmpresa || 'MRS_TPV';
          nombreSpan.classList.remove('hidden');
        }
      }

      if (logoImg && hasLogoInBar) {
        logoImg.src = currentConfig.logoUrl;
        logoImg.classList.remove('hidden');
      } else if (logoImg) {
        logoImg.classList.add('hidden');
        logoImg.removeAttribute('src');
      }
    }

    // Información del usuario en topbar (Nombre | Rol)
    if (currentSession) {
      const userNombre = document.getElementById('user-nombre');
      const userRole = document.getElementById('user-role');
      if (userNombre) {
        userNombre.textContent = currentSession.nombre || currentSession.email || 'Usuario';
      }
      if (userRole) {
        const roleLabels = {
          'administrador': 'Admin',
          'tecnico': 'Técnico',
          'dependiente': 'Dependiente'
        };
        userRole.textContent = roleLabels[currentSession.role] || currentSession.role || 'Usuario';
      }
    }

    // Botón ajustes en topbar (siempre visible, acceso controlado por módulo)
    const btnAjustes = document.getElementById('btn-ajustes');
    if (btnAjustes) {
      btnAjustes.addEventListener('click', () => {
        loadModule('ajustes');
      });
    }

    // Toggle tema
    const btnTheme = document.getElementById('btn-theme-toggle');
    if (btnTheme) {
      btnTheme.addEventListener('click', () => {
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
      });
    }

    // Botón salir
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        await window.mrsTpv.clearSession();
        window.PocketBaseApi.clearToken();
        currentSession = null;
        showScreen('login');
        setupLogin();
      });
    }
  }

  // Configurar navegación
  function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const module = item.dataset.module;
        if (module) {
          loadModule(module);
        }
      });
    });
  }

  // Cargar módulo
  function getModuleGlobal(moduleName) {
    const globalName = moduleName.charAt(0).toUpperCase() + moduleName.slice(1) + 'Module';
    return window[globalName];
  }

  function ensureModuleScript(moduleName) {
    return new Promise((resolve, reject) => {
      if (loadedModuleScripts.has(moduleName)) {
        resolve();
        return;
      }

      const existing = document.querySelector(`script[data-module="${moduleName}"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Error cargando script del módulo.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = `../modules/${moduleName}/${moduleName}.js`;
      script.dataset.module = moduleName;
      script.onload = () => {
        loadedModuleScripts.add(moduleName);
        resolve();
      };
      script.onerror = () => reject(new Error(`No se pudo cargar el módulo "${moduleName}"`));
      document.head.appendChild(script);
    });
  }

  async function loadModule(moduleName) {
    if (!moduleName) return;
    if (currentModule === moduleName) return;

    const seq = ++moduleLoadSeq;

    // Actualizar navegación activa
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.remove('active');
      if (item.dataset.module === moduleName) {
        item.classList.add('active');
      }
    });

    // Limpiar contenido anterior
    const contentArea = document.getElementById('module-content');
    if (!contentArea) return;

    contentArea.innerHTML = '<div class="text-center mt-3">Cargando...</div>';

    // Cargar módulo dinámicamente sin reinyectar scripts duplicados
    try {
      await ensureModuleScript(moduleName);
      if (seq !== moduleLoadSeq) return;

      const moduleApi = getModuleGlobal(moduleName);
      if (!moduleApi || typeof moduleApi.init !== 'function') {
        contentArea.innerHTML = `<div class="text-center mt-3"><h2>Módulo: ${moduleName}</h2><p>En desarrollo</p></div>`;
        return;
      }

      await moduleApi.init();
      currentModule = moduleName;
    } catch (error) {
      console.error('Error cargando módulo:', error);
      contentArea.innerHTML = `<div class="error-message">Error al cargar el módulo: ${error.message}</div>`;
    }
  }

  // Configurar tema
  function setTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('mrs_tpv_theme', theme);
    
    const themeIcon = document.getElementById('theme-icon');
    if (themeIcon) {
      themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  // API mínima de navegación entre módulos para acciones cruzadas.
  window.MrsTpvApp = {
    loadModule
  };

  // Iniciar aplicación cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
