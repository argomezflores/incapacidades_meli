'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const WEBHOOK_VALIDATE_URL = process.env.WEBHOOK_VALIDATE_URL;
const WEBHOOK_SECRET       = process.env.WEBHOOK_SECRET;

function shortId() {
  return crypto.randomBytes(4).toString('hex');
}

router.post('/', async (req, res) => {
  const reqId = shortId();
  const { operadorId } = req.body || {};
  const cleanId = String(operadorId || '').replace(/\D/g, '');

  if (!cleanId || cleanId.length < 4) {
    return res.json({ valid: false, error: 'ID inválido. Debe ser numérico.' });
  }

  if (!WEBHOOK_VALIDATE_URL || !WEBHOOK_SECRET) {
    console.error(`[driver:${reqId}] config faltante`);
    return res.json({ valid: false, error: 'Servicio de validación no configurado.' });
  }

  try {
    const vfRes = await fetch(WEBHOOK_VALIDATE_URL, {
      method:  'POST',
      headers: {
        'Content-Type':   'application/json',
        'x-secret-token': WEBHOOK_SECRET,
        'x-source':       'incapacidades-node-app',
        'x-request-id':   reqId
      },
      body:   JSON.stringify({ operadorId: cleanId }),
      signal: AbortSignal.timeout(8000)
    });

    if (!vfRes.ok) {
      console.error(`[driver:${reqId}] VerdiFlows status=${vfRes.status}`);
      return res.json({ valid: false, error: 'Error al verificar ID.' });
    }

    const data = await vfRes.json();
    return res.json(data);

  } catch (err) {
    console.error(`[driver:${reqId}] fetch error: ${err.name}`);
    return res.json({ valid: false, error: 'Servicio de validación no disponible.' });
  }
});

module.exports = router;
