require("dotenv").config();

const express = require("express");

const { enviarMensaje } = require("./whapi");

const {
  horariosDisponibles,
  crearCita,
  buscarCitas,
  cancelarCita
} = require("./database");

const app = express();

app.use(express.json());

// Almacena temporalmente el estado de la conversación de cada paciente.
const sesiones = new Map();

// Elimina el identificador de WhatsApp del número de teléfono.
function normalizarTelefono(chatId) {
  return chatId.replace("@s.whatsapp.net", "");
}

// Genera el menú principal del asistente.
function menu() {
  return `¡Hola! Soy Smart Mind, el asistente de la clínica odontológica.

¿En qué te puedo ayudar?

1️⃣ Agendar una cita
2️⃣ Cancelar una cita
3️⃣ Ver mis citas

Escribe el número de la opción.`;
}

// Verifica que la fecha tenga un formato válido y que exista.
function esFechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return false;
  }

  const [year, month, day] = fecha.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

// Verifica que la fecha sea válida y que no sea anterior al día actual.
function esFechaFutura(fecha) {
  if (!esFechaValida(fecha)) return false;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const fechaIngresada = new Date(`${fecha}T00:00:00`);

  return fechaIngresada >= hoy;
}

// Verifica que la hora esté dentro de los horarios permitidos por la clínica.
function esHoraValida(hora) {
  return [
    "09:00",
    "10:00",
    "11:00",
    "14:00",
    "15:00",
    "16:00"
  ].includes(hora);
}

// Procesa los mensajes recibidos y determina la respuesta según el estado de la conversación.
async function procesarMensaje(numero, texto) {
  const mensaje = texto.trim().toLowerCase();
  const sesion = sesiones.get(numero);

  // Inicia una nueva conversación o regresa al menú principal.
  if (!sesion || mensaje === "menu" || mensaje === "hola") {
    sesiones.set(numero, { paso: "menu" });
    return menu();
  }

  // Procesa las opciones del menú principal.
  if (sesion.paso === "menu") {
    // Opción 1: iniciar el proceso para agendar una cita.
    if (mensaje === "1") {
      sesiones.set(numero, {
        paso: "nombre"
      });

      return "Perfecto. ¿Cuál es tu nombre completo?";
    }

    // Opción 2: consultar las citas existentes para poder cancelar una.
    if (mensaje === "2") {
      const citas = buscarCitas(numero);

      if (citas.length === 0) {
        return "No tienes citas confirmadas para cancelar.";
      }

      sesiones.set(numero, {
        paso: "cancelar",
        citas
      });

      return [
        "Estas son tus citas:",
        "",
        ...citas.map(
          cita =>
            `${cita.id}. ${cita.fecha} a las ${cita.hora}`
        ),
        "",
        "Escribe el número de la cita que deseas cancelar."
      ].join("\n");
    }

    // Opción 3: mostrar las citas confirmadas del paciente.
    if (mensaje === "3") {
      const citas = buscarCitas(numero);

      if (citas.length === 0) {
        return "No tienes citas confirmadas.";
      }

      return [
        "Tus citas confirmadas:",
        "",
        ...citas.map(
          cita =>
            `📅 ${cita.fecha} a las ${cita.hora}`
        )
      ].join("\n");
    }

    return "Por favor, escribe 1, 2 o 3.";
  }

  // AGENDAR CITA: solicitar el nombre del paciente.
  if (sesion.paso === "nombre") {
    if (texto.trim().length < 2) {
      return "Por favor, escribe tu nombre completo.";
    }

    sesiones.set(numero, {
      paso: "fecha",
      nombre: texto.trim()
    });

    return `Gracias, ${texto.trim()}.

¿Para qué fecha deseas tu cita?

Escribe la fecha así:
AAAA-MM-DD

Ejemplo: 2026-09-21`;
  }

  // AGENDAR CITA: solicitar y validar la fecha.
  if (sesion.paso === "fecha") {
    const fecha = texto.trim();

    if (!esFechaFutura(fecha)) {
      return `La fecha no es válida o ya pasó.

Escribe una fecha futura con este formato:
AAAA-MM-DD`;
    }

    const horarios = horariosDisponibles(fecha);

    if (horarios.length === 0) {
      return "Lo siento, no hay horarios disponibles ese día. Escribe otra fecha.";
    }

    sesiones.set(numero, {
      ...sesion,
      paso: "hora",
      fecha,
      horarios
    });

    return [
      `Horarios disponibles para ${fecha}:`,
      "",
      ...horarios.map((hora, i) => `${i + 1}. ${hora}`),
      "",
      "Escribe la hora exacta, por ejemplo: 14:00"
    ].join("\n");
  }

  // AGENDAR CITA: solicitar y validar el horario elegido.
  if (sesion.paso === "hora") {
    const hora = texto.trim();

    if (!esHoraValida(hora) || !sesion.horarios.includes(hora)) {
      return [
        "Esa hora no está disponible.",
        "",
        "Horarios disponibles:",
        ...sesion.horarios,
        "",
        "Escribe una hora como 14:00."
      ].join("\n");
    }

    // Crea la cita en la base de datos.
    const id = crearCita(
      sesion.nombre,
      numero,
      sesion.fecha,
      hora
    );

    // Si no se obtiene un ID, significa que el horario ya no está disponible.
    if (!id) {
      return "Ese horario acaba de ser ocupado. Escribe menu para volver a empezar.";
    }

    // Finaliza la sesión después de registrar la cita correctamente.
    sesiones.delete(numero);

    return `✅ ¡Tu cita quedó registrada!

Paciente: ${sesion.nombre}
Fecha: ${sesion.fecha}
Hora: ${hora}

Número de cita: ${id}

Para volver al menú, escribe menu.`;
  }

  // CANCELAR CITA: procesa la selección de la cita que se desea cancelar.
  if (sesion.paso === "cancelar") {
    const id = Number(texto.trim());

    if (!Number.isInteger(id)) {
      return "Escribe el número de la cita que deseas cancelar.";
    }

    // Comprueba que la cita seleccionada pertenezca al paciente.
    const pertenece = sesion.citas.some(cita => cita.id === id);

    if (!pertenece) {
      return "Ese número no corresponde a una de tus citas.";
    }

    // Cancela la cita en la base de datos.
    const cancelada = cancelarCita(id, numero);

    // Finaliza la sesión después de procesar la cancelación.
    sesiones.delete(numero);

    if (!cancelada) {
      return "No se pudo cancelar la cita. Intenta nuevamente.";
    }

    return `✅ Tu cita número ${id} fue cancelada.

Si deseas agendar otra, escribe menu.`;
  }

  // Si el estado de la sesión no es reconocido, se reinicia la conversación.
  sesiones.delete(numero);

  return menu();
}

