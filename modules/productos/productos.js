/**
 * Módulo Productos - Gestión de categorías y productos
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let categorias = [];
  let productos = [];
  let currentSession = null;
  let cambiosStockPendientes = {};

  // Inicializar módulo
  async function init() {
    currentSession = await window.mrsTpv.getSession();
    await loadData();
    render();
    setupEventListeners();
  }

  // Cargar datos
  async function loadData() {
    categorias = await window.mrsTpv.getCategorias() || [];
    productos = await window.mrsTpv.getProductos() || [];
  }

  // Renderizar interfaz
  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    const canEdit = currentSession?.role === 'administrador' || currentSession?.role === 'tecnico';

    content.innerHTML = `
      <div class="productos-module">
        <div class="module-header">
          <h2>Gestión de Productos</h2>
          ${canEdit ? '<button class="btn btn-primary" id="btn-nueva-categoria">Nueva Categoría</button>' : ''}
          ${canEdit ? '<button class="btn btn-primary" id="btn-nuevo-producto">Nuevo Producto</button>' : ''}
        </div>

        <div class="productos-tabs">
          <button class="tab-btn active" data-tab="categorias">Categorías</button>
          <button class="tab-btn" data-tab="productos">Productos</button>
          <button class="tab-btn" data-tab="stock">Stock</button>
        </div>

        <div class="tab-content active" id="tab-categorias">
          <div class="categorias-list" id="categorias-list"></div>
        </div>

        <div class="tab-content" id="tab-productos">
          <div class="productos-filters">
            <select id="filter-categoria">
              <option value="">Todas las categorías</option>
            </select>
            <input type="text" id="search-producto" placeholder="Buscar producto...">
          </div>
          <div class="table-container">
            <table id="productos-table">
              <thead>
                <tr>
                  <th>Imagen</th>
                  <th>Nombre</th>
                  <th>Categoría</th>
                  <th>Precio</th>
                  <th>IVA</th>
                  <th>Stock</th>
                  ${canEdit ? '<th>Acciones</th>' : ''}
                </tr>
              </thead>
              <tbody id="productos-tbody"></tbody>
            </table>
          </div>
        </div>

        <div class="tab-content" id="tab-stock">
          <div class="module-header">
            <h3>Stock</h3>
            ${canEdit ? '<button class="btn btn-primary" id="btn-guardar-stock-in-productos">Guardar Cambios</button>' : ''}
          </div>
          <div class="stock-filters">
            <select id="filter-categoria-stock-in-productos">
              <option value="">Todas las categorías</option>
            </select>
            <input type="text" id="search-stock-in-productos" placeholder="Buscar producto...">
          </div>
          <div class="table-container">
            <table id="stock-table-in-productos">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Categoría</th>
                  <th>Stock Actual</th>
                  ${canEdit ? '<th>Acciones</th>' : ''}
                </tr>
              </thead>
              <tbody id="stock-tbody-in-productos"></tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    renderCategorias();
    renderProductos();
    renderStockTab();
    setupTabs();
  }

  // Renderizar categorías
  function renderCategorias() {
    const list = document.getElementById('categorias-list');
    if (!list) return;

    if (categorias.length === 0) {
      list.innerHTML = '<p class="empty-message">No hay categorías. Crea una nueva categoría para comenzar.</p>';
      return;
    }

    const canEdit = currentSession?.role === 'administrador' || currentSession?.role === 'tecnico';

    list.innerHTML = categorias.map(cat => `
      <div class="categoria-item">
        <div class="categoria-image">
          ${cat.imagenUrl ? `<img src="${cat.imagenUrl}" alt="${cat.nombre}">` : '<div class="no-image">Sin imagen</div>'}
        </div>
        <div class="categoria-info">
          <h3>${escapeHtml(cat.nombre)}</h3>
          <p>${productos.filter(p => p.categoriaId === cat.id).length} productos</p>
        </div>
        ${canEdit ? `
          <div class="categoria-actions">
            <button class="btn btn-ghost btn-sm" onclick="ProductosModule.editarCategoria('${cat.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="ProductosModule.eliminarCategoria('${cat.id}')">Eliminar</button>
          </div>
        ` : ''}
      </div>
    `).join('');
  }

  // Renderizar productos
  function renderProductos(categoriaId = '', searchTerm = '') {
    const tbody = document.getElementById('productos-tbody');
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
      tbody.innerHTML = `<tr><td colspan="${canEdit ? 7 : 6}" class="empty-message">No hay productos</td></tr>`;
      return;
    }

    tbody.innerHTML = productosFiltrados.map(prod => {
      const categoria = categorias.find(c => c.id === prod.categoriaId);
      return `
        <tr>
          <td>
            ${prod.imagenUrl ? `<img src="${prod.imagenUrl}" alt="${prod.nombre}" class="producto-thumb">` : '-'}
          </td>
          <td>${escapeHtml(prod.nombre)}</td>
          <td>${categoria ? escapeHtml(categoria.nombre) : '-'}</td>
          <td>${formatEuro(prod.precio || 0)}</td>
          <td>${prod.iva || 0}%</td>
          <td class="${(prod.stock || 0) === 0 ? 'stock-zero' : (prod.stock || 0) <= 3 ? 'stock-bajo' : ''}">
            ${prod.stock || 0}
          </td>
          ${canEdit ? `
            <td>
              <button class="btn btn-ghost btn-sm" onclick="ProductosModule.editarProducto('${prod.id}')">Editar</button>
              <button class="btn btn-ghost btn-sm" onclick="ProductosModule.eliminarProducto('${prod.id}')">Eliminar</button>
            </td>
          ` : ''}
        </tr>
      `;
    }).join('');
  }

  // Configurar tabs
  function setupTabs() {
    const tabBtns = document.querySelectorAll('.productos-tabs .tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        document.querySelectorAll('.productos-module .tab-content').forEach(content => {
          content.classList.remove('active');
        });
        document.getElementById(`tab-${tab}`).classList.add('active');
      });
    });
  }

  // Configurar event listeners
  function setupEventListeners() {
    const canEdit = currentSession?.role === 'administrador' || currentSession?.role === 'tecnico';

    // Filtro categoría
    const filterCategoria = document.getElementById('filter-categoria');
    if (filterCategoria) {
      categorias.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.nombre;
        filterCategoria.appendChild(option);
      });
      filterCategoria.addEventListener('change', (e) => {
        renderProductos(e.target.value, document.getElementById('search-producto')?.value || '');
      });
    }

    // Búsqueda
    const searchProducto = document.getElementById('search-producto');
    if (searchProducto) {
      searchProducto.addEventListener('input', (e) => {
        renderProductos(filterCategoria?.value || '', e.target.value);
      });
    }

    // Filtros de stock dentro de productos
    setupStockFilters();

    if (!canEdit) return;

    // Nueva categoría
    const btnNuevaCategoria = document.getElementById('btn-nueva-categoria');
    if (btnNuevaCategoria) {
      btnNuevaCategoria.addEventListener('click', () => mostrarModalCategoria());
    }

    // Nuevo producto
    const btnNuevoProducto = document.getElementById('btn-nuevo-producto');
    if (btnNuevoProducto) {
      btnNuevoProducto.addEventListener('click', () => mostrarModalProducto());
    }

    // Guardar stock
    const btnGuardarStock = document.getElementById('btn-guardar-stock-in-productos');
    if (btnGuardarStock) {
      btnGuardarStock.addEventListener('click', guardarCambiosStock);
    }
  }

  // Renderizar stock (dentro de Productos)
  function renderStockTab(categoriaId = '', searchTerm = '') {
    const tbody = document.getElementById('stock-tbody-in-productos');
    if (!tbody) return;

    let productosFiltrados = productos;
    if (categoriaId) {
      productosFiltrados = productosFiltrados.filter(p => p.categoriaId === categoriaId);
    }
    if (searchTerm) {
      const term = String(searchTerm || '').toLowerCase();
      productosFiltrados = productosFiltrados.filter(p => (p.nombre || '').toLowerCase().includes(term));
    }

    const canEdit = currentSession?.role === 'administrador' || currentSession?.role === 'tecnico';

    if (productosFiltrados.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${canEdit ? 4 : 3}" class="empty-message">No hay productos</td></tr>`;
      return;
    }

    tbody.innerHTML = productosFiltrados.map(prod => {
      const categoria = categorias.find(c => c.id === prod.categoriaId);
      const stockActual = cambiosStockPendientes[prod.id] !== undefined
        ? cambiosStockPendientes[prod.id]
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
                <input type="number" class="stock-input" data-producto-id="${prod.id}" value="${stockActual}" min="0">
                <button class="btn-stock btn-plus" data-producto-id="${prod.id}">+</button>
                <button class="btn-stock btn-direct" data-producto-id="${prod.id}" title="Ajuste directo">📝</button>
              </div>
            </td>
          ` : ''}
        </tr>
      `;
    }).join('');

    if (!canEdit) return;

    tbody.querySelectorAll('.btn-minus').forEach(btn => {
      btn.addEventListener('click', (e) => ajustarStock(e.target.dataset.productoId, -1));
    });
    tbody.querySelectorAll('.btn-plus').forEach(btn => {
      btn.addEventListener('click', (e) => ajustarStock(e.target.dataset.productoId, 1));
    });
    tbody.querySelectorAll('.stock-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const productoId = e.target.dataset.productoId;
        const nuevoStock = parseInt(e.target.value, 10) || 0;
        cambiosStockPendientes[productoId] = Math.max(0, nuevoStock);
        renderStockTab(
          document.getElementById('filter-categoria-stock-in-productos')?.value || '',
          document.getElementById('search-stock-in-productos')?.value || ''
        );
      });
    });
    tbody.querySelectorAll('.btn-direct').forEach(btn => {
      btn.addEventListener('click', (e) => ajusteDirectoStock(e.target.dataset.productoId));
    });
  }

  function setupStockFilters() {
    const filterCategoria = document.getElementById('filter-categoria-stock-in-productos');
    if (filterCategoria && filterCategoria.options.length <= 1) {
      categorias.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = cat.nombre;
        filterCategoria.appendChild(option);
      });
      filterCategoria.addEventListener('change', (e) => {
        renderStockTab(e.target.value, document.getElementById('search-stock-in-productos')?.value || '');
      });
    }

    const searchStock = document.getElementById('search-stock-in-productos');
    if (searchStock) {
      searchStock.addEventListener('input', (e) => {
        renderStockTab(filterCategoria?.value || '', e.target.value);
      });
    }
  }

  function ajustarStock(productoId, delta) {
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;
    const stockActual = cambiosStockPendientes[productoId] !== undefined
      ? cambiosStockPendientes[productoId]
      : (producto.stock || 0);
    cambiosStockPendientes[productoId] = Math.max(0, stockActual + delta);
    renderStockTab(
      document.getElementById('filter-categoria-stock-in-productos')?.value || '',
      document.getElementById('search-stock-in-productos')?.value || ''
    );
  }

  function ajusteDirectoStock(productoId) {
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;
    const stockActual = cambiosStockPendientes[productoId] !== undefined
      ? cambiosStockPendientes[productoId]
      : (producto.stock || 0);
    const nuevoStock = prompt(`Nuevo stock para "${producto.nombre}":`, stockActual);
    if (nuevoStock === null) return;
    const stock = parseInt(nuevoStock, 10);
    if (!Number.isFinite(stock) || stock < 0) {
      alert('Introduce un número válido mayor o igual a 0');
      return;
    }
    cambiosStockPendientes[productoId] = stock;
    renderStockTab(
      document.getElementById('filter-categoria-stock-in-productos')?.value || '',
      document.getElementById('search-stock-in-productos')?.value || ''
    );
  }

  async function guardarCambiosStock() {
    const cambiosIds = Object.keys(cambiosStockPendientes);
    if (cambiosIds.length === 0) {
      alert('No hay cambios pendientes de stock');
      return;
    }
    if (!confirm(`¿Guardar ${cambiosIds.length} cambio(s) de stock?`)) return;

    cambiosIds.forEach((productoId) => {
      const producto = productos.find(p => p.id === productoId);
      if (producto) {
        producto.stock = cambiosStockPendientes[productoId];
      }
    });

    await window.mrsTpv.saveProductos(productos);
    cambiosStockPendientes = {};
    alert('Stock actualizado correctamente');
    renderProductos(
      document.getElementById('filter-categoria')?.value || '',
      document.getElementById('search-producto')?.value || ''
    );
    renderStockTab(
      document.getElementById('filter-categoria-stock-in-productos')?.value || '',
      document.getElementById('search-stock-in-productos')?.value || ''
    );
  }

  // Mostrar modal categoría
  function mostrarModalCategoria(categoriaId = null) {
    const categoria = categoriaId ? categorias.find(c => c.id === categoriaId) : null;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${categoria ? 'Editar' : 'Nueva'} Categoría</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-categoria">
            <div class="form-group">
              <label>Nombre *</label>
              <input type="text" id="categoria-nombre" value="${categoria?.nombre || ''}" required>
            </div>
            <div class="form-group">
              <label>Imagen</label>
              <div class="image-preview" id="categoria-image-preview">
                ${categoria?.imagenUrl ? `<img src="${categoria.imagenUrl}" alt="Preview">` : ''}
              </div>
              <button type="button" class="btn btn-ghost" id="btn-select-image">Seleccionar imagen</button>
              <input type="hidden" id="categoria-imagen-url" value="${categoria?.imagenUrl || ''}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-categoria">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Seleccionar imagen
    const btnSelectImage = modal.querySelector('#btn-select-image');
    btnSelectImage.addEventListener('click', async () => {
      const logoUrl = await window.mrsTpv.selectLogo();
      if (logoUrl) {
        document.getElementById('categoria-imagen-url').value = logoUrl;
        const preview = document.getElementById('categoria-image-preview');
        preview.innerHTML = `<img src="${logoUrl}" alt="Preview">`;
      }
    });

    // Cancelar
    modal.querySelector('#btn-cancelar-categoria').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Guardar
    modal.querySelector('#form-categoria').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('categoria-nombre').value.trim();
      const imagenUrl = document.getElementById('categoria-imagen-url').value.trim();

      if (!nombre) {
        alert('El nombre es obligatorio');
        return;
      }

      if (categoria) {
        categoria.nombre = nombre;
        categoria.imagenUrl = imagenUrl;
      } else {
        categorias.push({
          id: 'cat_' + Date.now(),
          nombre,
          imagenUrl
        });
      }

      await window.mrsTpv.saveCategorias(categorias);
      document.body.removeChild(modal);
      renderCategorias();
    });
  }

  // Mostrar modal producto
  function mostrarModalProducto(productoId = null) {
    const producto = productoId ? productos.find(p => p.id === productoId) : null;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${producto ? 'Editar' : 'Nuevo'} Producto</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-producto">
            <div class="form-group">
              <label>Nombre *</label>
              <input type="text" id="producto-nombre" value="${producto?.nombre || ''}" required>
            </div>
            <div class="form-group">
              <label>Categoría *</label>
              <select id="producto-categoria" required>
                <option value="">Seleccionar...</option>
              </select>
            </div>
            <div class="form-group">
              <label>Precio (€) *</label>
              <input type="number" id="producto-precio" value="${producto?.precio || ''}" step="0.01" min="0" required>
            </div>
            <div class="form-group">
              <label>IVA (%)</label>
              <input type="number" id="producto-iva" value="${producto?.iva || 21}" min="0" max="100">
            </div>
            <div class="form-group">
              <label>Stock inicial</label>
              <input type="number" id="producto-stock" value="${producto?.stock || 0}" min="0">
            </div>
            <div class="form-group">
              <label>Imagen</label>
              <div class="image-preview" id="producto-image-preview">
                ${producto?.imagenUrl ? `<img src="${producto.imagenUrl}" alt="Preview">` : ''}
              </div>
              <button type="button" class="btn btn-ghost" id="btn-select-product-image">Seleccionar imagen</button>
              <input type="hidden" id="producto-imagen-url" value="${producto?.imagenUrl || ''}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-producto">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Llenar categorías
    const selectCategoria = modal.querySelector('#producto-categoria');
    categorias.forEach(cat => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.nombre;
      if (producto && producto.categoriaId === cat.id) {
        option.selected = true;
      }
      selectCategoria.appendChild(option);
    });

    // Seleccionar imagen
    const btnSelectImage = modal.querySelector('#btn-select-product-image');
    btnSelectImage.addEventListener('click', async () => {
      const logoUrl = await window.mrsTpv.selectLogo();
      if (logoUrl) {
        document.getElementById('producto-imagen-url').value = logoUrl;
        const preview = document.getElementById('producto-image-preview');
        preview.innerHTML = `<img src="${logoUrl}" alt="Preview">`;
      }
    });

    // Cancelar
    modal.querySelector('#btn-cancelar-producto').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Guardar
    modal.querySelector('#form-producto').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = document.getElementById('producto-nombre').value.trim();
      const categoriaId = document.getElementById('producto-categoria').value;
      const precio = parseFloat(document.getElementById('producto-precio').value);
      const iva = parseFloat(document.getElementById('producto-iva').value) || 21;
      const stock = parseInt(document.getElementById('producto-stock').value) || 0;
      const imagenUrl = document.getElementById('producto-imagen-url').value.trim();

      if (!nombre || !categoriaId || isNaN(precio)) {
        alert('Completa todos los campos obligatorios');
        return;
      }

      if (producto) {
        producto.nombre = nombre;
        producto.categoriaId = categoriaId;
        producto.precio = precio;
        producto.iva = iva;
        producto.stock = stock;
        producto.imagenUrl = imagenUrl;
      } else {
        productos.push({
          id: 'prod_' + Date.now(),
          nombre,
          categoriaId,
          precio,
          iva,
          stock,
          imagenUrl
        });
      }

      await window.mrsTpv.saveProductos(productos);
      document.body.removeChild(modal);
      renderProductos();
      renderStockTab(
        document.getElementById('filter-categoria-stock-in-productos')?.value || '',
        document.getElementById('search-stock-in-productos')?.value || ''
      );
    });
  }

  // Editar categoría
  window.ProductosModule = window.ProductosModule || {};
  window.ProductosModule.editarCategoria = mostrarModalCategoria;

  // Eliminar categoría
  window.ProductosModule.eliminarCategoria = async function(categoriaId) {
    const categoria = categorias.find(c => c.id === categoriaId);
    if (!categoria) return;

    const productosEnCategoria = productos.filter(p => p.categoriaId === categoriaId);
    if (productosEnCategoria.length > 0) {
      alert(`No se puede eliminar la categoría porque tiene ${productosEnCategoria.length} productos asociados`);
      return;
    }

    if (!confirm(`¿Eliminar la categoría "${categoria.nombre}"?`)) return;

    categorias = categorias.filter(c => c.id !== categoriaId);
    await window.mrsTpv.saveCategorias(categorias);
    renderCategorias();
  };

  // Editar producto
  window.ProductosModule.editarProducto = mostrarModalProducto;

  // Eliminar producto
  window.ProductosModule.eliminarProducto = async function(productoId) {
    const producto = productos.find(p => p.id === productoId);
    if (!producto) return;

    if (!confirm(`¿Eliminar el producto "${producto.nombre}"?`)) return;

    productos = productos.filter(p => p.id !== productoId);
    delete cambiosStockPendientes[productoId];
    await window.mrsTpv.saveProductos(productos);
    renderProductos();
    renderStockTab(
      document.getElementById('filter-categoria-stock-in-productos')?.value || '',
      document.getElementById('search-stock-in-productos')?.value || ''
    );
  };

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
  window.ProductosModule.init = init;
})();
