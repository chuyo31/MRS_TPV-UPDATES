/**
 * Módulo Caja - Punto de Venta (TPV)
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let categorias = [];
  let productos = [];
  let cajaActual = null;
  let clientes = [];
  let ticket = {
    lineas: [],
    descuentoPct: 0,
    cliente: null,
    formaPago: 'efectivo'
  };
  let panelSizes = {
    categorias: 200,
    productos: 400,
    ticket: 300
  };
  let currentCategoriaId = '';
  let productSearchTerm = '';
  let activeResize = null;
  let documentResizeHandlersBound = false;

  // Inicializar módulo
  async function init() {
    await loadData();
    restorePanelSizes();
    render();
    setupEventListeners();
  }

  // Cargar datos
  async function loadData() {
    categorias = await window.mrsTpv.getCategorias() || [];
    productos = await window.mrsTpv.getProductos() || [];
    cajaActual = await window.mrsTpv.getCajaActual();
    clientes = await window.mrsTpv.getClientes() || [];

    // Verificar inicio de caja
    const hoy = new Date().toISOString().split('T')[0];
    if (!cajaActual || cajaActual.fecha !== hoy || cajaActual.cerrada) {
      await showInicioCaja();
    }
  }

  // Renderizar interfaz
  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    content.innerHTML = `
      <div class="caja-container">
        <div class="caja-panel categorias-panel" style="width: ${panelSizes.categorias}px">
          <div class="panel-header">
            <h3>Categorías</h3>
          </div>
          <div class="categorias-grid" id="categorias-grid"></div>
        </div>
        
        <div class="caja-resizer" id="resizer-1"></div>
        
        <div class="caja-panel productos-panel" style="flex: 1; min-width: 200px">
          <div class="panel-header">
            <h3>Productos</h3>
            <div class="categoria-actual" id="categoria-actual">Todas las categorías</div>
            <div class="productos-search-wrap">
              <input
                type="text"
                id="caja-product-search"
                class="productos-search-input"
                placeholder="Buscar producto... (Enter añade el primero)"
                autocomplete="off"
              >
            </div>
          </div>
          <div class="productos-grid" id="productos-grid"></div>
        </div>
        
        <div class="caja-resizer" id="resizer-2"></div>
        
        <div class="caja-panel ticket-panel" style="width: ${panelSizes.ticket}px">
          <div class="panel-header">
            <h3>Ticket</h3>
          </div>
          <div class="ticket-content">
            <div class="ticket-lineas" id="ticket-lineas"></div>
            <div class="ticket-totales">
              <div class="total-line">
                <span>Subtotal:</span>
                <span id="subtotal">0,00 €</span>
              </div>
              <div class="total-line">
                <label>Descuento (%):</label>
                <input type="number" id="descuento-input" min="0" max="100" value="0" step="0.1">
              </div>
              <div class="total-line">
                <span>Descuento:</span>
                <span id="descuento-total">0,00 €</span>
              </div>
              <div class="total-line" id="iva-lines"></div>
              <div class="total-line total-final">
                <span>TOTAL:</span>
                <span id="total-final">0,00 €</span>
              </div>
            </div>
            <div class="ticket-cliente">
              <label>Cliente (opcional):</label>
              <select id="cliente-select">
                <option value="">Sin cliente</option>
              </select>
            </div>
            <div class="ticket-pago">
              <label>Forma de pago:</label>
              <select id="forma-pago-select">
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta">Tarjeta</option>
                <option value="transferencia">Transferencia</option>
                <option value="bizum">Bizum</option>
              </select>
            </div>
            <div class="ticket-actions">
              <button class="btn btn-primary btn-block" id="btn-cobrar">Cobrar</button>
              <button class="btn btn-ghost btn-block" id="btn-limpiar">Limpiar ticket</button>
            </div>
          </div>
        </div>
      </div>
    `;

    renderCategorias();
    renderProductos(currentCategoriaId, productSearchTerm);
    renderTicket();
  }

  function getFilteredProductos(categoriaId = '', searchTerm = '') {
    let productosFiltrados = productos;
    if (categoriaId) {
      productosFiltrados = productosFiltrados.filter(p => p.categoriaId === categoriaId);
    }
    if (searchTerm) {
      const term = String(searchTerm || '').trim().toLowerCase();
      productosFiltrados = productosFiltrados.filter(p => (p.nombre || '').toLowerCase().includes(term));
    }
    return productosFiltrados;
  }

  // Renderizar categorías
  function renderCategorias() {
    const grid = document.getElementById('categorias-grid');
    if (!grid) return;

    grid.innerHTML = categorias.map(cat => {
      const imageHtml = cat.imagenUrl
        ? `<img src="${cat.imagenUrl}" alt="${escapeHtml(cat.nombre)}">`
        : `<div class="categoria-placeholder"></div>`;
      return `
        <div class="categoria-card" data-categoria-id="${cat.id}">
          ${imageHtml}
          <div class="categoria-overlay">
            <div class="categoria-nombre">${escapeHtml(cat.nombre)}</div>
          </div>
        </div>
      `;
    }).join('');

    // Añadir "Todas"
    grid.insertAdjacentHTML('afterbegin', `
      <div class="categoria-card active" data-categoria-id="">
        <div class="categoria-placeholder"></div>
        <div class="categoria-overlay">
          <div class="categoria-nombre">Todas</div>
        </div>
      </div>
    `);

    // Event listeners
    grid.querySelectorAll('.categoria-card').forEach(card => {
      card.addEventListener('click', () => {
        grid.querySelectorAll('.categoria-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const categoriaId = card.dataset.categoriaId || '';
        filterProductos(categoriaId);
      });
    });
  }

  // Renderizar productos
  function renderProductos(categoriaId = '', searchTerm = '') {
    const grid = document.getElementById('productos-grid');
    if (!grid) return;

    const productosFiltrados = getFilteredProductos(categoriaId, searchTerm);

    grid.innerHTML = productosFiltrados.map(prod => {
      const stock = prod.stock || 0;
      const stockClass = stock === 0 ? 'sin-stock' : (stock <= 3 ? 'stock-bajo' : '');
      const disabled = stock === 0;
      
      return `
        <div class="producto-card ${stockClass} ${disabled ? 'disabled' : ''}" data-producto-id="${prod.id}">
          ${prod.imagenUrl ? `<img src="${prod.imagenUrl}" alt="${prod.nombre}">` : ''}
          <div class="producto-info">
            <div class="producto-nombre">${escapeHtml(prod.nombre)}</div>
            <div class="producto-precio">${formatEuro(prod.precio || 0)}</div>
            <div class="producto-stock">${stock > 0 ? `${stock} disponible` : 'Sin stock'}</div>
          </div>
        </div>
      `;
    }).join('');

    // Event listeners
    grid.querySelectorAll('.producto-card:not(.disabled)').forEach(card => {
      card.addEventListener('click', () => {
        const productoId = card.dataset.productoId;
        añadirProductoATicket(productoId);
      });
    });
  }

  // Renderizar ticket
  function renderTicket() {
    const lineasDiv = document.getElementById('ticket-lineas');
    if (!lineasDiv) return;

    lineasDiv.innerHTML = ticket.lineas.map((linea, index) => {
      const subtotal = (linea.precio || 0) * (linea.cantidad || 1);
      return `
        <div class="ticket-linea">
          <div class="linea-info">
            <div class="linea-nombre">${escapeHtml(linea.nombre)}</div>
          </div>
          <div class="linea-controls">
            <button class="btn-cantidad btn-cantidad-minus" data-index="${index}" title="Restar">-</button>
            <input type="number" class="linea-cantidad" value="${linea.cantidad}" min="1" data-index="${index}">
            <button class="btn-cantidad btn-cantidad-plus" data-index="${index}" title="Sumar">+</button>
            <button class="btn-eliminar-linea" data-index="${index}">×</button>
          </div>
          <div class="linea-subtotal">${formatEuro(subtotal)}</div>
        </div>
      `;
    }).join('');

    // Event listeners para cantidad
    lineasDiv.querySelectorAll('.linea-cantidad').forEach(input => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        const cantidad = parseInt(e.target.value) || 1;
        if (cantidad > 0) {
          ticket.lineas[index].cantidad = cantidad;
          renderTicket();
          calcularTotales();
        }
      });
    });

    // Event listeners para +/- cantidad
    lineasDiv.querySelectorAll('.btn-cantidad-minus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (isNaN(index) || !ticket.lineas[index]) return;
        ticket.lineas[index].cantidad = Math.max(1, (ticket.lineas[index].cantidad || 1) - 1);
        renderTicket();
      });
    });

    lineasDiv.querySelectorAll('.btn-cantidad-plus').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        if (isNaN(index) || !ticket.lineas[index]) return;
        const linea = ticket.lineas[index];
        const producto = productos.find(p => p.id === linea.productoId);
        const stock = producto ? (producto.stock || 0) : Infinity;
        if (linea.cantidad >= stock) return;
        linea.cantidad += 1;
        renderTicket();
      });
    });

    // Event listeners para eliminar
    lineasDiv.querySelectorAll('.btn-eliminar-linea').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        ticket.lineas.splice(index, 1);
        renderTicket();
        calcularTotales();
      });
    });

    calcularTotales();
  }

  // Calcular totales
  function calcularTotales() {
    let subtotal = 0;
    const ivaPorTipo = {};

    ticket.lineas.forEach(linea => {
      const precioLinea = (linea.precio || 0) * (linea.cantidad || 1);
      subtotal += precioLinea;
      
      const iva = linea.iva || 0;
      if (!ivaPorTipo[iva]) {
        ivaPorTipo[iva] = { base: 0, cuota: 0 };
      }
      ivaPorTipo[iva].base += precioLinea;
      ivaPorTipo[iva].cuota = ivaPorTipo[iva].base * (iva / 100);
    });

    const descuentoPct = parseFloat(document.getElementById('descuento-input')?.value || 0);
    const descuento = subtotal * (descuentoPct / 100);
    const subtotalConDescuento = subtotal - descuento;

    // Recalcular IVA sobre subtotal con descuento
    Object.keys(ivaPorTipo).forEach(iva => {
      const baseIva = ivaPorTipo[iva].base * (1 - descuentoPct / 100);
      ivaPorTipo[iva].cuota = baseIva * (parseFloat(iva) / 100);
    });

    const totalIva = Object.values(ivaPorTipo).reduce((sum, item) => sum + item.cuota, 0);
    const total = subtotalConDescuento + totalIva;

    // Actualizar UI
    const subtotalEl = document.getElementById('subtotal');
    const descuentoTotalEl = document.getElementById('descuento-total');
    const ivaLinesEl = document.getElementById('iva-lines');
    const totalFinalEl = document.getElementById('total-final');

    if (subtotalEl) subtotalEl.textContent = formatEuro(subtotal);
    if (descuentoTotalEl) descuentoTotalEl.textContent = formatEuro(descuento);
    
    if (ivaLinesEl) {
      ivaLinesEl.innerHTML = Object.entries(ivaPorTipo).map(([iva, data]) => `
        <div class="total-line">
          <span>IVA ${iva}%:</span>
          <span>${formatEuro(data.cuota)}</span>
        </div>
      `).join('');
    }

    if (totalFinalEl) totalFinalEl.textContent = formatEuro(total);

    ticket.descuentoPct = descuentoPct;
    ticket.ivaPorTipo = ivaPorTipo;
  }

  // Filtrar productos por categoría
  function filterProductos(categoriaId) {
    currentCategoriaId = categoriaId || '';
    const categoriaActual = document.getElementById('categoria-actual');
    if (categoriaActual) {
      if (categoriaId) {
        const cat = categorias.find(c => c.id === categoriaId);
        categoriaActual.textContent = cat ? cat.nombre : 'Categoría';
      } else {
        categoriaActual.textContent = 'Todas las categorías';
      }
    }
    renderProductos(currentCategoriaId, productSearchTerm);
  }

  // Añadir producto al ticket
  function añadirProductoATicket(productoId) {
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;

    const stock = producto.stock || 0;
    if (stock === 0) {
      alert('No hay stock disponible de este producto');
      return;
    }

    if (stock <= 3) {
      const confirmar = confirm(`Stock bajo (${stock}). ¿Continuar?`);
      if (!confirmar) return;
    }

    // Buscar si ya existe en el ticket
    const lineaExistente = ticket.lineas.find(l => l.productoId === productoId);
    if (lineaExistente) {
      if (lineaExistente.cantidad >= stock) {
        alert('No hay suficiente stock');
        return;
      }
      lineaExistente.cantidad += 1;
    } else {
      const categoria = categorias.find(c => c.id === producto.categoriaId);
      ticket.lineas.push({
        productoId: producto.id,
        categoriaId: producto.categoriaId,
        categoriaNombre: categoria ? categoria.nombre : '',
        nombre: producto.nombre,
        precio: producto.precio || 0,
        cantidad: 1,
        iva: producto.iva || 0
      });
    }

    renderTicket();
  }

  // Configurar event listeners
  function setupEventListeners() {
    // Descuento
    const descuentoInput = document.getElementById('descuento-input');
    if (descuentoInput) {
      descuentoInput.addEventListener('input', calcularTotales);
    }

    // Buscador de productos
    const productSearch = document.getElementById('caja-product-search');
    if (productSearch) {
      productSearch.value = productSearchTerm;
      productSearch.addEventListener('input', (e) => {
        productSearchTerm = String(e.target.value || '').trim();
        renderProductos(currentCategoriaId, productSearchTerm);
      });
      productSearch.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const filtered = getFilteredProductos(currentCategoriaId, productSearchTerm);
        const firstAvailable = filtered.find(p => (p.stock || 0) > 0);
        if (firstAvailable) {
          añadirProductoATicket(firstAvailable.id);
        }
      });
    }

    // Cliente
    const clienteSelect = document.getElementById('cliente-select');
    if (clienteSelect) {
      clientes.forEach(cliente => {
        const option = document.createElement('option');
        option.value = cliente.id;
        option.textContent = cliente.nombre || cliente.razonSocial || cliente.email;
        clienteSelect.appendChild(option);
      });
      clienteSelect.addEventListener('change', (e) => {
        const clienteId = e.target.value;
        ticket.cliente = clienteId ? clientes.find(c => c.id === clienteId) : null;
      });
    }

    // Forma de pago
    const formaPagoSelect = document.getElementById('forma-pago-select');
    if (formaPagoSelect) {
      formaPagoSelect.addEventListener('change', (e) => {
        ticket.formaPago = e.target.value;
      });
    }

    // Botón cobrar
    const btnCobrar = document.getElementById('btn-cobrar');
    if (btnCobrar) {
      btnCobrar.addEventListener('click', procesarCobro);
    }

    // Botón limpiar
    const btnLimpiar = document.getElementById('btn-limpiar');
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', limpiarTicket);
    }

    // Resizers
    setupResizers();
  }

  // Configurar redimensionadores de paneles
  function setupResizers() {
    const resizer1 = document.getElementById('resizer-1');
    const resizer2 = document.getElementById('resizer-2');
    
    if (resizer1) {
      makeResizable(resizer1, 'categorias');
    }
    if (resizer2) {
      makeResizable(resizer2, 'ticket');
    }
  }

  function makeResizable(resizer, saveKey) {
    resizer.addEventListener('mousedown', (e) => {
      activeResize = { saveKey };
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    bindDocumentResizeHandlers();
  }

  function bindDocumentResizeHandlers() {
    if (documentResizeHandlersBound) return;
    documentResizeHandlersBound = true;

    document.addEventListener('mousemove', (e) => {
      if (!activeResize) return;
      const container = document.querySelector('.caja-container');
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const resizer1 = document.getElementById('resizer-1');
      const resizer2 = document.getElementById('resizer-2');
      if (!resizer1 || !resizer2) return;

      const minCategorias = 180;
      const minProductos = 260;
      const minTicket = 280;
      const maxTicket = Math.max(minTicket, Math.floor(containerRect.width * 0.55));

      if (activeResize.saveKey === 'categorias') {
        const desired = e.clientX - containerRect.left;
        const maxCategorias = containerRect.width - minProductos - minTicket - resizer1.offsetWidth - resizer2.offsetWidth;
        panelSizes.categorias = Math.max(minCategorias, Math.min(desired, maxCategorias));
      } else if (activeResize.saveKey === 'ticket') {
        const fromRight = containerRect.right - e.clientX;
        const maxByLayout = containerRect.width - panelSizes.categorias - minProductos - resizer1.offsetWidth - resizer2.offsetWidth;
        panelSizes.ticket = Math.max(minTicket, Math.min(fromRight, Math.min(maxTicket, maxByLayout)));
      }

      applyPanelSizes();
    });

    document.addEventListener('mouseup', () => {
      if (!activeResize) return;
      activeResize = null;
      document.body.style.cursor = '';
      savePanelSizes();
    });
  }

  function applyPanelSizes() {
    const categoriasPanel = document.querySelector('.categorias-panel');
    const ticketPanel = document.querySelector('.ticket-panel');
    if (categoriasPanel) categoriasPanel.style.width = `${Math.round(panelSizes.categorias)}px`;
    if (ticketPanel) ticketPanel.style.width = `${Math.round(panelSizes.ticket)}px`;
  }

  function savePanelSizes() {
    localStorage.setItem('mrs_tpv_caja_panel_sizes', JSON.stringify(panelSizes));
  }

  function restorePanelSizes() {
    const saved = localStorage.getItem('mrs_tpv_caja_panel_sizes');
    if (saved) {
      try {
        panelSizes = { ...panelSizes, ...JSON.parse(saved) };
      } catch (e) {
        console.error('Error restaurando tamaños de paneles:', e);
      }
    }
    panelSizes.categorias = Math.max(180, Number(panelSizes.categorias) || 200);
    panelSizes.ticket = Math.max(280, Number(panelSizes.ticket) || 300);
  }

  // Procesar cobro
  async function procesarCobro() {
    const btnCobrar = document.getElementById('btn-cobrar');
    try {
      if (ticket.lineas.length === 0) {
        alert('El ticket está vacío');
        return;
      }

      if (btnCobrar) {
        btnCobrar.disabled = true;
        btnCobrar.textContent = 'Procesando...';
      }

      const session = await window.mrsTpv.getSession();
      if (!session) {
        alert('Sesión no válida');
        return;
      }

      // Generar número de ticket
      const tickets = await window.mrsTpv.getTickets() || [];
      const año = new Date().getFullYear();
      const ticketsAño = tickets.filter(t => t.numero && t.numero.startsWith(`TCK-${año}-`));
      const ultimoNum = ticketsAño.length > 0 
        ? Math.max(...ticketsAño.map(t => parseInt(t.numero.split('-')[2]) || 0))
        : 0;
      const numeroTicket = `TCK-${año}-${String(ultimoNum + 1).padStart(4, '0')}`;

      calcularTotales();
      const subtotal = ticket.lineas.reduce((sum, l) => sum + (l.precio || 0) * (l.cantidad || 1), 0);
      const descuento = subtotal * (ticket.descuentoPct / 100);
      const totalIva = Object.values(ticket.ivaPorTipo || {}).reduce((sum, item) => sum + item.cuota, 0);
      const total = subtotal - descuento + totalIva;

      const baseTicket = {
        numero: numeroTicket,
        fechaHora: new Date().toISOString(),
        atendidoPor: String(session.nombre || session.email || '').trim() || 'Usuario',
        atendidoPorEmail: String(session.email || '').trim().toLowerCase(),
        lineas: ticket.lineas.map(l => ({ ...l })),
        descuentoPct: ticket.descuentoPct,
        total: total,
        formaPago: ticket.formaPago,
        cliente: ticket.cliente,
        ivaPorTipo: ticket.ivaPorTipo
      };

      const nuevoTicket = {
        ...baseTicket,
        hash: await calcularHash(baseTicket)
      };

      // Guardar ticket
      tickets.push(nuevoTicket);
      await window.mrsTpv.saveTickets(tickets);

      // Actualizar caja actual
      if (!cajaActual) {
        cajaActual = {
          fecha: new Date().toISOString().split('T')[0],
          importeInicial: 0,
          ventas: [],
          cerrada: false
        };
      }
      cajaActual.ventas.push({
        fechaHora: nuevoTicket.fechaHora,
        atendidoPor: nuevoTicket.atendidoPor,
        atendidoPorEmail: nuevoTicket.atendidoPorEmail,
        lineas: nuevoTicket.lineas,
        descuentoPct: nuevoTicket.descuentoPct,
        total: nuevoTicket.total,
        formaPago: nuevoTicket.formaPago,
        cliente: nuevoTicket.cliente,
        ivaPorTipo: nuevoTicket.ivaPorTipo
      });
      await window.mrsTpv.saveCajaActual(cajaActual);

      // Descontar stock
      ticket.lineas.forEach(linea => {
        const producto = productos.find(p => p.id === linea.productoId);
        if (producto) {
          producto.stock = Math.max(0, (producto.stock || 0) - linea.cantidad);
        }
      });
      await window.mrsTpv.saveProductos(productos);

      // Preguntar impresión
      const imprimir = confirm(`Ticket ${numeroTicket} guardado.\nTotal: ${formatEuro(total)}\n¿Imprimir ticket?`);
      if (imprimir) {
        const config = await window.mrsTpv.getConfig();
        await window.mrsTpv.printTicket(nuevoTicket, config);
      }

      limpiarTicket();
      renderProductos(currentCategoriaId, productSearchTerm);
    } catch (error) {
      console.error('procesarCobro error:', error);
      alert('Error al cobrar: ' + String(error?.message || error));
    } finally {
      if (btnCobrar) {
        btnCobrar.disabled = false;
        btnCobrar.textContent = 'Cobrar';
      }
    }
  }

  // Limpiar ticket
  function limpiarTicket() {
    ticket = {
      lineas: [],
      descuentoPct: 0,
      cliente: null,
      formaPago: 'efectivo'
    };
    const descuentoInput = document.getElementById('descuento-input');
    if (descuentoInput) descuentoInput.value = 0;
    const clienteSelect = document.getElementById('cliente-select');
    if (clienteSelect) clienteSelect.value = '';
    const formaPagoSelect = document.getElementById('forma-pago-select');
    if (formaPagoSelect) formaPagoSelect.value = 'efectivo';
    renderTicket();
  }

  // Mostrar inicio de caja
  async function showInicioCaja() {
    return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h3 class="modal-title">Inicio de Caja</h3>
          </div>
          <div class="modal-body">
            <p>Introduce el importe inicial de la caja:</p>
            <div class="form-group">
              <input type="number" id="importe-inicial" step="0.01" min="0" value="0" autofocus>
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" id="btn-confirmar-inicio">Confirmar</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const btnConfirmar = modal.querySelector('#btn-confirmar-inicio');
      const inputImporte = modal.querySelector('#importe-inicial');

      btnConfirmar.addEventListener('click', async () => {
        const importe = parseFloat(inputImporte.value) || 0;
        const hoy = new Date().toISOString().split('T')[0];
        
        cajaActual = {
          fecha: hoy,
          importeInicial: importe,
          ventas: [],
          cerrada: false
        };
        
        await window.mrsTpv.saveCajaActual(cajaActual);
        document.body.removeChild(modal);
        resolve();
      });

      inputImporte.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          btnConfirmar.click();
        }
      });
    });
  }

  // Calcular hash SHA-256
  async function calcularHash(data) {
    const str = JSON.stringify(data);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'sha256:' + hashHex;
  }

  // Utilidades
  function formatEuro(n) {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n || 0);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Exportar función de inicialización
  window.CajaModule = {
    init: init
  };
})();
