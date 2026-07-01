# Política de Seguridad — Bot Incapacidades MELI

Este documento describe los controles de seguridad implementados en el bot de reporte de incapacidades para drivers de Mercado Libre, los datos sensibles que se manejan, y las prácticas operativas que mantienen el servicio seguro.

---

## Contexto

El bot es un intermediario entre los drivers (que no tienen cuenta de Mercado Libre) y los workflows de procesamiento de MeLi (VerdiFlows / n8n). El form es deliberadamente público — accesible por link sin auth — para que cualquier driver con el enlace pueda reportar su incapacidad desde el celular.

Esta arquitectura nos obliga a blindar el servidor con controles defensivos: validación estricta de inputs, rate limiting real, mínimo footprint de datos, y apoyarnos en los controles anti-abuse existentes de la infraestructura MeLi.

---

## Lo que esta implementación protege

| Riesgo que se mitiga | Cómo se mitiga | Estándar al que se alinea |
|---|---|---|
| Ataques de denegación de servicio (DoS) por flood de requests | Rate limit real por IP del driver (20 req/min), límites de tamaño de payload por endpoint | OWASP A05:2021 — Security Misconfiguration |
| Upload de archivos maliciosos (malware disfrazado de PDF/foto) | Whitelist estricta de tipos (jpeg/png/webp/heic/heif/pdf), tamaño máx 8MB, verificación de magic bytes para confirmar contenido real | OWASP File Upload Cheat Sheet |
| Bypass de la validación de driver vía DevTools o Postman | Doble validación: client-side en el form + revalidación server-side en VerdiFlows contra BigQuery antes de procesar | OWASP A01:2021 — Broken Access Control |
| Exposición de datos personales y de salud en logs | Sanitización de logs (sin nombres, IDs, correos, diagnósticos, ni payloads completos) | LFPDPPP (Ley Federal de Protección de Datos Personales) |
| Colisión de folios entre incapacidades simultáneas | Generación centralizada en VerdiFlows con identificador único en lugar de aleatorio de 4 dígitos en Node | Integridad de datos |
| Fingerprinting por scanners de seguridad automatizados | Respuesta 404 limpia en rutas no existentes (en lugar de devolver el HTML del form) | OWASP A05:2021 — Security Misconfiguration |
| Inyección de inputs maliciosos en webhooks de VerdiFlows | Validación server-side estricta de todos los campos antes de reenviar (tipos, longitudes, formatos de fecha/email, sanitización numérica) | OWASP A03:2021 — Injection |
| Builds inconsistentes con versiones inseguras de dependencias | `package-lock.json` versionado + capacidad de correr `npm audit` para detectar CVEs conocidos | NIST SP 800-218 (SSDF) — PW.4 |
| Variables sensibles expuestas en el repo | `WEBHOOK_SECRET` vive sólo en env vars de Coolify/Render, `.env` está en `.gitignore` | OWASP A02:2021 — Cryptographic Failures |
| Headers de seguridad faltantes (clickjacking, MIME sniffing, etc.) | Helmet activo (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, X-DNS-Prefetch-Control) | OWASP Secure Headers Project |
| Comunicación insegura | HTTPS forzado por Coolify/Render con certificado válido | TLS 1.2+ |
| Bots y tráfico automatizado abusivo | Se apoya en los controles anti-abuse existentes en la infraestructura MeLi (gateway, WAF corporativo, monitoreo de tráfico anómalo) — el bot no reimplementa esos controles | Defense in depth |

---

## Datos sensibles que se manejan

| Categoría | Datos | Cómo se tratan |
|---|---|---|
| **PII básica** | Nombre, ID de operador, correo, teléfono | Validados y sanitizados antes de enviar. Nunca persisten en el server, nunca se escriben a logs. |
| **Datos de salud** | Tipo de incidencia, fecha, descripción, datos IMSS (NSS, folio, días, tipo) | Procesados sólo en memoria del request, enviados directo a VerdiFlows. No hay almacenamiento intermedio en el server. |
| **Documentos médicos** | Constancia médica (foto o PDF) | Validados por tipo (whitelist) y tamaño (≤8MB), verificación de magic bytes, transmitidos en base64 sobre HTTPS, almacenados sólo en infra MeLi (Google Drive corporativo) como respaldo. No persisten en el server. |

