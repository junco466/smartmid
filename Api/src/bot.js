// Conversación del chatbot de WhatsApp.
// Versión puente: conserva el menú original, pero ya agenda sobre la misma base y las mismas
// reglas que el panel. El rediseño completo (motivo → especialista → procedimiento) es la fase 4.
const agenda = require('./agenda');
const { hoyISO, hhmm, aMin, esFechaValida, fmtCorta } = require('./utils');

// Mientras llega la fase 4, el bot agenda valoraciones con la odontóloga de primeras consultas.
const DOCTOR_BOT = process.env.BOT_DOCTOR || 'd1';
const PROC_BOT = 'val';

// Almacena temporalmente el estado de la conversación de cada paciente.
const sesiones = new Map();

// Genera el menú principal del asistente.
function menu() {
  return `¡Hola! Soy Smart Mind, el asistente de la clínica odontológica.

¿En qué te puedo ayudar?

1️⃣ Agendar una cita
2️⃣ Cancelar una cita
3️⃣ Ver mis citas

Escribe el número de la opción.`;
}

const citasActivas = numero => agenda.listarCitas({ telefono: numero, estado: 'programada', desde: hoyISO() });
const textoCita = c => `${fmtCorta(c.fecha)} a las ${hhmm(c.inicio)} · ${agenda.nombreProc(c.proc)}`;

// Horarios libres de ese día (cada 30 min, para que la lista sea corta).
function horariosDelDia(fecha, numero) {
  const p = agenda.procPor(PROC_BOT);
  return agenda.horariosLibres({ doctor: DOCTOR_BOT, proc: PROC_BOT, duracion: p.duracion, fecha, telefono: numero })
    .filter(t => t % 30 === 0)
    .map(hhmm);
}

