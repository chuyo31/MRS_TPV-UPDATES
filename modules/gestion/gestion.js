/**
 * Módulo Gestión - Presupuestos, Albaranes, Facturas
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let presupuestos = [];
  let albaranes = [];
  let facturas = [];
  let tickets = [];
  let categorias = [];
  let clientes = [];
  let config = {};
  let series = {};
  let currentSession = null;
  let tipoFiltro = 'todos';
  let estadoFiltro = '';
  let vistaPanel = 'comercial';

  async function init() {
    if (window.VerifactuCore) {
      await window.VerifactuCore.init();
    }
    currentSession = await window.mrsTpv.getSession();
    await loadData();
    render();
    setupEventListeners();
    processPendingGestionAction();
  }

  async function loadData() {
    presupuestos = await window.mrsTpv.getGestionPresupuestos() || [];
    albaranes = await window.mrsTpv.getGestionAlbaranes() || [];
    facturas = await window.mrsTpv.getFacturas() || [];
    tickets = await window.mrsTpv.getTickets() || [];
    categorias = await window.mrsTpv.getCategorias() || [];
    clientes = await window.mrsTpv.getClientes() || [];
    config = await window.mrsTpv.getConfig() || {};
    series = await window.mrsTpv.getGestionSeries() || {};
  }

  function generarNumero(tipo) {
    const año = new Date().getFullYear();
    const añoStr = String(año);
    const tipoKey = tipo === 'presupuesto' ? 'presupuestos' : tipo === 'albaran' ? 'albaranes' : 'facturas';
    const prefijo = tipo === 'presupuesto' ? 'PRE' : tipo === 'albaran' ? 'ALB' : 'FAC';
    
    if (!series[tipoKey]) series[tipoKey] = {};
    const num = (series[tipoKey][añoStr] || 0) + 1;
    series[tipoKey][añoStr] = num;
    return `${prefijo}-${añoStr}-${String(num).padStart(4, '0')}`;
  }

  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    content.innerHTML = `
      <div class="gestion-module">
        <div class="module-header">
          <h2>Gestión Comercial</h2>
          <div class="gestion-header-actions">
            <button class="btn btn-primary" id="btn-nuevo-presupuesto">Nuevo Presupuesto</button>
            <button class="btn btn-primary" id="btn-nueva-factura">Nueva Factura</button>
            <button class="btn btn-ghost" id="btn-ir-historial">Historial</button>
            <button class="btn btn-ghost" id="btn-exporting-advice">Exportación</button>
          </div>
        </div>

        <div id="gestion-panel-comercial" style="${vistaPanel === 'comercial' ? '' : 'display:none;'}">
          <div class="gestion-filters">
            <select id="filter-tipo">
              <option value="todos">Todos</option>
              <option value="presupuesto">Presupuestos</option>
              <option value="albaran">Albaranes</option>
              <option value="factura">Facturas</option>
            </select>
            <select id="filter-estado">
              <option value="">Todos los estados</option>
              <option value="borrador">Borrador</option>
              <option value="emitido">Emitido</option>
              <option value="aceptado">Aceptado</option>
              <option value="aceptada">Aceptada</option>
              <option value="rechazado">Rechazado</option>
              <option value="convertido">Convertido</option>
              <option value="facturado">Facturado</option>
              <option value="emitida">Emitida</option>
              <option value="anulada">Anulada</option>
              <option value="rectificada">Rectificada</option>
            </select>
          </div>

          <div class="table-container">
            <table id="gestion-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Total</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="gestion-tbody"></tbody>
            </table>
          </div>
        </div>

        <div id="gestion-panel-exporting" class="documentos-module" style="${vistaPanel === 'exporting' ? '' : 'display:none;'}">
          <div class="module-header">
            <h3>Exportación</h3>
          </div>
          <div class="documentos-filters">
            <div class="form-group">
              <label>Desde</label>
              <input type="date" id="gestion-fecha-desde">
            </div>
            <div class="form-group">
              <label>Hasta</label>
              <input type="date" id="gestion-fecha-hasta">
            </div>
            <button class="btn btn-primary" id="btn-gestion-aplicar-filtros">Aplicar Filtros</button>
          </div>
          <div class="documentos-actions">
            <button class="btn btn-primary" id="btn-gestion-exportar-tickets-pdf">Exportar Tickets a PDF</button>
            <button class="btn btn-primary" id="btn-gestion-exportar-facturas-pdf">Exportar Facturas a PDF</button>
            <button class="btn btn-primary" id="btn-gestion-exportar-historial-pdf">Exportar Historial Completo a PDF</button>
            <button class="btn btn-primary" id="btn-gestion-exportar-csv">Exportar a CSV</button>
          </div>
        </div>
      </div>
    `;

    renderLista();
  }

  function renderLista() {
    const tbody = document.getElementById('gestion-tbody');
    if (!tbody) return;

    let items = [];
    if (tipoFiltro === 'todos' || tipoFiltro === 'presupuesto') {
      items.push(...presupuestos.map(p => ({ ...p, tipo: 'presupuesto' })));
    }
    if (tipoFiltro === 'todos' || tipoFiltro === 'albaran') {
      items.push(...albaranes.map(a => ({ ...a, tipo: 'albaran' })));
    }
    if (tipoFiltro === 'todos' || tipoFiltro === 'factura') {
      items.push(...facturas.map(f => ({ ...f, tipo: 'factura' })));
    }

    if (estadoFiltro) {
      items = items.filter(i => i.estado === estadoFiltro);
    }

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-message">No hay documentos</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(item => {
      const cliente = clientes.find(c => c.id === item.clienteId);
      return `
        <tr>
          <td>${item.numero || 'BORRADOR'}</td>
          <td>${formatFecha(item.fechaHora || item.createdAt)}</td>
          <td>${cliente ? escapeHtml(cliente.nombre || cliente.razonSocial || '-') : '-'}</td>
          <td>${item.tipo === 'presupuesto' ? 'Presupuesto' : item.tipo === 'albaran' ? 'Albarán' : 'Factura'}</td>
          <td>${formatEstadoDocumento(item)}</td>
          <td>${formatEuro(item.total || 0)}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="GestionModule.verDocumento('${item.tipo}', '${item.id}')">Ver</button>
            <button class="btn btn-ghost btn-sm" onclick="GestionModule.editarDocumento('${item.tipo}', '${item.id}')">Editar</button>
            ${item.tipo === 'presupuesto' && item.estado === 'aceptado' ? 
              `<button class="btn btn-ghost btn-sm" onclick="GestionModule.convertirAlbaran('${item.id}')">Convertir</button>` : ''}
            ${item.tipo === 'albaran' && item.estado !== 'facturado' ? 
              `<button class="btn btn-ghost btn-sm" onclick="GestionModule.facturar('${item.id}')">Facturar</button>` : ''}
          </td>
        </tr>
      `;
    }).join('');
  }

  function setupEventListeners() {
    document.getElementById('btn-nuevo-presupuesto').addEventListener('click', () => {
      mostrarModalPresupuesto();
    });
    document.getElementById('btn-nueva-factura').addEventListener('click', () => {
      mostrarModalFactura();
    });
    document.getElementById('btn-ir-historial').addEventListener('click', () => {
      irModuloHistorial();
    });
    document.getElementById('btn-exporting-advice').addEventListener('click', () => {
      vistaPanel = vistaPanel === 'exporting' ? 'comercial' : 'exporting';
      render();
      setupEventListeners();
      renderLista();
    });

    document.getElementById('filter-tipo').addEventListener('change', (e) => {
      tipoFiltro = e.target.value;
      renderLista();
    });

    document.getElementById('filter-estado').addEventListener('change', (e) => {
      estadoFiltro = e.target.value;
      renderLista();
    });

    document.getElementById('btn-gestion-aplicar-filtros')?.addEventListener('click', () => {
      alert('Filtros aplicados. Los exportes usarán estas fechas.');
    });
    document.getElementById('btn-gestion-exportar-tickets-pdf')?.addEventListener('click', exportarTicketsPDFGestion);
    document.getElementById('btn-gestion-exportar-facturas-pdf')?.addEventListener('click', exportarFacturasPDFGestion);
    document.getElementById('btn-gestion-exportar-historial-pdf')?.addEventListener('click', exportarHistorialPDFGestion);
    document.getElementById('btn-gestion-exportar-csv')?.addEventListener('click', exportarCSVGestion);
  }

  function mostrarModalPresupuesto(presupuestoId = null) {
    let presupuesto = presupuestoId ? presupuestos.find(p => p.id === presupuestoId) : null;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 800px;">
        <div class="modal-header">
          <h3 class="modal-title">${presupuesto ? 'Editar' : 'Nuevo'} Presupuesto</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-presupuesto">
            <div class="form-group">
              <label>Cliente *</label>
              <select id="pres-cliente" required>
                <option value="">Seleccionar...</option>
              </select>
            </div>
            <div class="form-group">
              <label>Equipo</label>
              <input type="text" id="pres-equipo" value="${presupuesto?.equipo || ''}">
            </div>
            <div class="form-group">
              <label>Serie</label>
              <input type="text" id="pres-serie" value="${presupuesto?.serie || ''}">
            </div>
            <div class="form-group">
              <label>Avería Reportada</label>
              <textarea id="pres-averia" rows="2">${presupuesto?.averiaReportada || ''}</textarea>
            </div>
            <div class="form-group">
              <label>Trabajo a Realizar</label>
              <textarea id="pres-trabajo" rows="2">${presupuesto?.trabajoRealizar || ''}</textarea>
            </div>
            <div id="pres-lineas">
              <h4>Líneas</h4>
              <div id="pres-lineas-list"></div>
              <button type="button" class="btn btn-ghost" id="btn-add-linea">Añadir Línea</button>
            </div>
            <div class="form-group">
              <label>Notas</label>
              <textarea id="pres-notas" rows="2">${presupuesto?.notas || ''}</textarea>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-pres">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Llenar clientes
    const selectCliente = document.getElementById('pres-cliente');
    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre || cliente.razonSocial || cliente.email;
      if (presupuesto && presupuesto.clienteId === cliente.id) {
        option.selected = true;
      }
      selectCliente.appendChild(option);
    });

    // Renderizar líneas
    const lineas = Array.isArray(presupuesto?.lineas) ? presupuesto.lineas.map(l => ({ ...l })) : [];
    renderLineasPresupuesto(lineas);

    // Añadir línea
    document.getElementById('btn-add-linea').addEventListener('click', () => {
      lineas.push(crearLineaBase());
      renderLineasPresupuesto(lineas);
    });

    modal.querySelector('#btn-cancelar-pres').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#form-presupuesto').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (!presupuesto || !presupuesto.numero) {
        presupuesto = {
          id: 'pres_' + Date.now(),
          numero: generarNumero('presupuesto'),
          estado: 'borrador',
          fechaHora: new Date().toISOString(),
          lineas: [],
          trazas: [{
            tipo: 'creado',
            fechaHora: new Date().toISOString(),
            usuario: currentSession.email
          }]
        };
      }

      presupuesto.clienteId = document.getElementById('pres-cliente').value;
      presupuesto.equipo = document.getElementById('pres-equipo').value.trim();
      presupuesto.serie = document.getElementById('pres-serie').value.trim();
      presupuesto.averiaReportada = document.getElementById('pres-averia').value.trim();
      presupuesto.trabajoRealizar = document.getElementById('pres-trabajo').value.trim();
      presupuesto.notas = document.getElementById('pres-notas').value.trim();
      presupuesto.lineas = lineas;

      const totales = calcularTotalesLineas(lineas);
      presupuesto.base = totales.base;
      presupuesto.ivaPorTipo = totales.ivaPorTipo;
      presupuesto.total = totales.total;

      const index = presupuestos.findIndex(p => p.id === presupuesto.id);
      if (index >= 0) {
        presupuestos[index] = presupuesto;
      } else {
        presupuestos.push(presupuesto);
      }

      await window.mrsTpv.saveGestionSeries(series);
      await window.mrsTpv.saveGestionPresupuestos(presupuestos);
      document.body.removeChild(modal);
      renderLista();
    });
  }

  function renderLineasPresupuesto(lineas) {
    const list = document.getElementById('pres-lineas-list');
    if (!list) return;

    list.innerHTML = lineas.map((linea, index) => `
      <div class="linea-presupuesto">
        <select class="linea-tipo" data-index="${index}">
          <option value="pieza" ${linea.tipo === 'pieza' ? 'selected' : ''}>Pieza</option>
          <option value="mano_obra" ${linea.tipo === 'mano_obra' ? 'selected' : ''}>Mano de obra</option>
          <option value="libre" ${linea.tipo === 'libre' ? 'selected' : ''}>Libre</option>
        </select>
        <input type="text" class="linea-descripcion" data-index="${index}" value="${linea.descripcion || ''}" placeholder="Descripción">
        <input type="number" class="linea-cantidad" data-index="${index}" value="${linea.cantidad || 1}" min="1" style="width: 80px;">
        <input type="number" class="linea-precio" data-index="${index}" value="${linea.precio || 0}" step="0.01" min="0" style="width: 100px;">
        <input type="number" class="linea-iva" data-index="${index}" value="${linea.iva || 21}" min="0" max="100" style="width: 60px;">
        <button type="button" class="btn btn-ghost btn-sm linea-remove" data-index="${index}">×</button>
      </div>
    `).join('');

    // Event listeners
    list.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('change', () => {
        const index = parseInt(el.dataset.index);
        if (el.classList.contains('linea-tipo')) lineas[index].tipo = el.value;
        if (el.classList.contains('linea-descripcion')) lineas[index].descripcion = el.value;
        if (el.classList.contains('linea-cantidad')) lineas[index].cantidad = parseInt(el.value) || 1;
        if (el.classList.contains('linea-precio')) lineas[index].precio = parseFloat(el.value) || 0;
        if (el.classList.contains('linea-iva')) lineas[index].iva = parseFloat(el.value) || 21;
      });
    });
    list.querySelectorAll('.linea-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index, 10);
        if (Number.isNaN(index)) return;
        lineas.splice(index, 1);
        renderLineasPresupuesto(lineas);
      });
    });
  }

  function mostrarModalFactura(facturaId = null) {
    let factura = facturaId ? facturas.find(f => f.id === facturaId) : null;
    const lineas = Array.isArray(factura?.lineas) ? factura.lineas.map(l => ({ ...l })) : [];
    
    // Verificar si la factura está emitida/anulada/rectificada (bloqueada para edición directa)
    const estadoBloqueado = factura && (factura.estado === 'emitida' || factura.estado === 'anulada' || factura.estado === 'rectificada');
    const esEdicionBloqueada = estadoBloqueado;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 860px;">
        <div class="modal-header">
          <h3 class="modal-title">${factura ? (esEdicionBloqueada ? 'Ver Factura (Bloqueada)' : 'Editar') : 'Nueva'} Factura</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          ${esEdicionBloqueada ? `
            <div class="alert alert-warning" style="margin-bottom:15px;padding:10px;background:#fff3cd;border:1px solid #ffc107;border-radius:4px">
              <strong>Factura bloqueada:</strong> Esta factura está ${factura.estado} y no puede editarse directamente. 
              Para modificarla, debe usar la opción de rectificación desde el módulo Historial.
            </div>
          ` : ''}
          <form id="form-factura">
            <div class="form-group">
              <label>Cliente *</label>
              <select id="fac-cliente" required ${esEdicionBloqueada ? 'disabled' : ''}>
                <option value="">Seleccionar...</option>
              </select>
            </div>
            <div id="fac-lineas">
              <h4>Líneas de factura</h4>
              <div id="fac-lineas-list"></div>
              ${!esEdicionBloqueada ? '<button type="button" class="btn btn-ghost" id="btn-add-linea-fac">Añadir Línea</button>' : ''}
            </div>
            <div class="form-group mt-2">
              <label>Estado de factura</label>
              <select id="fac-estado" ${esEdicionBloqueada ? 'disabled' : ''}>
                <option value="borrador" ${factura?.estado === 'borrador' ? 'selected' : ''}>Borrador</option>
                <option value="emitida" ${!factura || factura?.estado === 'emitida' ? 'selected' : ''}>Emitida</option>
                <option value="aceptada" ${factura?.estado === 'aceptada' ? 'selected' : ''}>Aceptada</option>
                <option value="anulada" ${factura?.estado === 'anulada' ? 'selected' : ''}>Anulada</option>
                <option value="rectificada" ${factura?.estado === 'rectificada' ? 'selected' : ''}>Rectificada</option>
              </select>
            </div>
            <div class="form-group mt-2">
              <label>Notas</label>
              <textarea id="fac-notas" rows="2" ${esEdicionBloqueada ? 'disabled' : ''}>${factura?.notas || ''}</textarea>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-fac">${esEdicionBloqueada ? 'Cerrar' : 'Cancelar'}</button>
              ${!esEdicionBloqueada ? '<button type="submit" class="btn btn-primary">Guardar Factura</button>' : ''}
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const selectCliente = modal.querySelector('#fac-cliente');
    clientes.forEach(cliente => {
      const option = document.createElement('option');
      option.value = cliente.id;
      option.textContent = cliente.nombre || cliente.razonSocial || cliente.email;
      if (factura && factura.clienteId === cliente.id) option.selected = true;
      selectCliente.appendChild(option);
    });

    renderLineasFactura(lineas, esEdicionBloqueada);

    if (!esEdicionBloqueada) {
      modal.querySelector('#btn-add-linea-fac').addEventListener('click', () => {
        lineas.push(crearLineaBase());
        renderLineasFactura(lineas, false);
      });
    }
    modal.querySelector('#btn-cancelar-fac').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    modal.querySelector('#form-factura').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (esEdicionBloqueada) {
        document.body.removeChild(modal);
        return;
      }

      const clienteId = modal.querySelector('#fac-cliente').value;
      if (!clienteId) {
        alert('Debes seleccionar un cliente.');
        return;
      }
      if (!lineas.length) {
        alert('Debes añadir al menos una línea.');
        return;
      }

      const cleaned = lineas
        .map(l => ({
          descripcion: String(l.descripcion || '').trim(),
          cantidad: Math.max(1, parseInt(l.cantidad, 10) || 1),
          precio: Math.max(0, parseFloat(l.precio) || 0),
          iva: Math.max(0, parseFloat(l.iva) || 0)
        }))
        .filter(l => l.descripcion || l.precio > 0);

      if (!cleaned.length) {
        alert('Debes completar al menos una línea con concepto o precio.');
        return;
      }

      const estadoAnterior = factura?.estado;
      const esNueva = !factura || !factura.numero;
      
      if (esNueva) {
        factura = {
          id: 'fac_' + Date.now(),
          numero: generarNumero('factura'),
          fechaHora: new Date().toISOString(),
          estado: 'borrador'
        };
      }

      const totales = calcularTotalesLineas(cleaned);
      factura.clienteId = clienteId;
      factura.estado = modal.querySelector('#fac-estado').value || 'borrador';
      factura.lineas = cleaned;
      factura.notas = modal.querySelector('#fac-notas').value.trim();
      factura.base = totales.base;
      factura.ivaPorTipo = totales.ivaPorTipo;
      factura.total = totales.total;

      const index = facturas.findIndex(f => f.id === factura.id);
      if (index >= 0) {
        facturas[index] = factura;
      } else {
        facturas.push(factura);
      }

      await window.mrsTpv.saveGestionSeries(series);
      await window.mrsTpv.saveFacturas(facturas);
      
      // Registro fiscal Verifactu (solo para facturas emitidas)
      if (window.VerifactuCore && factura.estado === 'emitida') {
        try {
          if (esNueva || estadoAnterior !== 'emitida') {
            // Nueva factura emitida o cambio a emitida
            const registro = await window.VerifactuCore.crearRegistroFiscal(
              window.VerifactuCore.REGISTRO_TIPOS.ALTA,
              factura
            );
            await window.VerifactuCore.registrarAuditTrail(
              esNueva ? 'crear_factura' : 'cambiar_estado_emitida',
              factura.id,
              factura.numero,
              currentSession?.nombre || currentSession?.email || 'sistema',
              { estadoAnterior: estadoAnterior }
            );
          }
        } catch (e) {
          console.error('Error creando registro fiscal:', e);
        }
      }
      
      document.body.removeChild(modal);
      tipoFiltro = 'factura';
      const filterTipo = document.getElementById('filter-tipo');
      if (filterTipo) filterTipo.value = 'factura';
      renderLista();
    });
  }

  function renderLineasFactura(lineas, bloqueado = false) {
    const list = document.getElementById('fac-lineas-list');
    if (!list) return;

    const disabledAttr = bloqueado ? 'disabled' : '';
    list.innerHTML = lineas.map((linea, index) => `
      <div class="linea-presupuesto">
        <input type="text" class="linea-descripcion" data-index="${index}" value="${escapeHtml(linea.descripcion || '')}" placeholder="Concepto" ${disabledAttr}>
        <input type="number" class="linea-cantidad" data-index="${index}" value="${linea.cantidad || 1}" min="1" style="width: 80px;" ${disabledAttr}>
        <input type="number" class="linea-precio" data-index="${index}" value="${linea.precio || 0}" step="0.01" min="0" style="width: 110px;" ${disabledAttr}>
        <input type="number" class="linea-iva" data-index="${index}" value="${linea.iva || 21}" min="0" max="100" style="width: 70px;" ${disabledAttr}>
        ${!bloqueado ? `<button type="button" class="btn btn-ghost btn-sm linea-remove" data-index="${index}">×</button>` : ''}
      </div>
    `).join('');

    if (!bloqueado) {
      list.querySelectorAll('input').forEach(el => {
        el.addEventListener('input', () => {
          const index = parseInt(el.dataset.index, 10);
          if (Number.isNaN(index)) return;
          if (!lineas[index]) return;
          if (el.classList.contains('linea-descripcion')) lineas[index].descripcion = el.value;
          if (el.classList.contains('linea-cantidad')) lineas[index].cantidad = parseInt(el.value, 10) || 1;
          if (el.classList.contains('linea-precio')) lineas[index].precio = parseFloat(el.value) || 0;
          if (el.classList.contains('linea-iva')) lineas[index].iva = parseFloat(el.value) || 0;
        });
      });
      list.querySelectorAll('.linea-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const index = parseInt(btn.dataset.index, 10);
          if (Number.isNaN(index)) return;
          lineas.splice(index, 1);
          renderLineasFactura(lineas, false);
        });
      });
    }
  }

  function crearLineaBase() {
    return {
      tipo: 'mano_obra',
      descripcion: '',
      cantidad: 1,
      precio: 0,
      iva: 21
    };
  }

  function calcularTotalesLineas(lineas) {
    let base = 0;
    const ivaPorTipo = {};
    (lineas || []).forEach((l) => {
      const cantidad = Number(l?.cantidad || 0);
      const precio = Number(l?.precio || 0);
      const iva = Number(l?.iva || 0);
      const subtotal = precio * cantidad;
      base += subtotal;
      if (!ivaPorTipo[iva]) ivaPorTipo[iva] = { base: 0, cuota: 0 };
      ivaPorTipo[iva].base += subtotal;
      ivaPorTipo[iva].cuota = ivaPorTipo[iva].base * (iva / 100);
    });
    const totalIva = Object.values(ivaPorTipo).reduce((sum, item) => sum + Number(item.cuota || 0), 0);
    return {
      base,
      ivaPorTipo,
      total: base + totalIva
    };
  }

  function getFiltradosExportGestion() {
    const desde = document.getElementById('gestion-fecha-desde')?.value || '';
    const hasta = document.getElementById('gestion-fecha-hasta')?.value || '';

    let ticketsFiltrados = [...tickets];
    let facturasFiltradas = [...facturas];

    if (desde) {
      const desdeDate = new Date(desde);
      ticketsFiltrados = ticketsFiltrados.filter(t => new Date(t.fechaHora) >= desdeDate);
      facturasFiltradas = facturasFiltradas.filter(f => new Date(f.fechaHora) >= desdeDate);
    }
    if (hasta) {
      const hastaDate = new Date(hasta);
      hastaDate.setHours(23, 59, 59, 999);
      ticketsFiltrados = ticketsFiltrados.filter(t => new Date(t.fechaHora) <= hastaDate);
      facturasFiltradas = facturasFiltradas.filter(f => new Date(f.fechaHora) <= hastaDate);
    }
    return { tickets: ticketsFiltrados, facturas: facturasFiltradas };
  }

  async function exportarTicketsPDFGestion() {
    const { tickets: ticketsFiltrados } = getFiltradosExportGestion();
    const html = generarHTMLTicketsExport(ticketsFiltrados);
    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToPdf(html, `tickets_${fecha}.pdf`);
  }

  async function exportarFacturasPDFGestion() {
    const { facturas: facturasFiltradas } = getFiltradosExportGestion();
    const html = generarHTMLFacturasExport(facturasFiltradas);
    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToPdf(html, `facturas_${fecha}.pdf`);
  }

  async function exportarHistorialPDFGestion() {
    const { tickets: ticketsFiltrados, facturas: facturasFiltradas } = getFiltradosExportGestion();
    const html = generarHTMLHistorialCompletoExport(ticketsFiltrados, facturasFiltradas);
    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToPdf(html, `historial_completo_${fecha}.pdf`);
  }

  async function exportarCSVGestion() {
    const { tickets: ticketsFiltrados, facturas: facturasFiltradas } = getFiltradosExportGestion();
    let csv = 'Tipo,Número,Fecha,Cliente,Base,IVA,Total\n';

    ticketsFiltrados.forEach(t => {
      const cliente = t.cliente ? (t.cliente.nombre || t.cliente.razonSocial || '-') : '-';
      const iva = Object.values(t.ivaPorTipo || {}).reduce((sum, item) => sum + Number(item?.cuota || 0), 0);
      const base = Number(t.total || 0) - iva;
      csv += `Ticket,${t.numero || '-'},${formatFechaCSV(t.fechaHora)},${cliente},${base},${iva},${t.total || 0}\n`;
    });

    facturasFiltradas.forEach(f => {
      const byId = clientes.find(c => c.id === f?.clienteId);
      const cliente = byId ? (byId.nombre || byId.razonSocial || byId.email || '-') : '-';
      const iva = Object.values(f.ivaPorTipo || {}).reduce((sum, item) => sum + Number(item?.cuota || 0), 0);
      const base = Number(f.total || 0) - iva;
      csv += `Factura,${f.numero || '-'},${formatFechaCSV(f.fechaHora)},${cliente},${base},${iva},${f.total || 0}\n`;
    });

    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToCsv(csv, `exportacion_${fecha}.csv`);
  }

  function generarHTMLTicketsExport(ticketsData) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#f5f5f5}
      </style></head><body><h1>Tickets de Venta</h1><table>
      <tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Total</th></tr>
      ${ticketsData.map(t => `<tr><td>${escapeHtml(t.numero || '-')}</td><td>${formatFecha(t.fechaHora)}</td><td>${escapeHtml(t?.cliente?.nombre || t?.cliente?.razonSocial || '-')}</td><td>${formatEuro(t.total || 0)}</td></tr>`).join('')}
      </table></body></html>`;
  }

  function generarHTMLFacturasExport(facturasData) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial;padding:20px}table{width:100%;border-collapse:collapse;margin-top:20px}
      th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#f5f5f5}
      </style></head><body><h1>Facturas</h1><table>
      <tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Total</th></tr>
      ${facturasData.map(f => {
        const byId = clientes.find(c => c.id === f?.clienteId);
        const cliente = byId ? (byId.nombre || byId.razonSocial || byId.email || '-') : '-';
        return `<tr><td>${escapeHtml(f.numero || '-')}</td><td>${formatFecha(f.fechaHora)}</td><td>${escapeHtml(cliente)}</td><td>${escapeHtml(formatEstadoDocumento({ tipo: 'factura', estado: f?.estado }))}</td><td>${formatEuro(f.total || 0)}</td></tr>`;
      }).join('')}
      </table></body></html>`;
  }

  function generarHTMLHistorialCompletoExport(ticketsData, facturasData) {
    const nombreEmpresa = String(config?.nombreEmpresa || 'MRS_TPV');
    const totalBase = [...ticketsData, ...facturasData].reduce((sum, item) => {
      const iva = Object.values(item.ivaPorTipo || {}).reduce((s, i) => s + Number(i?.cuota || 0), 0);
      return sum + Number(item.total || 0) - iva;
    }, 0);
    const totalIva = [...ticketsData, ...facturasData].reduce((sum, item) =>
      sum + Object.values(item.ivaPorTipo || {}).reduce((s, i) => s + Number(i?.cuota || 0), 0), 0);
    const totalVentas = [...ticketsData, ...facturasData].reduce((sum, item) => sum + Number(item.total || 0), 0);
    const porCategoria = {};
    [...ticketsData, ...facturasData].forEach((doc) => {
      (doc?.lineas || []).forEach((l) => {
        const categoria = categorias.find(c => c.id === l?.categoriaId);
        const catNombre = categoria ? categoria.nombre : 'Sin categoría';
        if (!porCategoria[catNombre]) {
          porCategoria[catNombre] = { cantidad: 0, total: 0 };
        }
        const cantidad = Number(l?.cantidad || 1);
        const precio = Number(l?.precio || 0);
        const subtotal = Number(l?.subtotal ?? (cantidad * precio));
        porCategoria[catNombre].cantidad += cantidad;
        porCategoria[catNombre].total += subtotal;
      });
    });

    const filasCategorias = Object.entries(porCategoria).map(([cat, data]) => `
      <tr>
        <td>${escapeHtml(cat)}</td>
        <td>${data.cantidad}</td>
        <td>${formatEuro(data.total)}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #e9e9ea;
      margin: 0;
      padding: 28px;
      color: #111;
    }
    h1 {
      margin: 0 0 24px 0;
      font-size: 46px;
      font-weight: 700;
    }
    .empresa {
      margin: -10px 0 20px 0;
      font-size: 20px;
      color: #2b2b2b;
      font-weight: 600;
    }
    h2 {
      margin: 26px 0 16px 0;
      font-size: 26px;
      font-weight: 700;
    }
    .resumen {
      background: #efeff0;
      border-radius: 6px;
      padding: 20px 22px;
      margin-bottom: 26px;
    }
    .resumen p {
      font-size: 18px;
      margin: 16px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: #ececed;
      font-size: 16px;
    }
    th, td {
      padding: 12px 10px;
      border: 2px solid #c8c8c8;
      text-align: left;
    }
    th {
      font-weight: 700;
      background: #e5e5e6;
    }
  </style>
</head>
<body>
  <h1>Historial Completo</h1>
  <div class="empresa">${escapeHtml(nombreEmpresa)}</div>
  <div class="resumen">
    <h2 style="margin-top:0;">Resumen</h2>
    <p>Base imponible: ${formatEuro(totalBase)}</p>
    <p>Total IVA: ${formatEuro(totalIva)}</p>
    <p>Total ventas: ${formatEuro(totalVentas)}</p>
  </div>

  <h2>Por Categorías</h2>
  <table>
    <thead>
      <tr>
        <th>Categoría</th>
        <th>Cantidad</th>
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${filasCategorias || '<tr><td colspan="3">Sin datos</td></tr>'}
    </tbody>
  </table>
</body>
</html>`;
  }

  function formatEstadoDocumento(item) {
    const estado = String(item?.estado || '').trim().toLowerCase();
    const tipo = String(item?.tipo || '').trim().toLowerCase();
    if (!estado) return '-';
    const labels = {
      borrador: 'Borrador',
      emitido: 'Emitido',
      emitida: 'Emitida',
      aceptado: 'Aceptado',
      aceptada: 'Aceptada',
      rechazado: 'Rechazado',
      convertido: 'Convertido',
      facturado: 'Facturado',
      rectificada: 'Rectificada',
      anulada: 'Anulada'
    };
    if (tipo === 'factura' && estado === 'aceptado') return 'Aceptada';
    if (tipo === 'factura' && estado === 'emitido') return 'Emitida';
    return labels[estado] || estado;
  }

  window.GestionModule = window.GestionModule || {};
  window.GestionModule.verDocumento = function(tipo, id) {
    if (tipo === 'presupuesto') {
      const presupuesto = presupuestos.find(p => p.id === id);
      if (!presupuesto) return;
      const html = buildPresupuestoA4PreviewHtml(presupuesto);
      abrirModalDocumentoGestion(
        'Presupuesto ' + (presupuesto.numero || ''),
        html,
        [
          {
            label: 'Imprimir',
            onClick: () => {
              const docHtml = buildPresupuestoA4DocumentHtml(presupuesto);
              return printHtmlDocumento(docHtml);
            }
          },
          {
            label: 'Guardar PDF',
            primary: true,
            onClick: () => {
              const docHtml = buildPresupuestoA4DocumentHtml(presupuesto);
              const file = String(presupuesto?.numero || 'presupuesto').replace(/[^\w\-]+/g, '_') + '.pdf';
              return window.mrsTpv.exportToPdf(docHtml, file);
            }
          }
        ]
      );
      return;
    }
    if (tipo === 'albaran') {
      const albaran = albaranes.find(a => a.id === id);
      if (!albaran) return;
      const html = buildAlbaranA4PreviewHtml(albaran);
      abrirModalDocumentoGestion(
        'Albarán ' + (albaran.numero || ''),
        html,
        [
          {
            label: 'Imprimir',
            onClick: () => {
              const docHtml = buildAlbaranA4DocumentHtml(albaran);
              return printHtmlDocumento(docHtml);
            }
          },
          {
            label: 'Guardar PDF',
            primary: true,
            onClick: () => {
              const docHtml = buildAlbaranA4DocumentHtml(albaran);
              const file = String(albaran?.numero || 'albaran').replace(/[^\w\-]+/g, '_') + '.pdf';
              return window.mrsTpv.exportToPdf(docHtml, file);
            }
          }
        ]
      );
      return;
    }
    if (tipo === 'factura') {
      const factura = facturas.find(f => f.id === id);
      if (!factura) return;
      abrirModalVistaFactura(factura);
      return;
    }
    alert('Ver documento: ' + tipo + ' - ' + id);
  };
  window.GestionModule.editarDocumento = function(tipo, id) {
    if (tipo === 'presupuesto') {
      mostrarModalPresupuesto(id);
      return;
    }
    if (tipo === 'factura') {
      mostrarModalFactura(id);
    }
  };
  window.GestionModule.convertirAlbaran = async function(presupuestoId) {
    const presupuesto = presupuestos.find(p => p.id === presupuestoId);
    if (!presupuesto) return;

    const albaran = {
      id: 'alb_' + Date.now(),
      numero: generarNumero('albaran'),
      fechaHora: new Date().toISOString(),
      clienteId: presupuesto.clienteId,
      equipo: presupuesto.equipo,
      serie: presupuesto.serie,
      averiaReportada: presupuesto.averiaReportada,
      trabajoRealizar: presupuesto.trabajoRealizar,
      lineas: presupuesto.lineas.map(l => ({ ...l })),
      notas: presupuesto.notas,
      base: presupuesto.base,
      ivaPorTipo: presupuesto.ivaPorTipo,
      total: presupuesto.total,
      estado: 'emitido',
      presupuestoId: presupuesto.id
    };

    presupuesto.estado = 'convertido';
    presupuesto.trazas.push({
      tipo: 'convertido',
      fechaHora: new Date().toISOString(),
      usuario: currentSession.email,
      albaranId: albaran.id,
      albaranNumero: albaran.numero
    });

    albaranes.push(albaran);
    await window.mrsTpv.saveGestionSeries(series);
    await window.mrsTpv.saveGestionPresupuestos(presupuestos);
    await window.mrsTpv.saveGestionAlbaranes(albaranes);
    renderLista();
  };
  window.GestionModule.facturar = async function(albaranId) {
    const albaran = albaranes.find(a => a.id === albaranId);
    if (!albaran) return;

    const factura = {
      id: 'fac_' + Date.now(),
      numero: generarNumero('factura'),
      fechaHora: new Date().toISOString(),
      clienteId: albaran.clienteId,
      lineas: albaran.lineas.map(l => ({ ...l })),
      base: albaran.base,
      ivaPorTipo: albaran.ivaPorTipo,
      total: albaran.total,
      estado: 'emitida',
      albaranId: albaran.id
    };

    albaran.estado = 'facturado';
    facturas.push(factura);
    await window.mrsTpv.saveGestionSeries(series);
    await window.mrsTpv.saveGestionAlbaranes(albaranes);
    await window.mrsTpv.saveFacturas(facturas);
    renderLista();
  };

  function formatEuro(n) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
  }

  function formatFecha(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('es-ES');
  }

  function formatFechaCSV(iso) {
    if (!iso) return '';
    return new Date(iso).toISOString().split('T')[0];
  }

  function irModuloHistorial() {
    if (window.MrsTpvApp?.loadModule) {
      window.MrsTpvApp.loadModule('historial');
      return;
    }
    alert('No se pudo abrir el módulo Historial.');
  }

  function processPendingGestionAction() {
    try {
      const key = 'mrs_tpv_gestion_action';
      const action = sessionStorage.getItem(key);
      if (!action) return;
      sessionStorage.removeItem(key);
      if (action === 'nuevo_presupuesto') {
        mostrarModalPresupuesto();
      } else if (action === 'nueva_factura') {
        mostrarModalFactura();
      }
    } catch (_) {
      // Silencioso
    }
  }

  function abrirModalVistaFactura(factura) {
    const cliente = clientes.find(c => c.id === factura?.clienteId);
    const clienteNombre = cliente ? (cliente.nombre || cliente.razonSocial || cliente.email || '-') : '-';
    const estado = formatEstadoDocumento({ tipo: 'factura', estado: factura?.estado });
    const iva = Math.max(0, Number(factura?.total || 0) - Number(factura?.base || 0));

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal" style="max-width: 860px;">
        <div class="modal-header">
          <h3 class="modal-title">Factura ${escapeHtml(factura?.numero || '')}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <div class="factura-preview">
            <div class="factura-preview-head">
              <div>
                <h3>MRS_TPV</h3>
                <p>Documento comercial</p>
              </div>
              <div class="factura-preview-meta">
                <div><strong>Factura:</strong> ${escapeHtml(factura?.numero || '-')}</div>
                <div><strong>Fecha:</strong> ${formatFecha(factura?.fechaHora)}</div>
                <div><strong>Estado:</strong> ${escapeHtml(estado)}</div>
              </div>
            </div>
            <div class="factura-preview-client">
              <strong>Cliente:</strong> ${escapeHtml(clienteNombre)}
            </div>
            <div class="table-container">
              <table class="doc-view-table factura-preview-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cant.</th>
                    <th>P. Unit.</th>
                    <th>IVA</th>
                    <th>Importe</th>
                  </tr>
                </thead>
                <tbody>
                  ${(factura?.lineas || []).map((l) => {
                    const cant = Number(l?.cantidad || 1);
                    const precio = Number(l?.precio || 0);
                    const ivaLinea = Number(l?.iva || 0);
                    const sub = cant * precio;
                    return `<tr>
                      <td>${escapeHtml(l?.descripcion || l?.nombre || '-')}</td>
                      <td>${cant}</td>
                      <td>${formatEuro(precio)}</td>
                      <td>${ivaLinea}%</td>
                      <td>${formatEuro(sub)}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
            <div class="doc-view-totales">
              <div><span>Subtotal</span><strong>${formatEuro(factura?.base || 0)}</strong></div>
              <div><span>IVA</span><strong>${formatEuro(iva)}</strong></div>
              <div class="doc-view-total-final"><span>Total</span><strong>${formatEuro(factura?.total || 0)}</strong></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const close = () => {
      if (modal.parentNode) document.body.removeChild(modal);
    };
    modal.querySelector('.modal-close')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });
  }

  function abrirModalDocumentoGestion(titulo, html, actions) {
    const existing = document.querySelector('.modal-overlay.gestion-doc-view-modal');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay gestion-doc-view-modal';
    modal.innerHTML = `
      <div class="modal" style="max-width: 980px;">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(titulo)}</h3>
          <button class="modal-close" type="button">&times;</button>
        </div>
        <div class="modal-body">${html}</div>
        ${Array.isArray(actions) && actions.length ? `
          <div class="modal-footer doc-view-actions">
            ${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-ghost'}" type="button" data-gestion-doc-action="${i}">${escapeHtml(a.label || 'Acción')}</button>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
    document.body.appendChild(modal);

    const close = () => {
      if (modal.parentNode) modal.parentNode.removeChild(modal);
    };
    modal.querySelector('.modal-close')?.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    if (Array.isArray(actions) && actions.length) {
      actions.forEach((a, i) => {
        const btn = modal.querySelector(`[data-gestion-doc-action="${i}"]`);
        btn?.addEventListener('click', async () => {
          try {
            if (typeof a?.onClick === 'function') {
              await a.onClick();
            }
          } catch (err) {
            alert('No se pudo ejecutar la acción: ' + String(err?.message || err));
          }
        });
      });
    }
  }

  async function printHtmlDocumento(html) {
    const win = window.open('', '_blank', 'width=1000,height=800');
    if (!win) {
      alert('No se pudo abrir la ventana de impresión.');
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
    }, 250);
  }

  function getComercialA4Style(forPrint = false) {
    return `
      <style>
        @page { size: A4; margin: 8mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: ${forPrint ? '0' : '10px'};
          background: ${forPrint ? '#fff' : '#efefef'};
          font-family: Arial, sans-serif;
          color: #111;
        }
        .doc-a4-sheet {
          width: ${forPrint ? '194mm' : '100%'};
          max-width: ${forPrint ? '194mm' : '190mm'};
          min-height: ${forPrint ? '279mm' : '255mm'};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #d8d8d8;
          padding: 12mm 10mm;
        }
        .doc-a4-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          background: #f2f2f2;
          margin: -12mm -10mm 10mm -10mm;
          padding: 10mm 10mm 6mm 10mm;
        }
        .doc-a4-header h1 { margin: 0 0 6px 0; font-size: 46px; line-height: 1; }
        .doc-a4-numero {
          display: inline-block;
          border: 2px solid #777;
          padding: 4px 10px;
          font-size: 16px;
          font-weight: 700;
          background: #fff;
        }
        .doc-a4-logo img {
          max-width: 130px;
          max-height: 65px;
          object-fit: contain;
          filter: brightness(0) saturate(100%);
        }
        .doc-a4-logo span { font-size: 16px; font-weight: 700; }
        .doc-a4-bloques {
          display: grid;
          grid-template-columns: 1fr 1px 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }
        .doc-a4-divider { background: #c6c6c6; }
        .doc-a4-bloque h3 { margin: 0 0 8px 0; font-size: 13px; }
        .doc-a4-bloque p { margin: 3px 0; font-size: 12px; }
        .doc-a4-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
        .doc-a4-table th { background: #f2f2f2; border: 1px solid #666; padding: 6px; font-size: 12px; text-align: left; }
        .doc-a4-table th:nth-child(2), .doc-a4-table th:nth-child(3), .doc-a4-table th:nth-child(4),
        .doc-a4-table td:nth-child(2), .doc-a4-table td:nth-child(3), .doc-a4-table td:nth-child(4) {
          text-align: center; width: 16%;
        }
        .doc-a4-table td { border-bottom: 1px solid #ddd; padding: 6px; font-size: 12px; }
        .doc-a4-totales-wrap { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; margin-top: 18px; }
        .doc-a4-pago { border: 2px solid #777; padding: 8px; width: 46%; min-height: 90px; }
        .doc-a4-pago h4 { margin: 0 0 6px 0; font-size: 12px; }
        .doc-a4-pago p { margin: 3px 0; font-size: 11px; }
        .doc-a4-totales { width: 42%; }
        .doc-a4-totales .row { display: grid; grid-template-columns: 1fr 70px 100px; gap: 6px; border-bottom: 1px solid #777; padding: 6px 4px; font-size: 13px; text-align: right; }
        .doc-a4-totales .row span:first-child { text-align: left; }
        .doc-a4-totales .total { border: 2px solid #555; margin-top: 8px; font-weight: 700; }
        .doc-a4-legal {
          margin-top: 12px;
          font-size: 10px;
          color: #555;
          line-height: 1.4;
          border-top: 1px solid #e0e0e0;
          padding-top: 8px;
        }
      </style>
    `;
  }

  function buildPresupuestoA4Inner(presupuesto) {
    const numero = String(presupuesto?.numero || 'PRESUPUESTO');
    const fecha = formatFecha(presupuesto?.fechaHora || presupuesto?.createdAt);
    const cliente = clientes.find(c => c.id === presupuesto?.clienteId) || {};
    const clienteNombre = String(cliente?.nombre || cliente?.razonSocial || cliente?.email || '-');
    const clienteDireccion = String(cliente?.direccion || '-');
    const clienteTelefono = String(cliente?.telefono || cliente?.whatsapp || '-');
    const clienteEmail = String(cliente?.email || '-');
    const empresaNombre = String(config?.nombreEmpresa || 'MRS_TPV');
    const empresaDireccion = String(config?.direccion || '-');
    const empresaTelefono = String(config?.telefono || '-');
    const empresaEmail = String(config?.email || '-');
    const empresaCif = String(config?.cif || '-');
    const numeroCuenta = String(config?.numeroCuenta || '-');
    const notaLegal = String(
      config?.presupuestoNotaLegal ||
      'Validez del presupuesto: 15 dias desde su fecha de emision. Los precios incluyen impuestos salvo indicacion en contrario. Una vez aceptado, no se admiten cambios sin autorizacion expresa del cliente.'
    );
    const base = Number(presupuesto?.base || 0);
    const total = Number(presupuesto?.total || 0);
    const iva = Math.max(0, total - base);
    const ivaPct = Object.keys(presupuesto?.ivaPorTipo || {})[0] ? (Object.keys(presupuesto.ivaPorTipo)[0] + '%') : '-';
    const lineas = Array.isArray(presupuesto?.lineas) ? presupuesto.lineas : [];
    const lineasHtml = lineas.length
      ? lineas.map((l) => {
          const descripcion = String(l?.descripcion || l?.nombre || '-');
          const cantidad = Number(l?.cantidad || 1);
          const precio = Number(l?.precio || 0);
          const subtotal = Number(l?.subtotal ?? (cantidad * precio));
          return `<tr><td>${escapeHtml(descripcion)}</td><td>${cantidad}</td><td>${formatEuro(precio)}</td><td>${formatEuro(subtotal)}</td></tr>`;
        }).join('')
      : '<tr><td colspan="4" style="text-align:center;color:#666;">Sin líneas</td></tr>';

    return `
      <section class="doc-a4-sheet">
        <header class="doc-a4-header">
          <div>
            <h1>PRESUPUESTO</h1>
            <div class="doc-a4-numero">Nº ${escapeHtml(numero)}</div>
          </div>
          <div class="doc-a4-logo">
            ${config?.logoUrl ? `<img src="${escapeHtml(config.logoUrl)}" alt="Logo">` : `<span>${escapeHtml(empresaNombre)}</span>`}
          </div>
        </header>

        <section class="doc-a4-bloques">
          <div class="doc-a4-bloque">
            <h3>DATOS DEL CLIENTE</h3>
            <p>${escapeHtml(clienteNombre)}</p>
            <p>${escapeHtml(clienteTelefono)}</p>
            <p>${escapeHtml(clienteEmail)}</p>
            <p>${escapeHtml(clienteDireccion)}</p>
          </div>
          <div class="doc-a4-divider"></div>
          <div class="doc-a4-bloque">
            <h3>DATOS DE LA EMPRESA</h3>
            <p>${escapeHtml(empresaNombre)}</p>
            <p>${escapeHtml(empresaCif)}</p>
            <p>${escapeHtml(empresaTelefono)}</p>
            <p>${escapeHtml(empresaEmail)}</p>
            <p>${escapeHtml(empresaDireccion)}</p>
          </div>
        </section>

        <div style="margin: 6px 0 10px 0; font-size:12px; color:#333;">Fecha: ${escapeHtml(fecha)}</div>

        <table class="doc-a4-table">
          <thead>
            <tr>
              <th>Detalle</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${lineasHtml}</tbody>
        </table>

        <section class="doc-a4-totales-wrap">
          <div class="doc-a4-pago">
            <h4>INFORMACIÓN DE PAGO</h4>
            <p>Transferencia bancaria</p>
            <p>Beneficiario: ${escapeHtml(empresaNombre)}</p>
            <p>Número de cuenta: ${escapeHtml(numeroCuenta)}</p>
          </div>
          <div class="doc-a4-totales">
            <div class="row"><span>IVA</span><span>${escapeHtml(ivaPct)}</span><span>${formatEuro(iva)}</span></div>
            <div class="row total"><span>TOTAL</span><span></span><span>${formatEuro(total)}</span></div>
          </div>
        </section>

        <div class="doc-a4-legal">${escapeHtml(notaLegal)}</div>
      </section>
    `;
  }

  function buildPresupuestoA4PreviewHtml(presupuesto) {
    return `${getComercialA4Style(false)}${buildPresupuestoA4Inner(presupuesto)}`;
  }

  function buildPresupuestoA4DocumentHtml(presupuesto) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(String(presupuesto?.numero || 'presupuesto'))}</title>${getComercialA4Style(true)}</head><body>${buildPresupuestoA4Inner(presupuesto)}</body></html>`;
  }

  function buildAlbaranA4Inner(albaran) {
    const numero = String(albaran?.numero || 'ALBARAN');
    const fecha = formatFecha(albaran?.fechaHora || albaran?.createdAt);
    const cliente = clientes.find(c => c.id === albaran?.clienteId) || {};
    const clienteNombre = String(cliente?.nombre || cliente?.razonSocial || cliente?.email || '-');
    const clienteDireccion = String(cliente?.direccion || '-');
    const clienteTelefono = String(cliente?.telefono || cliente?.whatsapp || '-');
    const clienteEmail = String(cliente?.email || '-');
    const empresaNombre = String(config?.nombreEmpresa || 'MRS_TPV');
    const empresaDireccion = String(config?.direccion || '-');
    const empresaTelefono = String(config?.telefono || '-');
    const empresaEmail = String(config?.email || '-');
    const empresaCif = String(config?.cif || '-');
    const notaLegal = String(
      config?.albaranNotaLegal ||
      'Condiciones del albaran: La firma del cliente acredita la entrega/recepcion del material o servicio descrito. Cualquier incidencia debe comunicarse en un plazo maximo de 24 horas.'
    );
    const base = Number(albaran?.base || 0);
    const total = Number(albaran?.total || 0);
    const iva = Math.max(0, total - base);
    const ivaPct = Object.keys(albaran?.ivaPorTipo || {})[0] ? (Object.keys(albaran.ivaPorTipo)[0] + '%') : '-';
    const lineas = Array.isArray(albaran?.lineas) ? albaran.lineas : [];
    const lineasHtml = lineas.length
      ? lineas.map((l) => {
          const descripcion = String(l?.descripcion || l?.nombre || '-');
          const cantidad = Number(l?.cantidad || 1);
          const precio = Number(l?.precio || 0);
          const subtotal = Number(l?.subtotal ?? (cantidad * precio));
          return `<tr><td>${escapeHtml(descripcion)}</td><td>${cantidad}</td><td>${formatEuro(precio)}</td><td>${formatEuro(subtotal)}</td></tr>`;
        }).join('')
      : '<tr><td colspan="4" style="text-align:center;color:#666;">Sin líneas</td></tr>';

    return `
      <section class="doc-a4-sheet">
        <header class="doc-a4-header">
          <div>
            <h1>ALBARÁN</h1>
            <div class="doc-a4-numero">Nº ${escapeHtml(numero)}</div>
          </div>
          <div class="doc-a4-logo">
            ${config?.logoUrl ? `<img src="${escapeHtml(config.logoUrl)}" alt="Logo">` : `<span>${escapeHtml(empresaNombre)}</span>`}
          </div>
        </header>

        <section class="doc-a4-bloques">
          <div class="doc-a4-bloque">
            <h3>DATOS DEL CLIENTE</h3>
            <p>${escapeHtml(clienteNombre)}</p>
            <p>${escapeHtml(clienteTelefono)}</p>
            <p>${escapeHtml(clienteEmail)}</p>
            <p>${escapeHtml(clienteDireccion)}</p>
          </div>
          <div class="doc-a4-divider"></div>
          <div class="doc-a4-bloque">
            <h3>DATOS DE LA EMPRESA</h3>
            <p>${escapeHtml(empresaNombre)}</p>
            <p>${escapeHtml(empresaCif)}</p>
            <p>${escapeHtml(empresaTelefono)}</p>
            <p>${escapeHtml(empresaEmail)}</p>
            <p>${escapeHtml(empresaDireccion)}</p>
          </div>
        </section>

        <div style="margin: 6px 0 10px 0; font-size:12px; color:#333;">Fecha: ${escapeHtml(fecha)}</div>

        <table class="doc-a4-table">
          <thead>
            <tr>
              <th>Detalle</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${lineasHtml}</tbody>
        </table>

        <section class="doc-a4-totales-wrap">
          <div class="doc-a4-pago">
            <h4>RECEPCIÓN</h4>
            <p>Documento de entrega/recepcion</p>
            <p>Empresa: ${escapeHtml(empresaNombre)}</p>
            <p>Cliente: ${escapeHtml(clienteNombre)}</p>
          </div>
          <div class="doc-a4-totales">
            <div class="row"><span>IVA</span><span>${escapeHtml(ivaPct)}</span><span>${formatEuro(iva)}</span></div>
            <div class="row total"><span>TOTAL</span><span></span><span>${formatEuro(total)}</span></div>
          </div>
        </section>

        <div class="doc-a4-legal">${escapeHtml(notaLegal)}</div>
      </section>
    `;
  }

  function buildAlbaranA4PreviewHtml(albaran) {
    return `${getComercialA4Style(false)}${buildAlbaranA4Inner(albaran)}`;
  }

  function buildAlbaranA4DocumentHtml(albaran) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(String(albaran?.numero || 'albaran'))}</title>${getComercialA4Style(true)}</head><body>${buildAlbaranA4Inner(albaran)}</body></html>`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  window.GestionModule.init = init;
})();