**Principio:** el server no es un sistema de registro. Es un pipe seguro entre el driver y VerdiFlows. La fuente de verdad y persistencia viven en MeLi.

---

## Cumplimiento

### LFPDPPP (Ley Federal de Protección de Datos Personales en Posesión de los Particulares)
- Aviso de privacidad referenciado en el form (paso 4)
- Datos de salud tratados conforme al principio de finalidad: sólo para gestionar la incidencia reportada
- Sin persistencia en el intermediario → la responsabilidad de retención y eliminación recae en los sistemas MeLi
- Logs sanitizados → no se acumula PII en el droplet

### OWASP Top 10 (2021)
Cobertura de A01 (Broken Access Control), A02 (Cryptographic Failures), A03 (Injection), A05 (Security Misconfiguration).

### NIST SSDF (Secure Software Development Framework, SP 800-218)
- **PW.4** (verify third-party software): `package-lock.json` versionado + `npm audit` mensual
- **PS.1** (protect code): repo privado, secretos sólo en env vars

---

## Reportar vulnerabilidades

Si encuentras una vulnerabilidad, **no abras un issue público**. Reporta directamente a:

- **Owner:** Rogelio Gómez — `andres.gomezflores@mercadolibre.com.mx`
- **Equipo MeLi InfoSec:** seguir el canal interno de reporte

Tiempo esperado de respuesta: 48 horas hábiles.

---

## Notas operativas

### Auditoría de dependencias (mensual)
```bash
cd server
npm audit
npm audit fix
```
Si `npm audit fix` no resuelve un CVE crítico, escalar antes del próximo deploy.

> Si estás detrás del proxy corporativo MeLi y npm falla con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, correr con `NODE_OPTIONS="--use-system-ca"`.

### Rotación de secretos
Cadencia recomendada: cada 6 meses, o inmediatamente tras cualquier sospecha de fuga.

1. Generar nuevo `WEBHOOK_SECRET` en VerdiFlows (nodo "Validar Token y Formatear")
2. Actualizar env var en Coolify/Render
3. Redeploy

### Monitoreo
- Endpoint `/health` para health checks (Coolify/Render lo usan automáticamente)
- Logs sólo contienen: timestamp, ruta, status code, mensaje genérico de error, `requestId` corto para correlación
- Para debugging profundo, correlacionar `requestId` con logs de VerdiFlows

---

## Lo que NO está implementado (decisiones conscientes)

| Control | Por qué se pospuso | Cuándo reevaluar |
|---|---|---|
| **Captcha en el form (hCaptcha/Turnstile)** | La infraestructura MeLi ya tiene controles anti-abuse (gateway, WAF, monitoreo). Añadir captcha sería duplicar controles y añadir fricción al driver. | Si vemos evidencia de tráfico automatizado abusivo que los controles existentes no filtren. |
| **Dead letter queue** (si VerdiFlows falla, los submits se pierden) | Trade-off de complejidad vs. probabilidad. VerdiFlows tiene su propio uptime alto y los drivers pueden reintentar. | Si vemos >0.5% de pérdidas en logs o quejas de drivers. |
| **Dockerfile con `--chown=node:node`** | Defense-in-depth marginal. El usuario `node` ya está activo, los archivos siendo owned por root no es vector de exploit real en este contexto. | Si pasamos auditoría externa que lo flagee. |
| **CSP con nonce** | El HTML actual usa scripts/styles inline. Implementar nonce requiere refactor del template. Sin entrada de usuario reflejada en el HTML, el riesgo de XSS es bajo. | Si añadimos renderizado dinámico de inputs del usuario. |
| **JWT de sesión entre `validate-driver` y `submit`** | Se reemplazó por revalidación en VerdiFlows (más simple, mismo efecto defensivo). | N/A — decisión final. |
| **Cloudflare/WAF propio** | Coolify/Render dan HTTPS suficiente. La infra MeLi ya provee WAF corporativo delante. | Si migramos a dominio propio fuera de MeLi. |

---

## Histórico de cambios

| Fecha | Cambio | Responsable |
|---|---|---|
| 2026-06-30 | Implementación inicial del blindaje (file validation, rate limit real, sanitización de logs, folio en VerdiFlows) | Rogelio Gómez |
