# Cómo iniciar Smart Mind con Whapi y ngrok

Guía para dejar funcionando el chatbot de WhatsApp y el panel. Todos los comandos son para **PowerShell** en Windows.

## Cómo encajan las piezas

```
Paciente (WhatsApp) ──► Whapi ──► ngrok (internet) ──► tu PC: servidor Node (puerto 3000)
                                                        ├─ /webhook/whapi   ← mensajes del bot
                                                        ├─ /api/...         ← datos del panel
                                                        └─ /                ← página web y panel
Servidor ──► Whapi ──► Paciente   (las respuestas del bot)
```

- **Whapi** conecta un número de WhatsApp con tu servidor. Cuando un paciente escribe, Whapi avisa al servidor (webhook), y el servidor responde usando el token de Whapi.
- **ngrok** le da a tu PC una dirección pública (`https://….ngrok-free.dev`), para que Whapi pueda llegar a tu servidor.
- **El servidor** (`Api/`) responde al chatbot, guarda las citas en `smartmind.db` y sirve la página web.

---

## 1. Lo que necesitas (una sola vez)

| Qué | Para qué | Cómo comprobarlo |
|---|---|---|
| **Node.js 22** o superior | Ejecutar el servidor | `node -v` debe mostrar `v22…` o más |
| **Cuenta de Whapi** con un canal conectado | El número de WhatsApp del bot | En [panel.whapi.cloud](https://panel.whapi.cloud) el canal aparece como conectado |
| **Token del canal de Whapi** | Que el servidor pueda enviar mensajes | Está en la página del canal, en el panel de Whapi |
| **ngrok** instalado y con tu cuenta | La dirección pública | `ngrok version` |
| **Dominio fijo de ngrok** | Que la dirección no cambie | El tuyo: `jaws-shuffling-congenial.ngrok-free.dev` |

### 1.1 Conectar el número a Whapi

1. Entra a [panel.whapi.cloud](https://panel.whapi.cloud) y abre tu canal.
2. Si no está conectado, escanea el código QR desde el WhatsApp del celular que será el bot (**Dispositivos vinculados → Vincular un dispositivo**).
3. Copia el **token** del canal. Es secreto: no lo compartas ni lo subas a internet.

> El número conectado a Whapi **es el bot**. Los mensajes que salen de ese número se ignoran, así que para probarlo hay que escribirle **desde otro celular**.

### 1.2 Registrar ngrok en tu PC

En el panel de ngrok ([dashboard.ngrok.com](https://dashboard.ngrok.com)) copia tu *authtoken* y ejecútalo una sola vez:

```powershell
ngrok config add-authtoken TU_AUTHTOKEN_DE_NGROK
```

---

## 2. Configurar el archivo `.env` (una sola vez)

El archivo `Api\.env` guarda los secretos. No se sube a git (está en `.gitignore`). Puedes partir de `Api\.env.example`.

```ini
WHAPI_TOKEN=el_token_de_tu_canal_de_whapi
PORT=3000
JWT_SECRET=un_texto_largo_y_aleatorio
WHATSAPP_NUMERO=573144914328
# Opcional pero recomendado (ver paso 5):
WHAPI_WEBHOOK_SECRET=
```

| Variable | Qué es |
|---|---|
| `WHAPI_TOKEN` | Token del canal de Whapi. Sin él, el bot recibe los mensajes pero no puede responder. |
| `PORT` | Puerto del servidor. Si no lo pones, es el 3000. ngrok debe usar el **mismo**. |
| `JWT_SECRET` | Firma las sesiones del panel. Ya se generó uno en tu `.env`. Si lo cambias, todos tienen que volver a iniciar sesión. |
| `WHATSAPP_NUMERO` | El número del bot, con 57 y sin `+`. Lo usan los botones "Escribir por WhatsApp" de la página. |
| `WHAPI_WEBHOOK_SECRET` | Si lo defines, solo se aceptan los mensajes que traigan ese secreto en la URL (evita mensajes falsos). |

Para generar un `JWT_SECRET` nuevo:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Instalar dependencias

La primera vez, y cada vez que bajes cambios nuevos del proyecto:

```powershell
cd C:\Users\Sistemas\Documents\SmartMind\Api; npm install
```

---

## 4. Arranque de cada día

Necesitas **dos ventanas de PowerShell** abiertas al mismo tiempo.

### Ventana 1 · El servidor

```powershell
cd C:\Users\Sistemas\Documents\SmartMind\Api; npm run dev
```

Debe mostrar:

```
Servidor ejecutándose en puerto 3000
```

`npm run dev` reinicia el servidor solo cada vez que cambias el código. Para dejarlo fijo usa `npm start`.

> **¿Base real o de pruebas?** Si en esa ventana escribiste antes `$env:DB_PATH="smartmind-pruebas.db"`, el servidor usa la base de pruebas. Para trabajar con la real, abre una ventana nueva o ejecuta `Remove-Item Env:DB_PATH` antes de `npm run dev`.

### Ventana 2 · ngrok

```powershell
ngrok http --url=jaws-shuffling-congenial.ngrok-free.dev 3000
```

En versiones antiguas de ngrok la opción se llama `--domain` en vez de `--url`. Si tu `PORT` no es 3000, cambia el número del final.

Debe mostrar una línea como:

```
Forwarding   https://jaws-shuffling-congenial.ngrok-free.dev -> http://localhost:3000
```

### Comprobar que todo responde

1. Abre `https://jaws-shuffling-congenial.ngrok-free.dev/salud` en el navegador. Debe mostrar `{"ok":true,"servicio":"Smart Mind",…}`.
   - Con ngrok gratuito, la primera vez puede aparecer una página de aviso de ngrok: haz clic en **Visit Site**. Ese aviso no afecta a Whapi.
2. Abre `http://127.0.0.1:4040`: es el inspector de ngrok, donde verás cada mensaje que llega de Whapi.

---

## 5. Configurar el webhook en Whapi (una vez, o si cambia la dirección)

1. En [panel.whapi.cloud](https://panel.whapi.cloud) abre tu canal y entra a la configuración (**Settings**) → **Webhooks**.
2. URL del webhook:

   ```
   https://jaws-shuffling-congenial.ngrok-free.dev/webhook/whapi
   ```

   Si definiste `WHAPI_WEBHOOK_SECRET` en el `.env`, agrégalo al final:

   ```
   https://jaws-shuffling-congenial.ngrok-free.dev/webhook/whapi?secreto=EL_MISMO_VALOR_DEL_ENV
   ```

3. Método **POST** y evento **messages** (mensajes entrantes). Los demás eventos no hacen falta.
4. Guarda.

Como tu dominio de ngrok es fijo, esto se hace una sola vez. Si algún día usas ngrok sin `--url`, la dirección cambia en cada arranque y hay que actualizarla aquí.

---

## 6. Probar que el bot responde

1. Desde **otro celular** (no el del bot), escribe `hola` al número del bot.
2. En pocos segundos debe llegar el menú de Smart Mind.
3. En la **ventana 1** aparece `Mensaje de 57…: hola`.
4. En el inspector de ngrok (`http://127.0.0.1:4040`) aparece `POST /webhook/whapi 200`.

Para probar conversaciones sin gastar mensajes, usa el simulador: panel → **Automatizaciones** → **Probar el chatbot** (ver [PRUEBAS.md](PRUEBAS.md), paso 15).

## 7. Abrir el panel

- Desde tu PC: `http://localhost:3000`
- Desde otro equipo: `https://jaws-shuffling-congenial.ngrok-free.dev`

> ⚠️ Con ngrok encendido, **el panel queda publicado en internet**. Antes de usarlo con pacientes reales, revisa la sección 10.

## 8. Apagar

En cada ventana presiona **Ctrl + C**. Primero ngrok y luego el servidor. Los datos quedan guardados en `Api\smartmind.db`.

---

## 9. Problemas frecuentes

| Qué pasa | Causa probable | Qué hacer |
|---|---|---|
| El bot no responde y la ventana 1 no muestra `Mensaje de…` | El mensaje no llega al servidor | Revisa que ngrok esté encendido, que la URL del webhook en Whapi sea exactamente la del paso 5 y mira el inspector `http://127.0.0.1:4040`. |
| El inspector de ngrok no muestra nada | Whapi no está enviando | Canal desconectado (vuelve a escanear el QR) o webhook mal configurado. |
| El inspector muestra `401` | El secreto no coincide | El `?secreto=` de la URL en Whapi debe ser igual a `WHAPI_WEBHOOK_SECRET` del `.env`. |
| La ventana 1 muestra `Mensaje de…` pero no llega la respuesta | Falla el envío por Whapi | Busca `Error Whapi: 401` (token equivocado) o `403/404` (canal). Revisa `WHAPI_TOKEN`. |
| Escribo desde el número del bot y no pasa nada | Es lo esperado | El bot ignora sus propios mensajes. Escribe desde otro celular. |
| `EADDRINUSE` al iniciar el servidor | El puerto ya está en uso | Hay otro servidor abierto (otra ventana). Ciérralo o cambia `PORT`, también en ngrok. |
| ngrok dice que el dominio ya está en uso | Hay otra sesión de ngrok abierta | Cierra la otra ventana de ngrok (o la sesión en otro equipo). |
| ngrok pide autenticación | Falta el authtoken | Repite el paso 1.2. |
| El panel dice *No se pudo conectar con el servidor* | El servidor está apagado | Vuelve a ejecutar la ventana 1. |
| El panel muestra datos de prueba | La ventana tiene `DB_PATH` | Ejecuta `Remove-Item Env:DB_PATH` y reinicia el servidor. |
| *Tu sesión expiró* en el panel | Pasaron 12 horas o cambió `JWT_SECRET` | Vuelve a iniciar sesión. |

## 10. Antes de usarlo con pacientes reales

- [ ] Define `WHAPI_WEBHOOK_SECRET` y actualiza la URL del webhook en Whapi (paso 5).
- [ ] Cambia la contraseña del administrador (`admin@smartmind.co` / `admin1234`): entra con esa cuenta y usa **Cambiar contraseña**, arriba junto al nombre. Guárdala en un lugar seguro: si la olvidas, nadie más puede restablecerla desde el panel.
- [ ] Cambia la de la cuenta de prueba `camila@smartmind.co` (o elimínala). El administrador asigna contraseñas a los odontólogos en **Equipo y servicios → Editar → Nueva contraseña**, y cada odontólogo puede cambiar la suya con **Cambiar contraseña**.
- [ ] Cuando alguien cambia su contraseña, o el administrador le asigna una, se cierran sus sesiones abiertas en otros equipos.
- [ ] Haz copias de seguridad de `Api\smartmind.db` con el servidor apagado; ese archivo es toda la información de la clínica.
- [ ] Recuerda que, mientras ngrok esté encendido, el panel es accesible desde internet.

---

## Resumen rápido

```powershell
# Ventana 1
cd C:\Users\Sistemas\Documents\SmartMind\Api; npm run dev
```

```powershell
# Ventana 2
ngrok http --url=jaws-shuffling-congenial.ngrok-free.dev 3000
```

- Webhook en Whapi: `https://jaws-shuffling-congenial.ngrok-free.dev/webhook/whapi`
- Comprobar: `https://jaws-shuffling-congenial.ngrok-free.dev/salud`
- Inspector de ngrok: `http://127.0.0.1:4040`
- Panel: `http://localhost:3000`
