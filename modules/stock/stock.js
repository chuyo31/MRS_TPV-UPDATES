/**
 * Módulo Stock - Ajustes de stock
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let productos = [];
  let categorias = [];
  let currentSession = null;
  let cambiosPendientes = {};

  // Inicializar módulo
  async function init() {
    currentSession = await window.mrsTpv.getSession();
    await loadData();
    render();
    setupEventListeners();
  }

  // Cargar datos
  async function loadData() {
    productos = await window.mrsTpv.getProductos() || [];
    categorias = await window.mrsTpv.getCategorias() || [];
  }

  // Renderizar interfaz
  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    const canEdit = currentSession?.role === 'administrador' || currentSession?.role === 'tecnico';

    content.innerHTML = `
      <div class="stock-module">
        <div class="module-header">
          <h2>Gestión de Stock</h2>
          ${canEdit ? '<button class="btn btn-primary" id="btn-guardar-stock">Guardar Cambios</button>' : ''}
        </div>

        <div class="stock-filters">
          <select id="filter-categoria-stock">
            <option value="">Todas las categorías</option>
          </select>
          <input type="text" id="search-stock" placeholder="Buscar producto...">
        </div>

        <div class="table-container">
          <table id="stock-table">
            <thead>
              <tr>
                <th>Producto</th>
                <th>Categoría</th>
                <th>Stock Actual</th>
                ${canEdit ? '<th>Acciones</th>' : ''}
              </tr>
            </thead>
            <tbody id="stock-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    renderStock();
    setupFilters();
  }

  // Renderizar stock
  function renderStock(categoriaId = '', searchTerm = '') {
    const tbody = document.getElementById('stock-tbody');
    if (!tbody) return;

    let productosFiltrados = productos;

    if (categoriaId) {
      productosFiltrados = productosFiltrados.filter(p => p.categoriaId === categoriaId);
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      productosFiltrados = productosFiltrados.filter(p => 
        (p.nombre || '').toLowerCase().includes(term)
      );
    }

    const canEdit = currentSession?.role === 'administrador' || currentSession?.role === 'tecnico';

    if (productosFiltrados.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-message">No hay productos</td></tr>';
      return;
    }

    tbody.innerHTML = productosFiltrados.map(prod => {
      const categoria = categorias.find(c => c.id === prod.categoriaId);
      const stockActual = cambiosPendientes[prod.id] !== undefined 
        ? cambiosPendientes[prod.id] 
        : (prod.stock || 0);
      const stockClass = stockActual === 0 ? 'stock-zero' : (stockActual <= 3 ? 'stock-bajo' : '');

      return `
        <tr class="${stockClass}">
          <td>${escapeHtml(prod.nombre)}</td>
          <td>${categoria ? escapeHtml(categoria.nombre) : '-'}</td>
          <td class="stock-value">${stockActual}</td>
          ${canEdit ? `
            <td>
              <div class="stock-controls">
                <button class="btn-stock btn-minus" data-producto-id="${prod.id}">-</button>
                <input type="number" class="stock-input" 
                  data-producto-id="${prod.id}" 
                  value="${stockActual}" 
                  min="0">
                <button class="btn-stock btn-plus" data-producto-id="${prod.id}">+</button>
                <button class="btn-stock btn-direct" data-producto-id="${prod.id}" title="Ajuste directo">📝</button>
              </div>
            </td>
          ` : ''}
        </tr>
      `;
    }).join('');

    // Event listeners para controles
    if (canEdit) {
      tbody.querySelectorAll('.btn-minus').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const productoId = e.target.dataset.productoId;
          ajustarStock(productoId, -1);
        });
      });

      tbody.querySelectorAll('.btn-plus').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const productoId = e.target.dataset.productoId;
          ajustarStock(productoId, 1);
        });
      });

      tbody.querySelectorAll('.stock-input').forEach(input => {
        input.addEventListener('change', (e) => {
          const productoId = e.target.dataset.productoId;
          const nuevoStock = parseInt(e.target.value) || 0;
          cambiosPendientes[productoId] = Math.max(0, nuevoStock);
          renderStock(
            document.getElementById('filter-categoria-stock')?.value || '',
            document.getElementById('search-stock')?.value || ''
          );
        });
      });

      tbody.querySelectorAll('.btn-direct').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const productoId = e.target.dataset.productoId;
          ajusteDirectoStock(productoId);
        });
      });
    }
  }

  // Ajustar stock
  function ajustarStock(productoId, delta) {
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;

    const stockActual = cambiosPendientes[productoId] !== undefined 
      ? cambiosPendientes[productoId] 
      : (producto.stock || 0);
    
    cambiosPendientes[productoId] = Math.max(0, stockActual + delta);
    
    renderStock(
      document.getElementById('filter-categoria-stock')?.value || '',
      document.getElementById('search-stock')?.value || ''
    );
  }

  // Ajuste directo de stock
  function ajusteDirectoStock(productoId) {
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;

    const stockActual = cambiosPendientes[productoId] !== undefined 
      ? cambiosPendientes[productoId] 
      : (producto.stock || 0);

    const nuevoStock = prompt(`Nuevo stock para "${producto.nombre}":`, stockActual);
    if (nuevoStock !== null) {
      const stock = parseInt(nuevoStock);
      if (!isNaN(stock) && stock >= 0) {
        cambiosPendientes[productoId] = stock;
        renderStock(
          document.getElementById('filter-categoria-stock')?.value || '',
          document.getElementById('search-stock')?.value || ''
        );
      } else {
        alert('Introduce un número válido mayor o igual a 0');
      }
    }
  }

  // Configurar filtros
  function setupFilters() {
    const filterCategoria = document.getElementById('filter-categoria-stock');
    if (filterCategoria) {
      categorias.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.nombre;
        filterCategoria.appendChild(option);
      });
      filterCategoria.addEventListener('change', (e) => {
        renderStock(e.target.value, document.getElementById('search-stock')?.value || '');
      });
    }

    const searchStock = document.getElementById('search-stock');
    if (searchStock) {
      searchStock.addEventListener('input', (e) => {
        renderStock(filterCategoria?.value || '', e.target.value);
      });
    }
  }

  // Configurar event listeners
  function setupEventListeners() {
    const canEdit = currentSession?.role === 'administrador' || currentSession?.role === 'tecnico';
    
    if (!canEdit) return;

    const btnGuardar = document.getElementById('btn-guardar-stock');
    if (btnGuardar) {
      btnGuardar.addEventListener('click', guardarCambios);
    }
  }

  // Guardar cambios
  async function guardarCambios() {
    if (Object.keys(cambiosPendientes).length === 0) {
      alert('No hay cambios pendientes');
      return;
    }

    if (!confirm(`¿Guardar ${Object.keys(cambiosPendientes).length} cambio(s) de stock?`)) {
      return;
    }

    // Aplicar cambios
    Object.keys(cambiosPendientes).forEach(productoId => {
      const producto = productos.find(p => p.id === productoId);
      if (producto) {
        producto.stock = cambiosPendientes[productoId];
      }
    });

    await window.mrsTpv.saveProductos(productos);
    cambiosPendientes = {};
    
    alert('Cambios guardados correctamente');
    renderStock(
      document.getElementById('filter-categoria-stock')?.value || '',
      document.getElementById('search-stock')?.value || ''
    );
  }

  // Utilidades
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Exportar función de inicialización
  window.StockModule = {
    init: init
  };
})();
