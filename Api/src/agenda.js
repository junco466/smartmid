// Reglas de agenda de Smart Mind (cero cruces, cero errores de duración).
// Portadas del prototipo web para que el panel y el chatbot usen exactamente las mismas.
const db = require('./db');
const { HORARIO, ESPECIALIDADES, ESTADOS, TIPOS_BLOQUEO } = require('./config');
const {
  hoyISO, sumarDias, ahoraMin, hhmm, esLaborable, solapa, fmtCorta,
  esFechaValida, minutosLaborales, normalizarTelefono
} = require('./utils');


/* ---------------------------------------------------------
   1. LECTURAS
   --------------------------------------------------------- */
const COLS_CITA = `id, paciente, telefono, proc, duracion, doctor_id AS doctor, fecha, inicio, estado, origen,
  motivo_cancelacion AS motivoCancelacion, creado`;
const COLS_BLOQUEO = 'id, doctor_id AS doctor, fecha, desde, hasta, motivo, tipo';
const COLS_COLA = `id, cita_id AS citaId, paciente, telefono, proc, duracion, doctor_id AS doctor,
  fecha_original AS fechaOriginal, inicio_original AS inicioOriginal, motivo, creado`;

const doctores = () => db.prepare('SELECT id, nombre, especialidad, experiencia, bio FROM doctores WHERE activo = 1 ORDER BY id').all();
const doctorPor = id => db.prepare('SELECT id, nombre, especialidad, experiencia, bio FROM doctores WHERE id = ? AND activo = 1').get(id);
const nombreDoc = id => doctorPor(id)?.nombre || 'Odontólogo';

function catalogo() {
  const filas = db.prepare('SELECT id, nombre, duracion, precio, tipo FROM procedimientos ORDER BY orden, id').all();
  return Object.fromEntries(filas.map(({ id, ...p }) => [id, p]));
}
// Cambios: { val: { duracion, precio }, ... } (ya validados). Las citas existentes conservan su duración.
function actualizarCatalogo(cambios) {
  const upd = db.prepare('UPDATE procedimientos SET duracion = ?, precio = ? WHERE id = ?');
  db.transaction(() => {
    Object.entries(cambios).forEach(([id, v]) => upd.run(v.duracion, v.precio, id));
  })();
  return catalogo();
}
const procPor = id => db.prepare('SELECT id, nombre, duracion, precio, tipo FROM procedimientos WHERE id = ?').get(id);
const nombreProc = id => procPor(id)?.nombre || 'Procedimiento';
const puedeHacer = (doc, proc) => !!doc && (ESPECIALIDADES[doc.especialidad]?.procs || []).includes(proc);

const citaPor = id => db.prepare(`SELECT ${COLS_CITA} FROM citas WHERE id = ?`).get(id);
const bloqueoPor = id => db.prepare(`SELECT ${COLS_BLOQUEO} FROM bloqueos WHERE id = ?`).get(id);
const itemColaPor = id => db.prepare(`SELECT ${COLS_COLA} FROM cola WHERE id = ?`).get(id);

// Filtros opcionales: doctor, fecha, desde, hasta, estado, telefono.
function listarCitas({ doctor, fecha, desde, hasta, estado, telefono } = {}) {
  const where = [], args = [];
  if (doctor) { where.push('doctor_id = ?'); args.push(doctor); }
  if (fecha) { where.push('fecha = ?'); args.push(fecha); }
  if (desde) { where.push('fecha >= ?'); args.push(desde); }
  if (hasta) { where.push('fecha <= ?'); args.push(hasta); }
  if (estado) { where.push('estado = ?'); args.push(estado); }
  if (telefono) { where.push('telefono = ?'); args.push(normalizarTelefono(telefono)); }
  const sql = `SELECT ${COLS_CITA} FROM citas ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha, inicio`;
  return db.prepare(sql).all(...args);
}

