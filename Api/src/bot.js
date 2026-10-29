// Conversación del chatbot de WhatsApp.
// Funciona como una recepcionista: orienta por motivo de consulta, ofrece especialista,
// procedimiento y horarios libres, confirma antes de guardar y permite cambiar o cancelar citas.
// Todo pasa por las mismas reglas de agenda que el panel (src/agenda.js).
const db = require('./db');
const agenda = require('./agenda');
const { hoyISO, sumarDias, hhmm, esLaborable, esFechaValida, fmtCorta, deISO } = require('./utils');

const SESION_MAX_MS = 2 * 60 * 60 * 1000; // tras 2 h sin escribir, la conversación vuelve a empezar
const HORARIOS_POR_PAGINA = 6;


/* ---------------------------------------------------------
   1. MEMORIA (sesiones y pacientes en la base de datos)
   --------------------------------------------------------- */
function leerSesion(telefono) {
  const fila = db.prepare('SELECT estado, actualizado FROM sesiones_bot WHERE telefono = ?').get(telefono);
  if (!fila || Date.now() - fila.actualizado > SESION_MAX_MS) return null;
  try { return JSON.parse(fila.estado); } catch (e) { return null; }
}

function guardarSesion(telefono, sesion) {
  const ahora = Date.now();
  db.prepare(`INSERT INTO sesiones_bot (telefono, estado, actualizado) VALUES (?, ?, ?)
    ON CONFLICT(telefono) DO UPDATE SET estado = excluded.estado, actualizado = excluded.actualizado`)
    .run(telefono, JSON.stringify(sesion), ahora);
  db.prepare('DELETE FROM sesiones_bot WHERE actualizado < ?').run(ahora - 24 * 60 * 60 * 1000);
}

const nombrePaciente = telefono => db.prepare('SELECT nombre FROM pacientes WHERE telefono = ?').get(telefono)?.nombre || null;

function recordarPaciente(telefono, nombre) {
  db.prepare(`INSERT INTO pacientes (telefono, nombre, actualizado) VALUES (?, ?, ?)
    ON CONFLICT(telefono) DO UPDATE SET nombre = excluded.nombre, actualizado = excluded.actualizado`)
    .run(telefono, nombre, Date.now());
}


/* ---------------------------------------------------------
   2. ENTENDER LO QUE ESCRIBE EL PACIENTE
   --------------------------------------------------------- */
// "Menú", "MENU", "menú!!" y "1️⃣" quedan como "menu" y "1".
const normalizar = txt => String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9\s/-]/g, ' ').replace(/\s+/g, ' ').trim();

const PALABRAS_MENU = ['menu', 'inicio', 'hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches', 'empezar', '0'];
const PALABRAS_SI = ['si', 's', 'sii', 'claro', 'ok', 'okay', 'dale', 'de una', 'confirmo', 'confirmar', 'listo', 'correcto', 'yes', 'si por favor', 'si señor'];
const PALABRAS_NO = ['no', 'n', 'nop', 'nel', 'no gracias'];
const esSi = t => PALABRAS_SI.includes(t);
const esNo = t => PALABRAS_NO.includes(t);

// Devuelve el índice elegido (por número o por parte del nombre) o -1.
function elegir(t, etiquetas) {
  const numero = Number(t.replace(/^opcion /, ''));
  if (Number.isInteger(numero) && numero >= 1 && numero <= etiquetas.length) return numero - 1;
  if (t.length < 3) return -1;
  const coinciden = etiquetas.map((e, i) => [normalizar(e), i]).filter(([e]) => e.includes(t));
  return coinciden.length === 1 ? coinciden[0][1] : -1;
}

