/**
 * Módulo Clientes - Gestión de clientes
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  let clientes = [];
  let currentSession = null;

  // Inicializar módulo
  async function init() {
    currentSession = await window.mrsTpv.getSession();
    await loadData();
    render();
    setupEventListeners();
  }

  // Cargar datos
  async function loadData() {
    clientes = await window.mrsTpv.getClientes() || [];
  }

  // Renderizar interfaz
  function render() {
    const content = document.getElementById('module-content');
    if (!content) return;

    content.innerHTML = `
      <div class="clientes-module">
        <div class="module-header">
          <h2>Gestión de Clientes</h2>
          <button class="btn btn-primary" id="btn-nuevo-cliente">Nuevo Cliente</button>
        </div>

        <div class="clientes-filters">
          <input type="text" id="search-cliente" placeholder="Buscar cliente...">
        </div>

        <div class="table-container">
          <table id="clientes-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Nombre / Razón Social</th>
                <th>CIF/NIF</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="clientes-tbody"></tbody>
          </table>
        </div>
      </div>
    `;

    renderClientes();
  }

  // Renderizar clientes
  function renderClientes(searchTerm = '') {
    const tbody = document.getElementById('clientes-tbody');
    if (!tbody) return;

    let clientesFiltrados = clientes;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      clientesFiltrados = clientesFiltrados.filter(c => 
        (c.nombre || '').toLowerCase().includes(term) ||
        (c.razonSocial || '').toLowerCase().includes(term) ||
        (c.cif || '').toLowerCase().includes(term) ||
        (c.email || '').toLowerCase().includes(term) ||
        (c.telefono || '').includes(term)
      );
    }

    if (clientesFiltrados.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-message">No hay clientes</td></tr>';
      return;
    }

    tbody.innerHTML = clientesFiltrados.map(cliente => {
      const nombreCompleto = cliente.tipo === 'empresa' 
        ? (cliente.razonSocial || cliente.nombreComercial || cliente.nombre)
        : cliente.nombre;
      
      return `
        <tr>
          <td>${cliente.tipo === 'empresa' ? 'Empresa' : 'Particular'}</td>
          <td>${escapeHtml(nombreCompleto || '-')}</td>
          <td>${escapeHtml(cliente.cif || '-')}</td>
          <td>${escapeHtml(cliente.telefono || '-')}</td>
          <td>${escapeHtml(cliente.email || '-')}</td>
          <td>
            <button class="btn btn-ghost btn-sm" onclick="ClientesModule.editarCliente('${cliente.id}')">Editar</button>
            <button class="btn btn-ghost btn-sm" onclick="ClientesModule.eliminarCliente('${cliente.id}')">Eliminar</button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Configurar event listeners
  function setupEventListeners() {
    // Nuevo cliente
    const btnNuevoCliente = document.getElementById('btn-nuevo-cliente');
    if (btnNuevoCliente) {
      btnNuevoCliente.addEventListener('click', () => mostrarModalCliente());
    }

    // Búsqueda
    const searchCliente = document.getElementById('search-cliente');
    if (searchCliente) {
      searchCliente.addEventListener('input', (e) => {
        renderClientes(e.target.value);
      });
    }
  }

  // Mostrar modal cliente
  function mostrarModalCliente(clienteId = null) {
    const cliente = clienteId ? clientes.find(c => c.id === clienteId) : null;
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">${cliente ? 'Editar' : 'Nuevo'} Cliente</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">
          <form id="form-cliente">
            <div class="form-group">
              <label>Tipo *</label>
              <select id="cliente-tipo" required>
                <option value="particular" ${cliente?.tipo === 'particular' ? 'selected' : ''}>Particular</option>
                <option value="empresa" ${cliente?.tipo === 'empresa' ? 'selected' : ''}>Empresa</option>
              </select>
            </div>
            <div class="form-group" id="group-nombre">
              <label>Nombre *</label>
              <input type="text" id="cliente-nombre" value="${cliente?.nombre || ''}" required>
            </div>
            <div class="form-group" id="group-razon-social" style="display: none;">
              <label>Razón Social *</label>
              <input type="text" id="cliente-razon-social" value="${cliente?.razonSocial || ''}">
            </div>
            <div class="form-group" id="group-nombre-comercial" style="display: none;">
              <label>Nombre Comercial</label>
              <input type="text" id="cliente-nombre-comercial" value="${cliente?.nombreComercial || ''}">
            </div>
            <div class="form-group">
              <label>CIF/NIF</label>
              <input type="text" id="cliente-cif" value="${cliente?.cif || ''}">
            </div>
            <div class="form-group">
              <label>Dirección</label>
              <input type="text" id="cliente-direccion" value="${cliente?.direccion || ''}">
            </div>
            <div class="form-group">
              <label>Teléfono</label>
              <input type="tel" id="cliente-telefono" value="${cliente?.telefono || ''}">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" id="cliente-email" value="${cliente?.email || ''}">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-ghost" id="btn-cancelar-cliente">Cancelar</button>
              <button type="submit" class="btn btn-primary">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Mostrar/ocultar campos según tipo
    const tipoSelect = modal.querySelector('#cliente-tipo');
    const groupNombre = modal.querySelector('#group-nombre');
    const groupRazonSocial = modal.querySelector('#group-razon-social');
    const groupNombreComercial = modal.querySelector('#group-nombre-comercial');
    const nombreInput = modal.querySelector('#cliente-nombre');
    const razonSocialInput = modal.querySelector('#cliente-razon-social');

    function toggleCampos() {
      const tipo = tipoSelect.value;
      if (tipo === 'empresa') {
        groupNombre.style.display = 'none';
        groupRazonSocial.style.display = 'block';
        groupNombreComercial.style.display = 'block';
        razonSocialInput.required = true;
        nombreInput.required = false;
      } else {
        groupNombre.style.display = 'block';
        groupRazonSocial.style.display = 'none';
        groupNombreComercial.style.display = 'none';
        nombreInput.required = true;
        razonSocialInput.required = false;
      }
    }

    tipoSelect.addEventListener('change', toggleCampos);
    toggleCampos();

    // Cancelar
    modal.querySelector('#btn-cancelar-cliente').addEventListener('click', () => {
      document.body.removeChild(modal);
    });
    modal.querySelector('.modal-close').addEventListener('click', () => {
      document.body.removeChild(modal);
    });

    // Guardar
    modal.querySelector('#form-cliente').addEventListener('submit', async (e) => {
      e.preventDefault();
      const tipo = document.getElementById('cliente-tipo').value;
      const nombre = document.getElementById('cliente-nombre').value.trim();
      const razonSocial = document.getElementById('cliente-razon-social').value.trim();
      const nombreComercial = document.getElementById('cliente-nombre-comercial').value.trim();
      const cif = document.getElementById('cliente-cif').value.trim();
      const direccion = document.getElementById('cliente-direccion').value.trim();
      const telefono = document.getElementById('cliente-telefono').value.trim();
      const email = document.getElementById('cliente-email').value.trim();

      if (tipo === 'particular' && !nombre) {
        alert('El nombre es obligatorio');
        return;
      }

      if (tipo === 'empresa' && !razonSocial) {
        alert('La razón social es obligatoria');
        return;
      }

      if (cliente) {
        cliente.tipo = tipo;
        cliente.nombre = nombre;
        cliente.razonSocial = razonSocial;
        cliente.nombreComercial = nombreComercial;
        cliente.cif = cif;
        cliente.direccion = direccion;
        cliente.telefono = telefono;
        cliente.email = email;
      } else {
        clientes.push({
          id: 'cli_' + Date.now(),
          tipo,
          nombre,
          razonSocial,
          nombreComercial,
          cif,
          direccion,
          telefono,
          email
        });
      }

      await window.mrsTpv.saveClientes(clientes);
      document.body.removeChild(modal);
      renderClientes();
    });
  }

  // Editar cliente
  window.ClientesModule = window.ClientesModule || {};
  window.ClientesModule.editarCliente = mostrarModalCliente;

  // Eliminar cliente
  window.ClientesModule.eliminarCliente = async function(clienteId) {
    const cliente = clientes.find(c => c.id === clienteId);
    if (!cliente) return;

    const nombreCompleto = cliente.tipo === 'empresa' 
      ? (cliente.razonSocial || cliente.nombreComercial || cliente.nombre)
      : cliente.nombre;

    if (!confirm(`¿Eliminar el cliente "${nombreCompleto}"?`)) return;

    clientes = clientes.filter(c => c.id !== clienteId);
    await window.mrsTpv.saveClientes(clientes);
    renderClientes();
  };

  // Utilidades
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Exportar función de inicialización
  window.ClientesModule.init = init;
})();