// WEBHOOK DE WHAPI
app.post("/webhook/whapi", async (req, res) => {
  // Responde inmediatamente a Whapi para confirmar la recepción del webhook.
  res.sendStatus(200);

  try {
    const mensajes = req.body.messages || [];

    // Procesa todos los mensajes recibidos en el webhook.
    for (const mensaje of mensajes) {
      // Ignora los mensajes enviados por la propia cuenta de WhatsApp.
      if (mensaje.from_me) continue;

      // Solo procesa mensajes de texto.
      if (mensaje.type !== "text") continue;

      const numero = normalizarTelefono(mensaje.chat_id);
      const texto = mensaje.text?.body;

      // Ignora mensajes que no contengan texto.
      if (!texto) continue;

      console.log(`Mensaje de ${numero}: ${texto}`);

      // Procesa el mensaje y obtiene la respuesta correspondiente.
      const respuesta = await procesarMensaje(numero, texto);

      // Envía la respuesta al paciente por WhatsApp.
      await enviarMensaje(numero, respuesta);
    }
  } catch (error) {
    // Registra cualquier error ocurrido durante el procesamiento del webhook.
    console.error("Error procesando webhook:", error);
  }
});

// Endpoint utilizado para comprobar que el servidor está funcionando.
app.get("/", (req, res) => {
  res.send("Smart Mind está funcionando 🚀");
});

// Define el puerto del servidor utilizando la variable de entorno PORT
// o el puerto 3000 como valor predeterminado.
const PORT = process.env.PORT || 3000;

// Inicia el servidor.
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en puerto ${PORT}`);
});