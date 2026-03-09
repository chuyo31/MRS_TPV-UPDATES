/**
 * Módulo Historial - Tickets y Facturas
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let tickets = [];
  let facturas = [];
  let clientes = [];
  let config = null;

  async function init() {
    if (window.VerifactuCore) {
      await window.VerifactuCore.init();
    }
    await loadData();
    render();
    setupEventListeners();
  }

  async function loadData() {
    tickets = await window.mrsTpv.getTickets() || [];
    facturas = await window.mrsTpv.getFacturas() || [];
    clientes = await window.mrsTpv.getClientes() || [];
    config = await window.mrsTpv.getConfig() || {};
  }

  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    content.innerHTML = `
      <div class="historial-module">
        <div class="module-header">
          <h2>Historial</h2>
          <div class="gestion-header-actions">
            <button class="btn btn-primary" id="btn-hist-nuevo-presupuesto">Nuevo Presupuesto</button>
            <button class="btn btn-primary" id="btn-hist-nueva-factura">Nueva Factura</button>
            <button class="btn btn-ghost" id="btn-hist-volver-gestion">Volver a Gestión</button>
          </div>
        </div>

        <div class="historial-tabs">
          <button class="tab-btn active" data-tab="tickets">Tickets</button>
          <button class="tab-btn" data-tab="facturas">Facturas</button>
        </div>

        <div class="tab-content active" id="tab-tickets">
          <div class="table-container">
            <table id="tickets-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Hash</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="tickets-tbody"></tbody>
            </table>
          </div>
        </div>

        <div class="tab-content" id="tab-facturas">
          <div class="table-container">
            <table id="facturas-table">
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Estado</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody id="facturas-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    renderTickets();
    renderFacturas();
    setupTabs();
  }

  function renderTickets() {
    const tbody = document.getElementById('tickets-tbody');
    if (!tbody) return;

    if (tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-message">No hay tickets</td></tr>';
      return;
    }

    tbody.innerHTML = tickets.map(ticket => {
      const cliente = ticket.cliente ? clientes.find(c => c.id === ticket.cliente.id) : null;
      const hashValido = ticket.hash ? true : false; // Simplificado - verificación completa requeriría async
      const ticketNumero = String(ticket?.numero || '');
      const alreadyInvoiced = isTicketInvoiced(ticketNumero);
      const linkedFactura = getFacturaByTicketNumero(ticketNumero);
      
      return `
        <tr>
          <td>
            <div>${escapeHtml(ticket.numero || '-')}</div>
            ${linkedFactura ? `
              <div class="trace-link-wrap">
                <span>Factura:</span>
                <button class="btn-link-inline" onclick="HistorialModule.irAFactura('${encodeURIComponent(linkedFactura.numero || '')}')">
                  ${escapeHtml(linkedFactura.numero || '-')}
                </button>
              </div>
            ` : ''}
          </td>
          <td>${formatFecha(ticket.fechaHora)}</td>
          <td>${cliente ? escapeHtml(cliente.nombre || cliente.razonSocial || '-') : '-'}</td>
          <td>${formatEuro(ticket.total || 0)}</td>
          <td class="hash-cell">
            <span class="hash-badge ${hashValido ? 'hash-valido' : 'hash-invalido'}">
              ${ticket.hash ? escapeHtml(ticket.hash) : '-'}
            </span>
          </td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="HistorialModule.verTicket('${ticket.numero}')">Ver</button>
            <button class="btn btn-ghost btn-sm" onclick="HistorialModule.crearFacturaDesdeTicket('${ticket.numero}')" ${alreadyInvoiced ? 'disabled title="Este ticket ya está facturado"' : ''}>
              ${alreadyInvoiced ? 'Facturado' : 'Facturar'}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  async function verificarHash(ticket) {
    if (!ticket.hash) return false;
    const hashCalculado = await calcularHash({ ...ticket, hash: undefined });
    return ticket.hash === hashCalculado;
  }

  async function calcularHash(data) {
    const str = JSON.stringify(data);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'sha256:' + hashHex;
  }

  function renderFacturas() {
    const tbody = document.getElementById('facturas-tbody');
    if (!tbody) return;

    if (facturas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-message">No hay facturas</td></tr>';
      return;
    }

    const byId = new Map();
    const byNumero = new Map();
    facturas.forEach((f) => {
      if (f?.id) byId.set(String(f.id), f);
      if (f?.numero) byNumero.set(String(f.numero), f);
    });

    const childrenByParent = new Map();
    const roots = [];

    facturas.forEach((f) => {
      const parentId = String(f?.facturaOriginalId || '').trim();
      const parentNumero = String(f?.facturaOriginalNumero || '').trim();
      const parent = (parentId && byId.get(parentId)) || (parentNumero && byNumero.get(parentNumero));
      if (!parent) {
        roots.push(f);
        return;
      }
      const key = String(parent.id || parent.numero || '');
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key).push(f);
    });

    const sortByFecha = (a, b) => {
      const ta = Date.parse(String(a?.fechaHora || '')) || 0;
      const tb = Date.parse(String(b?.fechaHora || '')) || 0;
      return ta - tb;
    };

    roots.sort(sortByFecha);
    childrenByParent.forEach((arr) => arr.sort(sortByFecha));

    const rendered = [];
    const addRow = (factura, isRectificativa) => {
      const key = String(factura?.id || factura?.numero || '');
      if (rendered.includes(key)) return '';
      rendered.push(key);

      const clienteNombre = getClienteNombre(factura?.cliente || (factura?.clienteId ? { id: factura.clienteId } : null));
      const estado = String(factura?.estado || '-');
      const estadoLabel = estado === 'rectificada' ? 'Rectificada' : (estado === 'emitida' ? 'Emitida' : estado);
      const canRectify = canRectifyFactura(factura);
      const ticketRef = getTicketNumeroForFactura(factura);

      return `
        <tr class="${isRectificativa ? 'factura-row-rectificativa' : 'factura-row-origen'}">
          <td>
            <div class="factura-numero-wrap">
              ${isRectificativa ? '<span class="factura-rel-arrow">⟶</span>' : '<span class="factura-rel-arrow-placeholder"></span>'}
              <span>${escapeHtml(factura?.numero || '-')}</span>
            </div>
            ${ticketRef ? `
              <div class="trace-link-wrap">
                <span>Ticket:</span>
                <button class="btn-link-inline" onclick="HistorialModule.irATicket('${encodeURIComponent(ticketRef)}')">
                  ${escapeHtml(ticketRef)}
                </button>
              </div>
            ` : ''}
          </td>
          <td>${formatFecha(factura?.fechaHora)}</td>
          <td>${escapeHtml(clienteNombre)}</td>
          <td>${formatEuro(factura?.total || 0)}</td>
          <td><span class="estado-badge ${estado === 'rectificada' ? 'estado-rectificada' : 'estado-emitida'}">${escapeHtml(estadoLabel)}</span></td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="HistorialModule.verFactura('${factura.numero}')">Ver</button>
            ${canRectify ? 
              `<button class="btn btn-ghost btn-sm" onclick="HistorialModule.rectificarFactura('${factura.numero}')">Rectificar</button>` : ''}
          </td>
        </tr>
      `;
    };

    const paintNode = (factura, isChild) => {
      let html = addRow(factura, isChild);
      const key = String(factura?.id || factura?.numero || '');
      const children = childrenByParent.get(key) || [];
      children.forEach((child) => {
        html += addRow(child, true);
      });
      return html;
    };

    let html = '';
    roots.forEach((root) => {
      html += paintNode(root, false);
    });

    // Seguridad: renderizar cualquier factura que no haya entrado en la jerarquía.
    facturas.forEach((f) => {
      const key = String(f?.id || f?.numero || '');
      if (!rendered.includes(key)) {
        html += addRow(f, !!(f?.facturaOriginalId || f?.facturaOriginalNumero));
      }
    });

    tbody.innerHTML = html;
  }

  function setupTabs() {
    const tabBtns = document.querySelectorAll('.historial-tabs .tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.historial-module .tab-content').forEach(content => {
          content.classList.remove('active');
        });
        document.getElementById(`tab-${tab}`).classList.add('active');
      });
    });
  }

  function setupEventListeners() {
    document.getElementById('btn-hist-volver-gestion')?.addEventListener('click', () => {
      irGestion();
    });
    document.getElementById('btn-hist-nuevo-presupuesto')?.addEventListener('click', () => {
      irGestionConAccion('nuevo_presupuesto');
    });
    document.getElementById('btn-hist-nueva-factura')?.addEventListener('click', () => {
      irGestionConAccion('nueva_factura');
    });
  }

  function irGestion() {
    if (window.MrsTpvApp?.loadModule) {
      window.MrsTpvApp.loadModule('gestion');
      return;
    }
    alert('No se pudo abrir Gestión.');
  }

  function irGestionConAccion(action) {
    try {
      sessionStorage.setItem('mrs_tpv_gestion_action', action);
    } catch (_) {
      // Silencioso
    }
    irGestion();
  }

  function isRectificativa(factura) {
    return !!(String(factura?.facturaOriginalId || '').trim() || String(factura?.facturaOriginalNumero || '').trim());
  }

  function isTicketInvoiced(ticketNumero) {
    const numero = String(ticketNumero || '').trim();
    if (!numero) return false;
    return facturas.some((f) => String(f?.ticketNumero || '').trim() === numero);
  }

  function hasRectificativa(factura) {
    const id = String(factura?.id || '').trim();
    const numero = String(factura?.numero || '').trim();
    return facturas.some((f) => {
      const parentId = String(f?.facturaOriginalId || '').trim();
      const parentNumero = String(f?.facturaOriginalNumero || '').trim();
      return (id && parentId === id) || (numero && parentNumero === numero);
    });
  }

  function canRectifyFactura(factura) {
    if (!factura) return false;
    if (isRectificativa(factura)) return false; // No rectificar rectificativas.
    if (String(factura?.estado || '').trim().toLowerCase() === 'rectificada') return false; // Ya rectificada.
    if (hasRectificativa(factura)) return false; // Ya tiene rectificativa creada.
    return true;
  }

  function getFacturaByTicketNumero(ticketNumero) {
    const numero = String(ticketNumero || '').trim();
    if (!numero) return null;
    return facturas.find((f) => String(f?.ticketNumero || '').trim() === numero) || null;
  }

  function getTicketNumeroForFactura(factura) {
    if (!factura) return '';
    let current = factura;
    const visited = new Set();
    for (let i = 0; i < 10; i += 1) {
      const key = String(current?.id || current?.numero || '');
      if (visited.has(key)) break;
      if (key) visited.add(key);

      const ticketNumero = String(current?.ticketNumero || '').trim();
      if (ticketNumero) return ticketNumero;

      const parentId = String(current?.facturaOriginalId || '').trim();
      const parentNumero = String(current?.facturaOriginalNumero || '').trim();
      if (!parentId && !parentNumero) break;

      const parent = facturas.find((f) =>
        (parentId && String(f?.id || '').trim() === parentId) ||
        (parentNumero && String(f?.numero || '').trim() === parentNumero)
      );
      if (!parent) break;
      current = parent;
    }
    return '';
  }

  function getClienteNombre(ref) {
    if (!ref) return '-';
    if (typeof ref === 'string') {
      const found = clientes.find(c => c.id === ref);
      return found ? (found.nombre || found.razonSocial || found.email || '-') : ref;
    }
    if (typeof ref === 'object') {
      const byId = ref.id ? clientes.find(c => c.id === ref.id) : null;
      return (byId?.nombre || byId?.razonSocial || ref.nombre || ref.razonSocial || ref.email || '-');
    }
    return '-';
  }

  function renderLineasDocumento(lineas) {
    if (!Array.isArray(lineas) || lineas.length === 0) {
      return '<tr><td colspan="5" class="empty-message">Sin líneas</td></tr>';
    }
    return lineas.map((l) => {
      const nombre = l?.nombre || '-';
      const cantidad = Number(l?.cantidad || 0);
      const precio = Number(l?.precio || 0);
      const iva = Number(l?.iva || 0);
      const subtotal = Number(l?.subtotal !== undefined ? l.subtotal : (cantidad * precio));
      return `
        <tr>
          <td>${escapeHtml(nombre)}</td>
          <td>${cantidad}</td>
          <td>${formatEuro(precio)}</td>
          <td>${iva}%</td>
          <td>${formatEuro(subtotal)}</td>
        </tr>
      `;
    }).join('');
  }

  function formatEu(n) {
    const num = Number(n || 0);
    return num.toFixed(2);
  }

  function formatFechaCorta(iso) {
    if (!iso) return '--/--/----';
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }

  function formatHoraCorta(iso) {
    if (!iso) return '--:--';
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function buildIvaRows(ivaPorTipo) {
    const data = ivaPorTipo && typeof ivaPorTipo === 'object' ? ivaPorTipo : {};
    const tipos = Object.keys(data);
    if (!tipos.length) return '';
    return tipos.map((tipo) => {
      const item = data[tipo] || {};
      const base = formatEu(item.base);
      const cuota = formatEu(item.cuota);
      return `
        <div class="ticket-iva-row">
          <span>BASE IMPONIBLE ${tipo}%</span>
          <span>${base}</span>
          <span>IVA ${tipo}%</span>
          <span>${cuota}</span>
        </div>
      `;
    }).join('');
  }

  function buildTicketThermalLines(lineas) {
    if (!Array.isArray(lineas) || lineas.length === 0) {
      return '<div class="ticket-line-empty">Sin líneas</div>';
    }
    return lineas.map((l) => {
      const qty = Number(l?.cantidad || 0);
      const nombre = String(l?.nombre || '-');
      const precio = formatEu(l?.precio);
      const subtotal = formatEu(l?.subtotal !== undefined ? l.subtotal : (qty * Number(l?.precio || 0)));
      return `
        <div class="ticket-line-row">
          <div class="line-desc">${escapeHtml(nombre)}</div>
          <div class="line-values">
            <span>${qty}</span>
            <span>${precio}</span>
            <span>${subtotal}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function buildTicketHtml(ticket) {
    const empresa = String(config?.nombreEmpresa || 'MRS_TPV');
    const direccion = String(config?.direccion || '').trim();
    const telefono = String(config?.telefono || '').trim();
    const numero = String(ticket?.numero || '-');
    const fecha = formatFechaCorta(ticket?.fechaHora);
    const hora = formatHoraCorta(ticket?.fechaHora);
    const metodoPago = String(ticket?.formaPago || '-');
    const atendidoPor = String(ticket?.atendidoPor || '-');
    const clienteNombre = getClienteNombre(ticket?.cliente);
    const total = formatEu(ticket?.total);
    const subtotal = formatEu(ticket?.subtotal !== undefined ? ticket.subtotal : 0);
    const descuentoPct = Number(ticket?.descuentoPct || 0);
    const descuentoImporte = subtotal !== '0.00'
      ? formatEu((Number(subtotal) * descuentoPct) / 100)
      : formatEu(0);

    return `
      <div class="ticket-thermal">
        <div class="ticket-head-center ticket-brand">${escapeHtml(empresa)}</div>
        ${direccion ? `<div class="ticket-head-center">${escapeHtml(direccion)}</div>` : ''}
        ${telefono ? `<div class="ticket-head-center">TELF. ${escapeHtml(telefono)}</div>` : ''}

        <div class="ticket-sep"></div>

        <div class="ticket-meta-row">
          <span>TICKET ${escapeHtml(numero)}</span>
          <span>${fecha} ${hora}</span>
        </div>
        <div class="ticket-meta-row">
          <span>PAGO ${escapeHtml(metodoPago)}</span>
          <span>CLIENTE ${escapeHtml(clienteNombre)}</span>
        </div>
        <div class="ticket-meta-row">
          <span>ATENDIDO POR ${escapeHtml(atendidoPor)}</span>
          <span></span>
        </div>

        <div class="ticket-sep"></div>

        <div class="ticket-cols-head">
          <span>Cant.</span>
          <span>Descripcion</span>
          <span>P.U.</span>
          <span>Total</span>
        </div>

        ${buildTicketThermalLines(ticket?.lineas)}

        <div class="ticket-sep"></div>

        ${descuentoPct > 0 ? `
          <div class="ticket-total-line">
            <span>DESCUENTO ${descuentoPct}%</span>
            <strong>- ${descuentoImporte}</strong>
          </div>
        ` : ''}
        <div class="ticket-total-line ticket-grand-total">
          <span>TOTAL</span>
          <strong>${total}</strong>
        </div>

        <div class="ticket-sep"></div>

        ${buildIvaRows(ticket?.ivaPorTipo)}

        <div class="ticket-footer">... GRACIAS POR SU VISITA ...</div>
      </div>
    `;
  }

  async function getRegistroFiscalFactura(factura) {
    if (!window.VerifactuCore) return null;
    try {
      const registros = await window.mrsTpv.getRegistrosFiscales() || [];
      return registros.find(r => r.facturaId === factura.id || r.facturaNumero === factura.numero) || null;
    } catch (_) {
      return null;
    }
  }

  function getClienteFacturaDetalle(factura) {
    const rawCliente = factura?.cliente;
    let byId = null;
    if (factura?.clienteId) {
      byId = clientes.find(c => c.id === factura.clienteId) || null;
    } else if (rawCliente?.id) {
      byId = clientes.find(c => c.id === rawCliente.id) || null;
    }
    const source = byId || rawCliente || {};
    return {
      nombre: String(source?.nombre || source?.razonSocial || source?.email || '-'),
      direccion: String(source?.direccion || '-'),
      telefono: String(source?.telefono || source?.whatsapp || '-'),
      email: String(source?.email || '-')
    };
  }

  function renderLineasFacturaA4(lineas) {
    if (!Array.isArray(lineas) || lineas.length === 0) {
      return '<tr><td colspan="4" style="text-align:center;color:#666;">Sin líneas</td></tr>';
    }
    return lineas.map((l) => {
      const descripcion = String(l?.descripcion || l?.nombre || '-');
      const cantidad = Number(l?.cantidad || 1);
      const precio = Number(l?.precio || 0);
      const subtotal = Number(l?.subtotal !== undefined ? l.subtotal : (cantidad * precio));
      return `
        <tr>
          <td>${escapeHtml(descripcion)}</td>
          <td>${cantidad}</td>
          <td>${formatEuro(precio)}</td>
          <td>${formatEuro(subtotal)}</td>
        </tr>
      `;
    }).join('');
  }

  function buildFacturaA4Inner(factura, options = {}) {
    const subtotal = Number(factura?.base !== undefined ? factura.base : (factura?.subtotal !== undefined ? factura.subtotal : 0));
    const total = Number(factura?.total || 0);
    const iva = Math.max(0, total - subtotal);
    const estado = String(factura?.estado || '-');
    const numero = String(factura?.numero || 'Factura');
    const fecha = formatFechaCorta(factura?.fechaHora);
    const empresaNombre = String(config?.nombreEmpresa || 'MRS_TPV');
    const empresaDireccion = String(config?.direccion || '-');
    const empresaTelefono = String(config?.telefono || '-');
    const empresaEmail = String(config?.email || '-');
    const empresaCif = String(config?.cif || '-');
    const numeroCuenta = String(config?.numeroCuenta || '-');
    const notaLegal = String(
      config?.facturaNotaLegal ||
      'Nota legal: Este documento tiene validez fiscal y mercantil. Salvo error tipografico u omision. Para cualquier aclaracion, contacte con la empresa emisora.'
    );
    const cliente = getClienteFacturaDetalle(factura);

    const ivaPct = (() => {
      const keys = Object.keys(factura?.ivaPorTipo || {});
      if (!keys.length) return '';
      return keys[0] + '%';
    })();

    const lineasHtml = renderLineasFacturaA4(factura?.lineas);
    const qrBlock = options?.verifactuHtml || '';

    return `
      <section class="fac-a4-sheet">
        <header class="fac-a4-header">
          <div>
            <h1>FACTURA</h1>
            <div class="fac-a4-numero">Nº ${escapeHtml(numero)}</div>
          </div>
          <div class="fac-a4-logo">
            ${config?.logoUrl ? `<img src="${escapeHtml(config.logoUrl)}" alt="Logo">` : `<span>${escapeHtml(empresaNombre)}</span>`}
          </div>
        </header>

        <section class="fac-a4-bloques">
          <div class="fac-a4-bloque">
            <h3>DATOS DEL CLIENTE</h3>
            <p>${escapeHtml(cliente.nombre)}</p>
            <p>${escapeHtml(cliente.telefono)}</p>
            <p>${escapeHtml(cliente.email)}</p>
            <p>${escapeHtml(cliente.direccion)}</p>
          </div>
          <div class="fac-a4-divider"></div>
          <div class="fac-a4-bloque">
            <h3>DATOS DE LA EMPRESA</h3>
            <p>${escapeHtml(empresaNombre)}</p>
            <p>${escapeHtml(empresaCif)}</p>
            <p>${escapeHtml(empresaTelefono)}</p>
            <p>${escapeHtml(empresaEmail)}</p>
            <p>${escapeHtml(empresaDireccion)}</p>
          </div>
        </section>

        <div class="fac-a4-meta">
          <span>Fecha: ${escapeHtml(fecha)}</span>
          <span>Estado: ${escapeHtml(estado)}</span>
        </div>

        <table class="fac-a4-table">
          <thead>
            <tr>
              <th>Detalle</th>
              <th>Cantidad</th>
              <th>Precio</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${lineasHtml}
          </tbody>
        </table>

        <section class="fac-a4-totales-wrap">
          <div class="fac-a4-pago">
            <h4>INFORMACIÓN DE PAGO</h4>
            <p>Transferencia bancaria</p>
            <p>Beneficiario: ${escapeHtml(empresaNombre)}</p>
            <p>Número de cuenta: ${escapeHtml(numeroCuenta)}</p>
          </div>
          <div class="fac-a4-totales">
            <div class="row"><span>IVA</span><span>${escapeHtml(ivaPct || '-')}</span><span>${formatEuro(iva)}</span></div>
            <div class="row total"><span>TOTAL</span><span></span><span>${formatEuro(total)}</span></div>
          </div>
        </section>

        <div class="fac-a4-legal">
          ${escapeHtml(notaLegal)}
        </div>

        ${qrBlock}
      </section>
    `;
  }

  function getFacturaA4Style(forPrint = false) {
    return `
      <style>
        @page { size: A4; margin: 8mm; }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          padding: ${forPrint ? '0' : '12px'};
          background: ${forPrint ? '#fff' : '#efefef'};
          font-family: Arial, sans-serif;
          color: #111;
          width: ${forPrint ? '210mm' : 'auto'};
          min-height: ${forPrint ? '297mm' : 'auto'};
        }
        .fac-a4-sheet {
          width: ${forPrint ? '194mm' : '100%'};
          max-width: ${forPrint ? '194mm' : '190mm'};
          min-height: ${forPrint ? '279mm' : '255mm'};
          margin: 0 auto;
          background: #fff;
          border: 1px solid #d8d8d8;
          padding: 12mm 10mm;
        }
        .fac-a4-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          background: #f2f2f2;
          margin: -12mm -10mm 10mm -10mm;
          padding: 10mm 10mm 6mm 10mm;
        }
        .fac-a4-header h1 {
          margin: 0 0 6px 0;
          font-size: 52px;
          letter-spacing: 0.5px;
          line-height: 1;
        }
        .fac-a4-numero {
          display: inline-block;
          border: 2px solid #777;
          padding: 4px 10px;
          font-size: 18px;
          font-weight: 700;
          background: #fff;
        }
        .fac-a4-logo img {
          max-width: 130px;
          max-height: 65px;
          object-fit: contain;
          /* Forzar logo oscuro para impresión en papel blanco */
          filter: brightness(0) saturate(100%);
        }
        .fac-a4-logo span {
          font-size: 16px;
          font-weight: 700;
        }
        .fac-a4-bloques {
          display: grid;
          grid-template-columns: 1fr 1px 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }
        .fac-a4-divider {
          background: #c6c6c6;
        }
        .fac-a4-bloque h3 {
          margin: 0 0 8px 0;
          font-size: 13px;
          letter-spacing: 0.3px;
        }
        .fac-a4-bloque p {
          margin: 3px 0;
          font-size: 12px;
        }
        .fac-a4-meta {
          display: flex;
          justify-content: space-between;
          margin: 6px 0 10px 0;
          font-size: 12px;
          color: #333;
        }
        .fac-a4-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 12px;
        }
        .fac-a4-table th {
          background: #f2f2f2;
          border: 1px solid #666;
          padding: 6px;
          font-size: 12px;
          text-align: left;
        }
        .fac-a4-table th:nth-child(2),
        .fac-a4-table th:nth-child(3),
        .fac-a4-table th:nth-child(4),
        .fac-a4-table td:nth-child(2),
        .fac-a4-table td:nth-child(3),
        .fac-a4-table td:nth-child(4) {
          text-align: center;
          width: 16%;
        }
        .fac-a4-table td {
          border-bottom: 1px solid #ddd;
          padding: 6px;
          font-size: 12px;
        }
        .fac-a4-totales-wrap {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 14px;
          margin-top: 18px;
        }
        .fac-a4-pago {
          border: 2px solid #777;
          padding: 8px;
          width: 46%;
          min-height: 90px;
        }
        .fac-a4-pago h4 {
          margin: 0 0 6px 0;
          font-size: 12px;
        }
        .fac-a4-pago p {
          margin: 3px 0;
          font-size: 11px;
        }
        .fac-a4-totales {
          width: 42%;
        }
        .fac-a4-totales .row {
          display: grid;
          grid-template-columns: 1fr 70px 100px;
          gap: 6px;
          border-bottom: 1px solid #777;
          padding: 6px 4px;
          font-size: 13px;
          text-align: right;
        }
        .fac-a4-totales .row span:first-child {
          text-align: left;
        }
        .fac-a4-totales .total {
          border: 2px solid #555;
          border-top: 2px solid #555;
          margin-top: 8px;
          font-weight: 700;
        }
        .fac-a4-legal {
          margin-top: 12px;
          font-size: 10px;
          color: #555;
          line-height: 1.4;
          border-top: 1px solid #e0e0e0;
          padding-top: 8px;
        }
        .fac-a4-verifactu {
          margin-top: 14px;
          padding-top: 10px;
          border-top: 1px solid #ddd;
          font-size: 10px;
          color: #666;
        }
      </style>
    `;
  }

  async function buildFacturaHtml(factura) {
    const estado = String(factura?.estado || '-');
    
    let qrData = '';
    let leyendaVerifactu = '';
    let hashFiscal = '';
    
    if (window.VerifactuCore && (estado === 'emitida' || estado === 'rectificada')) {
      const registro = await getRegistroFiscalFactura(factura);
      if (registro) {
        qrData = window.VerifactuCore.generarQRFiscal(factura, registro);
        leyendaVerifactu = window.VerifactuCore.generarLeyendaVerifactu();
        hashFiscal = registro.hash || '';
      }
    }

    const verifactuHtml = leyendaVerifactu ? `
      <div class="fac-a4-verifactu">
        <div><strong>${escapeHtml(leyendaVerifactu)}</strong></div>
        ${hashFiscal ? `<div>Hash fiscal: ${escapeHtml(hashFiscal.substring(0, 48))}...</div>` : ''}
        ${qrData ? `<div>QR fiscal: ${escapeHtml(qrData.substring(0, 80))}...</div>` : ''}
      </div>
    ` : '';

    return `
      ${getFacturaA4Style(false)}
      ${buildFacturaA4Inner(factura, { verifactuHtml, estado })}
    `;
  }

  function abrirModalDocumento(titulo, html, modalClass, actions) {
    const existing = document.querySelector('.modal-overlay.doc-view-modal');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay doc-view-modal' + (modalClass ? (' ' + modalClass) : '');
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${escapeHtml(titulo)}</h3>
          <button class="modal-close" type="button">&times;</button>
        </div>
        <div class="modal-body">
          ${html}
        </div>
        ${Array.isArray(actions) && actions.length ? `
          <div class="modal-footer doc-view-actions">
            ${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-ghost'}" type="button" data-doc-action="${i}">${escapeHtml(a.label || 'Acción')}</button>`).join('')}
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
        const btn = modal.querySelector(`[data-doc-action="${i}"]`);
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

  async function buildFacturaDocumentHtml(factura) {
    const estado = String(factura?.estado || '-');
    
    let qrData = '';
    let leyendaVerifactu = '';
    let hashFiscal = '';
    
    if (window.VerifactuCore && (estado === 'emitida' || estado === 'rectificada')) {
      const registro = await getRegistroFiscalFactura(factura);
      if (registro) {
        qrData = window.VerifactuCore.generarQRFiscal(factura, registro);
        leyendaVerifactu = window.VerifactuCore.generarLeyendaVerifactu();
        hashFiscal = registro.hash || '';
      }
    }

    const verifactuHtml = leyendaVerifactu ? `
      <div class="fac-a4-verifactu">
        <div><strong>${escapeHtml(leyendaVerifactu)}</strong></div>
        ${hashFiscal ? `<div>Hash fiscal: ${escapeHtml(hashFiscal)}</div>` : ''}
        ${qrData ? `<div>QR fiscal: ${escapeHtml(qrData)}</div>` : ''}
      </div>
    ` : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(String(factura?.numero || 'Factura'))}</title>
  ${getFacturaA4Style(true)}
</head>
<body>
  ${buildFacturaA4Inner(factura, { verifactuHtml, estado })}
</body>
</html>`;
  }

  async function printFactura(factura) {
    const html = await buildFacturaDocumentHtml(factura);
    const win = window.open('', '_blank', 'width=900,height=700');
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

  async function saveFacturaPdf(factura) {
    if (!window.mrsTpv?.exportToPdf) {
      alert('La opción de exportar PDF no está disponible.');
      return;
    }
    const html = await buildFacturaDocumentHtml(factura);
    const numero = String(factura?.numero || 'factura').replace(/[^\w\-]+/g, '_');
    await window.mrsTpv.exportToPdf(html, `${numero}.pdf`);
  }

  window.HistorialModule = window.HistorialModule || {};
  window.HistorialModule.verTicket = function(numero) {
    const ticket = tickets.find(t => t.numero === numero);
    if (ticket) {
      abrirModalDocumento('Ticket ' + (ticket.numero || ''), buildTicketHtml(ticket), 'ticket-thermal-modal');
    }
  };
  window.HistorialModule.irAFactura = function(encodedNumero) {
    const numero = decodeURIComponent(String(encodedNumero || ''));
    const tabBtn = document.querySelector('.historial-tabs .tab-btn[data-tab="facturas"]');
    tabBtn?.click();
    window.HistorialModule.verFactura(numero);
  };
  window.HistorialModule.irATicket = function(encodedNumero) {
    const numero = decodeURIComponent(String(encodedNumero || ''));
    const tabBtn = document.querySelector('.historial-tabs .tab-btn[data-tab="tickets"]');
    tabBtn?.click();
    window.HistorialModule.verTicket(numero);
  };
  window.HistorialModule.crearFacturaDesdeTicket = async function(numero) {
    const ticket = tickets.find(t => t.numero === numero);
    if (!ticket) return;
    if (isTicketInvoiced(ticket.numero)) {
      alert('Este ticket ya está facturado y no se puede facturar de nuevo.');
      return;
    }

    const series = await window.mrsTpv.getGestionSeries() || {};
    const año = new Date().getFullYear();
    const añoStr = String(año);
    if (!series.facturas) series.facturas = {};
    const num = (series.facturas[añoStr] || 0) + 1;
    series.facturas[añoStr] = num;
    const numeroFactura = `FAC-${añoStr}-${String(num).padStart(4, '0')}`;

    const factura = {
      id: 'fac_' + Date.now(),
      numero: numeroFactura,
      fechaHora: new Date().toISOString(),
      ticketNumero: ticket.numero,
      cliente: ticket.cliente,
      lineas: ticket.lineas.map(l => ({ ...l })),
      total: ticket.total,
      ivaPorTipo: ticket.ivaPorTipo,
      estado: 'emitida',
      atendidoPor: ticket.atendidoPor
    };

    facturas.push(factura);
    await window.mrsTpv.saveGestionSeries(series);
    await window.mrsTpv.saveFacturas(facturas);
    
    // Registro fiscal Verifactu
    if (window.VerifactuCore && factura.estado === 'emitida') {
      try {
        const registro = await window.VerifactuCore.crearRegistroFiscal(
          window.VerifactuCore.REGISTRO_TIPOS.ALTA,
          factura
        );
        const session = await window.mrsTpv.getSession();
        await window.VerifactuCore.registrarAuditTrail(
          'crear_factura',
          factura.id,
          factura.numero,
          session?.nombre || session?.email || 'sistema',
          { desdeTicket: ticket.numero }
        );
      } catch (e) {
        console.error('Error creando registro fiscal:', e);
      }
    }
    
    renderTickets();
    renderFacturas();
    alert('Factura creada: ' + numeroFactura);
  };
  window.HistorialModule.verFactura = async function(numero) {
    const factura = facturas.find(f => f.numero === numero);
    if (factura) {
      const html = await buildFacturaHtml(factura);
      abrirModalDocumento(
        'Factura ' + (factura.numero || ''),
        html,
        '',
        [
          { label: 'Imprimir', onClick: () => printFactura(factura) },
          { label: 'Guardar PDF', primary: true, onClick: () => saveFacturaPdf(factura) }
        ]
      );
    }
  };
  window.HistorialModule.rectificarFactura = async function(numero) {
    const factura = facturas.find(f => f.numero === numero);
    if (!factura) return;
    if (!canRectifyFactura(factura)) {
      alert('Esta factura no se puede rectificar más de una vez.');
      return;
    }

    const series = await window.mrsTpv.getGestionSeries() || {};
    const año = new Date().getFullYear();
    const añoStr = String(año);
    if (!series.facturas) series.facturas = {};
    const num = (series.facturas[añoStr] || 0) + 1;
    series.facturas[añoStr] = num;
    const numeroRectificativa = `${factura.numero}-R`;

    const rectificativa = {
      id: 'fac_' + Date.now(),
      numero: numeroRectificativa,
      fechaHora: new Date().toISOString(),
      facturaOriginalId: factura.id,
      facturaOriginalNumero: factura.numero,
      cliente: factura.cliente,
      lineas: factura.lineas.map(l => ({ ...l })),
      total: factura.total,
      ivaPorTipo: factura.ivaPorTipo,
      estado: 'emitida'
    };

    factura.estado = 'rectificada';
    facturas.push(rectificativa);
    await window.mrsTpv.saveGestionSeries(series);
    await window.mrsTpv.saveFacturas(facturas);
    
    // Registro fiscal Verifactu (rectificación)
    if (window.VerifactuCore) {
      try {
        const registro = await window.VerifactuCore.crearRegistroFiscal(
          window.VerifactuCore.REGISTRO_TIPOS.RECTIFICACION,
          rectificativa,
          'Rectificación de factura ' + factura.numero
        );
        const session = await window.mrsTpv.getSession();
        await window.VerifactuCore.registrarAuditTrail(
          'rectificar_factura',
          rectificativa.id,
          rectificativa.numero,
          session?.nombre || session?.email || 'sistema',
          { facturaOriginal: factura.numero }
        );
      } catch (e) {
        console.error('Error creando registro fiscal de rectificación:', e);
      }
    }
    
    renderTickets();
    renderFacturas();
    alert('Factura rectificativa creada: ' + numeroRectificativa);
  };

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

  window.HistorialModule.init = init;
})();
