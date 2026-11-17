require("dotenv").config();

// Todas las fechas y horas se calculan con la hora de Colombia.
process.env.TZ = process.env.TZ || "America/Bogota";

const fs = require("fs");
const path = require("path");
const express = require("express");

const { enviarMensaje } = require("./whapi");
const { procesarMensaje } = require("./src/bot");
const { normalizarTelefono } = require("./src/utils");
const rutasApi = require("./src/rutas");

const app = express();

app.use(express.json());

// API REST que usa el panel web.
app.use("/api", rutasApi);

// Página web (pacientes + panel), servida desde el mismo servidor: sin CORS y con una sola URL.
const WEB = path.join(__dirname, "..", "Homepage");

// Cada arranque (cada despliegue) agrega una versión a los archivos que usa index.html
// (styles.css?v=..., script.js?v=..., imágenes). Así el navegador descarga los nuevos
// aunque tenga guardados los viejos en caché (Cloudflare les da 4 horas).
const VERSION = Date.now().toString(36);
const indexHtml = fs
  .readFileSync(path.join(WEB, "index.html"), "utf8")
  .replace(/(href|src)="(styles\.css|script\.js|favicon\.ico|img\/[^"?]+)"/g, `$1="$2?v=${VERSION}"`);
app.get(["/", "/index.html"], (req, res) => {
  res.set("Cache-Control", "no-cache");
  res.type("html").send(indexHtml);
});

app.use(express.static(WEB));

// Ids de mensajes ya procesados, para ignorar reintentos de Whapi.
const procesados = new Set();
function yaProcesado(id) {
  if (!id) return false;
  if (procesados.has(id)) return true;
  procesados.add(id);
  if (procesados.size > 1000) procesados.delete(procesados.values().next().value);
  return false;
}

// WEBHOOK DE WHAPI
// Si WHAPI_WEBHOOK_SECRET está definido, la URL configurada en Whapi debe ser
// /webhook/whapi?secreto=<valor>, así nadie más puede inyectar mensajes.
app.post("/webhook/whapi", async (req, res) => {
  const secreto = process.env.WHAPI_WEBHOOK_SECRET;
  if (secreto && req.query.secreto !== secreto) return res.sendStatus(401);

  // Responde inmediatamente a Whapi para confirmar la recepción del webhook.
  res.sendStatus(200);

  const mensajes = req.body?.messages || [];

  // Procesa todos los mensajes recibidos en el webhook.
  for (const mensaje of mensajes) {
    // Ignora los mensajes enviados por la propia cuenta, los de grupos y los repetidos.
    if (mensaje.from_me) continue;
    if (!String(mensaje.chat_id || "").endsWith("@s.whatsapp.net")) continue;
    if (yaProcesado(mensaje.id)) continue;

    // Solo procesa mensajes de texto.
    if (mensaje.type !== "text") continue;

    const numero = normalizarTelefono(mensaje.chat_id);
    const texto = mensaje.text?.body;

    // Ignora mensajes que no contengan texto.
    if (!texto) continue;

    // Un error con un mensaje no detiene el resto.
    try {
      console.log(`Mensaje de ${numero}: ${texto}`);
      const respuesta = procesarMensaje(numero, texto);
      await enviarMensaje(numero, respuesta);
    } catch (error) {
      console.error(`Error procesando el mensaje de ${numero}:`, error);
    }
  }
});

// Endpoint utilizado para comprobar que el servidor está funcionando.
app.get("/salud", (req, res) => {
  res.json({ ok: true, servicio: "Smart Mind", hora: new Date().toString() });
});

// Errores no controlados (incluye JSON mal formado).
app.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed") return res.status(400).json({ error: "El cuerpo de la petición no es JSON válido." });
  console.error(error);
  res.status(500).json({ error: "Error interno del servidor." });
});

// Define el puerto del servidor utilizando la variable de entorno PORT
// o el puerto 3000 como valor predeterminado.
const PORT = process.env.PORT || 3000;

// Inicia el servidor.
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});
