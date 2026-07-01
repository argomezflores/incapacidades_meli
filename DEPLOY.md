# DEPLOY — Bot Incapacidades

## Qué es esto

Aplicación Node.js standalone que sirve el formulario de reporte de incapacidades y lo conecta a los workflows de VerdiFlows (n8n MeLi). El servidor actúa **sólo como intermediario** — no almacena datos. Toda la persistencia y orquestación viven en VerdiFlows.

---

## 1. Prerequisitos

### Token de VerdiFlows
> VerdiFlows → **Incapacidades Intake** → nodo **"Validar Token y Formatear"** → variable `SECRET_TOKEN`

El mismo token vale para ambos workflows (intake y validate-driver).

---

## 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Llenar `WEBHOOK_SECRET` con el token de VerdiFlows. Las URLs de los webhooks ya están en `.env.example` y los workflows están activos.

---

## 3. Probar local con Docker

```bash
docker-compose up --build
```

La app corre en `http://localhost:3000`.

- Abre el formulario y completa los 4 pasos
- Verifica el ID `3129587` para confirmar que VerdiFlows responde
- Envía → debe devolver folio (`INC-YYMMDD-XXXXXX`)

Lo que funciona en Docker local **funciona igual en Coolify/Render** — mismo container.

Para logs en tiempo real:
```bash
docker-compose logs -f
```

---

## 4. Deploy en Coolify

### 4.1 Subir el repo
```bash
git init
git add .
git commit -m "Bot Incapacidades — initial deploy"
git remote add origin https://github.com/TU_USUARIO/bot-incapacidades.git
git push -u origin main
```

> ⚠️ **Antes del primer push**, asegúrate de que `package-lock.json` está commited. Sin él, `npm ci` del Dockerfile falla y el container no arranca.

### 4.2 Conectar en Coolify
1. Panel de Coolify → **New Resource** → **Application** → **Git Repository**
2. Seleccionar el repo
3. Coolify detecta el `Dockerfile` automáticamente
4. Branch: `main`

### 4.3 Environment Variables

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `WEBHOOK_URL` | `https://web.furycloud.io/api/proxy/verdi_flows/webhook/incapacidades-intake` |
| `WEBHOOK_VALIDATE_URL` | `https://web.furycloud.io/api/proxy/verdi_flows/webhook/incapacidades-validate-driver` |
| `WEBHOOK_SECRET` | *(token de VerdiFlows)* |

### 4.4 Deploy
Click en **Deploy**. Coolify asigna un dominio (algo como `https://bot-incapacidades.tu-server.coolify.app`).

---

## 5. Deploy en Render (alternativa / futuro)

1. New → **Web Service** → conectar GitHub repo
2. Render detecta el `Dockerfile` automáticamente
3. Plan: Starter (suficiente para tráfico de drivers)
4. **Environment** → añadir las mismas variables que en Coolify (Render setea `PORT` solo, no es necesario configurarlo)
5. Deploy

Render asigna dominio automático `https://bot-incapacidades.onrender.com`.

> ⚠️ **Vercel NO funciona** con esta arquitectura. Vercel es serverless y el server usa Express persistente. Si migran a Vercel, hay que reescribir los endpoints como funciones serverless.

---

## 6. Verificar deploy

```bash
curl https://TU-DOMINIO.app/health
# → {"status":"ok","ts":"..."}
```

Si responde, el server está vivo.

---

## 7. Prueba end-to-end

1. Abrir `https://TU-DOMINIO.app`
2. Ingresar un ID de driver válido → debe aparecer el nombre
3. Completar los 4 pasos
4. Enviar → debe recibir folio (`INC-YYMMDD-XXXXXX`)
5. Confirmar correo de notificación en `andres.gomezflores@mercadolibre.com.mx` desde VerdiFlows

---

## 8. Cambios requeridos en VerdiFlows

**Estos cambios se hacen en n8n, no en este repo.** Sin ellos el bot no funciona correctamente.

