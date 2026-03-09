/**
 * Módulo Reparaciones - Gestión de órdenes de reparación
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let reparaciones = [];
  let clientes = [];
  let distribuidores = [];
  let series = {};
  let currentSession = null;
  let ordenSeleccionada = null;
  let filtroEstado = '';
  let historialBusqueda = '';
  let ordenesBusqueda = '';

  // Inicializar módulo
  async function init() {
    currentSession = await window.mrsTpv.getSession();
    await loadData();
    render();
    setupEventListeners();
    setupResizer();
  }

  // Cargar datos
  async function loadData() {
    reparaciones = await window.mrsTpv.getReparaciones() || [];
    clientes = await window.mrsTpv.getClientes() || [];
    distribuidores = await window.mrsTpv.getDistribuidores() || [];
    series = await window.mrsTpv.getReparacionesSeries() || {};
  }

  // Generar número de orden
  function generarNumeroOrden() {
    const año = new Date().getFullYear();
    const añoStr = String(año);
    const num = (series[añoStr] || 0) + 1;
    series[añoStr] = num;
    return `OR-${añoStr}-${String(num).padStart(4, '0')}`;
  }

  // Renderizar interfaz
  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    content.innerHTML = `
      <div class="reparaciones-module">
        <div class="module-header">
          <h2>Reparaciones</h2>
          <button class="btn btn-primary" id="btn-nueva-reparacion">Nueva Reparación</button>
        </div>

        <div class="reparaciones-container">
          <div class="reparaciones-panel-left">
            <div class="panel-header">
              <h3>Órdenes de Reparación</h3>
              <input type="text" id="search-ordenes" placeholder="Buscar orden, cliente, equipo, pieza...">
              <select id="filter-estado">
                <option value="">Todos los estados</option>
                <option value="recibido">Recibido</option>
                <option value="esperando_pieza">Esperando pieza</option>
                <option value="en_reparacion">En reparación</option>
                <option value="reparado">Reparado</option>
                <option value="entregado">Entregado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
            <div class="reparaciones-list" id="reparaciones-list"></div>
          </div>

          <div class="reparaciones-resizer" id="resizer-reparaciones"></div>

          <div class="reparaciones-panel-right">
            <div class="reparaciones-tabs">
              <button class="tab-btn active" data-tab="orden">Órdenes</button>
              <button class="tab-btn" data-tab="pedidos">Pedidos</button>
              <button class="tab-btn" data-tab="historial">Historial</button>
              <button class="tab-btn" data-tab="notas">Notas</button>
            </div>

            <div class="tab-content active" id="tab-orden">
              <div id="orden-content"></div>
            </div>

            <div class="tab-content" id="tab-pedidos">
              <div id="pedidos-content"></div>
            </div>

            <div class="tab-content" id="tab-historial">
              <div id="historial-pedidos-content"></div>
            </div>

            <div class="tab-content" id="tab-notas">
              <div id="notas-content"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    renderReparaciones();
    renderOrden();
    setupTabs();
  }

  // Renderizar lista de reparaciones
  function renderReparaciones() {
    const list = document.getElementById('reparaciones-list');
    if (!list) return;

    const reparacionesOrdenadas = [...reparaciones].sort((a, b) => {
      const ta = Date.parse(String(a?.updatedAt || a?.createdAt || '')) || 0;
      const tb = Date.parse(String(b?.updatedAt || b?.createdAt || '')) || 0;
      return tb - ta;
    });

    let reparacionesFiltradas = reparacionesOrdenadas;
    if (filtroEstado) {
      reparacionesFiltradas = reparacionesFiltradas.filter(r => r.estado === filtroEstado);
    }

    const termino = String(ordenesBusqueda || '').trim().toLowerCase();
    if (termino) {
      reparacionesFiltradas = reparacionesFiltradas.filter((r) => {
        const campos = [
          r.numero || '',
          r.clienteNombre || '',
          r.marcaModelo || '',
          r.piezaDescripcion || '',
          r.estado || ''
        ].join(' ').toLowerCase();
        return campos.includes(termino);
      });
    } else {
      reparacionesFiltradas = reparacionesFiltradas.slice(0, 5);
    }

    if (reparacionesFiltradas.length === 0) {
      list.innerHTML = `<p class="empty-message">${termino ? 'No hay resultados para la búsqueda' : 'No hay órdenes de reparación'}</p>`;
      return;
    }

    list.innerHTML = reparacionesFiltradas.map(rep => {
      const estadoLabels = {
        recibido: 'Recibido',
        esperando_pieza: 'Esperando pieza',
        en_reparacion: 'En reparación',
        reparado: 'Reparado',
        entregado: 'Entregado',
        cancelado: 'Cancelado'
      };
      
      // Colores de fondo y texto según estado
      const estadoStyles = {
        recibido: { bg: '#ffd614', text: '#000000' }, // Amarillo - texto negro
        esperando_pieza: { bg: '#b03fff', text: '#ffffff' }, // Morado - texto blanco
        en_reparacion: { bg: '#efa31f', text: '#000000' }, // Naranja - texto negro
        reparado: { bg: '#1fb2ef', text: '#000000' }, // Azul claro - texto negro
        entregado: { bg: '#5ee535', text: '#000000' }, // Verde - texto negro
        cancelado: { bg: '#c32828', text: '#ffffff' } // Rojo - texto blanco
      };
      
      const estilo = estadoStyles[rep.estado] || { bg: 'transparent', text: 'inherit' };
      const estadoLabel = estadoLabels[rep.estado] || rep.estado;
      
      // Determinar color de texto para toda la tarjeta basado en el fondo
      // Si el fondo es claro (amarillo, naranja, azul claro, verde), texto negro
      // Si el fondo es oscuro (morado, rojo), texto blanco
      const textoCard = estilo.text === '#ffffff' ? '#ffffff' : '#000000';

      return `
        <div class="reparacion-card ${ordenSeleccionada?.id === rep.id ? 'active' : ''}" 
             data-reparacion-id="${rep.id}"
             style="background-color: ${estilo.bg}; color: ${textoCard};">
          <div class="reparacion-header">
            <strong>${rep.numero || 'BORRADOR'}</strong>
            <span class="reparacion-estado" style="background-color: rgba(0, 0, 0, 0.2); color: ${textoCard};">
              ${estadoLabel}
            </span>
          </div>
          <div class="reparacion-info">
            <div>Cliente: ${escapeHtml(rep.clienteNombre || '-')}</div>
            <div>Equipo: ${escapeHtml(rep.marcaModelo || '-')}</div>
            <div>Fecha: ${formatFecha(rep.createdAt || rep.updatedAt)}</div>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners
    list.querySelectorAll('.reparacion-card').forEach(card => {
      card.addEventListener('click', () => {
        const reparacionId = card.dataset.reparacionId;
        ordenSeleccionada = reparaciones.find(r => r.id === reparacionId);
        renderReparaciones();
        renderOrden();
      });
    });
  }

  // Renderizar orden seleccionada
  function renderOrden() {
    const content = document.getElementById('orden-content');
    if (!content) return;

    if (!ordenSeleccionada) {
      content.innerHTML = '<p class="empty-message">Selecciona una orden de reparación</p>';
      return;
    }

    const rep = ordenSeleccionada;
    content.innerHTML = `
      <form id="form-reparacion">
        <div class="form-section">
          <h3>Datos del Cliente</h3>
          <div class="form-group">
            <label>Cliente *</label>
            <select id="rep-cliente" required>
              <option value="">Seleccionar...</option>
            </select>
          </div>
        </div>

        <div class="form-section">
          <h3>Equipo</h3>
          <div class="form-group">
            <label>Tipo *</label>
            <select id="rep-equipo-tipo" required>
              <option value="movil" ${rep.equipoTipo === 'movil' ? 'selected' : ''}>Móvil</option>
              <option value="tablet" ${rep.equipoTipo === 'tablet' ? 'selected' : ''}>Tablet</option>
              <option value="consola" ${rep.equipoTipo === 'consola' ? 'selected' : ''}>Consola</option>
              <option value="mando" ${rep.equipoTipo === 'mando' ? 'selected' : ''}>Mando</option>
              <option value="portatil" ${rep.equipoTipo === 'portatil' ? 'selected' : ''}>Portátil</option>
              <option value="pantalla_portatil" ${rep.equipoTipo === 'pantalla_portatil' ? 'selected' : ''}>Pantalla Portátil</option>
            </select>
          </div>
          <div class="form-group">
            <label>Marca/Modelo</label>
            <input type="text" id="rep-marca-modelo" value="${escapeHtml(rep.marcaModelo || '')}">
          </div>
          <div class="form-group">
            <label>IMEI/Serie</label>
            <input type="text" id="rep-imei-serie" value="${escapeHtml(rep.imeiSerie || '')}">
          </div>
        </div>

        <div class="form-section">
          <h3>Acceso al Dispositivo</h3>
          <div class="form-group">
            <label>Tipo</label>
            <select id="rep-acceso-tipo">
              <option value="ninguno" ${rep.accesoTipo === 'ninguno' ? 'selected' : ''}>Ninguno</option>
              <option value="pin" ${rep.accesoTipo === 'pin' ? 'selected' : ''}>PIN</option>
              <option value="password" ${rep.accesoTipo === 'password' ? 'selected' : ''}>Contraseña</option>
              <option value="patron" ${rep.accesoTipo === 'patron' ? 'selected' : ''}>Patrón</option>
            </select>
          </div>
          <div class="form-group" id="group-acceso-codigo">
            <label>Código/Patrón</label>
            <input type="text" id="rep-acceso-codigo" value="${escapeHtml(rep.accesoCodigo || '')}">
          </div>
        </div>

        <div class="form-section">
          <h3>Información de Reparación</h3>
          <div class="form-group">
            <label>Avería Reportada</label>
            <textarea id="rep-averia" rows="3">${escapeHtml(rep.averiaReportada || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Diagnóstico</label>
            <textarea id="rep-diagnostico" rows="3">${escapeHtml(rep.diagnostico || '')}</textarea>
          </div>
          <div class="form-group">
            <label>Estado *</label>
            <select id="rep-estado" required>
              <option value="recibido" ${rep.estado === 'recibido' ? 'selected' : ''}>Recibido</option>
              <option value="esperando_pieza" ${rep.estado === 'esperando_pieza' ? 'selected' : ''}>Esperando pieza</option>
              <option value="en_reparacion" ${rep.estado === 'en_reparacion' ? 'selected' : ''}>En reparación</option>
              <option value="reparado" ${rep.estado === 'reparado' ? 'selected' : ''}>Reparado</option>
              <option value="entregado" ${rep.estado === 'entregado' ? 'selected' : ''}>Entregado</option>
              <option value="cancelado" ${rep.estado === 'cancelado' ? 'selected' : ''}>Cancelado</option>
            </select>
          </div>
        </div>

        <div class="form-section">
          <h3>Pieza Necesaria</h3>
          <div class="form-group">
            <label>
              <input type="checkbox" id="rep-requiere-pieza" ${rep.requierePieza ? 'checked' : ''}>
              Requiere pieza
            </label>
          </div>
          <div id="pieza-fields" style="display: ${rep.requierePieza ? 'block' : 'none'}">
            <div class="form-group">
              <label>Descripción de la pieza</label>
              <input type="text" id="rep-pieza-descripcion" value="${escapeHtml(rep.piezaDescripcion || '')}">
            </div>
            <div class="form-group">
              <label>Cantidad</label>
              <input type="number" id="rep-pieza-cantidad" value="${rep.piezaCantidad || 1}" min="1">
            </div>
            <div class="form-group">
              <label>Distribuidor</label>
              <select id="rep-distribuidor">
                <option value="">Seleccionar...</option>
              </select>
            </div>
          </div>
        </div>

        <div class="form-section">
          <h3>Calculadora de Precios</h3>
          <div class="calculadora">
            <div class="form-group">
              <label>Coste pieza (€)</label>
              <input type="number" id="calc-coste-pieza" value="${rep.costePieza || 0}" step="0.01" min="0">
            </div>
            <div class="form-group">
              <label>Coste envío (€)</label>
              <input type="number" id="calc-coste-envio" value="${rep.costeEnvio || 7}" step="0.01" min="0">
            </div>
            <div class="form-group">
              <label>IVA (%)</label>
              <input type="number" id="calc-iva" value="${rep.ivaPct || 21}" min="0" max="100">
            </div>
            <div class="form-group">
              <label>Margen mano de obra (€)</label>
              <input type="number" id="calc-margen" value="${rep.margenManoObra || 0}" step="0.01" min="0">
            </div>
            <div class="calculadora-resultados">
              <div class="calc-line">
                <span>Base:</span>
                <span id="calc-base">0,00 €</span>
              </div>
              <div class="calc-line">
                <span>IVA:</span>
                <span id="calc-iva-total">0,00 €</span>
              </div>
              <div class="calc-line">
                <span>Coste interno:</span>
                <span id="calc-interno">0,00 €</span>
              </div>
              <div class="calc-line calc-total">
                <span>Total cliente:</span>
                <span id="calc-total">0,00 €</span>
              </div>
            </div>
          </div>
        </div>

        <div class="form-actions">
          <button type="button" class="btn btn-ghost" id="btn-imprimir-resguardo">Imprimir Resguardo</button>
          <button type="button" class="btn btn-ghost" id="btn-enviar-resguardo-whatsapp">Enviar Resguardo por WhatsApp</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `;

    // Llenar clientes
    const selectCliente = document.getElementById('rep-cliente');
    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre || cliente.razonSocial || cliente.email;
      if (rep.clienteId === cliente.id) {
        option.selected = true;
      }
      selectCliente.appendChild(option);
    });

    // Llenar distribuidores
    const selectDistribuidor = document.getElementById('rep-distribuidor');
    distribuidores.forEach(dist => {
      const option = document.createElement('option');
      option.value = dist.id;
      option.textContent = dist.nombre;
      if (rep.distribuidorId === dist.id) {
        option.selected = true;
      }
      selectDistribuidor.appendChild(option);
    });

    // Mostrar/ocultar campos de acceso
    const accesoSelect = document.getElementById('rep-acceso-tipo');
    const grupoCodigo = document.getElementById('group-acceso-codigo');
    accesoSelect.addEventListener('change', () => {
      grupoCodigo.style.display = accesoSelect.value === 'ninguno' ? 'none' : 'block';
    });
    if (accesoSelect.value === 'ninguno') {
      grupoCodigo.style.display = 'none';
    }

    // Mostrar/ocultar campos de pieza
    const requierePieza = document.getElementById('rep-requiere-pieza');
    const piezaFields = document.getElementById('pieza-fields');
    requierePieza.addEventListener('change', () => {
      piezaFields.style.display = requierePieza.checked ? 'block' : 'none';
    });

    // Calculadora
    setupCalculadora();

    // Guardar
    document.getElementById('form-reparacion').addEventListener('submit', guardarReparacion);

    // Imprimir resguardo
    document.getElementById('btn-imprimir-resguardo').addEventListener('click', imprimirResguardo);
    document.getElementById('btn-enviar-resguardo-whatsapp').addEventListener('click', enviarResguardoWhatsApp);
  }

  // Configurar calculadora
  function setupCalculadora() {
    const inputs = ['calc-coste-pieza', 'calc-coste-envio', 'calc-iva', 'calc-margen'];
    inputs.forEach(id => {
      const input = document.getElementById(id);
      if (input) {
        input.addEventListener('input', calcularPrecios);
      }
    });
    calcularPrecios();
  }

  // Calcular precios
  function calcularPrecios() {
    const costePieza = parseFloat(document.getElementById('calc-coste-pieza')?.value || 0);
    const costeEnvio = parseFloat(document.getElementById('calc-coste-envio')?.value || 0);
    const ivaPct = parseFloat(document.getElementById('calc-iva')?.value || 21);
    const margen = parseFloat(document.getElementById('calc-margen')?.value || 0);

    const base = costePieza + costeEnvio;
    const iva = base * (ivaPct / 100);
    const interno = base + iva;
    const total = interno + margen;

    document.getElementById('calc-base').textContent = formatEuro(base);
    document.getElementById('calc-iva-total').textContent = formatEuro(iva);
    document.getElementById('calc-interno').textContent = formatEuro(interno);
    document.getElementById('calc-total').textContent = formatEuro(total);
  }

  // Guardar reparación
  async function guardarReparacion(e) {
    e.preventDefault();

    const clienteId = document.getElementById('rep-cliente').value;
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) {
      alert('Selecciona un cliente');
      return;
    }

    const equipoTipo = document.getElementById('rep-equipo-tipo').value;
    const marcaModelo = document.getElementById('rep-marca-modelo').value.trim();
    const imeiSerie = document.getElementById('rep-imei-serie').value.trim();
    const accesoTipo = document.getElementById('rep-acceso-tipo').value;
    const accesoCodigo = document.getElementById('rep-acceso-codigo').value.trim();
    const averiaReportada = document.getElementById('rep-averia').value.trim();
    const diagnostico = document.getElementById('rep-diagnostico').value.trim();
    const estado = document.getElementById('rep-estado').value;
    const requierePieza = document.getElementById('rep-requiere-pieza').checked;
    const piezaDescripcion = requierePieza ? document.getElementById('rep-pieza-descripcion').value.trim() : '';
    const piezaCantidad = requierePieza ? parseInt(document.getElementById('rep-pieza-cantidad').value) || 1 : 0;
    const distribuidorId = requierePieza ? document.getElementById('rep-distribuidor').value : '';

    const costePieza = parseFloat(document.getElementById('calc-coste-pieza')?.value || 0);
    const costeEnvio = parseFloat(document.getElementById('calc-coste-envio')?.value || 0);
    const ivaPct = parseFloat(document.getElementById('calc-iva')?.value || 21);
    const margenManoObra = parseFloat(document.getElementById('calc-margen')?.value || 0);

    const base = costePieza + costeEnvio;
    const iva = base * (ivaPct / 100);
    const costeInterno = base + iva;
    const totalCliente = costeInterno + margenManoObra;

    if (!ordenSeleccionada.numero) {
      ordenSeleccionada.numero = generarNumeroOrden();
    }

    ordenSeleccionada.clienteId = clienteId;
    ordenSeleccionada.clienteNombre = cliente.nombre || cliente.razonSocial || cliente.email;
    ordenSeleccionada.clienteTelefono = cliente.telefono || '';
    ordenSeleccionada.clienteWhatsapp = cliente.whatsapp || cliente.telefono || '';
    ordenSeleccionada.equipoTipo = equipoTipo;
    ordenSeleccionada.marcaModelo = marcaModelo;
    ordenSeleccionada.imeiSerie = imeiSerie;
    ordenSeleccionada.accesoTipo = accesoTipo;
    ordenSeleccionada.accesoCodigo = accesoCodigo;
    ordenSeleccionada.averiaReportada = averiaReportada;
    ordenSeleccionada.diagnostico = diagnostico;
    ordenSeleccionada.estado = estado;
    ordenSeleccionada.requierePieza = requierePieza;
    ordenSeleccionada.piezaDescripcion = piezaDescripcion;
    ordenSeleccionada.piezaCantidad = piezaCantidad;
    ordenSeleccionada.distribuidorId = distribuidorId;
    ordenSeleccionada.costePieza = costePieza;
    ordenSeleccionada.costeEnvio = costeEnvio;
    ordenSeleccionada.ivaPct = ivaPct;
    ordenSeleccionada.margenManoObra = margenManoObra;
    ordenSeleccionada.costeInterno = costeInterno;
    ordenSeleccionada.totalCliente = totalCliente;
    ordenSeleccionada.updatedAt = new Date().toISOString();
    if (!ordenSeleccionada.createdAt) {
      ordenSeleccionada.createdAt = new Date().toISOString();
    }
    if (!ordenSeleccionada.notas) {
      ordenSeleccionada.notas = [];
    }

    // Guardar series
    await window.mrsTpv.saveReparacionesSeries(series);

    // Guardar reparaciones
    const index = reparaciones.findIndex(r => r.id === ordenSeleccionada.id);
    if (index >= 0) {
      reparaciones[index] = ordenSeleccionada;
    } else {
      reparaciones.push(ordenSeleccionada);
    }
    await window.mrsTpv.saveReparaciones(reparaciones);

    alert('Reparación guardada correctamente');
    renderReparaciones();
    renderPedidos();
  }

  // Imprimir resguardo
  async function imprimirResguardo() {
    if (!ordenSeleccionada) return;
    const config = await window.mrsTpv.getConfig();
    // Pasar el tema activo real para que la plantilla de impresión
    // respete modo claro/oscuro igual que la app.
    const activeTheme =
      document.documentElement.getAttribute('data-theme') ||
      document.body.getAttribute('data-theme') ||
      localStorage.getItem('mrs_tpv_theme') ||
      config?.temaDefecto ||
      'dark';
    const printConfig = { ...(config || {}), currentTheme: activeTheme };
    await window.mrsTpv.printRepairReceipt(ordenSeleccionada, printConfig);
  }

  async function enviarResguardoWhatsApp() {
    if (!ordenSeleccionada) {
      alert('Selecciona una orden de reparación');
      return;
    }

    const cliente = clientes.find(c => c.id === ordenSeleccionada.clienteId);
    const clienteWhatsapp = ordenSeleccionada.clienteWhatsapp || cliente?.whatsapp || cliente?.telefono || '';
    if (!clienteWhatsapp) {
      alert('No hay número de WhatsApp disponible para el cliente');
      return;
    }

    const numeroOrden = ordenSeleccionada.numero || 'BORRADOR';
    const equipo = ordenSeleccionada.marcaModelo || '-';
    const estado = ordenSeleccionada.estado || '-';
    const total = formatEuro(ordenSeleccionada.totalCliente || 0);

    let mensaje = '*Resguardo de reparación*\n\n';
    mensaje += `Cliente: ${ordenSeleccionada.clienteNombre || 'Cliente'}\n`;
    mensaje += `Orden: ${numeroOrden}\n`;
    mensaje += `Equipo: ${equipo}\n`;
    mensaje += `Estado: ${estado}\n`;
    mensaje += `Total estimado: ${total}\n\n`;
    mensaje += 'Gracias.';

    abrirWhatsApp(clienteWhatsapp, mensaje);
  }

  // Renderizar pedidos
  function renderPedidos() {
    const content = document.getElementById('pedidos-content');
    if (!content) return;

    const pedidosPendientes = reparaciones.filter(r => 
      r.requierePieza &&
      r.distribuidorId &&
      (!r.pedidoEstado || r.pedidoEstado === 'pendiente')
    );

    if (pedidosPendientes.length === 0) {
      content.innerHTML = '<p class="empty-message">No hay pedidos pendientes</p>';
      return;
    }

    // Agrupar por distribuidor
    const pedidosPorDistribuidor = {};
    pedidosPendientes.forEach(rep => {
      const distId = rep.distribuidorId;
      if (!pedidosPorDistribuidor[distId]) {
        pedidosPorDistribuidor[distId] = [];
      }
      pedidosPorDistribuidor[distId].push(rep);
    });

    content.innerHTML = Object.entries(pedidosPorDistribuidor).map(([distId, pedidos]) => {
      const distribuidor = distribuidores.find(d => d.id === distId);
      if (!distribuidor) return '';

      const total = pedidos.reduce((sum, p) => sum + ((p.costePieza || 0) * (p.piezaCantidad || 1)), 0);

      return `
        <div class="pedido-grupo">
          <div class="pedido-header">
            <h3>${escapeHtml(distribuidor.nombre)}</h3>
            <p>WhatsApp: ${escapeHtml(distribuidor.whatsapp || '-')}</p>
            <button class="btn btn-primary btn-sm" onclick="ReparacionesModule.enviarPedido('${distId}')">Enviar Pedido</button>
          </div>
          <table class="pedido-table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Equipo</th>
                <th>Pieza</th>
                <th>Cantidad</th>
                <th>Precio</th>
              </tr>
            </thead>
            <tbody>
              ${pedidos.map(p => `
                <tr>
                  <td>${escapeHtml(p.clienteNombre || '-')}</td>
                  <td>${escapeHtml(p.marcaModelo || '-')}</td>
                  <td>${escapeHtml(p.piezaDescripcion || '-')}</td>
                  <td>${p.piezaCantidad || 1}</td>
                  <td>${formatEuro(p.costePieza || 0)}</td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="4"><strong>Total</strong></td>
                <td><strong>${formatEuro(total)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    }).join('');
  }

  // Renderizar historial de pedidos enviados
  function renderHistorialPedidos() {
    const content = document.getElementById('historial-pedidos-content');
    if (!content) return;

    const pedidosEnviadosBase = reparaciones
      .filter(r =>
        r.requierePieza &&
        r.distribuidorId &&
        r.pedidoEstado === 'enviado' &&
        r.pedidoEnviadoAt
      )
      .sort((a, b) => new Date(b.pedidoEnviadoAt) - new Date(a.pedidoEnviadoAt));

    const termino = String(historialBusqueda || '').trim().toLowerCase();
    const limiteMs = 5 * 24 * 60 * 60 * 1000;
    const ahora = Date.now();

    const pedidosEnviados = pedidosEnviadosBase.filter((p) => {
      if (termino) {
        const dist = distribuidores.find(d => d.id === p.distribuidorId);
        const campos = [
          p.numero || '',
          p.clienteNombre || '',
          p.marcaModelo || '',
          p.piezaDescripcion || '',
          dist?.nombre || '',
          new Date(p.pedidoEnviadoAt).toLocaleDateString('es-ES')
        ].join(' ').toLowerCase();
        return campos.includes(termino);
      }
      return (ahora - new Date(p.pedidoEnviadoAt).getTime()) <= limiteMs;
    });

    const ocultosPorFecha = !termino
      ? pedidosEnviadosBase.filter((p) => (ahora - new Date(p.pedidoEnviadoAt).getTime()) > limiteMs).length
      : 0;

    if (pedidosEnviados.length === 0) {
      content.innerHTML = `
        <div class="form-group" style="max-width: 420px; margin-bottom: 10px;">
          <input
            type="text"
            id="historial-pedidos-search"
            placeholder="Buscar por pieza, distribuidor, orden, cliente o fecha..."
            value="${escapeHtml(historialBusqueda)}"
          >
        </div>
        <p class="empty-message">${termino ? 'No hay resultados para la búsqueda' : 'No hay pedidos enviados en los últimos 5 días'}</p>
      `;
      const searchInputEmpty = document.getElementById('historial-pedidos-search');
      searchInputEmpty?.addEventListener('input', (e) => {
        historialBusqueda = e.target.value || '';
        renderHistorialPedidos();
      });
      return;
    }

    const pedidosPorDia = {};
    pedidosEnviados.forEach((p) => {
      const dia = new Date(p.pedidoEnviadoAt).toLocaleDateString('es-ES');
      if (!pedidosPorDia[dia]) pedidosPorDia[dia] = [];
      pedidosPorDia[dia].push(p);
    });

    content.innerHTML = `
      <div class="form-group" style="max-width: 420px; margin-bottom: 10px;">
        <input
          type="text"
          id="historial-pedidos-search"
          placeholder="Buscar por pieza, distribuidor, orden, cliente o fecha..."
          value="${escapeHtml(historialBusqueda)}"
        >
      </div>
      ${ocultosPorFecha > 0 ? `<p class="empty-message" style="margin-bottom:10px;">Hay ${ocultosPorFecha} pedidos más antiguos ocultos. Usa el buscador para verlos.</p>` : ''}
      ${Object.entries(pedidosPorDia).map(([dia, pedidos]) => {
      const totalDia = pedidos.reduce((sum, p) => sum + ((p.costePieza || 0) * (p.piezaCantidad || 1)), 0);
      return `
        <div class="pedido-grupo">
          <div class="pedido-header">
            <h3>Pedidos enviados - ${escapeHtml(dia)}</h3>
            <p>Total coste día: <strong>${formatEuro(totalDia)}</strong></p>
          </div>
          <table class="pedido-table">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Distribuidor</th>
                <th>Pieza</th>
                <th>Cantidad</th>
                <th>Coste u.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${pedidos.map(p => {
                const dist = distribuidores.find(d => d.id === p.distribuidorId);
                const cantidad = p.piezaCantidad || 1;
                const costeU = p.costePieza || 0;
                const total = costeU * cantidad;
                return `
                  <tr>
                    <td>${escapeHtml(new Date(p.pedidoEnviadoAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}</td>
                    <td>${escapeHtml(dist?.nombre || '-')}</td>
                    <td>${escapeHtml(p.piezaDescripcion || '-')}</td>
                    <td>${cantidad}</td>
                    <td>${formatEuro(costeU)}</td>
                    <td><strong>${formatEuro(total)}</strong></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }).join('')}
    `;

    const searchInput = document.getElementById('historial-pedidos-search');
    searchInput?.addEventListener('input', (e) => {
      historialBusqueda = e.target.value || '';
      renderHistorialPedidos();
    });
  }

  // Renderizar notas
  function renderNotas() {
    const content = document.getElementById('notas-content');
    if (!content) return;

    if (!ordenSeleccionada) {
      content.innerHTML = '<p class="empty-message">Selecciona una orden para ver las notas</p>';
      return;
    }

    const notas = ordenSeleccionada.notas || [];
    
    content.innerHTML = `
      <div class="notas-timeline">
        ${notas.map(n => `
          <div class="nota-item">
            <div class="nota-fecha">${formatFecha(n.fechaHora)}</div>
            <div class="nota-texto">${escapeHtml(n.texto)}</div>
            <div class="nota-actions">
              ${n.enviadoWhatsApp ? '<span class="nota-whatsapp">📱 Enviado por WhatsApp</span>' : ''}
              ${!n.enviadoWhatsApp ? `<button class="btn btn-ghost btn-sm" onclick="ReparacionesModule.enviarNotaPorWhatsApp('${n.id}')">📱 Enviar por WhatsApp</button>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
      <button class="btn btn-primary" id="btn-nueva-nota">Añadir Nota</button>
    `;

    document.getElementById('btn-nueva-nota').addEventListener('click', mostrarModalNota);
  }

  // Mostrar modal nota
  function mostrarModalNota() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Nueva Nota</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-nota">
            <div class="form-group">
              <label>Nota</label>
              <textarea id="nota-texto" rows="4" required></textarea>
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" id="nota-enviar-whatsapp">
                Enviar por WhatsApp al cliente
              </label>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-nota">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#btn-cancelar-nota').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#form-nota').addEventListener('submit', async (e) => {
      e.preventDefault();
      const texto = document.getElementById('nota-texto').value.trim();
      const enviarWhatsApp = document.getElementById('nota-enviar-whatsapp').checked;

      if (!texto) return;

      if (!ordenSeleccionada.notas) {
        ordenSeleccionada.notas = [];
      }

      const nuevaNota = {
        id: 'note_' + Date.now(),
        texto,
        fechaHora: new Date().toISOString(),
        enviadoWhatsApp: false
      };

      ordenSeleccionada.notas.push(nuevaNota);

      if (enviarWhatsApp) {
        // Obtener datos del cliente
        const clienteId = ordenSeleccionada.clienteId;
        const cliente = clientes.find(c => c.id === clienteId);
        const clienteWhatsapp = ordenSeleccionada.clienteWhatsapp || cliente?.whatsapp || cliente?.telefono;
        
        if (clienteWhatsapp) {
          // Generar mensaje para el cliente
          let mensaje = `*Actualización de Reparación*\n\n`;
          mensaje += `Hola ${ordenSeleccionada.clienteNombre || 'Cliente'},\n\n`;
          if (ordenSeleccionada.numero) {
            mensaje += `Orden: ${ordenSeleccionada.numero}\n`;
          }
          if (ordenSeleccionada.marcaModelo) {
            mensaje += `Equipo: ${ordenSeleccionada.marcaModelo}\n`;
          }
          mensaje += `\n${texto}\n\n`;
          mensaje += `Saludos.`;
          
          // Abrir WhatsApp con el mensaje
          abrirWhatsApp(clienteWhatsapp, mensaje);
          nuevaNota.enviadoWhatsApp = true;
        } else {
          alert('No hay número de WhatsApp disponible para el cliente');
        }
      }

      await window.mrsTpv.saveReparaciones(reparaciones);
      document.body.removeChild(modal);
      renderNotas();
    });
  }

  // Configurar tabs
  function setupTabs() {
    const tabBtns = document.querySelectorAll('.reparaciones-tabs .tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.querySelectorAll('.reparaciones-panel-right .tab-content').forEach(content => {
          content.classList.remove('active');
        });
        document.getElementById(`tab-${tab}`).classList.add('active');

        if (tab === 'pedidos') {
          renderPedidos();
        } else if (tab === 'historial') {
          renderHistorialPedidos();
        } else if (tab === 'notas') {
          renderNotas();
        }
      });
    });
  }

  // Configurar event listeners
  function setupEventListeners() {
    // Nueva reparación
    document.getElementById('btn-nueva-reparacion').addEventListener('click', () => {
      ordenSeleccionada = {
        id: 'rep_' + Date.now(),
        numero: '',
        estado: 'recibido',
        notas: []
      };
      renderReparaciones();
      renderOrden();
    });

    // Filtro estado
    document.getElementById('filter-estado').addEventListener('change', (e) => {
      filtroEstado = e.target.value;
      renderReparaciones();
    });

    // Buscador de órdenes (muestra todo cuando se usa búsqueda)
    document.getElementById('search-ordenes')?.addEventListener('input', (e) => {
      ordenesBusqueda = e.target.value || '';
      renderReparaciones();
    });
  }

  function setupResizer() {
    const container = document.querySelector('.reparaciones-container');
    const leftPanel = document.querySelector('.reparaciones-panel-left');
    const rightPanel = document.querySelector('.reparaciones-panel-right');
    const resizer = document.getElementById('resizer-reparaciones');
    if (!container || !leftPanel || !rightPanel || !resizer) return;

    const STORAGE_KEY = 'mrs_tpv_reparaciones_left_width';
    const MIN_LEFT = 240;
    const MIN_RIGHT = 520;

    const clampWidth = (w) => {
      const maxAllowed = Math.max(MIN_LEFT, container.clientWidth - MIN_RIGHT - resizer.offsetWidth);
      return Math.max(MIN_LEFT, Math.min(w, maxAllowed));
    };

    const applyLeftWidth = (w) => {
      const width = clampWidth(w);
      leftPanel.style.width = `${width}px`;
      localStorage.setItem(STORAGE_KEY, String(width));
      updateResponsiveLayout();
    };

    const updateResponsiveLayout = () => {
      const rightWidth = rightPanel.getBoundingClientRect().width;
      const moduleRoot = document.querySelector('.reparaciones-module');
      if (!moduleRoot) return;
      moduleRoot.classList.toggle('reparaciones-compact', rightWidth < 900);
    };

    const saved = Number(localStorage.getItem(STORAGE_KEY) || 0);
    if (Number.isFinite(saved) && saved > 0) {
      applyLeftWidth(saved);
    } else {
      updateResponsiveLayout();
    }

    let dragging = false;

    const onMove = (clientX) => {
      const rect = container.getBoundingClientRect();
      const next = clientX - rect.left;
      applyLeftWidth(next);
    };

    const onMouseMove = (e) => {
      if (!dragging) return;
      onMove(e.clientX);
    };

    const stopDragging = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('is-resizing-reparaciones');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDragging);
    };

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      document.body.classList.add('is-resizing-reparaciones');
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', stopDragging);
    });

    window.addEventListener('resize', () => {
      const current = parseFloat(leftPanel.style.width || '300');
      applyLeftWidth(Number.isFinite(current) ? current : 300);
    });
  }

  // Inicializar módulo global ANTES de definir funciones
  window.ReparacionesModule = window.ReparacionesModule || {};

  // Utilidades (definidas temprano para evitar problemas de scope)
  function formatEuro(n) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
  }

  function formatFecha(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('es-ES', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Función para abrir WhatsApp con mensaje
  function abrirWhatsApp(numero, mensaje) {
    if (!numero) {
      alert('No hay número de WhatsApp disponible');
      return;
    }
    
    // Limpiar número: quitar espacios, guiones, paréntesis y el signo +
    let numeroLimpio = numero.replace(/[\s\-\(\)\+]/g, '');
    
    // Si no empieza con código de país, asumir España (34)
    if (!numeroLimpio.startsWith('34') && numeroLimpio.length === 9) {
      numeroLimpio = '34' + numeroLimpio;
    }
    
    // Codificar mensaje para URL
    const mensajeCodificado = encodeURIComponent(mensaje);
    
    // Abrir WhatsApp Web/Desktop
    const url = `https://wa.me/${numeroLimpio}?text=${mensajeCodificado}`;
    window.open(url, '_blank');
  }

  // Generar mensaje de pedido para distribuidor
  function generarMensajePedido(pedidos, distribuidor) {
    let mensaje = 'Hola, pedido para el siguiente dia.\n';
    
    pedidos.forEach((p) => {
      const pieza = p.piezaDescripcion || 'Pieza';
      const precio = formatEuro(p.costePieza || 0);
      mensaje += `- ${pieza} (${precio})\n`;
    });
    
    mensaje += '\nGRACIAS';
    
    return mensaje;
  }

  // Enviar nota por WhatsApp
  window.ReparacionesModule.enviarNotaPorWhatsApp = function(notaId) {
    if (!ordenSeleccionada || !ordenSeleccionada.notas) return;
    
    const nota = ordenSeleccionada.notas.find(n => n.id === notaId);
    if (!nota) return;
    
    // Obtener datos del cliente
    const clienteId = ordenSeleccionada.clienteId;
    const cliente = clientes.find(c => c.id === clienteId);
    const clienteWhatsapp = ordenSeleccionada.clienteWhatsapp || cliente?.whatsapp || cliente?.telefono;
    
    if (!clienteWhatsapp) {
      alert('No hay número de WhatsApp disponible para el cliente');
      return;
    }
    
    // Generar mensaje para el cliente
    let mensaje = `*Actualización de Reparación*\n\n`;
    mensaje += `Hola ${ordenSeleccionada.clienteNombre || 'Cliente'},\n\n`;
    if (ordenSeleccionada.numero) {
      mensaje += `Orden: ${ordenSeleccionada.numero}\n`;
    }
    if (ordenSeleccionada.marcaModelo) {
      mensaje += `Equipo: ${ordenSeleccionada.marcaModelo}\n`;
    }
    mensaje += `\n${nota.texto}\n\n`;
    mensaje += `Saludos.`;
    
    // Abrir WhatsApp con el mensaje
    abrirWhatsApp(clienteWhatsapp, mensaje);
    
    // Marcar nota como enviada
    nota.enviadoWhatsApp = true;
    window.mrsTpv.saveReparaciones(reparaciones);
    renderNotas();
  };

  // Enviar pedido
  window.ReparacionesModule.enviarPedido = async function(distribuidorId) {
    const pedidos = reparaciones.filter(r => 
      r.requierePieza && r.distribuidorId === distribuidorId && r.pedidoEstado !== 'recibido'
    );
    const distribuidor = distribuidores.find(d => d.id === distribuidorId);
    
    if (!distribuidor) {
      alert('Distribuidor no encontrado');
      return;
    }
    
    if (pedidos.length === 0) {
      alert('No hay pedidos pendientes para este distribuidor');
      return;
    }
    
    // Generar mensaje del pedido
    const mensaje = generarMensajePedido(pedidos, distribuidor);
    
    // Abrir WhatsApp con el mensaje
    abrirWhatsApp(distribuidor.whatsapp, mensaje);
    
    // Marcar pedidos como enviados
    pedidos.forEach(p => {
      p.pedidoEstado = 'enviado';
      p.pedidoEnviadoAt = new Date().toISOString();
    });
    
    await window.mrsTpv.saveReparaciones(reparaciones);
    renderPedidos();
    renderHistorialPedidos();

    // Al enviar, mover automáticamente a Historial.
    const historialTabBtn = document.querySelector('.reparaciones-tabs .tab-btn[data-tab="historial"]');
    historialTabBtn?.click();
  };

  // Exportar función de inicialización
  window.ReparacionesModule.init = init;
})();
