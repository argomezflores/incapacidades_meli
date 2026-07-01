'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const {
  requiredFields,
  isValidEmail,
  isValidDate,
  validateAttachment
} = require('../middleware/validate');

const WEBHOOK_URL    = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

router.post('/', async (req, res) => {
  const reqId = shortId();
  const data  = req.body || {};

  // ── Validación server-side de campos ──────────────────────
  const missing = requiredFields(data, ['nombre', 'operadorId', 'tipoIncidencia', 'fechaIncidente']);
  if (missing) return res.status(400).json({ success: false, error: missing });

  if (data.correo && !isValidEmail(data.correo)) {
    return res.status(400).json({ success: false, error: 'Correo electrónico inválido.' });
  }

  if (!isValidDate(data.fechaIncidente) || new Date(data.fechaIncidente) > new Date()) {
    return res.status(400).json({ success: false, error: 'Fecha del incidente inválida o futura.' });
  }

  // ── Validar archivo adjunto (tipo + tamaño + magic bytes) ─
  const fileCheck = validateAttachment(data.constanciaFileBase64, data.constanciaFileName);
  if (!fileCheck.ok) {
    return res.status(400).json({ success: false, error: fileCheck.error });
  }

  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error(`[submit:${reqId}] config faltante`);
    return res.status(500).json({ success: false, error: 'Servidor no configurado correctamente.' });
  }

  const payload = {
    action:               'submit',
    timestamp:            new Date().toISOString(),
    source:               'incapacidades-node-app',
    requestId:            reqId,
    nombre:               String(data.nombre).trim(),
    operadorId:           String(data.operadorId).replace(/\D/g, ''),
    nodo:                 String(data.nodo || '').trim().toUpperCase(),
    tipoIncidencia:       data.tipoIncidencia,
    fechaIncidente:       data.fechaIncidente,
    sigueOperando:        data.sigueOperando || 'no_especificado',
    descripcion:          String(data.descripcion || '').trim().slice(0, 500),
    correo:               String(data.correo || '').trim().toLowerCase(),
    telefono:             String(data.telefono || '').replace(/\D/g, ''),
    constanciaMedica:     data.constanciaMedica || 'no_especificado',
    constanciaFileBase64: data.constanciaFileBase64 || '',
    constanciaFileName:   data.constanciaFileName   || '',
    constanciaMime:       fileCheck.mime || '',
    constanciaSizeBytes:  fileCheck.sizeBytes || 0,
    imssData:             data.imssData || {}
  };

  try {
    const vfRes = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-secret-token': WEBHOOK_SECRET,
        'x-source':       'incapacidades-node-app',
        'x-request-id':   reqId
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    if (!vfRes.ok) {
      console.error(`[submit:${reqId}] VerdiFlows status=${vfRes.status}`);
      let upstreamError = 'Error al procesar la solicitud. Intenta de nuevo.';
      try {
        const errBody = await vfRes.json();
        if (errBody && typeof errBody.error === 'string') upstreamError = errBody.error;
      } catch { /* respuesta no-JSON */ }
      return res.status(vfRes.status === 400 ? 400 : 502).json({ success: false, error: upstreamError });
    }

    let vfData;
    try {
      vfData = await vfRes.json();
    } catch {
      console.error(`[submit:${reqId}] respuesta VerdiFlows no es JSON`);
      return res.status(502).json({ success: false, error: 'Respuesta inválida del servidor de procesamiento.' });
    }

    if (!vfData || !vfData.folio) {
      console.error(`[submit:${reqId}] VerdiFlows no devolvió folio`);
      return res.status(502).json({ success: false, error: 'No se generó folio. Contacta soporte.' });
    }

    return res.json({ success: true, folio: vfData.folio });

  } catch (err) {
    console.error(`[submit:${reqId}] fetch error: ${err.name}`);
    return res.status(502).json({ success: false, error: 'No se pudo conectar. Intenta de nuevo.' });
  }
});

module.exports = router;