function listarBloqueos({ doctor, desde } = {}) {
  const where = [], args = [];
  if (doctor) { where.push('doctor_id = ?'); args.push(doctor); }
  if (desde) { where.push('fecha >= ?'); args.push(desde); }
  const sql = `SELECT ${COLS_BLOQUEO} FROM bloqueos ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha, desde`;
  return db.prepare(sql).all(...args);
}

function listarCola({ doctor } = {}) {
  return doctor
    ? db.prepare(`SELECT ${COLS_COLA} FROM cola WHERE doctor_id = ? ORDER BY creado`).all(doctor)
    : db.prepare(`SELECT ${COLS_COLA} FROM cola ORDER BY creado`).all();
}

function leerConfig() {
  const filas = db.prepare('SELECT clave, valor FROM config').all();
  return Object.fromEntries(filas.map(f => [f.clave, JSON.parse(f.valor)]));
}

function guardarConfig(cambios) {
  const actual = leerConfig();
  const upd = db.prepare('UPDATE config SET valor = ? WHERE clave = ?');
  db.transaction(() => {
    Object.entries(cambios).forEach(([clave, valor]) => {
      if (clave in actual && typeof valor === 'boolean') upd.run(JSON.stringify(valor), clave);
    });
  })();
  return leerConfig();
}


/* ---------------------------------------------------------
   2. REGISTRO DE MENSAJES Y NOTIFICACIONES
   --------------------------------------------------------- */
