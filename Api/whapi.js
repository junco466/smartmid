require("dotenv").config();

const WHAPI_TOKEN = process.env.WHAPI_TOKEN;

async function enviarMensaje(numero, mensaje) {
  const response = await fetch(
    "https://gate.whapi.cloud/messages/text",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHAPI_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        to: numero,
        body: mensaje
      }),
      // Si Whapi no responde en 15 s, se aborta para no dejar el webhook colgado.
      signal: AbortSignal.timeout(15000)
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Error Whapi: ${response.status} ${JSON.stringify(data)}`
    );
  }

  return data;
}

module.exports = {
  enviarMensaje
};