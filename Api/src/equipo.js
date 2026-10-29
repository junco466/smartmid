// Administración del equipo y los servicios: odontólogos, especialidades, procedimientos y motivos.
// Todo lo que se guarda aquí lo usan de inmediato la página, la agenda y el chatbot.
const db = require('./db');
const agenda = require('./agenda');
const { HORARIO } = require('./config');
const { cifrarClave } = require('./claves');
const { hoyISO } = require('./utils');

const texto = v => String(v ?? '').trim();
const lista = v => (Array.isArray(v) ? [...new Set(v.map(String))] : []);
const existe = (tabla, id) => !!db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).get(id);

// "Cirugía oral" → "cirugia-oral" (y "cirugia-oral-2" si ya existe).
function nuevoId(nombre, tabla) {
  const base = texto(nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'item';
  let id = base;
  for (let n = 2; existe(tabla, id); n++) id = `${base}-${n}`;
  return id;
}

const siguienteOrden = tabla => db.prepare(`SELECT COALESCE(MAX(orden), -1) + 1 n FROM ${tabla}`).get().n;
const correoValido = correo => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);


/* ---------- Vista completa para el administrador ---------- */
function equipo() {
  const cuentas = db.prepare('SELECT doctor_id, correo FROM usuarios WHERE doctor_id IS NOT NULL').all();
  return {
    doctores: agenda.doctores({ todos: true }).map(d => ({ ...d, correo: cuentas.find(c => c.doctor_id === d.id)?.correo || null })),
    especialidades: agenda.especialidades({ todos: true }),
    procedimientos: agenda.catalogo({ todos: true }),
    motivos: agenda.motivos({ todos: true })
  };
}


/* ---------- Odontólogos ---------- */
const doctorCompleto = id => equipo().doctores.find(d => d.id === id);

