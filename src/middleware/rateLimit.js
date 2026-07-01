'use strict';

const rateLimit = require('express-rate-limit');

module.exports = rateLimit({
  windowMs:        60 * 1000,  // ventana de 1 minuto
  max:             20,          // máx 20 solicitudes por IP por ventana
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { error: 'Demasiadas solicitudes. Intenta de nuevo en un minuto.' }
});
