// Llena la base con citas, bloqueos y mensajes de ejemplo (los mismos del prototipo web).
//
//   npm run demo              → solo si todavía no hay citas
//   npm run demo -- --forzar  → borra citas, cola, bloqueos, mensajes y notificaciones y vuelve a crear todo
//
// Usa la base indicada en DB_PATH (o smartmind.db). Para pruebas conviene una base aparte:
//   PowerShell:  $env:DB_PATH="smartmind-pruebas.db"; npm run demo
require('dotenv').config({ quiet: true });
process.env.TZ = process.env.TZ || 'America/Bogota';

const db = require('../src/db');
const agenda = require('../src/agenda');
const { HORARIO } = require('../src/config');
const { hoyISO, sumarDias, ahoraMin, esLaborable, normalizarTelefono } = require('../src/utils');

const PACIENTES = {
  d1: [['Laura Gómez', '3001112233'], ['Juan Pérez', '3002223344'], ['Mariana Ruiz', '3003334455'], ['Carlos Mejía', '3004445566'], ['Valentina Torres', '3005556677'], ['Paula Henao', '3006667788'], ['Tomás Álvarez', '3007778899'], ['Isabel Cardona', '3008889900'], ['Felipe Zapata', '3009990011'], ['Daniela Ochoa', '3010001122'], ['Santiago Rendón', '3011112233'], ['Luisa Mora', '3012223344']],
  d2: [['Pedro Castaño', '3101112233'], ['Ana Lucía Vélez', '3102223344'], ['Jorge Muñoz', '3103334455'], ['Natalia Giraldo', '3104445566'], ['Andrés Quintero', '3105556677'], ['Carolina Jaramillo', '3106667788'], ['Mauricio Arias', '3107778899'], ['Sara Montoya', '3108889900'], ['Esteban Londoño', '3109990011'], ['Gloria Patiño', '3110001122'], ['Ricardo Salazar', '3111112233'], ['Verónica Duque', '3112223344']],
  d3: [['Mateo Restrepo', '3201112233'], ['Sofía Hincapié', '3202223344'], ['Samuel Gil', '3203334455'], ['Valeria Correa', '3204445566'], ['Martín Echeverri', '3205556677'], ['Antonia Uribe', '3206667788'], ['Jerónimo Cano', '3207778899'], ['Emilia Posada', '3208889900'], ['Simón Betancur', '3209990011'], ['Mariana Toro', '3210001122'], ['Juan José Vargas', '3211112233'], ['Isabella Marín', '3212223344']]
};

// Agenda tipo de cada odontólogo: [hora de inicio en minutos, procedimiento]. No se cruzan entre sí.
const PLANTILLAS = {
  d1: [[480, 'lim'], [540, 'res'], [600, 'val'], [630, 'ble'], [840, 'lim'], [930, 'res'], [990, 'val']],
  d2: [[480, 'end'], [600, 'val'], [660, 'rx'], [780, 'end'], [900, 'val'], [960, 'rx']],
  d3: [[480, 'ort'], [510, 'ort'], [570, 'val'], [630, 'ort'], [810, 'ort'], [870, 'val'], [930, 'ort'], [960, 'ort']]
};

const forzar = process.argv.includes('--forzar');
const { n: existentes } = db.prepare('SELECT COUNT(*) n FROM citas').get();
if (existentes && !forzar) {
  console.log(`La base ya tiene ${existentes} cita(s). Usa "npm run demo -- --forzar" para borrarlas y crear los datos de ejemplo.`);
  process.exit(0);
}

const insCita = db.prepare(`INSERT INTO citas (paciente, telefono, proc, duracion, doctor_id, fecha, inicio, estado, origen, motivo_cancelacion)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

const resumen = db.transaction(() => {
  if (forzar) db.exec('DELETE FROM cola; DELETE FROM citas; DELETE FROM bloqueos; DELETE FROM mensajes; DELETE FROM notificaciones;');

  const hoy = hoyISO(), ahora = ahoraMin();
  const doctores = agenda.doctores().filter(d => PLANTILLAS[d.id]);
  let contador = 0, total = 0;
  const canceladas = [];

  for (let n = -12; n <= 10; n++) {
    const fecha = sumarDias(hoy, n);
    if (!esLaborable(fecha)) continue;
    doctores.forEach((doc, di) => {
      PLANTILLAS[doc.id].forEach(([inicio, proc], si) => {
        if ((n + si + di) % 3 === 0) return; // deja huecos libres
        const p = agenda.procPor(proc);
        if (!p || !agenda.puedeHacer(doc, proc)) return;
        const lista = PACIENTES[doc.id];
        const [paciente, telefono] = lista[contador++ % lista.length];
        const pasada = n < 0 || (n === 0 && inicio + p.duracion <= ahora);
        let estado = 'programada';
        if (pasada) {
          const h = Math.abs(n * 7 + si * 3 + di * 5) % 11;
          estado = h === 0 ? 'noasistio' : h === 1 ? 'cancelada' : 'asistida';
        }
        const r = insCita.run(paciente, normalizarTelefono(telefono), proc, p.duracion, doc.id, fecha, inicio, estado,
          si % 3 === 1 ? 'panel' : 'whatsapp', estado === 'cancelada' ? 'El paciente canceló' : null);
        if (estado === 'cancelada') canceladas.push(r.lastInsertRowid);
        total++;
      });
    });
  }

  // Dos pacientes que cancelaron y esperan un nuevo horario.
  const insCola = db.prepare(`INSERT INTO cola (cita_id, paciente, telefono, proc, duracion, doctor_id, fecha_original, inicio_original, motivo, creado)
    SELECT id, paciente, telefono, proc, duracion, doctor_id, fecha, inicio, 'Canceló por WhatsApp y pidió otro horario', ? FROM citas WHERE id = ?`);
  canceladas.slice(-2).forEach(id => insCola.run(Date.now(), id));

  // Bloqueos de ejemplo en días sin citas.
  const libres = [];
  for (let n = 12; libres.length < 2 && n < 40; n++) {
    const f = sumarDias(hoy, n);
    if (esLaborable(f)) libres.push(f);
  }
  const insBloqueo = db.prepare('INSERT INTO bloqueos (doctor_id, fecha, desde, hasta, motivo, tipo) VALUES (?, ?, ?, ?, ?, ?)');
  if (doctores.some(d => d.id === 'd2')) insBloqueo.run('d2', libres[0], 14 * 60, HORARIO.cierre, 'Cita médica personal', 'parcial');
  if (doctores.some(d => d.id === 'd1')) insBloqueo.run('d1', libres[1], HORARIO.apertura, HORARIO.cierre, 'Congreso de odontología estética', 'completo');

  agenda.registrar('Recordatorios de 24 h enviados', 'Todos los pacientes con cita para hoy');
  agenda.notificar('Datos de ejemplo cargados', `${total} citas de demostración`, 'agenda');
  return { total, cola: Math.min(2, canceladas.length) };
})();

console.log(`Listo: ${resumen.total} citas, ${resumen.cola} paciente(s) en la cola y 2 bloqueos de ejemplo.`);