// id = null crea uno nuevo. Con correo y clave también crea (o actualiza) su cuenta de acceso.
const guardarDoctor = db.transaction((id, d) => {
  const nombre = texto(d.nombre);
  const especialidades = lista(d.especialidades);
  const experiencia = d.experiencia === '' || d.experiencia == null ? null : Number(d.experiencia);
  const correo = texto(d.correo).toLowerCase();
  const clave = String(d.clave || '');
  const activo = d.activo === undefined ? true : !!d.activo;

  if (nombre.length < 5) return { error: 'Escribe el nombre completo del odontólogo.' };
  if (!especialidades.length) return { error: 'Elige al menos una especialidad.' };
  const desconocida = especialidades.find(e => !existe('especialidades', e));
  if (desconocida) return { error: `La especialidad "${desconocida}" no existe.` };
  if (experiencia !== null && (!Number.isInteger(experiencia) || experiencia < 0 || experiencia > 70)) return { error: 'Los años de experiencia no son válidos.' };
  if (id && !existe('doctores', id)) return { error: 'El odontólogo no existe.' };

  const cuenta = id ? db.prepare('SELECT id, correo FROM usuarios WHERE doctor_id = ?').get(id) : null;
  if (correo || clave) {
    if (!correoValido(correo)) return { error: 'El correo no es válido.' };
    if (db.prepare('SELECT 1 FROM usuarios WHERE correo = ? AND id IS NOT ?').get(correo, cuenta?.id ?? null)) return { error: 'Ya existe una cuenta con ese correo.' };
    // La clave es obligatoria al crear la cuenta; al editar, vacía significa "no cambiarla".
    if ((!cuenta || clave) && clave.length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  }

  if (id && !activo) {
    const { n } = db.prepare(`SELECT COUNT(*) n FROM citas WHERE doctor_id = ? AND estado = 'programada' AND fecha >= ?`).get(id, hoyISO());
    if (n) return { error: `Tiene ${n} cita(s) programada(s). Cancélalas o re-agéndalas antes de desactivarlo.` };
  }

  if (!id) {
    id = 'd' + Date.now().toString(36);
    db.prepare('INSERT INTO doctores (id, nombre, experiencia, bio, activo) VALUES (?, ?, ?, ?, ?)')
      .run(id, nombre, experiencia, texto(d.bio) || null, activo ? 1 : 0);
  } else {
    db.prepare('UPDATE doctores SET nombre = ?, experiencia = ?, bio = ?, activo = ? WHERE id = ?')
      .run(nombre, experiencia, texto(d.bio) || null, activo ? 1 : 0, id);
  }

  db.prepare('DELETE FROM doctor_especialidades WHERE doctor_id = ?').run(id);
  const insEsp = db.prepare('INSERT INTO doctor_especialidades (doctor_id, especialidad_id) VALUES (?, ?)');
  especialidades.forEach(e => insEsp.run(id, e));

  if (cuenta) {
    if (correo) db.prepare('UPDATE usuarios SET correo = ?, nombre = ? WHERE id = ?').run(correo, nombre, cuenta.id);
    // Contraseña asignada por el administrador: el odontólogo debe volver a iniciar sesión.
    if (clave) db.prepare('UPDATE usuarios SET clave_hash = ?, sesion_version = sesion_version + 1 WHERE id = ?').run(cifrarClave(clave), cuenta.id);
  } else if (correo) {
    db.prepare(`INSERT INTO usuarios (nombre, correo, clave_hash, rol, doctor_id) VALUES (?, ?, ?, 'odontologo', ?)`)
      .run(nombre, correo, cifrarClave(clave), id);
  }
  return { doctor: doctorCompleto(id) };
});


/* ---------- Especialidades ---------- */
const guardarEspecialidad = db.transaction((id, e) => {
  const nombre = texto(e.nombre);
  const procs = lista(e.procs);
  const activo = e.activo === undefined ? true : !!e.activo;

  if (nombre.length < 3) return { error: 'Escribe el nombre de la especialidad.' };
  if (!procs.length) return { error: 'Elige al menos un procedimiento.' };
  const desconocido = procs.find(p => !existe('procedimientos', p));
  if (desconocido) return { error: `El procedimiento "${desconocido}" no existe.` };
  if (id && !existe('especialidades', id)) return { error: 'La especialidad no existe.' };
  if (db.prepare('SELECT 1 FROM especialidades WHERE lower(nombre) = lower(?) AND id IS NOT ?').get(nombre, id)) return { error: 'Ya existe una especialidad con ese nombre.' };

  if (!id) {
    id = nuevoId(nombre, 'especialidades');
    db.prepare('INSERT INTO especialidades (id, nombre, orden, activo) VALUES (?, ?, ?, ?)').run(id, nombre, siguienteOrden('especialidades'), activo ? 1 : 0);
  } else {
    db.prepare('UPDATE especialidades SET nombre = ?, activo = ? WHERE id = ?').run(nombre, activo ? 1 : 0, id);
  }
  db.prepare('DELETE FROM especialidad_procs WHERE especialidad_id = ?').run(id);
  const ins = db.prepare('INSERT INTO especialidad_procs (especialidad_id, proc_id) VALUES (?, ?)');
  procs.forEach(p => ins.run(id, p));
  return { id, especialidad: agenda.especialidades({ todos: true })[id] };
});


/* ---------- Procedimientos ---------- */
// `especialidades` (opcional) indica qué especialidades lo incluyen.
const guardarProcedimiento = db.transaction((id, p) => {
  const nombre = texto(p.nombre);
  const duracion = Number(p.duracion);
  const precio = Number(p.precio);
  const activo = p.activo === undefined ? true : !!p.activo;

  if (nombre.length < 3) return { error: 'Escribe el nombre del procedimiento.' };
  if (!Number.isInteger(duracion) || duracion < HORARIO.paso || duracion > 240 || duracion % HORARIO.paso) return { error: 'La duración debe ser múltiplo de 15 (entre 15 y 240 min).' };
  if (!Number.isFinite(precio) || precio < 0) return { error: 'La tarifa no es válida.' };
  if (id && !existe('procedimientos', id)) return { error: 'El procedimiento no existe.' };
  if (db.prepare('SELECT 1 FROM procedimientos WHERE lower(nombre) = lower(?) AND id IS NOT ? AND eliminado = 0').get(nombre, id)) return { error: 'Ya existe un procedimiento con ese nombre.' };
  const esp = Array.isArray(p.especialidades) ? lista(p.especialidades) : null;
  const desconocida = esp?.find(e => !existe('especialidades', e));
  if (desconocida) return { error: `La especialidad "${desconocida}" no existe.` };

  if (!id) {
    id = nuevoId(nombre, 'procedimientos');
    db.prepare('INSERT INTO procedimientos (id, nombre, duracion, precio, tipo, orden, activo) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, nombre, duracion, Math.round(precio), texto(p.tipo) || null, siguienteOrden('procedimientos'), activo ? 1 : 0);
  } else {
    db.prepare('UPDATE procedimientos SET nombre = ?, duracion = ?, precio = ?, tipo = ?, activo = ? WHERE id = ?')
      .run(nombre, duracion, Math.round(precio), texto(p.tipo) || null, activo ? 1 : 0, id);
  }

  if (esp) {
    db.prepare('DELETE FROM especialidad_procs WHERE proc_id = ?').run(id);
    const ins = db.prepare('INSERT INTO especialidad_procs (especialidad_id, proc_id) VALUES (?, ?)');
    esp.forEach(e => ins.run(e, id));
  }
  return { id, procedimiento: agenda.catalogo({ todos: true })[id] };
});


/* ---------- Motivos de consulta ---------- */
const guardarMotivo = db.transaction((id, m) => {
  const motivo = texto(m.motivo);
  const especialidad = texto(m.especialidad);
  const activo = m.activo === undefined ? true : !!m.activo;

  if (motivo.length < 5) return { error: 'Describe el motivo de consulta.' };
  if (!existe('especialidades', especialidad)) return { error: 'Elige una especialidad válida.' };
  if (id && !db.prepare('SELECT 1 FROM motivos WHERE id = ?').get(id)) return { error: 'El motivo no existe.' };

  if (!id) {
    id = db.prepare('INSERT INTO motivos (motivo, especialidad_id, detalle, orden, activo) VALUES (?, ?, ?, ?, ?)')
      .run(motivo, especialidad, texto(m.detalle) || null, siguienteOrden('motivos'), activo ? 1 : 0).lastInsertRowid;
  } else {
    db.prepare('UPDATE motivos SET motivo = ?, especialidad_id = ?, detalle = ?, activo = ? WHERE id = ?')
      .run(motivo, especialidad, texto(m.detalle) || null, activo ? 1 : 0, id);
  }
  return { motivo: agenda.motivos({ todos: true }).find(x => x.id === Number(id)) };
});

const eliminarMotivo = id => db.prepare('DELETE FROM motivos WHERE id = ?').run(id).changes > 0;


/* ---------- Eliminar ---------- */
// Antes de eliminar, el panel muestra qué pasará:
//   bloqueo → no se puede eliminar todavía (y por qué)
//   avisos  → lo que se va a borrar o cambiar
//   archivar → tiene historial de citas: se oculta de todas las listas pero el historial conserva su nombre
const contar = (sql, ...args) => db.prepare(sql).get(...args).n;
const vivo = (tabla, id) => !!db.prepare(`SELECT 1 FROM ${tabla} WHERE id = ? AND eliminado = 0`).get(id);

function impacto(tipo, id) {
  const hoy = hoyISO();
  const avisos = [];

  if (tipo === 'doctor') {
    if (!vivo('doctores', id)) return { error: 'El odontólogo no existe.' };
    const futuras = contar(`SELECT COUNT(*) n FROM citas WHERE doctor_id = ? AND estado = 'programada' AND fecha >= ?`, id, hoy);
    const enCola = contar('SELECT COUNT(*) n FROM cola WHERE doctor_id = ?', id);
    const historial = contar('SELECT COUNT(*) n FROM citas WHERE doctor_id = ?', id);
    const bloqueos = contar('SELECT COUNT(*) n FROM bloqueos WHERE doctor_id = ?', id);
    const cuenta = db.prepare('SELECT correo FROM usuarios WHERE doctor_id = ?').get(id);
    let bloqueo = null;
    if (futuras) bloqueo = `Tiene ${futuras} cita(s) programada(s). Cancélalas primero, desde la Agenda o activando una emergencia en sus días.`;
    else if (enCola) bloqueo = `Tiene ${enCola} paciente(s) esperando nuevo horario en Re-agendamiento. Re-agéndalos o quítalos de la cola primero.`;
    if (cuenta) avisos.push(`Se borrará su cuenta de acceso (${cuenta.correo}).`);
    if (bloqueos) avisos.push(`Se borrarán ${bloqueos} bloqueo(s) de su agenda.`);
    if (historial) avisos.push(`Tiene ${historial} cita(s) en el historial: se conservan con su nombre, pero el odontólogo desaparece de todas las listas.`);
    return { bloqueo, avisos, archivar: historial > 0 };
  }

  if (tipo === 'procedimiento') {
    if (!vivo('procedimientos', id)) return { error: 'El procedimiento no existe.' };
    const futuras = contar(`SELECT COUNT(*) n FROM citas WHERE proc = ? AND estado = 'programada' AND fecha >= ?`, id, hoy);
    const enCola = contar('SELECT COUNT(*) n FROM cola WHERE proc = ?', id);
    const historial = contar('SELECT COUNT(*) n FROM citas WHERE proc = ?', id);
    let bloqueo = null;
    if (futuras) bloqueo = `Hay ${futuras} cita(s) programada(s) con este procedimiento. Desactívalo para que no se ofrezca más y elimínalo cuando ya no tenga citas pendientes.`;
    else if (enCola) bloqueo = `Hay ${enCola} paciente(s) con este procedimiento esperando nuevo horario en Re-agendamiento.`;
    const solas = db.prepare(`SELECT e.nombre FROM especialidad_procs ep JOIN especialidades e ON e.id = ep.especialidad_id
      WHERE ep.proc_id = ? AND (SELECT COUNT(*) FROM especialidad_procs x JOIN procedimientos p ON p.id = x.proc_id
        WHERE x.especialidad_id = ep.especialidad_id AND p.eliminado = 0) = 1`).all(id);
    solas.forEach(e => avisos.push(`La especialidad "${e.nombre}" quedará sin procedimientos.`));
    if (historial) avisos.push(`Tiene ${historial} cita(s) en el historial: se conservan con su nombre, pero el procedimiento desaparece de todas las listas.`);
    return { bloqueo, avisos, archivar: historial > 0 };
  }

  if (tipo === 'especialidad') {
    if (!existe('especialidades', id)) return { error: 'La especialidad no existe.' };
    // Odontólogos que se quedarían sin ninguna especialidad.
    const sinOtra = db.prepare(`SELECT d.nombre FROM doctor_especialidades de JOIN doctores d ON d.id = de.doctor_id
      WHERE de.especialidad_id = ? AND d.eliminado = 0
        AND (SELECT COUNT(*) FROM doctor_especialidades x WHERE x.doctor_id = d.id) = 1`).all(id);
    const conElla = contar(`SELECT COUNT(*) n FROM doctor_especialidades de JOIN doctores d ON d.id = de.doctor_id WHERE de.especialidad_id = ? AND d.eliminado = 0`, id);
    const motivos = contar('SELECT COUNT(*) n FROM motivos WHERE especialidad_id = ?', id);
    const bloqueo = sinOtra.length
      ? `${sinOtra.map(d => d.nombre).join(', ')} quedaría(n) sin especialidad. Asígnale(s) otra primero.`
      : null;
    if (conElla) avisos.push(`Se quitará de ${conElla} odontólogo(s).`);
    if (motivos) avisos.push(`Se borrarán ${motivos} motivo(s) de consulta que recomiendan esta especialidad.`);
    avisos.push('Los procedimientos no se borran; solo dejan de estar en esta especialidad.');
    return { bloqueo, avisos, archivar: false };
  }

  if (tipo === 'motivo') {
    if (!db.prepare('SELECT 1 FROM motivos WHERE id = ?').get(id)) return { error: 'El motivo no existe.' };
    return { bloqueo: null, avisos: ['Dejará de aparecer en la página de pacientes y en el chatbot.'], archivar: false };
  }
  return { error: 'Tipo no válido.' };
}

const eliminar = db.transaction((tipo, id) => {
  const i = impacto(tipo, id);
  if (i.error) return i;
  if (i.bloqueo) return { error: i.bloqueo };

  if (tipo === 'doctor') {
    db.prepare('DELETE FROM usuarios WHERE doctor_id = ?').run(id);
    db.prepare('DELETE FROM bloqueos WHERE doctor_id = ?').run(id);
    db.prepare('DELETE FROM doctor_especialidades WHERE doctor_id = ?').run(id);
    if (i.archivar) db.prepare('UPDATE doctores SET activo = 0, eliminado = 1 WHERE id = ?').run(id);
    else db.prepare('DELETE FROM doctores WHERE id = ?').run(id);
  }
  if (tipo === 'procedimiento') {
    db.prepare('DELETE FROM especialidad_procs WHERE proc_id = ?').run(id);
    if (i.archivar) db.prepare('UPDATE procedimientos SET activo = 0, eliminado = 1 WHERE id = ?').run(id);
    else db.prepare('DELETE FROM procedimientos WHERE id = ?').run(id);
  }
  if (tipo === 'especialidad') {
    db.prepare('DELETE FROM motivos WHERE especialidad_id = ?').run(id);
    db.prepare('DELETE FROM especialidades WHERE id = ?').run(id);
  }
  if (tipo === 'motivo') eliminarMotivo(id);
  return { ok: true, archivado: i.archivar };
});

module.exports = { equipo, guardarDoctor, guardarEspecialidad, guardarProcedimiento, guardarMotivo, eliminarMotivo, impacto, eliminar };
