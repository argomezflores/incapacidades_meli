'use strict';

const express    = require('express');
const helmet     = require('helmet');
const path       = require('path');
const rateLimit  = require('./middleware/rateLimit');
const submitRoute = require('./routes/submit');
const driverRoute = require('./routes/driver');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Confiar en el reverse proxy (Coolify/Render) para leer la IP real ─
app.set('trust proxy', 1);

// ── Security headers ───────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false // form embeds inline styles/scripts
}));

// ── Rate limiting en rutas API ─────────────────────────────
app.use('/api', rateLimit);

// ── Rutas API con body limits por ruta ─────────────────────
app.use('/api/submit',          express.json({ limit: '25mb' }), submitRoute);
app.use('/api/validate-driver', express.json({ limit: '10kb' }), driverRoute);

// ── Health check (Coolify/Render lo usa para saber si el app vive)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Archivos estáticos (el formulario HTML en /) ───────────
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── 404 para cualquier otra ruta (no devolver el form) ─────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Bot Incapacidades — puerto ${PORT} — ${new Date().toISOString()}`);
});