// Procesa los mensajes recibidos y determina la respuesta según el estado de la conversación.
function procesarMensaje(numero, texto) {
  const mensaje = texto.trim().toLowerCase();
  const sesion = sesiones.get(numero);

  // Inicia una nueva conversación o regresa al menú principal.
  if (!sesion || mensaje === 'menu' || mensaje === 'menú' || mensaje === 'hola') {
    sesiones.set(numero, { paso: 'menu' });
    return menu();
  }

  // Procesa las opciones del menú principal.
  if (sesion.paso === 'menu') {
    // Opción 1: iniciar el proceso para agendar una cita.
    if (mensaje === '1') {
      sesiones.set(numero, { paso: 'nombre' });
      return 'Perfecto. ¿Cuál es tu nombre completo?';
    }

    // Opción 2: consultar las citas existentes para poder cancelar una.
    if (mensaje === '2') {
      const citas = citasActivas(numero);
      if (citas.length === 0) return 'No tienes citas programadas para cancelar.';
      sesiones.set(numero, { paso: 'cancelar', citas: citas.map(c => c.id) });
      return [
        'Estas son tus citas:',
        '',
        ...citas.map(c => `${c.id}. ${textoCita(c)}`),
        '',
        'Escribe el número de la cita que deseas cancelar.'
      ].join('\n');
    }

    // Opción 3: mostrar las citas programadas del paciente.
    if (mensaje === '3') {
      const citas = citasActivas(numero);
      if (citas.length === 0) return 'No tienes citas programadas.';
      return ['Tus citas programadas:', '', ...citas.map(c => `📅 ${textoCita(c)}`)].join('\n');
    }

    return 'Por favor, escribe 1, 2 o 3.';
  }

  // AGENDAR CITA: solicitar el nombre del paciente.
  if (sesion.paso === 'nombre') {
    if (texto.trim().length < 2) return 'Por favor, escribe tu nombre completo.';
    sesiones.set(numero, { paso: 'fecha', nombre: texto.trim() });
    return `Gracias, ${texto.trim()}.

¿Para qué fecha deseas tu cita?

Escribe la fecha así:
AAAA-MM-DD

Ejemplo: ${hoyISO()}`;
  }

  // AGENDAR CITA: solicitar y validar la fecha.
  if (sesion.paso === 'fecha') {
    const fecha = texto.trim();
    if (!esFechaValida(fecha) || fecha < hoyISO()) {
      return `La fecha no es válida o ya pasó.

Escribe una fecha futura con este formato:
AAAA-MM-DD`;
    }

    const horarios = horariosDelDia(fecha, numero);
    if (horarios.length === 0) return 'Lo siento, no hay horarios disponibles ese día (la clínica atiende de lunes a sábado). Escribe otra fecha.';

    sesiones.set(numero, { ...sesion, paso: 'hora', fecha, horarios });
    return [
      `Horarios disponibles para ${fmtCorta(fecha)}:`,
      '',
      ...horarios.map((hora, i) => `${i + 1}. ${hora}`),
      '',
      'Escribe el número de la opción o la hora exacta, por ejemplo: 14:00'
    ].join('\n');
  }

  // AGENDAR CITA: solicitar y validar el horario elegido.
  if (sesion.paso === 'hora') {
    const opcion = Number(mensaje);
    const hora = Number.isInteger(opcion) && sesion.horarios[opcion - 1] ? sesion.horarios[opcion - 1] : texto.trim();

    if (!sesion.horarios.includes(hora)) {
      return ['Esa hora no está disponible.', '', 'Horarios disponibles:', ...sesion.horarios, '', 'Escribe una hora como 14:00.'].join('\n');
    }

    // Crea la cita con las mismas validaciones del panel (cruces, bloqueos, almuerzo...).
    const r = agenda.crearCita({
      paciente: sesion.nombre, telefono: numero, proc: PROC_BOT,
      doctor: DOCTOR_BOT, fecha: sesion.fecha, inicio: aMin(hora), origen: 'whatsapp'
    });

    if (r.error) return `No pude agendar ese horario: ${r.error}\n\nEscribe menu para volver a empezar.`;

    const { cita } = r;
    const detalle = `${cita.paciente} · ${agenda.nombreProc(cita.proc)} con ${agenda.nombreDoc(cita.doctor)} · ${fmtCorta(cita.fecha)}, ${hhmm(cita.inicio)}`;
    agenda.notificar('Nueva cita desde WhatsApp', detalle, 'cita', cita.doctor);
    agenda.registrar('Confirmación enviada por WhatsApp', detalle, { telefono: numero, doctor: cita.doctor });

    // Finaliza la sesión después de registrar la cita correctamente.
    sesiones.delete(numero);

    return `✅ ¡Tu cita quedó registrada!

Paciente: ${cita.paciente}
Procedimiento: ${agenda.nombreProc(cita.proc)}
Odontólogo: ${agenda.nombreDoc(cita.doctor)}
Fecha: ${fmtCorta(cita.fecha)}
Hora: ${hhmm(cita.inicio)} a ${hhmm(cita.inicio + cita.duracion)}

Número de cita: ${cita.id}

Para volver al menú, escribe menu.`;
  }

  // CANCELAR CITA: procesa la selección de la cita que se desea cancelar.
  if (sesion.paso === 'cancelar') {
    const id = Number(texto.trim());
    if (!Number.isInteger(id)) return 'Escribe el número de la cita que deseas cancelar.';

    // Comprueba que la cita seleccionada pertenezca al paciente.
    if (!sesion.citas.includes(id)) return 'Ese número no corresponde a una de tus citas.';

    // Cancela la cita y deja al paciente en la cola de re-agendamiento del panel.
    const r = agenda.cancelarCita(id, 'Canceló por WhatsApp');
    sesiones.delete(numero);

    if (r.error) return 'No se pudo cancelar la cita. Intenta nuevamente.';

    agenda.notificar('Cita cancelada por WhatsApp', `${r.cita.paciente} · ${fmtCorta(r.cita.fecha)}, ${hhmm(r.cita.inicio)}`, 'agenda', r.cita.doctor);

    return `✅ Tu cita número ${id} fue cancelada.

La clínica te contactará para ofrecerte un nuevo horario. Si deseas agendar otra, escribe menu.`;
  }

  // Si el estado de la sesión no es reconocido, se reinicia la conversación.
  sesiones.delete(numero);
  return menu();
}

module.exports = { procesarMensaje };