// Acepta 2026-11-03, 3/11, 03/11/2026, "hoy", "mañana", "pasado mañana" y días de la semana.
const DIAS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
function leerFecha(t) {
  const hoy = hoyISO();
  if (t === 'hoy') return hoy;
  if (t === 'manana') return sumarDias(hoy, 1);
  if (t === 'pasado manana') return sumarDias(hoy, 2);
  const dia = DIAS.indexOf(t.replace(/^el /, '').replace(/ proximo$/, ''));
  if (dia >= 0) {
    const diff = (dia - deISO(hoy).getDay() + 7) % 7 || 7;
    return sumarDias(hoy, diff);
  }
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (m) {
    let anio = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : Number(hoy.slice(0, 4));
    let iso = `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    // Sin año y ya pasó: se entiende el próximo año.
    if (!m[3] && iso < hoy) iso = `${anio + 1}${iso.slice(4)}`;
    return iso;
  }
  return null;
}


/* ---------------------------------------------------------
   3. TEXTOS
   --------------------------------------------------------- */
const pesos = n => '$' + Math.round(n).toLocaleString('es-CO');
const lista = items => items.map((x, i) => `*${i + 1}.* ${x}`).join('\n');
const cuando = (fecha, inicio) => `${fmtCorta(fecha)} · ${hhmm(inicio)}`;
// "lunes 2 de noviembre"
const dia = fecha => deISO(fecha).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
const Dia = fecha => dia(fecha).charAt(0).toUpperCase() + dia(fecha).slice(1);
const PIE = '_Escribe *menu* para volver al inicio._';

const MENU = `¿En qué te puedo ayudar? Responde con el número:

1️⃣ Agendar una cita
2️⃣ Ver mis citas
3️⃣ Cancelar o cambiar una cita
4️⃣ Precios
5️⃣ Nuestros odontólogos`;

function saludo(sesion) {
  return sesion.nombre
    ? `¡Hola, ${sesion.nombre.split(' ')[0]}! 👋 Soy Smart Mind, el asistente de la clínica.`
    : '¡Hola! 👋 Soy Smart Mind, el asistente de la clínica odontológica.';
}

const noEntendi = pregunta => `No entendí tu respuesta. 🙏\n\n${pregunta}`;


/* ---------------------------------------------------------
   4. DATOS PARA LA CONVERSACIÓN
   --------------------------------------------------------- */
const doctoresDe = especialidad => agenda.doctores().filter(d => d.especialidades.includes(especialidad));
const especialidadesConDoctor = () => Object.entries(agenda.especialidades()).filter(([id]) => doctoresDe(id).length);

// Procedimientos de la especialidad, con la valoración primero.
function procsDe(especialidad) {
  const ids = agenda.especialidades()[especialidad]?.procs || [];
  return [...ids].sort((a, b) => (b === 'val') - (a === 'val'));
}

function citasDelPaciente(telefono) {
  return agenda.listarCitas({ telefono, estado: 'programada', desde: hoyISO() });
}

const textoCita = c => `${cuando(c.fecha, c.inicio)} · ${c.procNombre} con ${c.doctorNombre}`;

// Próximos horarios libres (de uno o de varios odontólogos), ordenados por fecha.
function buscarHorarios(sesion, desde) {
  const docs = sesion.doctor ? [sesion.doctor] : doctoresDe(sesion.especialidad).map(d => d.id);
  const params = d => ({
    doctor: d, duracion: sesion.duracion, proc: sesion.modo === 'nueva' ? sesion.proc : null,
    paciente: sesion.nombre, telefono: sesion.telefono, ignorar: sesion.citaId
  });
  return docs.flatMap(d => agenda.proximosHorarios(params(d), desde, HORARIOS_POR_PAGINA, 30, 3).map(h => ({ ...h, doctor: d })))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.inicio - b.inicio)
    .slice(0, HORARIOS_POR_PAGINA);
}

function horariosDelDia(sesion, fecha) {
  const docs = sesion.doctor ? [sesion.doctor] : doctoresDe(sesion.especialidad).map(d => d.id);
  return docs.flatMap(d => agenda.horariosLibres({
    doctor: d, fecha, duracion: sesion.duracion, proc: sesion.modo === 'nueva' ? sesion.proc : null,
    paciente: sesion.nombre, telefono: sesion.telefono, ignorar: sesion.citaId
  }).filter(t => t % 30 === 0).map(inicio => ({ fecha, inicio, doctor: d })))
    .sort((a, b) => a.inicio - b.inicio)
    .slice(0, 8);
}


/* ---------------------------------------------------------
   5. PASOS DE LA CONVERSACIÓN
   Cada paso tiene `mostrar` (la pregunta) y `responder` (qué hacer con la respuesta).
   --------------------------------------------------------- */
function ir(sesion, paso, cambios = {}) {
  Object.assign(sesion, cambios, { paso });
  return PASOS[paso].mostrar(sesion);
}

// Vuelve al menú y deja el texto listo para "¿algo más?".
function alMenu(sesion, mensaje) {
  Object.assign(sesion, { paso: 'menu', opciones: null });
  return `${mensaje}\n\n¿Te ayudo con algo más? Escribe el número de una opción o *menu* para ver el menú.`;
}

// Al elegir especialidad: siguiente paso según cuántos procedimientos y odontólogos hay.
function trasEspecialidad(sesion, especialidad, intro = '') {
  const docs = doctoresDe(especialidad);
  if (!docs.length) {
    return ir(sesion, 'especialidad', { especialidad: null, aviso: 'Por ahora no tenemos ese especialista disponible. Elige otra opción:' });
  }
  sesion.especialidad = especialidad;
  const procs = procsDe(especialidad);
  if (procs.length === 1) return trasProcedimiento(sesion, procs[0], intro);
  return (intro ? intro + '\n\n' : '') + ir(sesion, 'procedimiento');
}

function trasProcedimiento(sesion, proc, intro = '') {
  const p = agenda.procPor(proc);
  Object.assign(sesion, { proc, duracion: p.duracion });
  const docs = doctoresDe(sesion.especialidad).filter(d => agenda.puedeHacer(d, proc));
  if (docs.length === 1) {
    sesion.doctor = docs[0].id;
    return `${intro ? intro + '\n\n' : ''}Te atenderá *${docs[0].nombre}*.\n\n` + ir(sesion, 'horario', { pagina: hoyISO() });
  }
  return (intro ? intro + '\n\n' : '') + ir(sesion, 'doctor');
}

const PASOS = {
  menu: {
    mostrar: () => MENU,
    responder(s, t) {
      const opcion = elegir(t, ['agendar', 'mis citas', 'cancelar', 'precios', 'odontologos']);
      if (opcion === 0 || t.includes('agendar') || t.includes('cita nueva')) {
        return ir(s, 'motivo', { modo: 'nueva', especialidad: null, proc: null, doctor: null, citaId: null, itemId: null });
      }
      if (opcion === 1) {
        const citas = citasDelPaciente(s.telefono);
        if (!citas.length) return alMenu(s, 'No tienes citas programadas. Escribe *1* para agendar una.');
        return alMenu(s, `📅 *Tus citas programadas:*\n\n${citas.map(c => `• ${textoCita(c)}`).join('\n')}`);
      }
      if (opcion === 2 || t.includes('cambiar')) return ir(s, 'elegirCita');
      if (opcion === 3 || t.includes('precio') || t.includes('tarifa')) {
        const procs = Object.values(agenda.catalogo());
        return alMenu(s, `💲 *Tarifas de la clínica:*\n\n${procs.map(p => `• ${p.nombre} (${p.duracion} min): ${pesos(p.precio)}`).join('\n')}\n\n_Valores en pesos colombianos, sujetos a valoración clínica._`);
      }
      if (opcion === 4 || t.includes('odontolog') || t.includes('doctor')) {
        const esp = agenda.especialidades();
        const docs = agenda.doctores().map(d => `• *${d.nombre}* — ${d.especialidades.map(e => esp[e]?.nombre).filter(Boolean).join(', ')}${d.experiencia ? ` · ${d.experiencia} años de experiencia` : ''}${d.bio ? `\n  ${d.bio}` : ''}`);
        return alMenu(s, `🧑‍⚕️ *Nuestro equipo:*\n\n${docs.join('\n')}\n\nAtendemos de lunes a sábado, de 8:00 a. m. a 5:00 p. m.`);
      }
      return noEntendi(MENU);
    }
  },

  // AGENDAR: motivo de consulta → especialidad recomendada
  motivo: {
    mostrar() {
      const textos = agenda.motivos().map(m => m.motivo);
      return `¿Cuál es el motivo de tu consulta?\n\n${lista([...textos, 'Otro motivo / quiero elegir la especialidad'])}`;
    },
    responder(s, t) {
      const motivos = agenda.motivos();
      const i = elegir(t, [...motivos.map(m => m.motivo), 'otro motivo']);
      if (i < 0) return noEntendi(PASOS.motivo.mostrar(s));
      if (i === motivos.length) return ir(s, 'especialidad');
      const m = motivos[i];
      const esp = agenda.especialidades()[m.especialidad];
      return trasEspecialidad(s, m.especialidad, `Para eso te recomiendo *${esp.nombre}*.${m.detalle ? ` ${m.detalle}` : ''}`);
    }
  },

  especialidad: {
    mostrar(s) {
      const aviso = s.aviso || '¿Con qué especialidad quieres tu cita?';
      s.aviso = null;
      return `${aviso}\n\n${lista(especialidadesConDoctor().map(([, e]) => e.nombre))}`;
    },
    responder(s, t) {
      const esps = especialidadesConDoctor();
      const i = elegir(t, esps.map(([, e]) => e.nombre));
      if (i < 0) return noEntendi(PASOS.especialidad.mostrar(s));
      return trasEspecialidad(s, esps[i][0]);
    }
  },

  procedimiento: {
    mostrar(s) {
      const procs = procsDe(s.especialidad).map(id => {
        const p = agenda.procPor(id);
        return `${p.nombre} · ${p.duracion} min · ${pesos(p.precio)}${id === 'val' ? ' _(recomendada si es tu primera visita)_' : ''}`;
      });
      return `¿Qué necesitas?\n\n${lista(procs)}`;
    },
    responder(s, t) {
      const procs = procsDe(s.especialidad);
      const i = elegir(t, procs.map(id => agenda.procPor(id).nombre));
      if (i < 0) return noEntendi(PASOS.procedimiento.mostrar(s));
      return trasProcedimiento(s, procs[i]);
    }
  },

  doctor: {
    mostrar(s) {
      const docs = doctoresDe(s.especialidad).filter(d => agenda.puedeHacer(d, s.proc));
      return `¿Con quién prefieres tu cita?\n\n${lista([...docs.map(d => d.nombre + (d.experiencia ? ` · ${d.experiencia} años de experiencia` : '')), 'Me da igual (el primer horario libre)'])}`;
    },
    responder(s, t) {
      const docs = doctoresDe(s.especialidad).filter(d => agenda.puedeHacer(d, s.proc));
      const i = elegir(t, [...docs.map(d => d.nombre), 'me da igual']);
      if (i < 0) return noEntendi(PASOS.doctor.mostrar(s));
      s.doctor = i < docs.length ? docs[i].id : null;
      return ir(s, 'horario', { pagina: hoyISO() });
    }
  },

  // Próximos horarios libres. "Ver más" avanza; "Otra fecha" pide un día concreto.
  horario: {
    mostrar(s) {
      const opciones = buscarHorarios(s, s.pagina);
      s.opciones = opciones;
      if (!opciones.length) {
        return alMenu(s, 'Lo siento, no encontré horarios libres en el próximo mes. 😕 La clínica te puede ayudar directamente; escribe *menu* para volver.');
      }
      const conDoctor = !s.doctor;
      return `Estos son los próximos horarios libres:\n\n${lista([
        ...opciones.map(o => cuando(o.fecha, o.inicio) + (conDoctor ? ` (${agenda.nombreDoc(o.doctor)})` : '')),
        'Ver más horarios',
        'Prefiero otra fecha'
      ])}`;
    },
    responder(s, t) {
      const n = s.opciones.length;
      const i = elegir(t, [...s.opciones.map((o, k) => `__${k}`), 'ver mas horarios', 'otra fecha']);
      if (i === n) return ir(s, 'horario', { pagina: sumarDias(s.opciones[n - 1].fecha, 1) });
      if (i === n + 1) return ir(s, 'fecha');
      if (i < 0) {
        const fecha = leerFecha(t); // también puede escribir directamente una fecha
        if (fecha) return PASOS.fecha.responder(s, t);
        return noEntendi(PASOS.horario.mostrar(s));
      }
      return elegirHorario(s, s.opciones[i]);
    }
  },

  fecha: {
    mostrar: () => '¿Qué día prefieres? Escribe por ejemplo *mañana*, *viernes* o *15/11*.',
    responder(s, t) {
      const fecha = leerFecha(t);
      if (!fecha || !esFechaValida(fecha)) return noEntendi(PASOS.fecha.mostrar(s));
      if (fecha < hoyISO()) return 'Esa fecha ya pasó. ¿Qué otro día prefieres?';
      if (!esLaborable(fecha)) return `El ${dia(fecha)} la clínica no atiende (atendemos de lunes a sábado). ¿Qué otro día prefieres?`;
      const opciones = horariosDelDia(s, fecha);
      if (!opciones.length) return `No quedan horarios libres el ${dia(fecha)}. 😕 ¿Qué otro día prefieres?`;
      s.opciones = opciones;
      s.paso = 'horarioDia';
      const conDoctor = !s.doctor;
      return `Horarios libres el *${dia(fecha)}*:\n\n${lista([...opciones.map(o => hhmm(o.inicio) + (conDoctor ? ` (${agenda.nombreDoc(o.doctor)})` : '')), 'Otra fecha'])}`;
    }
  },

  horarioDia: {
    mostrar: s => PASOS.fecha.responder(s, s.opciones[0].fecha),
    responder(s, t) {
      const n = s.opciones.length;
      const i = elegir(t, [...s.opciones.map(o => hhmm(o.inicio)), 'otra fecha']);
      if (i === n) return ir(s, 'fecha');
      if (i < 0) {
        if (leerFecha(t)) return PASOS.fecha.responder(s, t);
        return noEntendi('Escribe el número del horario que prefieres, u *otra fecha*.');
      }
      return elegirHorario(s, s.opciones[i]);
    }
  },

  nombre: {
    mostrar: () => '¿A nombre de quién agendo la cita? Escribe el *nombre completo* del paciente.',
    responder(s, t, texto) {
      const nombre = texto.trim().replace(/\s+/g, ' ');
      if (nombre.length < 5 || !/[a-zA-ZÀ-ÿ]{2,}/.test(nombre) || /^\d+$/.test(nombre)) {
        return 'Por favor escribe el nombre completo (nombre y apellido).';
      }
      s.nombre = nombre.replace(/(^|\s)(\p{L})/gu, (_, espacio, letra) => espacio + letra.toUpperCase());
      return ir(s, 'confirmar');
    }
  },

  confirmar: {
    mostrar(s) {
      const p = agenda.procPor(s.proc);
      const titulo = s.modo === 'nueva' ? 'Confirma tu cita' : 'Confirma el nuevo horario';
      return `*${titulo}:*

👤 ${s.nombre}
🦷 ${p.nombre} (${s.duracion} min) · ${pesos(p.precio)}
🧑‍⚕️ ${agenda.nombreDoc(s.elegido.doctor)}
📅 ${Dia(s.elegido.fecha)}, de ${hhmm(s.elegido.inicio)} a ${hhmm(s.elegido.inicio + s.duracion)}

Responde *sí* para confirmar o *no* para elegir otro horario.${s.modo === 'nueva' ? ' Para cambiar el nombre escribe *nombre*.' : ''}`;
    },
    responder(s, t) {
      if (t === 'nombre' && s.modo === 'nueva') return ir(s, 'nombre');
      if (esNo(t)) return ir(s, 'horario', { pagina: hoyISO() });
      if (!esSi(t)) return noEntendi('Responde *sí* para confirmar o *no* para elegir otro horario.');
      return guardarCita(s);
    }
  },

  // CANCELAR O CAMBIAR
  elegirCita: {
    mostrar(s) {
      const citas = citasDelPaciente(s.telefono);
      if (!citas.length) return alMenu(s, 'No tienes citas programadas para cancelar o cambiar.');
      s.opciones = citas.map(c => c.id);
      if (citas.length === 1) {
        s.citaId = citas[0].id;
        s.paso = 'accionCita';
        return `Tienes esta cita:\n\n📅 ${textoCita(citas[0])}\n\n${lista(['Cambiar de horario', 'Cancelarla'])}`;
      }
      return `¿Cuál cita?\n\n${lista(citas.map(textoCita))}`;
    },
    responder(s, t) {
      const i = elegir(t, s.opciones.map(() => '')); // solo por número
      if (i < 0) return noEntendi(PASOS.elegirCita.mostrar(s));
      return ir(s, 'accionCita', { citaId: s.opciones[i] });
    }
  },

  accionCita: {
    mostrar(s) {
      const c = agenda.citaPor(s.citaId);
      return `📅 ${textoCita(c)}\n\n¿Qué quieres hacer?\n\n${lista(['Cambiar de horario', 'Cancelarla'])}`;
    },
    responder(s, t) {
      const i = elegir(t, ['cambiar de horario', 'cancelarla']);
      const c = agenda.citaPor(s.citaId);
      if (!c || c.estado !== 'programada') return alMenu(s, 'Esa cita ya no está programada.');
      if (i === 0 || t.includes('cambiar')) {
        // Mismo procedimiento, misma duración y mismo odontólogo.
        return 'Busquemos un nuevo horario con la misma duración. 👇\n\n' +
          ir(s, 'horario', { modo: 'cambio', proc: c.proc, duracion: c.duracion, doctor: c.doctor, nombre: c.paciente, pagina: hoyISO() });
      }
      if (i === 1 || t.includes('cancel')) return ir(s, 'confirmarCancelar');
      return noEntendi(PASOS.accionCita.mostrar(s));
    }
  },

  confirmarCancelar: {
    mostrar(s) {
      const c = agenda.citaPor(s.citaId);
      return `¿Seguro que quieres cancelar tu cita del *${cuando(c.fecha, c.inicio)}*? Responde *sí* o *no*.`;
    },
    responder(s, t) {
      if (esNo(t)) return alMenu(s, 'Perfecto, tu cita sigue en pie. 👍');
      if (!esSi(t)) return noEntendi(PASOS.confirmarCancelar.mostrar(s));
      const r = agenda.cancelarCita(s.citaId, 'Canceló por WhatsApp');
      if (r.error) return alMenu(s, `No pude cancelar la cita: ${r.error}`);
      const { cita, item } = r;
      agenda.notificar('Cita cancelada por WhatsApp', `${cita.paciente} · ${cuando(cita.fecha, cita.inicio)}`, 'agenda', cita.doctor);
      agenda.registrar('Cancelación confirmada por WhatsApp', `${cita.paciente} · ${cita.procNombre} · ${cuando(cita.fecha, cita.inicio)}`, { telefono: s.telefono, doctor: cita.doctor });
      Object.assign(s, { itemId: item.id, proc: cita.proc, duracion: cita.duracion, doctor: cita.doctor, nombre: cita.paciente, citaId: null });
      s.paso = 'ofrecerNuevo';
      return `✅ Tu cita fue cancelada.\n\n¿Quieres que te ofrezca un nuevo horario con la misma duración (${cita.duracion} min)? Responde *sí* o *no*.`;
    }
  },

  ofrecerNuevo: {
    mostrar: () => '¿Quieres un nuevo horario? Responde *sí* o *no*.',
    responder(s, t) {
      if (esSi(t)) return ir(s, 'horario', { modo: 'reagendar', pagina: hoyISO() });
      if (esNo(t)) return alMenu(s, 'Entendido. La clínica podrá contactarte para ofrecerte un nuevo horario.');
      return noEntendi(PASOS.ofrecerNuevo.mostrar(s));
    }
  }
};

// El paciente eligió un horario: pide el nombre si no lo sabemos y luego confirma.
function elegirHorario(s, opcion) {
  s.elegido = opcion;
  if (s.modo === 'nueva' && !s.nombre) return ir(s, 'nombre');
  return ir(s, 'confirmar');
}

function guardarCita(s) {
  const { fecha, inicio, doctor } = s.elegido;
  let r;

  if (s.modo === 'nueva') {
    r = agenda.crearCita({ paciente: s.nombre, telefono: s.telefono, proc: s.proc, doctor, fecha, inicio, origen: 'whatsapp' });
  } else if (s.modo === 'reagendar') {
    r = agenda.reagendar(s.itemId, fecha, inicio);
  } else {
    // Cambio: cancela la cita actual y crea la nueva en un solo paso; si algo falla, no cambia nada.
    try {
      r = db.transaction(() => {
        const cancelada = agenda.cancelarCita(s.citaId, 'Cambio de horario solicitado por WhatsApp');
        if (cancelada.error) throw new Error(cancelada.error);
        const nueva = agenda.reagendar(cancelada.item.id, fecha, inicio);
        if (nueva.error) throw new Error(nueva.error);
        return nueva;
      })();
    } catch (e) {
      r = { error: e.message };
    }
  }

  // Alguien tomó ese horario mientras el paciente decidía.
  if (r.error) {
    return `Ese horario ya no está disponible (${r.error}) 😕\n\n` + ir(s, 'horario', { pagina: hoyISO() });
  }

  const { cita } = r;
  if (s.modo === 'nueva') recordarPaciente(s.telefono, s.nombre);
  const detalle = `${cita.paciente} · ${cita.procNombre} con ${cita.doctorNombre} · ${cuando(cita.fecha, cita.inicio)}`;
  const titulos = {
    nueva: ['Nueva cita desde WhatsApp', 'Confirmación enviada por WhatsApp'],
    reagendar: ['Paciente re-agendado por WhatsApp', 'Nuevo horario confirmado por WhatsApp'],
    cambio: ['Cita cambiada por WhatsApp', 'Cambio de horario confirmado por WhatsApp']
  }[s.modo];
  agenda.notificar(titulos[0], detalle, 'cita', cita.doctor);
  agenda.registrar(titulos[1], detalle, { telefono: s.telefono, doctor: cita.doctor });

  return alMenu(s, `✅ *¡Listo! Tu cita quedó ${s.modo === 'nueva' ? 'agendada' : 'reprogramada'}.*

🦷 ${cita.procNombre}
🧑‍⚕️ ${cita.doctorNombre}
📅 ${Dia(cita.fecha)}, de ${hhmm(cita.inicio)} a ${hhmm(cita.inicio + cita.duracion)}

Te esperamos. Si necesitas cambiarla o cancelarla, escríbeme y elige la opción *3*.`);
}


/* ---------------------------------------------------------
   6. ENTRADA PRINCIPAL
   --------------------------------------------------------- */
function procesarMensaje(telefono, texto) {
  const t = normalizar(texto);
  let sesion = leerSesion(telefono);

  try {
    let respuesta;
    // Conversación nueva, vencida o "menu": saludo y menú.
    if (!sesion || !PASOS[sesion.paso] || PALABRAS_MENU.includes(t)) {
      sesion = { paso: 'menu', telefono, nombre: nombrePaciente(telefono) };
      respuesta = `${saludo(sesion)}\n\n${MENU}\n\n${PIE}`;
    } else {
      sesion.telefono = telefono;
      respuesta = PASOS[sesion.paso].responder(sesion, t, String(texto || ''));
    }
    guardarSesion(telefono, sesion);
    return respuesta;
  } catch (error) {
    console.error(`Error en la conversación con ${telefono}:`, error);
    db.prepare('DELETE FROM sesiones_bot WHERE telefono = ?').run(telefono);
    return 'Tuve un problema procesando tu mensaje. 😕 Escribe *menu* para empezar de nuevo.';
  }
}

module.exports = { procesarMensaje, normalizar, leerFecha };