// TODO (fase 5): además de registrar, enviar el mensaje real por Whapi.
function registrar(titulo, detalle, { telefono = null, doctor = null } = {}) {
  db.prepare('INSERT INTO mensajes (t, telefono, titulo, detalle, doctor_id) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), telefono, titulo, detalle, doctor);
}

function notificar(titulo, detalle, tipo = 'agenda', doctor = null) {
  db.prepare('INSERT INTO notificaciones (t, titulo, detalle, tipo, doctor_id) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), titulo, detalle, tipo, doctor);
}

// Un odontólogo ve lo suyo y lo general; el administrador ve todo.
const filtroDoctor = doctor => (doctor ? { sql: 'WHERE doctor_id IS NULL OR doctor_id = ?', args: [doctor] } : { sql: '', args: [] });

function listarMensajes({ doctor, limite = 60 } = {}) {
  const f = filtroDoctor(doctor);
  return db.prepare(`SELECT id, t, telefono, titulo, detalle FROM mensajes ${f.sql} ORDER BY t DESC, id DESC LIMIT ?`).all(...f.args, limite);
}

function listarNotificaciones({ doctor, limite = 40 } = {}) {
  const f = filtroDoctor(doctor);
  return db.prepare(`SELECT id, t, titulo, detalle, tipo, leida FROM notificaciones ${f.sql} ORDER BY t DESC, id DESC LIMIT ?`)
    .all(...f.args, limite)
    .map(n => ({ ...n, leida: !!n.leida }));
}

function marcarNotificacionesLeidas({ doctor } = {}) {
  const f = filtroDoctor(doctor);
  db.prepare(`UPDATE notificaciones SET leida = 1 ${f.sql}`).run(...f.args);
}


/* ---------------------------------------------------------
   3. REGLAS DE AGENDA
   --------------------------------------------------------- */

// Lo que hace falta leer de la base de datos para validar un día completo de un odontólogo.
function contextoDia({ doctor, fecha, paciente, telefono }) {
  const tel = normalizarTelefono(telefono), nom = String(paciente || '').trim().toLowerCase();
  return {
    bloqueos: db.prepare('SELECT desde, hasta FROM bloqueos WHERE doctor_id = ? AND fecha = ?').all(doctor, fecha),
    citasDoctor: db.prepare(`SELECT id, paciente, inicio, duracion FROM citas WHERE doctor_id = ? AND fecha = ? AND estado != 'cancelada'`).all(doctor, fecha),
    citasPaciente: (tel || nom)
      ? db.prepare(`SELECT id, inicio, duracion, doctor_id AS doctor FROM citas WHERE fecha = ? AND estado != 'cancelada'
          AND ((? != '' AND telefono = ?) OR (? != '' AND lower(paciente) = ?))`).all(fecha, tel, tel, nom, nom)
      : []
  };
}

// Devuelve un mensaje de error, o null si el horario es válido.
function validarHorario({ doctor, fecha, inicio, duracion, proc, paciente, telefono, ignorar }, ctx = null) {
  const doc = doctorPor(doctor);
  if (!doc) return 'Selecciona un odontólogo.';
  if (proc && !procPor(proc)) return 'El procedimiento no existe.';
  if (proc && !puedeHacer(doc, proc)) return `${doc.nombre} no realiza este procedimiento.`;
  if (!esFechaValida(fecha)) return 'Selecciona una fecha válida.';
  if (!esLaborable(fecha)) return 'La clínica no atiende ese día.';
  if (!Number.isInteger(duracion) || duracion <= 0 || duracion % HORARIO.paso) return 'La duración del procedimiento no es válida.';
  if (!Number.isInteger(inicio) || inicio % HORARIO.paso) return 'La hora debe estar en bloques de 15 minutos.';

  const fin = inicio + duracion;
  if (inicio < HORARIO.apertura || fin > HORARIO.cierre) return 'La cita queda fuera del horario de atención.';
  if (fecha < hoyISO() || (fecha === hoyISO() && inicio < ahoraMin())) return 'No se puede agendar en una hora que ya pasó.';
  if (solapa(inicio, fin, HORARIO.almuerzoInicio, HORARIO.almuerzoFin)) return 'La cita se cruza con la hora de almuerzo.';

  const c = ctx || contextoDia({ doctor, fecha, paciente, telefono });
  if (c.bloqueos.some(b => solapa(inicio, fin, b.desde, b.hasta))) return 'El odontólogo tiene la agenda bloqueada en ese horario.';

  const cruce = c.citasDoctor.find(x => x.id !== ignorar && solapa(inicio, fin, x.inicio, x.inicio + x.duracion));
  if (cruce) return `Se cruza con la cita de ${cruce.paciente} (${hhmm(cruce.inicio)}–${hhmm(cruce.inicio + cruce.duracion)}).`;

  // El mismo paciente no puede tener dos citas a la vez, ni con odontólogos distintos.
  const propia = c.citasPaciente.find(x => x.id !== ignorar && solapa(inicio, fin, x.inicio, x.inicio + x.duracion));
  if (propia) return `El paciente ya tiene una cita a esa hora con ${nombreDoc(propia.doctor)}.`;
  return null;
}

// Todas las horas de inicio libres de un día.
function horariosLibres(params) {
  const libres = [];
  if (!Number.isInteger(params.duracion) || !esFechaValida(params.fecha)) return libres;
  const ctx = contextoDia(params);
  for (let t = HORARIO.apertura; t + params.duracion <= HORARIO.cierre; t += HORARIO.paso) {
    if (!validarHorario({ ...params, inicio: t }, ctx)) libres.push(t);
  }
  return libres;
}

// Próximos horarios libres a partir de una fecha (máximo `porDia` por día, repartidos).
function proximosHorarios(params, desde, max = 12, dias = 30, porDia = 4) {
  const res = [];
  for (let n = 0; n <= dias && res.length < max; n++) {
    const fecha = sumarDias(desde, n);
    if (!esLaborable(fecha)) continue;
    const libres = horariosLibres({ ...params, fecha });
    const elegidos = libres.length <= porDia ? libres
      : Array.from({ length: porDia }, (_, i) => libres[Math.round(i * (libres.length - 1) / (porDia - 1))]);
    for (const inicio of elegidos) {
      if (res.length >= max) break;
      res.push({ fecha, inicio });
    }
  }
  return res;
}

function citasAfectadas(doctor, fecha, desde, hasta) {
  return db.prepare(`SELECT ${COLS_CITA} FROM citas WHERE doctor_id = ? AND fecha = ? AND estado = 'programada'
      AND inicio < ? AND inicio + duracion > ? ORDER BY inicio`).all(doctor, fecha, hasta, desde);
}

const yaEmpezo = c => c.fecha < hoyISO() || (c.fecha === hoyISO() && c.inicio <= ahoraMin());


/* ---------------------------------------------------------
   4. OPERACIONES
   --------------------------------------------------------- */
const insertarCita = db.prepare(`INSERT INTO citas (paciente, telefono, proc, duracion, doctor_id, fecha, inicio, origen)
  VALUES (@paciente, @telefono, @proc, @duracion, @doctor, @fecha, @inicio, @origen)`);

// Valida y guarda en la misma transacción, así dos reservas simultáneas no pueden cruzarse.
const crearCita = db.transaction(d => {
  const p = procPor(d.proc);
  const datos = {
    paciente: String(d.paciente || '').trim(),
    telefono: normalizarTelefono(d.telefono),
    proc: d.proc,
    // La duración la define el procedimiento; solo una re-agendada conserva la original.
    duracion: d.origen === 'reagendada' && Number.isInteger(d.duracion) ? d.duracion : p?.duracion,
    doctor: d.doctor,
    fecha: d.fecha,
    inicio: d.inicio,
    origen: d.origen || 'panel'
  };
  if (datos.paciente.length < 2) return { error: 'Escribe el nombre del paciente.' };
  if (!p) return { error: 'El procedimiento no existe.' };
  const error = validarHorario(datos);
  if (error) return { error };
  const { lastInsertRowid } = insertarCita.run(datos);
  return { cita: citaPor(lastInsertRowid) };
});

function itemCola(cita, motivo) {
  const r = db.prepare(`INSERT INTO cola (cita_id, paciente, telefono, proc, duracion, doctor_id, fecha_original, inicio_original, motivo, creado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(cita.id, cita.paciente, cita.telefono, cita.proc, cita.duracion, cita.doctor, cita.fecha, cita.inicio, motivo, Date.now());
  return itemColaPor(r.lastInsertRowid);
}

// Cancela una cita programada y deja al paciente en la cola de re-agendamiento.
const cancelarCita = db.transaction((id, motivo = 'El paciente canceló', { aCola = true } = {}) => {
  const cita = citaPor(id);
  if (!cita) return { error: 'La cita no existe.' };
  if (cita.estado !== 'programada') return { error: 'Solo se pueden cancelar citas programadas.' };
  db.prepare(`UPDATE citas SET estado = 'cancelada', motivo_cancelacion = ? WHERE id = ?`).run(motivo, id);
  const item = aCola ? itemCola(cita, motivo) : null;
  return { cita: citaPor(id), item };
});

function marcarAsistencia(id, estado) {
  if (!['asistida', 'noasistio'].includes(estado)) return { error: 'Estado no válido.' };
  const cita = citaPor(id);
  if (!cita) return { error: 'La cita no existe.' };
  if (cita.estado !== 'programada') return { error: 'La cita ya no está programada.' };
  if (!yaEmpezo(cita)) return { error: 'La cita todavía no ha empezado.' };
  db.prepare('UPDATE citas SET estado = ? WHERE id = ?').run(estado, id);
  if (estado === 'noasistio') {
    registrar('Mensaje por inasistencia enviado', `${cita.paciente} · se le ofreció re-agendar por WhatsApp`, { telefono: cita.telefono, doctor: cita.doctor });
  }
  return { cita: citaPor(id) };
}

// Valida los datos de un bloqueo. Devuelve un mensaje de error o null.
function validarBloqueo({ doctor, fecha, desde, hasta, tipo }) {
  if (!doctorPor(doctor)) return 'Selecciona un odontólogo.';
  if (!TIPOS_BLOQUEO.includes(tipo)) return 'Tipo de bloqueo no válido.';
  if (!esFechaValida(fecha)) return 'Elige una fecha válida.';
  if (fecha < hoyISO()) return 'No puedes bloquear una fecha pasada.';
  if (!esLaborable(fecha)) return 'Ese día la clínica no atiende; no hace falta bloquearlo.';
  if (!Number.isInteger(desde) || !Number.isInteger(hasta)) return 'Indica el rango de horas.';
  if (desde % HORARIO.paso || hasta % HORARIO.paso) return 'Usa horas en bloques de 15 minutos (ej.: 14:00 o 14:15).';
  if (desde < HORARIO.apertura || hasta > HORARIO.cierre) return `El rango debe estar entre ${hhmm(HORARIO.apertura)} y ${hhmm(HORARIO.cierre)}.`;
  if (hasta <= desde) return 'La hora final debe ser posterior a la inicial.';
  return null;
}

// Crea un bloqueo y envía a la cola las citas que quedan dentro.
const aplicarBloqueo = db.transaction(({ doctor, fecha, desde, hasta, motivo, tipo }) => {
  if (tipo !== 'parcial') { desde = HORARIO.apertura; hasta = HORARIO.cierre; }
  const error = validarBloqueo({ doctor, fecha, desde, hasta, tipo });
  if (error) return { error };

  const existentes = db.prepare('SELECT desde, hasta FROM bloqueos WHERE doctor_id = ? AND fecha = ?').all(doctor, fecha);
  const cubierto = existentes.some(b => b.desde <= desde && b.hasta >= hasta);
  // Una emergencia puede caer sobre un bloqueo existente; un bloqueo normal no.
  if (tipo !== 'emergencia' && existentes.some(b => solapa(desde, hasta, b.desde, b.hasta))) return { error: 'Ya existe un bloqueo en ese rango.' };

  let bloqueo = null;
  if (!cubierto) {
    const motivoFinal = String(motivo || '').trim() || (tipo === 'emergencia' ? 'Emergencia / imprevisto' : tipo === 'parcial' ? 'Bloqueo por horas' : 'Día no laborable');
    const r = db.prepare('INSERT INTO bloqueos (doctor_id, fecha, desde, hasta, motivo, tipo) VALUES (?, ?, ?, ?, ?, ?)')
      .run(doctor, fecha, desde, hasta, motivoFinal, tipo);
    bloqueo = bloqueoPor(r.lastInsertRowid);
  }

  const { avisoEmergencia } = leerConfig();
  const motivoCola = tipo === 'emergencia' ? 'Cancelada por emergencia del odontólogo' : 'Cancelada por bloqueo de agenda';
  const items = citasAfectadas(doctor, fecha, desde, hasta).map(c => {
    const { item } = cancelarCita(c.id, motivoCola);
    if (avisoEmergencia) {
      registrar('Aviso de cancelación enviado por WhatsApp', `${c.paciente} · ${fmtCorta(fecha)}, ${hhmm(c.inicio)} · se le ofrecerá un nuevo horario`, { telefono: c.telefono, doctor });
    }
    return item;
  });

  if (tipo === 'emergencia') {
    notificar('Emergencia activada', `${nombreDoc(doctor)} · ${fmtCorta(fecha)} · ${items.length} paciente(s) por re-agendar`, 'agenda', doctor);
  } else if (items.length) {
    notificar('Agenda bloqueada', `${items.length} cita(s) pasaron a re-agendamiento`, 'agenda', doctor);
  }
  return { bloqueo, items };
});

function quitarBloqueo(id) {
  const r = db.prepare('DELETE FROM bloqueos WHERE id = ?').run(id);
  return r.changes > 0;
}

const desdeParaReagendar = item => (item.fechaOriginal > hoyISO() ? item.fechaOriginal : hoyISO());

// Re-agenda un paciente de la cola respetando la misma duración.
const reagendar = db.transaction((itemId, fecha, inicio) => {
  const item = itemColaPor(itemId);
  if (!item) return { error: 'El paciente ya no está en la cola.' };
  const r = crearCita({
    paciente: item.paciente, telefono: item.telefono, proc: item.proc, duracion: item.duracion,
    doctor: item.doctor, fecha, inicio, origen: 'reagendada'
  });
  if (r.error) return r;
  db.prepare('DELETE FROM cola WHERE id = ?').run(itemId);
  registrar('Nuevo horario enviado por WhatsApp', `${item.paciente} · ${nombreProc(item.proc)} · ${fmtCorta(fecha)}, ${hhmm(inicio)}`, { telefono: item.telefono, doctor: item.doctor });
  return r;
});

// Asigna a cada paciente el primer horario libre con la misma duración.
function reagendarAutomatico(itemIds) {
  let ok = 0, sinCupo = 0;
  itemIds.forEach(id => {
    const item = itemColaPor(id);
    if (!item) return;
    const [primero] = proximosHorarios(
      { doctor: item.doctor, duracion: item.duracion, proc: item.proc, paciente: item.paciente, telefono: item.telefono },
      desdeParaReagendar(item), 1, 45);
    if (primero && !reagendar(id, primero.fecha, primero.inicio).error) ok++;
    else sinCupo++;
  });
  if (ok) notificar('Re-agendamiento automático', `${ok} paciente(s) recibieron un nuevo horario`, 'agenda');
  return { ok, sinCupo };
}

function opcionesReagendar(itemId, max = 12) {
  const item = itemColaPor(itemId);
  if (!item) return null;
  return proximosHorarios(
    { doctor: item.doctor, duracion: item.duracion, proc: item.proc, paciente: item.paciente, telefono: item.telefono },
    desdeParaReagendar(item), max);
}


/* ---------------------------------------------------------
   5. ESTADÍSTICAS
   --------------------------------------------------------- */
function estadisticas({ doctor } = {}) {
  const docs = doctor ? [doctorPor(doctor)].filter(Boolean) : doctores();
  const ids = docs.map(d => d.id);
  const marcas = ids.map(() => '?').join(', ') || "''";
  const conteo = Object.fromEntries(ESTADOS.map(e => [e, 0]));
  db.prepare(`SELECT estado, COUNT(*) n FROM citas WHERE doctor_id IN (${marcas}) GROUP BY estado`).all(...ids)
    .forEach(f => { conteo[f.estado] = f.n; });

  const hoy = hoyISO();
  let disponible = 0, ocupado = 0;
  if (esLaborable(hoy)) {
    ids.forEach(id => {
      const bloqueado = db.prepare('SELECT desde, hasta FROM bloqueos WHERE doctor_id = ? AND fecha = ?').all(id, hoy)
        .reduce((s, b) => s + minutosLaborales(b.desde, b.hasta), 0);
      disponible += Math.max(0, minutosLaborales(HORARIO.apertura, HORARIO.cierre) - bloqueado);
      ocupado += db.prepare(`SELECT COALESCE(SUM(duracion), 0) s FROM citas WHERE doctor_id = ? AND fecha = ? AND estado != 'cancelada'`).get(id, hoy).s;
    });
  }
  const { asistida, noasistio } = conteo;
  return {
    asistidas: asistida,
    noasistio,
    canceladas: conteo.cancelada,
    programadas: conteo.programada,
    tasa: asistida + noasistio ? Math.round(asistida / (asistida + noasistio) * 100) : 0,
    ocupacion: disponible ? Math.min(100, Math.round(ocupado / disponible * 100)) : 0
  };
}

module.exports = {
  doctores, doctorPor, nombreDoc, catalogo, actualizarCatalogo, procPor, nombreProc, puedeHacer,
  citaPor, bloqueoPor, itemColaPor, listarCitas, listarBloqueos, listarCola,
  leerConfig, guardarConfig,
  registrar, notificar, listarMensajes, listarNotificaciones, marcarNotificacionesLeidas,
  validarHorario, horariosLibres, proximosHorarios, citasAfectadas, yaEmpezo,
  crearCita, cancelarCita, marcarAsistencia, validarBloqueo, aplicarBloqueo, quitarBloqueo,
  reagendar, reagendarAutomatico, opcionesReagendar, estadisticas
};