### 8.1 Workflow "Incapacidades Intake"

**a) Nodo "Validar Token y Formatear"** — quitar `folio` del body extraction. El folio ya no viene del client:

```python
# Quitar esta línea del return:
"folio": body.get("folio"),
```

**b) Añadir nodo "Generar Folio"** (Python code, después de "Validar Token y Formatear"):

```python
import datetime, secrets

now = datetime.datetime.utcnow() + datetime.timedelta(hours=-6)
yy = now.strftime('%y')
mm = now.strftime('%m')
dd = now.strftime('%d')
rand = secrets.token_hex(3).upper()  # 6 chars hex → 16.7M combinaciones

item = _input.first().json
item['folio'] = f'INC-{yy}{mm}{dd}-{rand}'
return [{'json': item}]
```

**c) Convertir el "BQ - Obtener CURP" en revalidación real.** Añadir un nodo IF después:
- Si `curp` es null o vacío → responder 400 `{"error": "ID de driver no válido"}` y cortar el flujo.
- Si `curp` existe → continuar al resto del workflow.

**d) Cambiar `responseMode` del webhook a `responseNode`** y añadir un nodo "Respond to Webhook" al final que devuelva:
```json
{ "folio": "{{ $('Generar Folio').item.json.folio }}", "success": true }
```

Hoy el `responseMode: "lastNode"` devuelve la respuesta de Gmail al server Node, lo cual no incluye el folio.

### 8.2 Workflow "Incapacidades - Driver Validation"

Este workflow ya está OK. Solo un detalle cosmético: hay dos nodos con el mismo nombre "Construir Respuesta Validación" (uno vacío placeholder). Se puede borrar el vacío pero no afecta funcionalidad.

---

## 9. Actualizaciones futuras

```bash
git add .
git commit -m "descripción del cambio"
git push
```

Coolify/Render detectan el push y hacen redeploy automático.

---

## 10. Estructura

```
├── public/index.html        ← El formulario (HTML standalone)
├── src/
│   ├── index.js             ← Server Express
│   ├── middleware/
│   │   ├── rateLimit.js     ← 20 req/min por IP
│   │   └── validate.js      ← Validación de campos y archivo
│   └── routes/
│       ├── submit.js        ← POST /api/submit → VerdiFlows intake
│       └── driver.js        ← POST /api/validate-driver → VerdiFlows validate
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── package-lock.json        ← REQUERIDO para que npm ci funcione
├── DEPLOY.md
└── SECURITY.md              ← Detalle de controles de seguridad implementados
```

---

## 11. Notas de seguridad

Ver [SECURITY.md](./SECURITY.md) para el detalle completo de los controles implementados (validación de archivos, rate limiting, LFPDPPP, OWASP Top 10, etc.).

Resumen:
- `WEBHOOK_SECRET` vive sólo en env vars del server
- Rate limiting real: 20 req/min por IP (`trust proxy` configurado para Coolify/Render)
- Validación server-side de archivos: whitelist de tipos + magic bytes + tamaño máx 8MB
- Logs sanitizados — no se persiste PII
- `.env` está en `.gitignore` — nunca se sube al repo

**Nota sobre spam/abuse:** este bot depende de los controles anti-abuse que MeLi ya tiene desplegados a nivel de infraestructura (gateway, WAF corporativo, monitoreo de tráfico anómalo). No se implementa captcha porque los controles existentes son suficientes para el volumen y perfil de tráfico esperado.

---

## 12. Mantenimiento

### Auditoría de dependencias
Correr mensualmente:
```bash
npm audit
npm audit fix
```

> Si estás detrás del proxy corporativo MeLi y npm da error `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, correr con `NODE_OPTIONS="--use-system-ca"` para usar el CA del sistema.

### Rotación de secretos
Recomendado cada 6 meses o tras cualquier sospecha de fuga:
1. Generar nuevo `WEBHOOK_SECRET` en VerdiFlows y actualizar env var en Coolify/Render
2. Redeploy
