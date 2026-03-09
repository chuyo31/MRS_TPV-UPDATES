# Checkpoint MRS_TPV - 2026-03-08

Estado guardado como punto de control funcional.

## Estado general

- La aplicacion esta estable en los flujos principales trabajados en esta sesion.
- Se corrigieron inconsistencias de nombre/rol entre topbar, sesion y Ajustes.
- Login permite usuario o email + contrasena.
- Branding por tema aplicado (logo o nombre, no ambos) en topbar/login.

## Historial

- `Ver ticket` ya no muestra JSON crudo; renderiza ticket visual estilo termico.
- Ticket muestra `ATENDIDO POR` justo debajo de `PAGO`.
- `Ver factura` muestra plantilla visual renovada.
- En `Ver factura` se agregaron acciones:
  - Imprimir
  - Guardar PDF
- Facturas rectificadas se visualizan con jerarquia (fila origen + fila rectificativa sangrada/flecha).
- Ajuste fino de alineacion de la fila rectificativa realizado.

## Reglas de negocio bloqueadas (facturacion/rectificacion)

- Un ticket no se puede facturar mas de una vez.
- Una factura no se puede rectificar mas de una vez.
- No se permite rectificar facturas rectificativas.
- Botones y validacion interna sincronizados para evitar duplicados.

## Plantilla factura estilo imagen de referencia

- Se adapto el estilo en:
  - Exportacion PDF en modulo Documentos.
  - Vista de factura en modulo Historial.

## Nota

Este checkpoint documenta el estado actual "funcionando" solicitado por el usuario.
