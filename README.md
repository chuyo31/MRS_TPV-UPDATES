# MRS_TPV-CURSOR

Sistema TPV desktop (Electron + PocketBase) para tienda y servicio técnico, con gestión comercial completa, impresión, exportación y trazabilidad.

## Estado del proyecto

Versión funcional final con:

- TPV de venta (`Caja`) con ticket e impresión
- Gestión de clientes, productos, stock y usuarios
- Módulo de reparaciones con pedidos, notas y WhatsApp
- Gestión comercial (`Presupuestos`, `Albaranes`, `Facturas`)
- Historial con relaciones Ticket <-> Factura
- Exportación PDF/CSV
- Base Verifactu implementada (sin remisión AEAT)

## Stack técnico

- Electron (proceso `main` + renderer)
- JavaScript vanilla (IIFE por módulo)
- PocketBase embebido (SQLite interno)
- IPC seguro (`preload` + `contextBridge`)
- CSS responsive con tema claro/oscuro

## Requisitos

- Node.js 18 o superior
- Windows (entorno objetivo actual)
- `database/pocketbase.exe` disponible

## Instalación y ejecución

```bash
npm install
npm start
```

Build:

```bash
npm run build
```

## Estructura principal

- `main/main.js`: núcleo Electron, IPC, impresión, backup, licencias, PocketBase
- `preload/preload.js`: APIs expuestas al renderer
- `renderer/index.html`: shell de pantallas y dashboard
- `renderer/js/app.js`: arranque, sesión, navegación, carga de módulos
- `renderer/css/main.css`: estilos globales y de módulos
- `modules/*`: lógica funcional por módulo
- `database/pb_migrations/*`: migraciones de PocketBase

## Módulos

- `Caja`: venta rápida, categorías, búsqueda producto, ticket, cobro
- `Productos`: ABM productos/categorías
- `Stock`: ajustes y control
- `Clientes`: ABM clientes
- `Reparaciones`: órdenes, estados, notas, pedidos, historial pedidos
- `Gestión`: presupuestos/albaranes/facturas manuales
- `Historial`: tickets/facturas, impresión/PDF, rectificativas, trazabilidad
- `Documentos`: exportación masiva PDF/CSV
- `Ajustes`: empresa, tienda, usuarios, distribuidores, sistema
- `Verifactu Core`: registros fiscales, encadenado hash, QR y auditoría interna

## Funcionalidades clave implementadas

### Usuarios y roles

- Roles: `administrador`, `tecnico`, `dependiente`
- Persistencia robusta con fallback local de nombres y roles
- Login por usuario o email

### TPV y facturación

- Tickets con hash y datos de atención
- Bloqueo de doble facturación por ticket
- Rectificación única por factura original
- Vista e impresión profesional de facturas

### Reparaciones

- Estados visuales por color
- Panel redimensionable y layout adaptativo
- Pedidos a distribuidores por WhatsApp
- Historial de pedidos enviados (últimos 5 días por defecto + buscador)
- Notas de cliente con envío por WhatsApp
- Impresión y envío de resguardo por WhatsApp

### Configuración avanzada

- Logo dinámico con inversión según tema
- Checkboxes de contenido para ticket y factura
- Texto editable de declaración de depósito (resguardo)
- Gestión de distribuidores desde `Ajustes`

## Verifactu (alcance actual)

Implementado:

- Registro fiscal inalterable en JSON
- Hash encadenado (`hashAnterior` + registro actual)
- Leyenda Verifactu en documentos
- Datos QR fiscales
- Audit trail de eventos fiscales
- Bloqueo de edición directa de facturas emitidas

No implementado (a propósito):

- Remisión AEAT en tiempo real

## Persistencia de datos

Datos locales en `%APPDATA%` (JSON + PocketBase interno), incluyendo:

- configuración, sesión, clientes, tickets, facturas
- reparaciones, distribuidores, series
- registros fiscales y auditoría

## Backup y restauración

Disponible desde `Ajustes > Sistema`:

- Exportación completa
- Restauración completa

## Licencias

- Trial inicial (30 días)
- Activación por clave
- Validación criptográfica

## Notas de mantenimiento

- Arquitectura modular sin frameworks frontend
- Comunicación sensible via IPC
- Evitar cambios directos en JSON fuera de la app
- Revisar migraciones PocketBase antes de actualizar versión

## Licencia

MIT
