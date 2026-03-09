/**
 * Módulo Documentos - Exportación PDF/CSV
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let tickets = [];
  let facturas = [];
  let categorias = [];
  let clientes = [];
  let config = null;

  async function init() {
    await loadData();
    render();
    setupEventListeners();
  }

  async function loadData() {
    tickets = await window.mrsTpv.getTickets() || [];
    facturas = await window.mrsTpv.getFacturas() || [];
    categorias = await window.mrsTpv.getCategorias() || [];
    clientes = await window.mrsTpv.getClientes() || [];
    config = await window.mrsTpv.getConfig() || {};
  }

  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    content.innerHTML = `
      <div class="documentos-module">
        <div class="module-header">
          <h2>Exportación de Documentos</h2>
        </div>

        <div class="documentos-filters">
          <div class="form-group">
            <label>Desde</label>
            <input type="date" id="fecha-desde">
          </div>
          <div class="form-group">
            <label>Hasta</label>
            <input type="date" id="fecha-hasta">
          </div>
          <button class="btn btn-primary" id="btn-aplicar-filtros">Aplicar Filtros</button>
        </div>

        <div class="documentos-actions">
          <button class="btn btn-primary" id="btn-exportar-tickets-pdf">Exportar Tickets a PDF</button>
          <button class="btn btn-primary" id="btn-exportar-facturas-pdf">Exportar Facturas a PDF</button>
          <button class="btn btn-primary" id="btn-exportar-historial-pdf">Exportar Historial Completo a PDF</button>
          <button class="btn btn-primary" id="btn-exportar-csv">Exportar a CSV</button>
        </div>
      </div>
    `;
  }

  function setupEventListeners() {
    document.getElementById('btn-aplicar-filtros').addEventListener('click', aplicarFiltros);
    document.getElementById('btn-exportar-tickets-pdf').addEventListener('click', exportarTicketsPDF);
    document.getElementById('btn-exportar-facturas-pdf').addEventListener('click', exportarFacturasPDF);
    document.getElementById('btn-exportar-historial-pdf').addEventListener('click', exportarHistorialPDF);
    document.getElementById('btn-exportar-csv').addEventListener('click', exportarCSV);
  }

  function aplicarFiltros() {
    // Los filtros se aplican al exportar
    alert('Filtros aplicados. Los exportes usarán estas fechas.');
  }

  function getFiltrados() {
    const desde = document.getElementById('fecha-desde').value;
    const hasta = document.getElementById('fecha-hasta').value;

    let ticketsFiltrados = tickets;
    let facturasFiltradas = facturas;

    if (desde) {
      const desdeDate = new Date(desde);
      ticketsFiltrados = ticketsFiltrados.filter(t => new Date(t.fechaHora) >= desdeDate);
      facturasFiltradas = facturasFiltradas.filter(f => new Date(f.fechaHora) >= desdeDate);
    }

    if (hasta) {
      const hastaDate = new Date(hasta);
      hastaDate.setHours(23, 59, 59);
      ticketsFiltrados = ticketsFiltrados.filter(t => new Date(t.fechaHora) <= hastaDate);
      facturasFiltradas = facturasFiltradas.filter(f => new Date(f.fechaHora) <= hastaDate);
    }

    return { tickets: ticketsFiltrados, facturas: facturasFiltradas };
  }

  async function exportarTicketsPDF() {
    const { tickets: ticketsFiltrados } = getFiltrados();
    const html = generarHTMLTickets(ticketsFiltrados);
    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToPdf(html, `tickets_${fecha}.pdf`);
  }

  async function exportarFacturasPDF() {
    const { facturas: facturasFiltradas } = getFiltrados();
    const html = generarHTMLFacturas(facturasFiltradas);
    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToPdf(html, `facturas_${fecha}.pdf`);
  }

  async function exportarHistorialPDF() {
    const { tickets: ticketsFiltrados, facturas: facturasFiltradas } = getFiltrados();
    const html = generarHTMLHistorialCompleto(ticketsFiltrados, facturasFiltradas);
    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToPdf(html, `historial_completo_${fecha}.pdf`);
  }

  async function exportarCSV() {
    const { tickets: ticketsFiltrados, facturas: facturasFiltradas } = getFiltrados();
    
    let csv = 'Tipo,Número,Fecha,Cliente,Base,IVA,Total\n';
    
    ticketsFiltrados.forEach(t => {
      const cliente = t.cliente ? (t.cliente.nombre || t.cliente.razonSocial || '-') : '-';
      const base = (t.total || 0) - Object.values(t.ivaPorTipo || {}).reduce((sum, item) => sum + item.cuota, 0);
      const iva = Object.values(t.ivaPorTipo || {}).reduce((sum, item) => sum + item.cuota, 0);
      csv += `Ticket,${t.numero || '-'},${formatFechaCSV(t.fechaHora)},${cliente},${base},${iva},${t.total || 0}\n`;
    });

    facturasFiltradas.forEach(f => {
      const cliente = f.cliente ? (f.cliente.nombre || f.cliente.razonSocial || '-') : '-';
      const base = (f.total || 0) - Object.values(f.ivaPorTipo || {}).reduce((sum, item) => sum + item.cuota, 0);
      const iva = Object.values(f.ivaPorTipo || {}).reduce((sum, item) => sum + item.cuota, 0);
      csv += `Factura,${f.numero || '-'},${formatFechaCSV(f.fechaHora)},${cliente},${base},${iva},${f.total || 0}\n`;
    });

    const fecha = new Date().toISOString().split('T')[0];
    await window.mrsTpv.exportToCsv(csv, `exportacion_${fecha}.csv`);
  }

  function generarHTMLTickets(tickets) {
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body{font-family:Arial;padding:20px}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{padding:8px;border:1px solid #ddd;text-align:left}
th{background:#f5f5f5}
</style></head><body>
<h1>Tickets de Venta</h1>
<table>
<tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Total</th></tr>
${tickets.map(t => `
<tr>
  <td>${t.numero || '-'}</td>
  <td>${formatFecha(t.fechaHora)}</td>
  <td>${t.cliente ? (t.cliente.nombre || t.cliente.razonSocial || '-') : '-'}</td>
  <td>${formatEuro(t.total || 0)}</td>
</tr>
`).join('')}
</table>
</body></html>`;
  }

  function generarHTMLFacturas(facturas) {
    const empresa = {
      nombre: String(config?.nombreEmpresa || 'MRS_TPV'),
      direccion: String(config?.direccion || ''),
      ciudadCp: String(config?.ciudad || ''),
      nif: String(config?.cif || ''),
      telefono: String(config?.telefono || '')
    };

    const getClienteFactura = (f) => {
      if (f?.cliente && typeof f.cliente === 'object') {
        return {
          nombre: f.cliente.nombre || f.cliente.razonSocial || '-',
          nif: f.cliente.nif || f.cliente.dni || '-',
          direccion: f.cliente.direccion || '-',
          ciudad: f.cliente.ciudad || '-'
        };
      }
      const byId = clientes.find(c => c.id === f?.clienteId);
      if (byId) {
        return {
          nombre: byId.nombre || byId.razonSocial || '-',
          nif: byId.nif || byId.dni || '-',
          direccion: byId.direccion || '-',
          ciudad: byId.ciudad || '-'
        };
      }
      return { nombre: '-', nif: '-', direccion: '-', ciudad: '-' };
    };

    const formatNum = (n) => Number(n || 0).toFixed(2);
    const formatDate = (iso) => {
      if (!iso) return '-';
      return new Date(iso).toLocaleDateString('es-ES');
    };

    const buildLineas = (lineas) => {
      if (!Array.isArray(lineas) || lineas.length === 0) {
        return '<tr><td colspan="4">Sin líneas</td></tr>';
      }
      return lineas.map((l) => {
        const desc = l.descripcion || l.nombre || '-';
        const qty = Number(l.cantidad || 1);
        const price = Number(l.precio || 0);
        const subtotal = Number(l.subtotal !== undefined ? l.subtotal : (qty * price));
        return `
          <tr>
            <td>${escapeHtml(desc)}</td>
            <td>${qty}</td>
            <td>${formatNum(price)}€</td>
            <td>${formatNum(subtotal)}€</td>
          </tr>
        `;
      }).join('');
    };

    const buildResumen = (f) => {
      const base = Number(f.base || 0);
      const total = Number(f.total || 0);
      const iva = total - base;
      return `
        <div class="resumen-box">
          <div><span>Base</span><strong>${formatNum(base)}€</strong></div>
          <div><span>IVA</span><strong>${formatNum(iva)}€</strong></div>
          <div class="total"><span>Total</span><strong>${formatNum(total)}€</strong></div>
        </div>
      `;
    };

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  *{box-sizing:border-box}
  body{font-family:Arial,sans-serif;background:#efefef;margin:0;padding:24px;color:#111}
  .factura{background:#fff;padding:28px 30px;margin:0 auto 26px auto;max-width:860px;page-break-after:always}
  .factura:last-child{page-break-after:auto}
  .head{display:flex;justify-content:space-between;gap:20px}
  .brand h1{margin:0;font-size:34px;line-height:1}
  .brand .sub{margin-top:4px;font-size:12px;font-weight:bold;letter-spacing:.6px}
  .empresa{font-size:12px;line-height:1.45;max-width:320px}
  .rule{border-top:2px solid #222;margin:16px 0}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .box{background:#111;color:#fff;padding:10px 12px;font-size:12px;min-height:70px}
  .box h4{margin:0 0 8px 0;font-size:12px}
  .box p{margin:2px 0}
  .tabla{width:100%;border-collapse:collapse;margin-top:12px}
  .tabla th{background:#111;color:#fff;padding:9px 8px;font-size:12px;text-align:center}
  .tabla td{padding:8px;border-bottom:1px solid #ddd;font-size:12px}
  .tabla td:nth-child(2),.tabla td:nth-child(3),.tabla td:nth-child(4){text-align:center}
  .footer{display:flex;justify-content:space-between;align-items:flex-end;margin-top:16px;gap:16px}
  .transfer{background:#111;color:#fff;padding:10px 12px;min-width:290px;font-size:12px}
  .transfer b{display:block;margin-bottom:4px}
  .resumen-box{min-width:230px}
  .resumen-box > div{display:flex;justify-content:space-between;border-bottom:1px solid #222;padding:5px 0;font-size:13px}
  .resumen-box .total{font-weight:bold;font-size:16px}
  .thanks{font-weight:800;text-align:right;margin-top:14px}
</style></head><body>
${facturas.map(f => {
  const c = getClienteFactura(f);
  return `
  <section class="factura">
    <div class="head">
      <div class="brand">
        <h1>${escapeHtml(empresa.nombre.split(' ')[0] || empresa.nombre)}</h1>
        <h1>${escapeHtml((empresa.nombre.split(' ').slice(1).join(' ')) || '')}</h1>
        <div class="sub">SERVICIO TECNICO</div>
      </div>
      <div class="empresa">
        ${escapeHtml(empresa.direccion || '-')}<br>
        ${escapeHtml(empresa.ciudadCp || '-')}<br>
        NIF: ${escapeHtml(empresa.nif || '-')}<br>
        TEL: ${escapeHtml(empresa.telefono || '-')}
      </div>
    </div>
    <div class="rule"></div>
    <div class="meta">
      <div class="box">
        <h4>CLIENTE</h4>
        <p>Nombre: ${escapeHtml(c.nombre)}</p>
        <p>NIF: ${escapeHtml(c.nif)}</p>
        <p>Dirección: ${escapeHtml(c.direccion)}</p>
        <p>Ciudad: ${escapeHtml(c.ciudad)}</p>
      </div>
      <div class="box">
        <h4>FACTURA N°: ${escapeHtml(f.numero || '-')}</h4>
        <p>Fecha: ${formatDate(f.fechaHora)}</p>
        <p>Estado: ${escapeHtml(f.estado || '-')}</p>
      </div>
    </div>
    <div class="rule"></div>
    <table class="tabla">
      <thead>
        <tr><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${buildLineas(f.lineas)}
      </tbody>
    </table>
    <div class="rule"></div>
    <div class="footer">
      <div class="transfer">
        <b>TRANSFERENCIA</b>
        ${escapeHtml(empresa.nombre)}<br>
        ${escapeHtml(config?.numeroCuenta || 'ES00 - 0000 - 0000 - 0000 - 0000')}
      </div>
      <div>
        ${buildResumen(f)}
        <div class="thanks">!MUCHAS GRACIAS<br>POR TU CONFIANZA!</div>
      </div>
    </div>
  </section>
  `;
}).join('')}
</body></html>`;
  }

  function generarHTMLHistorialCompleto(tickets, facturas) {
    const totalBase = [...tickets, ...facturas].reduce((sum, item) => {
      const iva = Object.values(item.ivaPorTipo || {}).reduce((s, i) => s + i.cuota, 0);
      return sum + (item.total || 0) - iva;
    }, 0);
    const totalIva = [...tickets, ...facturas].reduce((sum, item) => {
      return sum + Object.values(item.ivaPorTipo || {}).reduce((s, i) => s + i.cuota, 0);
    }, 0);
    const totalVentas = [...tickets, ...facturas].reduce((sum, item) => sum + (item.total || 0), 0);

    const porCategoria = {};
    tickets.forEach(t => {
      t.lineas?.forEach(l => {
        const cat = categorias.find(c => c.id === l.categoriaId);
        const catNombre = cat ? cat.nombre : 'Sin categoría';
        if (!porCategoria[catNombre]) {
          porCategoria[catNombre] = { cantidad: 0, total: 0 };
        }
        porCategoria[catNombre].cantidad += l.cantidad || 1;
        porCategoria[catNombre].total += (l.precio || 0) * (l.cantidad || 1);
      });
    });

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body{font-family:Arial;padding:20px}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{padding:8px;border:1px solid #ddd;text-align:left}
th{background:#f5f5f5}
.resumen{margin:20px 0;padding:15px;background:#f9f9f9;border-radius:5px}
</style></head><body>
<h1>Historial Completo</h1>
<div class="resumen">
  <h2>Resumen</h2>
  <p>Base imponible: ${formatEuro(totalBase)}</p>
  <p>Total IVA: ${formatEuro(totalIva)}</p>
  <p>Total ventas: ${formatEuro(totalVentas)}</p>
</div>
<h2>Por Categorías</h2>
<table>
<tr><th>Categoría</th><th>Cantidad</th><th>Total</th></tr>
${Object.entries(porCategoria).map(([cat, data]) => `
<tr>
  <td>${cat}</td>
  <td>${data.cantidad}</td>
  <td>${formatEuro(data.total)}</td>
</tr>
`).join('')}
</table>
</body></html>`;
  }

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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
  }

  function getFiltros() {
    return getFiltrados();
  }

  window.DocumentosModule = {
    init: init
  };
})();
