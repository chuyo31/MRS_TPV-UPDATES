/**
 * Módulo Verifactu Core - Cumplimiento RD 1007/2023 + Orden HAC/1177/2024
 * Registros inalterables, encadenamiento criptográfico, QR fiscal
 * IIFE - Sin dependencias externas
 */

(function() {
  'use strict';

  const REGISTRO_TIPOS = {
    ALTA: 'alta',
    RECTIFICACION: 'rectificacion',
    ANULACION: 'anulacion'
  };

  let registroFiscalActual = null;
  let registrosFiscales = [];

  async function init() {
    await loadRegistrosFiscales();
    await ensureRegistroFiscalActual();
  }

  async function loadRegistrosFiscales() {
    try {
      registrosFiscales = await window.mrsTpv.getRegistrosFiscales() || [];
    } catch (_) {
      registrosFiscales = [];
    }
  }

  async function saveRegistrosFiscales() {
    try {
      await window.mrsTpv.saveRegistrosFiscales(registrosFiscales);
      return true;
    } catch (e) {
      console.error('Error guardando registros fiscales:', e);
      return false;
    }
  }

  async function ensureRegistroFiscalActual() {
    if (!registroFiscalActual) {
      const ultimo = registrosFiscales.length > 0 
        ? registrosFiscales[registrosFiscales.length - 1]
        : null;
      registroFiscalActual = {
        hashAnterior: ultimo?.hash || null,
        timestamp: new Date().toISOString()
      };
    }
    return registroFiscalActual;
  }

  async function calcularHashEncadenado(datosFactura, hashAnterior) {
    const str = JSON.stringify({
      numero: datosFactura.numero,
      fechaHora: datosFactura.fechaHora,
      clienteId: datosFactura.clienteId,
      base: datosFactura.base,
      total: datosFactura.total,
      hashAnterior: hashAnterior || null
    });
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'sha256:' + hashHex;
  }

  async function crearRegistroFiscal(tipo, factura, motivo = null) {
    await ensureRegistroFiscalActual();
    const hashAnterior = registroFiscalActual.hashAnterior;
    const hash = await calcularHashEncadenado(factura, hashAnterior);

    const registro = {
      id: 'reg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      tipo: tipo,
      timestamp: new Date().toISOString(),
      facturaId: factura.id,
      facturaNumero: factura.numero,
      hashAnterior: hashAnterior,
      hash: hash,
      datos: {
        numero: factura.numero,
        fechaHora: factura.fechaHora,
        clienteId: factura.clienteId,
        base: factura.base,
        total: factura.total,
        estado: factura.estado
      },
      motivo: motivo || null
    };

    registrosFiscales.push(registro);
    registroFiscalActual.hashAnterior = hash;
    await saveRegistrosFiscales();

    return registro;
  }

  function generarQRFiscal(factura, registroFiscal) {
    const datos = {
      v: '1.0',
      n: factura.numero,
      f: factura.fechaHora,
      h: registroFiscal?.hash || '',
      t: factura.total || 0,
      e: factura.estado || 'emitida'
    };
    return JSON.stringify(datos);
  }

  function generarLeyendaVerifactu() {
    return 'Sistema VERI*FACTU conforme RD 1007/2023';
  }

  function validarIntegridadRegistro(registro) {
    if (!registro?.hash || !registro?.hashAnterior) return { ok: true };
    const idx = registrosFiscales.findIndex(r => r.id === registro.id);
    if (idx <= 0) return { ok: true };
    const anterior = registrosFiscales[idx - 1];
    return {
      ok: anterior?.hash === registro.hashAnterior,
      error: anterior?.hash !== registro.hashAnterior ? 'Hash anterior no coincide' : null
    };
  }

  async function registrarAuditTrail(operacion, facturaId, facturaNumero, usuario, detalles = {}) {
    try {
      const auditTrail = await window.mrsTpv.getAuditTrail() || [];
      const entrada = {
        id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        operacion: operacion,
        facturaId: facturaId,
        facturaNumero: facturaNumero,
        usuario: usuario || 'sistema',
        detalles: detalles
      };
      auditTrail.push(entrada);
      await window.mrsTpv.saveAuditTrail(auditTrail);
      return entrada;
    } catch (e) {
      console.error('Error registrando audit trail:', e);
      return null;
    }
  }

  window.VerifactuCore = {
    init,
    crearRegistroFiscal,
    generarQRFiscal,
    generarLeyendaVerifactu,
    validarIntegridadRegistro,
    registrarAuditTrail,
    REGISTRO_TIPOS
  };
})();
