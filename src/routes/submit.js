'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const {
  requiredFields,
  isValidEmail,
  isValidDate,
  validateAttachments
} = require('../middleware/validate');

const WEBHOOK_URL    = process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const DRIVE_URL      = process.env.DRIVE_WEBHOOK_URL;

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

// Fire-and-forget: sube archivos al Drive sub-workflow sin bloquear la respuesta
function fireDriveUpload(files, folio, operadorId) {
  if (!DRIVE_URL || !files || files.length === 0) return;

  files.forEach((f, idx) => {
    const fileNo = idx + 1;
    const ext    = f.fileName.split('.').pop().toLowerCase();
    const name   = files.length > 1
      ? `${folio}_${operadorId}_${fileNo}.${ext}`
      : `${folio}_${operadorId}.${ext}`;

    fetch(DRIVE_URL, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-secret-token': WEBHOOK_SECRET
      },
      body: JSON.stringify({
        folio,
        base64:    f.pureBase64,  // sin prefijo data URI
        fileName:  name,
        mime:      f.mime,
        fileIndex: fileNo
      }),
      signal: AbortSignal.timeout(30000)
    }).catch(() => {});
  });
}

router.post('/', async (req, res) => {
  const reqId = shortId();
  const data  = req.body || {};

  // ── Validación campos requeridos ──────────────────────────
  const missing = requiredFields(data, ['nombre', 'operadorId', 'tipoIncidencia', 'fechaIncidente']);
  if (missing) return res.status(400).json({ success: false, error: missing });

  if (data.correo && !isValidEmail(data.correo)) {
    return res.status(400).json({ success: false, error: 'Correo electrónico inválido.' });
  }

  if (!isValidDate(data.fechaIncidente) || new Date(data.fechaIncidente) > new Date()) {
    return res.status(400).json({ success: false, error: 'Fecha del incidente inválida o futura.' });
  }

  // ── Validar archivos adjuntos ─────────────────────────────
  // Acepta array constancias[] (nuevo) o campo suelto legacy para compatibilidad
  let constanciasInput = data.constancias;
  if (!Array.isArray(constanciasInput) && data.constanciaFileBase64) {
    constanciasInput = [{ base64: data.constanciaFileBase64, fileName: data.constanciaFileName || 'constancia' }];
  }

  const filesCheck = validateAttachments(constanciasInput);
  if (!filesCheck.ok) {
    return res.status(400).json({ success: false, error: filesCheck.error });
  }
  const files = filesCheck.files;

  if (!WEBHOOK_URL || !WEBHOOK_SECRET) {
    console.error(`[submit:${reqId}] config faltante`);
    return res.status(500).json({ success: false, error: 'Servidor no configurado correctamente.' });
  }

  const operadorId = String(data.operadorId).replace(/\D/g, '');

  // ── Payload a VerdiFlows — SIN base64 ─────────────────────
  // El base64 nunca llega a VerdiFlows: evita el crash por fuel limit en Python WASM
  const payload = {
    action:           'submit',
    timestamp:        new Date().toISOString(),
    source:           'incapacidades-node-app',
    requestId:        reqId,
    nombre:           String(data.nombre).trim(),
    operadorId,
    nodo:             String(data.nodo || '').trim().toUpperCase(),
    tipoIncidencia:   data.tipoIncidencia,
    fechaIncidente:   data.fechaIncidente,
    sigueOperando:    data.sigueOperando || 'no_especificado',
    descripcion:      String(data.descripcion || '').trim().slice(0, 500),
    correo:           String(data.correo || '').trim().toLowerCase(),
    telefono:         String(data.telefono || '').replace(/\D/g, ''),
    constanciaMedica: data.constanciaMedica || 'no_especificado',
    constanciaCount:  files.length,
    constanciaNames:  files.map(f => f.fileName).join(', '),
    imssData:         data.imssData || {}
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

    // ── Upload Drive (fire-and-forget, no bloquea la respuesta al usuario) ──
    fireDriveUpload(files, vfData.folio, operadorId);

    return res.json({ success: true, folio: vfData.folio });

  } catch (err) {
    console.error(`[submit:${reqId}] fetch error: ${err.name}`);
    return res.status(502).json({ success: false, error: 'No se pudo conectar. Intenta de nuevo.' });
  }
});

module.exports = router;
