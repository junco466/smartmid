/* =========================================================
   SMART MIND · script.js
   Acceso, agenda sin cruces, re-agendamiento, bloqueos,
   emergencias, estadísticas en vivo y catálogo.
   Prototipo: los datos se guardan solo en este navegador.
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. CONFIGURACIÓN (puedes editar estos valores)
   --------------------------------------------------------- */

// Número del chatbot de WhatsApp: código de país + número, sin "+" ni espacios.
const WHATSAPP_NUMERO = '573144914328';

// Horario de la clínica, en minutos desde la medianoche.
const HORARIO = {
  apertura: 8 * 60,                 // 08:00
  cierre: 17 * 60,                  // 17:00
  almuerzoInicio: 12 * 60,          // 12:00
  almuerzoFin: 13 * 60,             // 13:00
  paso: 15,                         // bloques de 15 minutos
  diasLaborables: [1, 2, 3, 4, 5, 6] // lunes a sábado (0 = domingo)
};

// Qué procedimientos puede hacer cada especialidad.
const ESPECIALIDADES = {
  general:     { nombre: 'Odontología general y estética', procs: ['val', 'lim', 'rx', 'res', 'ext', 'ble'] },
  endodoncia:  { nombre: 'Endodoncia', procs: ['val', 'rx', 'end'] },
  ortodoncia:  { nombre: 'Ortodoncia', procs: ['val', 'ort'] },
  periodoncia: { nombre: 'Periodoncia', procs: ['val', 'lim', 'rx'] },
  cirugia:     { nombre: 'Cirugía oral', procs: ['val', 'rx', 'ext'] }
};

// Catálogo inicial: duración rígida (múltiplos de 15 min) y tarifa en COP.
const CATALOGO_BASE = {
  val: { nombre: 'Valoración inicial',     duracion: 30, precio: 40000,  tipo: 'Diagnóstico' },
  lim: { nombre: 'Limpieza dental',        duracion: 45, precio: 90000,  tipo: 'Preventivo' },
  rx:  { nombre: 'Radiografía periapical', duracion: 15, precio: 30000,  tipo: 'Diagnóstico' },
  res: { nombre: 'Resina (calza)',         duracion: 60, precio: 150000, tipo: 'Restaurativo' },
  ext: { nombre: 'Extracción simple',      duracion: 45, precio: 130000, tipo: 'Cirugía' },
  ble: { nombre: 'Blanqueamiento',         duracion: 60, precio: 350000, tipo: 'Estético' },
  end: { nombre: 'Endodoncia (conducto)',  duracion: 90, precio: 450000, tipo: 'Especialidad' },
  ort: { nombre: 'Control de ortodoncia',  duracion: 30, precio: 120000, tipo: 'Especialidad' }
};

const DOCTORES_BASE = [
  { id: 'd1', nombre: 'Dra. Camila Restrepo', especialidad: 'general',    experiencia: 12, bio: 'Prevención, resinas y blanqueamiento. Atiende primeras consultas.' },
  { id: 'd2', nombre: 'Dr. Andrés Villegas',  especialidad: 'endodoncia', experiencia: 15, bio: 'Tratamientos de conducto y manejo de dolor dental agudo.' },
  { id: 'd3', nombre: 'Dra. Sofía Arango',    especialidad: 'ortodoncia', experiencia: 9,  bio: 'Brackets, alineadores y control de mordida en niños y adultos.' }
];

// Cuentas de prueba. En un sistema real, las contraseñas se validan en un servidor.
const USUARIOS_BASE = [
  { nombre: 'Dra. Camila Restrepo', correo: 'camila@smartmind.co', clave: 'demo1234', rol: 'odontologo', doctorId: 'd1' },
  { nombre: 'Administración Smart Mind', correo: 'admin@smartmind.co', clave: 'admin1234', rol: 'admin', doctorId: null }
];

// Guía de especialistas para pacientes.
const MOTIVOS = [
  { motivo: 'Dolor fuerte o sensibilidad al frío o al calor', especialidad: 'endodoncia', detalle: 'Puede indicar que el nervio del diente está comprometido.' },
  { motivo: 'Dientes desalineados o problemas de mordida', especialidad: 'ortodoncia', detalle: 'Brackets, alineadores y controles de ortodoncia.' },
  { motivo: 'Limpieza, caries o revisión general', especialidad: 'general', detalle: 'Prevención, limpiezas y resinas para caries.' },
  { motivo: 'Mejorar el color o la forma de mis dientes', especialidad: 'general', detalle: 'Blanqueamiento y resinas estéticas.' },
  { motivo: 'Encías inflamadas o que sangran', especialidad: 'periodoncia', detalle: 'Tratamiento de encías y tejidos de soporte.' },
  { motivo: 'Muela del juicio o extracción', especialidad: 'cirugia', detalle: 'Extracciones simples y valoración quirúrgica.' }
];

// Pacientes de ejemplo (cada odontólogo tiene los suyos).
const PACIENTES_DEMO = {
  d1: [['Laura Gómez', '3001112233'], ['Juan Pérez', '3002223344'], ['Mariana Ruiz', '3003334455'], ['Carlos Mejía', '3004445566'], ['Valentina Torres', '3005556677'], ['Paula Henao', '3006667788'], ['Tomás Álvarez', '3007778899'], ['Isabel Cardona', '3008889900'], ['Felipe Zapata', '3009990011'], ['Daniela Ochoa', '3010001122'], ['Santiago Rendón', '3011112233'], ['Luisa Mora', '3012223344']],
  d2: [['Pedro Castaño', '3101112233'], ['Ana Lucía Vélez', '3102223344'], ['Jorge Muñoz', '3103334455'], ['Natalia Giraldo', '3104445566'], ['Andrés Quintero', '3105556677'], ['Carolina Jaramillo', '3106667788'], ['Mauricio Arias', '3107778899'], ['Sara Montoya', '3108889900'], ['Esteban Londoño', '3109990011'], ['Gloria Patiño', '3110001122'], ['Ricardo Salazar', '3111112233'], ['Verónica Duque', '3112223344']],
  d3: [['Mateo Restrepo', '3201112233'], ['Sofía Hincapié', '3202223344'], ['Samuel Gil', '3203334455'], ['Valeria Correa', '3204445566'], ['Martín Echeverri', '3205556677'], ['Antonia Uribe', '3206667788'], ['Jerónimo Cano', '3207778899'], ['Emilia Posada', '3208889900'], ['Simón Betancur', '3209990011'], ['Mariana Toro', '3210001122'], ['Juan José Vargas', '3211112233'], ['Isabella Marín', '3212223344']]
};
const NOMBRES_CHATBOT = ['Camilo Ríos', 'Manuela Arango', 'Diego Ospina', 'Laura Henao', 'Julián Mesa', 'Catalina Vélez', 'Óscar Pineda', 'Paola Ríos', 'Sebastián Toro', 'Alejandra Gil'];

const ESTADOS = { programada: 'Programada', asistida: 'Asistida', noasistio: 'No asistió', cancelada: 'Cancelada' };
const ORIGENES = { whatsapp: 'Chatbot de WhatsApp', panel: 'Agendada en el panel', reagendada: 'Re-agendamiento' };
const CLAVES = { datos: 'smartmind-datos-v1', usuarios: 'smartmind-usuarios-v1', sesion: 'smartmind-sesion-v1' };


/* ---------------------------------------------------------
   2. UTILIDADES
   --------------------------------------------------------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const pad = n => String(n).padStart(2, '0');
const clonar = obj => JSON.parse(JSON.stringify(obj));
let secuencia = 0;
const uid = prefijo => prefijo + Date.now().toString(36) + (secuencia++).toString(36);

const aISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deISO = iso => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const hoyISO = () => aISO(new Date());
const sumarDias = (iso, n) => { const d = deISO(iso); d.setDate(d.getDate() + n); return aISO(d); };
const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const aMin = txt => { const [h, m] = String(txt).split(':').map(Number); return h * 60 + (m || 0); };
const esLaborable = iso => HORARIO.diasLaborables.includes(deISO(iso).getDay());
const cap = txt => (txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : '');
const fmtCorta = iso => cap(deISO(iso).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }));
const fmtLarga = iso => cap(deISO(iso).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }));
const pesos = n => '$' + Math.round(n).toLocaleString('es-CO');
const solapa = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const soloDigitos = txt => String(txt || '').replace(/\D/g, '');
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const esc = txt => String(txt ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function cuando(t) {
  const d = new Date(t);
  return aISO(d) === hoyISO() ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}
function iniciales(nombre) {
  return String(nombre).replace(/^(dra?\.?)\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}
// Minutos de atención dentro de un rango (sin contar el almuerzo).
function minutosLaborales(desde, hasta) {
  const ini = Math.max(desde, HORARIO.apertura), fin = Math.min(hasta, HORARIO.cierre);
  if (fin <= ini) return 0;
  const almuerzo = Math.max(0, Math.min(fin, HORARIO.almuerzoFin) - Math.max(ini, HORARIO.almuerzoInicio));
  return fin - ini - almuerzo;
}

// Almacenamiento seguro (si el navegador lo bloquea, se trabaja en memoria).
function leer(clave, respaldo) {
  try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : respaldo; } catch (e) { return respaldo; }
}
function escribir(clave, valor) {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ }
}


/* ---------------------------------------------------------
   3. ESTADO
   --------------------------------------------------------- */
let datos = null;      // doctores, catálogo, citas, bloqueos, cola, mensajes, notificaciones, ajustes
let usuarios = [];     // cuentas registradas
let usuario = null;    // sesión actual
const ui = {
  vista: 'paciente',
  seccion: 'resumen',
  agDoctor: null,
  agFecha: hoyISO(),
  nueva: { fecha: null, inicio: null },
  filtroNotif: 'todas'
};

const guardar = () => escribir(CLAVES.datos, datos);
const doctorPor = id => datos.doctores.find(d => d.id === id);
const procPor = id => datos.catalogo[id];
const nombreProc = id => procPor(id)?.nombre || 'Procedimiento';
const nombreDoc = id => doctorPor(id)?.nombre || 'Odontólogo';
const puedeHacer = (doc, proc) => !!doc && (ESPECIALIDADES[doc.especialidad]?.procs || []).includes(proc);
const esAdmin = () => usuario?.rol === 'admin';
const doctoresVisibles = () => (esAdmin() || !usuario?.doctorId) ? datos.doctores : datos.doctores.filter(d => d.id === usuario.doctorId);
const enAlcance = item => esAdmin() || item.doctor === usuario?.doctorId;
const citasAlcance = () => datos.citas.filter(enAlcance);
const colaAlcance = () => datos.cola.filter(enAlcance);


/* ---------------------------------------------------------
   4. DATOS DE DEMOSTRACIÓN
   --------------------------------------------------------- */
function crearDatosDemo() {
  const d = {
    doctores: clonar(DOCTORES_BASE),
    catalogo: clonar(CATALOGO_BASE),
    citas: [], bloqueos: [], cola: [], registro: [], notifs: [],
    config: { rec24: true, rec2: true, autoReagendar: true, avisoEmergencia: true, simular: true }
  };

  // Plantillas de agenda sin cruces: [hora de inicio, procedimiento]
  const plantillas = {
    d1: [[480, 'lim'], [540, 'res'], [600, 'val'], [630, 'ble'], [840, 'lim'], [930, 'res'], [990, 'val']],
    d2: [[480, 'end'], [600, 'val'], [660, 'rx'], [780, 'end'], [900, 'val'], [960, 'rx']],
    d3: [[480, 'ort'], [510, 'ort'], [570, 'val'], [630, 'ort'], [810, 'ort'], [870, 'val'], [930, 'ort'], [960, 'ort']]
  };
  const hoy = hoyISO(), ahora = ahoraMin();
  let contador = 0;

  for (let n = -12; n <= 10; n++) {
    const fecha = sumarDias(hoy, n);
    if (!esLaborable(fecha)) continue;
    d.doctores.forEach((doc, di) => {
      plantillas[doc.id].forEach(([inicio, proc], si) => {
        if ((n + si + di) % 3 === 0) return; // deja huecos libres
        const lista = PACIENTES_DEMO[doc.id];
        const [paciente, telefono] = lista[contador++ % lista.length];
        const duracion = d.catalogo[proc].duracion;
        const pasada = n < 0 || (n === 0 && inicio + duracion <= ahora);
        let estado = 'programada';
        if (pasada) {
          const h = Math.abs(n * 7 + si * 3 + di * 5) % 11;
          estado = h === 0 ? 'noasistio' : h === 1 ? 'cancelada' : 'asistida';
        }
        const cita = { id: uid('c'), paciente, telefono, proc, duracion, doctor: doc.id, fecha, inicio, estado, origen: si % 3 === 1 ? 'panel' : 'whatsapp' };
        if (estado === 'cancelada') cita.motivoCancelacion = 'El paciente canceló';
        d.citas.push(cita);
      });
    });
  }

  // Dos pacientes que cancelaron y esperan un nuevo horario
  d.citas.filter(c => c.estado === 'cancelada').slice(-2)
    .forEach(c => d.cola.push(itemCola(c, 'Canceló por WhatsApp y pidió otro horario')));

  // Bloqueos de ejemplo (en fechas sin citas)
  const libres = [];
  for (let n = 12; libres.length < 2 && n < 40; n++) {
    const f = sumarDias(hoy, n);
    if (esLaborable(f)) libres.push(f);
  }
  d.bloqueos.push({ id: uid('b'), doctor: 'd2', fecha: libres[0], desde: 14 * 60, hasta: 17 * 60, motivo: 'Cita médica personal', tipo: 'parcial' });
  d.bloqueos.push({ id: uid('b'), doctor: 'd1', fecha: libres[1], desde: HORARIO.apertura, hasta: HORARIO.cierre, motivo: 'Congreso de odontología estética', tipo: 'completo' });

  const t = Date.now(), h = 3600000;
  d.registro = [
    { t: t - 1 * h, titulo: 'Recordatorios de 2 h enviados', detalle: 'Pacientes con cita en las próximas horas' },
    { t: t - 3 * h, titulo: 'Mensajes por inasistencia enviados', detalle: 'Se ofreció re-agendar a quienes no asistieron ayer' },
    { t: t - 20 * h, titulo: 'Recordatorios de 24 h enviados', detalle: 'Todos los pacientes con cita para hoy' }
  ];
  const pendiente = d.cola[0];
  d.notifs = [
    { id: uid('n'), t: t - 0.5 * h, titulo: 'Un paciente pidió otro horario', detalle: `${pendiente ? pendiente.paciente : 'Un paciente'} está en la cola de re-agendamiento`, tipo: 'agenda', leida: false },
    { id: uid('n'), t: t - 2 * h, titulo: 'Nueva cita desde WhatsApp', detalle: 'El chatbot agendó una cita para los próximos días', tipo: 'cita', leida: false },
    { id: uid('n'), t: t - 26 * h, titulo: 'Bienvenido a Smart Mind', detalle: 'Tu agenda está conectada con el chatbot de WhatsApp', tipo: 'cita', leida: true }
  ];
  return d;
}


/* ---------------------------------------------------------
   5. REGLAS DE AGENDA (cero cruces, cero errores de duración)
   --------------------------------------------------------- */

// Devuelve un mensaje de error, o null si el horario es válido.
function validarHorario({ doctor, fecha, inicio, duracion, proc, paciente, telefono, ignorar }) {
  const doc = doctorPor(doctor);
  if (!doc) return 'Selecciona un odontólogo.';
  if (proc && !puedeHacer(doc, proc)) return `${doc.nombre} no realiza este procedimiento.`;
  if (!fecha) return 'Selecciona una fecha.';
  if (!esLaborable(fecha)) return 'La clínica no atiende ese día.';
  if (!Number.isInteger(duracion) || duracion <= 0 || duracion % HORARIO.paso) return 'La duración del procedimiento no es válida.';
  if (!Number.isInteger(inicio) || inicio % HORARIO.paso) return 'La hora debe estar en bloques de 15 minutos.';

  const fin = inicio + duracion;
  if (inicio < HORARIO.apertura || fin > HORARIO.cierre) return 'La cita queda fuera del horario de atención.';
  if (fecha < hoyISO() || (fecha === hoyISO() && inicio < ahoraMin())) return 'No se puede agendar en una hora que ya pasó.';
  if (solapa(inicio, fin, HORARIO.almuerzoInicio, HORARIO.almuerzoFin)) return 'La cita se cruza con la hora de almuerzo.';

  const bloqueo = datos.bloqueos.find(b => b.doctor === doctor && b.fecha === fecha && solapa(inicio, fin, b.desde, b.hasta));
  if (bloqueo) return 'El odontólogo tiene la agenda bloqueada en ese horario.';

  const cruce = datos.citas.find(c => c.id !== ignorar && c.estado !== 'cancelada' && c.doctor === doctor &&
    c.fecha === fecha && solapa(inicio, fin, c.inicio, c.inicio + c.duracion));
  if (cruce) return `Se cruza con la cita de ${cruce.paciente} (${hhmm(cruce.inicio)}–${hhmm(cruce.inicio + cruce.duracion)}).`;

  // El mismo paciente no puede tener dos citas a la vez, ni con odontólogos distintos.
  const tel = soloDigitos(telefono), nom = String(paciente || '').trim().toLowerCase();
  if (tel || nom) {
    const propia = datos.citas.find(c => c.id !== ignorar && c.estado !== 'cancelada' && c.fecha === fecha &&
      ((tel && soloDigitos(c.telefono) === tel) || (nom && c.paciente.toLowerCase() === nom)) &&
      solapa(inicio, fin, c.inicio, c.inicio + c.duracion));
    if (propia) return `El paciente ya tiene una cita a esa hora con ${nombreDoc(propia.doctor)}.`;
  }
  return null;
}

// Todas las horas de inicio libres de un día.
function horariosLibres(params) {
  const libres = [];
  if (!Number.isInteger(params.duracion)) return libres;
  for (let t = HORARIO.apertura; t + params.duracion <= HORARIO.cierre; t += HORARIO.paso) {
    if (!validarHorario({ ...params, inicio: t })) libres.push(t);
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

function agruparPorFecha(horarios) {
  return horarios.reduce((acc, h) => { (acc[h.fecha] = acc[h.fecha] || []).push(h.inicio); return acc; }, {});
}


/* ---------------------------------------------------------
   6. OPERACIONES
   --------------------------------------------------------- */
function crearCita(d) {
  const error = validarHorario(d); // validación final justo antes de guardar
  if (error) return { error };
  const cita = {
    id: uid('c'), paciente: d.paciente.trim(), telefono: d.telefono || '', proc: d.proc, duracion: d.duracion,
    doctor: d.doctor, fecha: d.fecha, inicio: d.inicio, estado: 'programada', origen: d.origen || 'panel'
  };
  datos.citas.push(cita);
  guardar();
  return { cita };
}

function itemCola(cita, motivo) {
  return {
    id: uid('q'), citaId: cita.id, paciente: cita.paciente, telefono: cita.telefono, proc: cita.proc,
    duracion: cita.duracion, doctor: cita.doctor, fechaOriginal: cita.fecha, inicioOriginal: cita.inicio,
    motivo, creado: Date.now()
  };
}

function cancelarCita(cita, motivo) {
  cita.estado = 'cancelada';
  cita.motivoCancelacion = motivo;
}

// Re-agenda un paciente de la cola respetando la misma duración.
function reagendar(item, fecha, inicio) {
  const r = crearCita({
    paciente: item.paciente, telefono: item.telefono, proc: item.proc, duracion: item.duracion,
    doctor: item.doctor, fecha, inicio, origen: 'reagendada'
  });
  if (r.error) return r;
  datos.cola = datos.cola.filter(q => q.id !== item.id);
  registrar('Nuevo horario enviado por WhatsApp', `${item.paciente} · ${nombreProc(item.proc)} · ${fmtCorta(fecha)}, ${hhmm(inicio)}`);
  guardar();
  return r;
}

const desdeParaReagendar = item => (item.fechaOriginal > hoyISO() ? item.fechaOriginal : hoyISO());

// Asigna a cada paciente el primer horario libre con la misma duración.
function reagendarAutomatico(items) {
  let ok = 0, sinCupo = 0;
  items.forEach(item => {
    const [primero] = proximosHorarios(
      { doctor: item.doctor, duracion: item.duracion, proc: item.proc, paciente: item.paciente, telefono: item.telefono },
      desdeParaReagendar(item), 1, 45);
    if (primero && !reagendar(item, primero.fecha, primero.inicio).error) ok++;
    else sinCupo++;
  });
  return { ok, sinCupo };
}

function citasAfectadas(doctor, fecha, desde, hasta) {
  return datos.citas
    .filter(c => c.doctor === doctor && c.fecha === fecha && c.estado === 'programada' && solapa(desde, hasta, c.inicio, c.inicio + c.duracion))
    .sort((a, b) => a.inicio - b.inicio);
}

// Crea un bloqueo y envía a la cola las citas que quedan dentro.
function aplicarBloqueo({ doctor, fecha, desde, hasta, motivo, tipo }) {
  const yaCubierto = datos.bloqueos.some(b => b.doctor === doctor && b.fecha === fecha && b.desde <= desde && b.hasta >= hasta);
  if (!yaCubierto) datos.bloqueos.push({ id: uid('b'), doctor, fecha, desde, hasta, motivo, tipo });

  const motivoCola = tipo === 'emergencia' ? 'Cancelada por emergencia del odontólogo' : 'Cancelada por bloqueo de agenda';
  const items = citasAfectadas(doctor, fecha, desde, hasta).map(c => {
    cancelarCita(c, motivoCola);
    const item = itemCola(c, motivoCola);
    datos.cola.push(item);
    if (datos.config.avisoEmergencia) {
      registrar('Aviso de cancelación enviado por WhatsApp', `${c.paciente} · ${fmtCorta(fecha)}, ${hhmm(c.inicio)} · se le ofrecerá un nuevo horario`);
    }
    return item;
  });
  guardar();
  return items;
}

function marcar(cita, estado) {
  if (cita.estado !== 'programada') return;
  cita.estado = estado;
  if (estado === 'noasistio') registrar('Mensaje por inasistencia enviado', `${cita.paciente} · se le ofreció re-agendar por WhatsApp`);
  cerrarModal();
  refrescar();
  toast(estado === 'asistida' ? `${cita.paciente}: asistencia registrada` : `${cita.paciente}: inasistencia registrada`, 'ok');
}

function registrar(titulo, detalle) {
  datos.registro.unshift({ t: Date.now(), titulo, detalle });
  datos.registro = datos.registro.slice(0, 60);
}
function notificar(titulo, detalle, tipo = 'agenda') {
  datos.notifs.unshift({ id: uid('n'), t: Date.now(), titulo, detalle, tipo, leida: false });
  datos.notifs = datos.notifs.slice(0, 40);
}


/* ---------------------------------------------------------
   7. NAVEGACIÓN Y SESIÓN
   --------------------------------------------------------- */
function irA(vista) {
  if (vista === 'panel' && !usuario) vista = 'acceso';
  if (vista === 'acceso' && usuario) vista = 'panel';
  ui.vista = vista;
  $$('[data-vista]').forEach(v => { v.hidden = v.dataset.vista !== vista; });
  $$('.view-tab').forEach(t => {
    const activo = t.dataset.ir === 'paciente' ? vista === 'paciente' : vista !== 'paciente';
    t.setAttribute('aria-pressed', String(activo));
  });
  if (vista === 'paciente') renderPaciente();
  if (vista === 'panel') renderPanel();
  mostrarPanelNotif(false);
  window.scrollTo({ top: 0 });
}

function guardarSesion(correo, recordar) {
  try {
    localStorage.removeItem(CLAVES.sesion);
    sessionStorage.removeItem(CLAVES.sesion);
    (recordar ? localStorage : sessionStorage).setItem(CLAVES.sesion, correo);
  } catch (e) { /* sin almacenamiento */ }
}
function leerSesion() {
  try { return localStorage.getItem(CLAVES.sesion) || sessionStorage.getItem(CLAVES.sesion); } catch (e) { return null; }
}
function borrarSesion() {
  try { localStorage.removeItem(CLAVES.sesion); sessionStorage.removeItem(CLAVES.sesion); } catch (e) { /* sin almacenamiento */ }
}

function iniciarSesion(u, recordar) {
  usuario = u;
  guardarSesion(u.correo, recordar);
  ui.agDoctor = null;
  ui.seccion = 'resumen';
  renderSesion();
  irA('panel');
  toast(`Bienvenido(a), ${u.nombre}`, 'ok');
}

function cerrarSesion() {
  usuario = null;
  borrarSesion();
  renderSesion();
  irA('paciente');
  toast('Sesión cerrada');
}

function renderSesion() {
  const conSesion = !!usuario;
  $('#btn-acceso').hidden = conSesion;
  $('#btn-notificaciones').hidden = !conSesion;
  $('#user-chip').hidden = !conSesion;
  if (conSesion) {
    $('#user-nombre').textContent = usuario.nombre;
    $('#user-avatar').textContent = iniciales(usuario.nombre);
  }
  renderNotifs();
}

function cambiarTabAcceso(cual) {
  const login = cual === 'login';
  $('#tab-login').setAttribute('aria-selected', String(login));
  $('#tab-registro').setAttribute('aria-selected', String(!login));
  $('#form-login').hidden = !login;
  $('#form-registro').hidden = login;
}

function actualizarRolRegistro() {
  $('#reg-esp-campo').hidden = $('#reg-rol').value !== 'odontologo';
}

function mostrarError(el, mensaje) {
  el.textContent = mensaje;
  el.hidden = false;
}


/* ---------------------------------------------------------
   8. VISTA PACIENTES (información + enlaces a WhatsApp)
   --------------------------------------------------------- */
const enlaceWhatsApp = mensaje => `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(mensaje)}`;

function activarWhatsApp() {
  $$('[data-wa]').forEach(a => {
    a.href = enlaceWhatsApp(a.dataset.wa);
    a.target = '_blank';
    a.rel = 'noopener';
  });
}

function renderPaciente() {
  // Guía: qué especialista según el motivo
  $('#guia-especialistas').innerHTML = MOTIVOS.map(m => {
    const esp = ESPECIALIDADES[m.especialidad];
    const docs = datos.doctores.filter(d => d.especialidad === m.especialidad);
    const quien = docs.length ? `Te atiende: ${docs.map(d => esc(d.nombre)).join(', ')}` : 'Empieza con una valoración inicial en odontología general.';
    return `<article class="guide-card">
      <p class="guide-motivo">${esc(m.motivo)}</p>
      <p class="guide-esp">${esc(esp.nombre)}</p>
      <p>${esc(m.detalle)}</p>
      <p class="guide-doc">${quien}</p>
      <a class="btn btn-outline btn-sm" href="#" data-wa="${esc(`Hola, quiero una cita. Mi motivo de consulta: ${m.motivo}.`)}">Consultar por WhatsApp</a>
    </article>`;
  }).join('');

  // Equipo
  $('#directorio').innerHTML = datos.doctores.map(d => `<article class="doctor">
      <div class="avatar" aria-hidden="true">${esc(iniciales(d.nombre))}</div>
      <h3>${esc(d.nombre)}</h3>
      <p class="doctor-role">${esc(ESPECIALIDADES[d.especialidad]?.nombre || '')}</p>
      <p>${esc(d.bio || '')}</p>
      <p class="doctor-meta">${d.experiencia ? `${d.experiencia} años de experiencia · ` : ''}Lun–Sáb</p>
      <a class="btn btn-outline btn-sm" href="#" data-wa="${esc(`Hola, quiero agendar una cita con ${d.nombre}.`)}">Agendar por WhatsApp</a>
    </article>`).join('');

  // Tarifas (salen del catálogo que edita el administrador)
  $('#tabla-tarifas tbody').innerHTML = Object.values(datos.catalogo)
    .map(p => `<tr><td>${esc(p.nombre)}</td><td>${p.duracion} min</td><td>${pesos(p.precio)}</td></tr>`).join('');

  activarWhatsApp();
}


/* ---------------------------------------------------------
   9. PANEL DEL ODONTÓLOGO
   --------------------------------------------------------- */
const vacio = mensaje => `<li class="list-empty">${esc(mensaje)}</li>`;

// Solo redibuja si el contenido cambió (evita que se pierda un clic en curso).
function pintarSiCambia(selector, html) {
  const el = $(selector);
  if (el.dataset.html !== html) {
    el.innerHTML = html;
    el.dataset.html = html;
  }
}

function renderPanel() {
  if (!usuario) return;
  const docs = doctoresVisibles();
  if (!ui.agDoctor || !docs.some(d => d.id === ui.agDoctor)) ui.agDoctor = usuario.doctorId || docs[0]?.id || null;

  $('#panel-saludo').textContent = esAdmin() ? 'Panel de la clínica' : `Hola, ${usuario.nombre.split(' ').slice(0, 2).join(' ')}`;
  const rol = esAdmin() ? 'Administrador' : (ESPECIALIDADES[doctorPor(usuario.doctorId)?.especialidad]?.nombre || 'Odontólogo');
  $('#panel-fecha').textContent = `${fmtLarga(hoyISO())} · ${rol}`;
  llenarSelectDoctores();
  mostrarSeccion(ui.seccion);
}

function llenarSelectDoctores() {
  const docs = doctoresVisibles();
  const opciones = docs.map(d => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('');
  ['#ag-doctor', '#blq-doctor', '#em-doctor'].forEach(sel => {
    const el = $(sel);
    const actual = el.value;
    el.innerHTML = opciones;
    el.value = docs.some(d => d.id === actual) ? actual : (ui.agDoctor || '');
    el.disabled = docs.length <= 1;
  });
}

function mostrarSeccion(seccion) {
  ui.seccion = seccion;
  $$('.side-link').forEach(b => {
    if (b.dataset.seccion === seccion) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== seccion; });
  const render = { resumen: renderResumen, agenda: renderAgenda, nueva: renderNueva, bloqueos: renderBloqueos, cola: renderCola, catalogo: renderCatalogo, ajustes: renderAjustes };
  if (render[seccion]) render[seccion]();
  renderContadores();
}

function refrescar() {
  guardar();
  renderNotifs();
  renderContadores();
  if (ui.vista === 'panel') mostrarSeccion(ui.seccion);
  if (ui.vista === 'paciente') renderPaciente();
}

function renderContadores() {
  const n = usuario ? colaAlcance().length : 0;
  const el = $('#cola-count');
  el.textContent = n;
  el.classList.toggle('is-empty', !n);
}

/* --- 9.1 Resumen y estadísticas --- */
function estadisticas() {
  const cs = citasAlcance();
  const contar = e => cs.filter(c => c.estado === e).length;
  const asistidas = contar('asistida'), noasistio = contar('noasistio');
  const hoy = hoyISO();
  let disponible = 0, ocupado = 0;
  if (esLaborable(hoy)) {
    doctoresVisibles().forEach(d => {
      const bloqueado = datos.bloqueos.filter(b => b.doctor === d.id && b.fecha === hoy).reduce((s, b) => s + minutosLaborales(b.desde, b.hasta), 0);
      disponible += Math.max(0, minutosLaborales(HORARIO.apertura, HORARIO.cierre) - bloqueado);
      ocupado += datos.citas.filter(c => c.doctor === d.id && c.fecha === hoy && c.estado !== 'cancelada').reduce((s, c) => s + c.duracion, 0);
    });
  }
  return {
    asistidas, noasistio,
    canceladas: contar('cancelada'),
    programadas: contar('programada'),
    tasa: asistidas + noasistio ? Math.round(asistidas / (asistidas + noasistio) * 100) : 0,
    ocupacion: disponible ? Math.min(100, Math.round(ocupado / disponible * 100)) : 0
  };
}

// Actualiza un contador y lo anima si cambió.
function ponerStat(id, valor, sufijo = '') {
  const el = document.getElementById(id);
  const texto = `${valor}${sufijo}`;
  if (el.textContent !== texto) {
    const habiaValor = el.dataset.listo === '1';
    el.textContent = texto;
    if (habiaValor) { el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump'); }
  }
  el.dataset.listo = '1';
}

function renderResumen() {
  const s = estadisticas();
  ponerStat('stat-asistidas', s.asistidas);
  ponerStat('stat-canceladas', s.canceladas);
  ponerStat('stat-noasistio', s.noasistio);
  ponerStat('stat-programadas', s.programadas);
  ponerStat('stat-tasa', s.tasa, '%');
  ponerStat('stat-ocupacion', s.ocupacion, '%');
  $('#dash-alcance').textContent = esAdmin() ? 'Toda la clínica' : 'Tu agenda';

  const hoy = hoyISO();
  const deHoy = citasAlcance().filter(c => c.fecha === hoy && c.estado !== 'cancelada').sort((a, b) => a.inicio - b.inicio);
  $('#lista-hoy').innerHTML = deHoy.length ? deHoy.map(c => itemCitaHTML(c, esAdmin())).join('')
    : vacio(esLaborable(hoy) ? 'No hay citas para hoy.' : 'Hoy la clínica no atiende.');

  $('#lista-registro').innerHTML = datos.registro.length
    ? datos.registro.slice(0, 8).map(r => `<li><div class="list-main"><p class="list-title">${esc(r.titulo)}</p><p class="list-meta">${esc(r.detalle)}</p></div><span class="list-time">${cuando(r.t)}</span></li>`).join('')
    : vacio('Aún no se han enviado mensajes.');

  const pendientes = colaAlcance().length;
  $('#alerta-cola').hidden = !pendientes;
  $('#alerta-cola-texto').textContent = `${plural(pendientes, 'paciente espera', 'pacientes esperan')} un nuevo horario.`;
}

/* --- 9.2 Elementos de cita reutilizables --- */
const yaEmpezo = c => c.fecha < hoyISO() || (c.fecha === hoyISO() && c.inicio <= ahoraMin());

function accionesCita(c) {
  if (c.estado !== 'programada') return '';
  const asistencia = yaEmpezo(c)
    ? `<button type="button" class="btn btn-outline btn-sm" data-accion="asistida" data-cita="${c.id}">Asistió</button>
       <button type="button" class="btn btn-outline btn-sm" data-accion="noasistio" data-cita="${c.id}">No asistió</button>`
    : '';
  return `${asistencia}<button type="button" class="btn btn-ghost btn-sm" data-accion="cancelar" data-cita="${c.id}">Cancelar</button>`;
}

function itemCitaHTML(c, mostrarDoctor = false) {
  const detalles = [
    `${hhmm(c.inicio)}–${hhmm(c.inicio + c.duracion)}`,
    nombreProc(c.proc),
    mostrarDoctor ? nombreDoc(c.doctor) : null,
    c.origen === 'whatsapp' ? 'vía WhatsApp' : c.origen === 'reagendada' ? 're-agendada' : null
  ].filter(Boolean).map(esc).join(' · ');
  return `<li>
    <div class="list-main"><p class="list-title">${esc(c.paciente)}</p><p class="list-meta">${detalles}</p></div>
    <div class="list-actions"><span class="badge" data-estado="${c.estado}">${ESTADOS[c.estado]}</span>${accionesCita(c)}</div>
  </li>`;
}

/* --- 9.3 Agenda (calendario por odontólogo) --- */
function eventoHTML({ inicio, fin, estado, titulo, meta = '', id = null }) {
  const fila = (inicio - HORARIO.apertura) / HORARIO.paso + 1;
  const bloques = Math.max(1, (fin - inicio) / HORARIO.paso);
  const etiqueta = id ? 'button' : 'div';
  const atributos = id ? ` type="button" data-cita-detalle="${id}"` : '';
  return `<${etiqueta} class="cal-event${bloques <= 1 ? ' is-short' : ''}" data-estado="${estado}" style="--row:${fila}; --span:${bloques}"${atributos}>
    <span class="cal-event-time">${hhmm(inicio)}–${hhmm(fin)}</span><span class="cal-event-title">${esc(titulo)}</span>${meta ? `<span class="cal-event-meta">${esc(meta)}</span>` : ''}
  </${etiqueta}>`;
}

function renderAgenda() {
  const sel = $('#ag-doctor');
  if (ui.agDoctor && sel.value !== ui.agDoctor) sel.value = ui.agDoctor;
  $('#ag-fecha').value = ui.agFecha;

  const grid = $('#calendar-grid');
  const fecha = ui.agFecha;
  const doc = doctorPor(ui.agDoctor);
  const citas = datos.citas.filter(c => c.doctor === ui.agDoctor && c.fecha === fecha).sort((a, b) => a.inicio - b.inicio);
  const activas = citas.filter(c => c.estado !== 'cancelada');
  const bloqueos = datos.bloqueos.filter(b => b.doctor === ui.agDoctor && b.fecha === fecha);

  if (!doc || !esLaborable(fecha)) {
    grid.classList.add('is-empty');
    grid.innerHTML = `<p class="cal-empty">${doc ? 'La clínica no atiende este día.' : 'No hay odontólogos registrados.'}</p>`;
  } else {
    grid.classList.remove('is-empty');
    const fila = m => (m - HORARIO.apertura) / HORARIO.paso + 1;
    let html = '';
    for (let m = HORARIO.apertura; m < HORARIO.cierre; m += HORARIO.paso) {
      const enPunto = m % 60 === 0;
      if (enPunto) html += `<div class="cal-hour" style="--row:${fila(m)}">${hhmm(m)}</div>`;
      html += `<div class="cal-slot${enPunto ? ' is-hour' : ''}" style="--row:${fila(m)}"></div>`;
    }
    const almuerzoCubierto = bloqueos.some(b => b.desde <= HORARIO.almuerzoInicio && b.hasta >= HORARIO.almuerzoFin);
    if (!almuerzoCubierto) html += eventoHTML({ inicio: HORARIO.almuerzoInicio, fin: HORARIO.almuerzoFin, estado: 'bloqueo', titulo: 'Almuerzo' });
    bloqueos.forEach(b => {
      html += eventoHTML({ inicio: b.desde, fin: b.hasta, estado: 'bloqueo', titulo: b.tipo === 'emergencia' ? 'Emergencia' : 'Bloqueado', meta: b.motivo });
    });
    activas.forEach(c => {
      html += eventoHTML({ inicio: c.inicio, fin: c.inicio + c.duracion, estado: c.estado, titulo: c.paciente, meta: nombreProc(c.proc), id: c.id });
    });
    grid.innerHTML = html;
  }

  const ocupado = activas.reduce((s, c) => s + c.duracion, 0);
  const disponible = esLaborable(fecha)
    ? Math.max(0, minutosLaborales(HORARIO.apertura, HORARIO.cierre) - bloqueos.reduce((s, b) => s + minutosLaborales(b.desde, b.hasta), 0))
    : 0;
  const partes = [fmtLarga(fecha), plural(activas.length, 'cita', 'citas')];
  if (disponible) partes.push(`Ocupación ${Math.round(ocupado / disponible * 100)}%`);
  if (bloqueos.length) partes.push('Con bloqueos');
  $('#ag-resumen').textContent = partes.join(' · ');

  $('#lista-dia').innerHTML = citas.length ? citas.map(c => itemCitaHTML(c)).join('') : vacio('Sin citas para este día.');
}

/* --- 9.4 Nueva cita --- */
function renderNueva() {
  const selProc = $('#cita-proc'), selDoc = $('#cita-doctor');
  const procActual = selProc.value, docActual = selDoc.value;

  selProc.innerHTML = Object.entries(datos.catalogo)
    .map(([id, p]) => `<option value="${id}">${esc(p.nombre)} · ${p.duracion} min</option>`).join('');
  selProc.value = datos.catalogo[procActual] ? procActual : 'val';

  const docs = doctoresVisibles().filter(d => puedeHacer(d, selProc.value));
  selDoc.innerHTML = docs.length
    ? docs.map(d => `<option value="${d.id}">${esc(d.nombre)}</option>`).join('')
    : '<option value="">Ningún odontólogo disponible realiza este procedimiento</option>';
  selDoc.value = docs.some(d => d.id === docActual) ? docActual : (docs[0]?.id || '');
  actualizarNueva();
}

function actualizarNueva() {
  const proc = $('#cita-proc').value, p = procPor(proc), doctor = $('#cita-doctor').value;
  $('#cita-duracion').textContent = p ? `Duración fija: ${p.duracion} min · Tarifa: ${pesos(p.precio)}` : 'Selecciona un procedimiento';

  // Próximos 12 días hábiles
  const fechas = [];
  for (let n = 0; fechas.length < 12 && n < 30; n++) {
    const f = sumarDias(hoyISO(), n);
    if (esLaborable(f)) fechas.push(f);
  }
  if (!fechas.includes(ui.nueva.fecha)) ui.nueva.fecha = fechas[0];
  pintarSiCambia('#cita-fechas', fechas.map(f => {
    const d = deISO(f);
    const dia = cap(d.toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', ''));
    const mes = d.toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
    return `<button type="button" class="chip" data-fecha="${f}" aria-pressed="${f === ui.nueva.fecha}"><span class="chip-sub">${esc(dia)}</span>${d.getDate()} ${esc(mes)}</button>`;
  }).join(''));

  // Horarios libres para esa combinación
  const libres = doctor && p ? horariosLibres({
    doctor, fecha: ui.nueva.fecha, duracion: p.duracion, proc,
    paciente: $('#pac-nombre').value, telefono: $('#pac-telefono').value
  }) : [];
  if (!libres.includes(ui.nueva.inicio)) ui.nueva.inicio = null;
  pintarSiCambia('#cita-horarios', libres.length
    ? libres.map(t => `<button type="button" class="chip" data-hora="${t}" aria-pressed="${t === ui.nueva.inicio}">${hhmm(t)}<span class="chip-sub">a ${hhmm(t + p.duracion)}</span></button>`).join('')
    : `<p class="chips-empty">${doctor ? 'No hay horarios libres este día. Prueba otra fecha.' : 'Selecciona un odontólogo.'}</p>`);

  // Resumen
  const resumen = $('#cita-resumen');
  if (ui.nueva.inicio !== null && p) {
    resumen.hidden = false;
    resumen.innerHTML = `
      <div class="summary-row"><span>Fecha</span><strong>${esc(fmtLarga(ui.nueva.fecha))}</strong></div>
      <div class="summary-row"><span>Horario</span><strong>${hhmm(ui.nueva.inicio)}–${hhmm(ui.nueva.inicio + p.duracion)}</strong></div>
      <div class="summary-row"><span>Odontólogo</span><strong>${esc(nombreDoc(doctor))}</strong></div>
      <div class="summary-row summary-total"><span>Tarifa</span><strong>${pesos(p.precio)}</strong></div>`;
  } else {
    resumen.hidden = true;
  }
  $('#btn-confirmar').disabled = ui.nueva.inicio === null;
}

/* --- 9.5 Bloqueos y emergencias --- */
function renderBloqueos() {
  const hoy = hoyISO();
  ['#blq-fecha', '#em-fecha'].forEach(sel => {
    const el = $(sel);
    el.min = hoy;
    if (!el.value || el.value < hoy) el.value = hoy;
  });
  const lista = datos.bloqueos.filter(b => enAlcance(b) && b.fecha >= hoy)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.desde - b.desde);
  $('#lista-bloqueos').innerHTML = lista.length ? lista.map(b => {
    const completo = b.desde <= HORARIO.apertura && b.hasta >= HORARIO.cierre;
    const etiqueta = b.tipo === 'emergencia' ? 'Emergencia' : completo ? 'Día completo' : 'Parcial';
    return `<li>
      <div class="list-main">
        <p class="list-title">${esc(fmtCorta(b.fecha))} · ${completo ? 'Todo el día' : `${hhmm(b.desde)}–${hhmm(b.hasta)}`}</p>
        <p class="list-meta">${esc(nombreDoc(b.doctor))} · ${esc(b.motivo || 'Sin motivo')}</p>
      </div>
      <div class="list-actions">
        <span class="badge" data-estado="${b.tipo === 'emergencia' ? 'cancelada' : 'bloqueo'}">${etiqueta}</span>
        <button type="button" class="btn btn-outline btn-sm" data-quitar-bloqueo="${b.id}">Quitar</button>
      </div>
    </li>`;
  }).join('') : vacio('No hay bloqueos programados.');
}

function listaAfectadasHTML(citas) {
  return `<ul class="list list-compact">${citas.map(c => `<li><div class="list-main"><p class="list-title">${esc(c.paciente)}</p><p class="list-meta">${hhmm(c.inicio)}–${hhmm(c.inicio + c.duracion)} · ${esc(nombreProc(c.proc))}</p></div></li>`).join('')}</ul>`;
}

function abrirEmergencia(doctor, fecha) {
  const doc = doctorPor(doctor);
  if (!doc) return toast('Selecciona un odontólogo', 'error');
  if (!fecha || fecha < hoyISO()) return toast('Elige hoy o una fecha futura', 'error');
  if (!esLaborable(fecha)) return toast('Ese día la clínica no atiende', 'error');

  const afectadas = citasAfectadas(doctor, fecha, HORARIO.apertura, HORARIO.cierre);
  abrirModal({
    titulo: 'Emergencia / día no laborable',
    tipo: 'peligro',
    cuerpo: `<p>Se bloqueará todo el <strong>${esc(fmtLarga(fecha))}</strong> para <strong>${esc(doc.nombre)}</strong>.</p>
      ${afectadas.length
        ? `<p class="alert alert-danger">${plural(afectadas.length, 'cita se cancelará', 'citas se cancelarán')} automáticamente. Los pacientes recibirán un aviso por WhatsApp y pasarán a re-agendamiento.</p>${listaAfectadasHTML(afectadas)}`
        : '<p class="alert">No hay citas programadas ese día.</p>'}`,
    acciones: [
      { texto: 'Volver', accion: cerrarModal },
      { texto: 'Activar emergencia', clase: 'btn-danger', accion: () => {
        const items = aplicarBloqueo({ doctor, fecha, desde: HORARIO.apertura, hasta: HORARIO.cierre, motivo: 'Emergencia / imprevisto', tipo: 'emergencia' });
        notificar('Emergencia activada', `${doc.nombre} · ${fmtCorta(fecha)} · ${plural(items.length, 'paciente', 'pacientes')} por re-agendar`, 'agenda');
        refrescar();
        if (!items.length) { cerrarModal(); return toast('Día bloqueado. No había citas que cancelar.', 'ok'); }
        abrirModal({
          titulo: 'Emergencia activada',
          cuerpo: `<p>Se ${items.length === 1 ? 'canceló 1 cita' : `cancelaron ${items.length} citas`} y se avisó a los pacientes.</p>
            <p class="alert">¿Quieres que el sistema les asigne el primer horario libre con la misma duración de su procedimiento?</p>`,
          acciones: [
            { texto: 'Lo haré desde la cola', accion: () => { cerrarModal(); mostrarSeccion('cola'); } },
            { texto: 'Re-agendar automáticamente', clase: 'btn-primary', accion: () => {
              const r = reagendarAutomatico(items);
              if (r.ok) notificar('Re-agendamiento automático', `${plural(r.ok, 'paciente recibió', 'pacientes recibieron')} un nuevo horario`, 'agenda');
              cerrarModal();
              refrescar();
              toast(`${plural(r.ok, 'paciente re-agendado', 'pacientes re-agendados')}${r.sinCupo ? ` · ${r.sinCupo} sin cupo` : ''}`, 'ok');
            } }
          ]
        });
      } }
    ]
  });
}

/* --- 9.6 Cola de re-agendamiento --- */
function renderCola() {
  const lista = colaAlcance().slice().sort((a, b) => a.creado - b.creado);
  $('#lista-cola').innerHTML = lista.length ? lista.map(q => `<li>
      <div class="list-main">
        <p class="list-title">${esc(q.paciente)}</p>
        <p class="list-meta">${esc(nombreProc(q.proc))} · ${q.duracion} min · ${esc(nombreDoc(q.doctor))}<br>${esc(q.motivo)} · cita original: ${esc(fmtCorta(q.fechaOriginal))}, ${hhmm(q.inicioOriginal)}</p>
      </div>
      <div class="list-actions">
        <span class="badge" data-estado="pendiente">Por re-agendar</span>
        <button type="button" class="btn btn-primary btn-sm" data-reagendar="${q.id}">Re-agendar</button>
      </div>
    </li>`).join('') : vacio('No hay pacientes pendientes. Todo al día.');
  $('#cola-auto').disabled = !lista.length;
}

/* --- 9.7 Catálogo --- */
function renderCatalogo() {
  const editable = esAdmin();
  $('#cat-aviso').hidden = editable;
  $('#cat-guardar').hidden = !editable;
  $('#tabla-catalogo tbody').innerHTML = Object.entries(datos.catalogo).map(([id, p]) => `<tr data-proc="${id}">
      <td>${esc(p.nombre)}</td>
      <td><input type="number" data-campo="duracion" value="${p.duracion}" min="15" max="240" step="15" aria-label="Duración de ${esc(p.nombre)} en minutos"${editable ? '' : ' disabled'}></td>
      <td><input type="number" data-campo="precio" value="${p.precio}" min="0" step="1000" aria-label="Tarifa de ${esc(p.nombre)}"${editable ? '' : ' disabled'}></td>
      <td>${esc(p.tipo)}</td>
    </tr>`).join('');
}

function guardarCatalogo() {
  const nuevos = {};
  for (const fila of $$('#tabla-catalogo tbody tr')) {
    const id = fila.dataset.proc;
    const nombre = datos.catalogo[id].nombre;
    const duracion = Number(fila.querySelector('[data-campo="duracion"]').value);
    const precio = Number(fila.querySelector('[data-campo="precio"]').value);
    if (!Number.isInteger(duracion) || duracion < 15 || duracion > 240 || duracion % 15) return toast(`${nombre}: la duración debe ser múltiplo de 15 (entre 15 y 240 min).`, 'error');
    if (!Number.isFinite(precio) || precio < 0) return toast(`${nombre}: la tarifa no es válida.`, 'error');
    nuevos[id] = { duracion, precio: Math.round(precio) };
  }
  Object.entries(nuevos).forEach(([id, v]) => Object.assign(datos.catalogo[id], v));
  notificar('Catálogo actualizado', 'Las nuevas duraciones aplican a las próximas citas', 'agenda');
  refrescar();
  toast('Catálogo guardado. Tarifas publicadas para pacientes.', 'ok');
}

/* --- 9.8 Automatizaciones --- */
function renderAjustes() {
  $$('[data-config]').forEach(input => { input.checked = !!datos.config[input.dataset.config]; });
}


/* ---------------------------------------------------------
   10. MODALES
   --------------------------------------------------------- */
const M = { caja: $('#modal'), titulo: $('#modal-titulo'), cuerpo: $('#modal-cuerpo'), acciones: $('#modal-acciones') };
let focoPrevio = null;

function abrirModal({ titulo, cuerpo, acciones = [], tipo = '' }) {
  if (M.caja.hidden) focoPrevio = document.activeElement;
  M.titulo.textContent = titulo;
  M.cuerpo.innerHTML = cuerpo;
  M.acciones.innerHTML = '';
  acciones.forEach(a => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.clase || 'btn-outline'}`;
    b.textContent = a.texto;
    b.addEventListener('click', a.accion);
    M.acciones.appendChild(b);
  });
  if (tipo) M.caja.dataset.tipo = tipo; else delete M.caja.dataset.tipo;
  M.caja.hidden = false;
  document.body.classList.add('no-scroll');
  (M.acciones.querySelector('.btn') || $('#modal-cerrar')).focus();
}

function cerrarModal() {
  if (M.caja.hidden) return;
  M.caja.hidden = true;
  document.body.classList.remove('no-scroll');
  if (focoPrevio && document.contains(focoPrevio)) focoPrevio.focus();
}

function abrirDetalle(c) {
  const acciones = [];
  if (c.estado === 'programada') {
    acciones.push({ texto: 'Cancelar cita', clase: 'btn-ghost', accion: () => abrirCancelar(c) });
    if (yaEmpezo(c)) {
      acciones.push({ texto: 'No asistió', accion: () => marcar(c, 'noasistio') });
      acciones.push({ texto: 'Asistió', clase: 'btn-primary', accion: () => marcar(c, 'asistida') });
    }
  }
  if (!acciones.length) acciones.push({ texto: 'Cerrar', accion: cerrarModal });
  abrirModal({
    titulo: c.paciente,
    cuerpo: `<dl class="kv">
      <dt>Estado</dt><dd><span class="badge" data-estado="${c.estado}">${ESTADOS[c.estado]}</span></dd>
      <dt>Procedimiento</dt><dd>${esc(nombreProc(c.proc))} · ${c.duracion} min</dd>
      <dt>Fecha</dt><dd>${esc(fmtLarga(c.fecha))}</dd>
      <dt>Hora</dt><dd>${hhmm(c.inicio)}–${hhmm(c.inicio + c.duracion)}</dd>
      <dt>Odontólogo</dt><dd>${esc(nombreDoc(c.doctor))}</dd>
      <dt>Celular</dt><dd>${esc(c.telefono || '—')}</dd>
      <dt>Origen</dt><dd>${esc(ORIGENES[c.origen] || 'Panel')}</dd>
      ${c.motivoCancelacion ? `<dt>Motivo</dt><dd>${esc(c.motivoCancelacion)}</dd>` : ''}
    </dl>`,
    acciones
  });
}

function abrirCancelar(c) {
  abrirModal({
    titulo: 'Cancelar cita',
    tipo: 'peligro',
    cuerpo: `<p>Vas a cancelar la cita de <strong>${esc(c.paciente)}</strong> (${esc(nombreProc(c.proc))}, ${esc(fmtCorta(c.fecha))} a las ${hhmm(c.inicio)}).</p>
      <div class="field"><label for="cancel-motivo">Motivo</label>
        <select id="cancel-motivo"><option>El paciente canceló</option><option>El odontólogo no puede atender</option><option>Decisión de la clínica</option></select>
      </div>
      ${datos.config.autoReagendar ? `<p class="alert">Al confirmar, le ofreceremos de inmediato un nuevo horario con la misma duración (${c.duracion} min).</p>` : ''}`,
    acciones: [
      { texto: 'Volver', accion: cerrarModal },
      { texto: datos.config.autoReagendar ? 'Cancelar y re-agendar' : 'Cancelar cita', clase: 'btn-danger', accion: () => {
        const motivo = $('#cancel-motivo').value;
        cancelarCita(c, motivo);
        const item = itemCola(c, motivo);
        datos.cola.push(item);
        registrar('Cancelación confirmada por WhatsApp', `${c.paciente} · ${nombreProc(c.proc)} · ${fmtCorta(c.fecha)}, ${hhmm(c.inicio)}`);
        notificar('Cita cancelada', `${c.paciente} · ${fmtCorta(c.fecha)}, ${hhmm(c.inicio)}`, 'agenda');
        refrescar();
        if (datos.config.autoReagendar) abrirReagendar(item, true);
        else { cerrarModal(); toast('Cita cancelada. El paciente quedó en la cola de re-agendamiento.'); }
      } }
    ]
  });
}

function abrirReagendar(item, recienCancelada = false) {
  const opciones = proximosHorarios(
    { doctor: item.doctor, duracion: item.duracion, proc: item.proc, paciente: item.paciente, telefono: item.telefono },
    desdeParaReagendar(item), 12);
  const grupos = agruparPorFecha(opciones);
  let elegido = null;

  const horariosHTML = opciones.length
    ? Object.entries(grupos).map(([f, horas]) => `<p class="mini-title">${esc(fmtLarga(f))}</p>
        <div class="chips">${horas.map(t => `<button type="button" class="chip" data-slot="${f}|${t}" aria-pressed="false">${hhmm(t)}<span class="chip-sub">a ${hhmm(t + item.duracion)}</span></button>`).join('')}</div>`).join('')
    : '<p class="chips-empty">No hay horarios libres en los próximos 30 días con este odontólogo.</p>';

  abrirModal({
    titulo: 'Re-agendar cita',
    cuerpo: `${recienCancelada ? '<p class="alert">Cita cancelada. Elige un nuevo horario para ofrecérselo al paciente por WhatsApp.</p>' : ''}
      <p><strong>${esc(item.paciente)}</strong> · ${esc(nombreProc(item.proc))} · <strong>${item.duracion} min</strong> con ${esc(nombreDoc(item.doctor))}</p>
      ${horariosHTML}`,
    acciones: [
      { texto: 'Dejar en la cola', accion: () => { cerrarModal(); toast('El paciente quedó en la cola de re-agendamiento'); } },
      { texto: 'Confirmar nuevo horario', clase: 'btn-primary', accion: () => {
        if (!elegido) return toast('Elige un horario primero', 'error');
        const r = reagendar(item, elegido.fecha, elegido.inicio);
        if (r.error) return toast(r.error, 'error');
        notificar('Cita re-agendada', `${item.paciente} · ${fmtCorta(elegido.fecha)}, ${hhmm(elegido.inicio)}`, 'agenda');
        cerrarModal();
        refrescar();
        toast('Nuevo horario confirmado y enviado al paciente', 'ok');
      } }
    ]
  });

  M.cuerpo.querySelectorAll('[data-slot]').forEach(boton => {
    boton.addEventListener('click', () => {
      M.cuerpo.querySelectorAll('[data-slot]').forEach(x => x.setAttribute('aria-pressed', 'false'));
      boton.setAttribute('aria-pressed', 'true');
      const [fecha, inicio] = boton.dataset.slot.split('|');
      elegido = { fecha, inicio: Number(inicio) };
    });
  });
}


/* ---------------------------------------------------------
   11. NOTIFICACIONES Y AVISOS
   --------------------------------------------------------- */
function renderNotifs() {
  const sinLeer = datos.notifs.filter(n => !n.leida).length;
  const contador = $('#notif-count');
  contador.textContent = sinLeer > 9 ? '9+' : String(sinLeer);
  contador.classList.toggle('is-empty', !sinLeer);
  $('#btn-notificaciones').setAttribute('aria-label', sinLeer ? `Notificaciones, ${sinLeer} sin leer` : 'Notificaciones');

  const filtradas = datos.notifs.filter(n =>
    ui.filtroNotif === 'todas' ||
    (ui.filtroNotif === 'noleidas' && !n.leida) ||
    (ui.filtroNotif === 'agenda' && n.tipo === 'agenda'));
  $('#lista-notificaciones').innerHTML = filtradas.length
    ? filtradas.map(n => `<li${n.leida ? '' : ' class="is-unread"'}><div class="list-main"><p class="list-title">${esc(n.titulo)}</p><p class="list-meta">${esc(n.detalle)}</p></div><span class="list-time">${cuando(n.t)}</span></li>`).join('')
    : vacio('No hay notificaciones.');
  $$('[data-filtro]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.filtro === ui.filtroNotif)));
}

function mostrarPanelNotif(abrir) {
  $('#panel-notificaciones').hidden = !abrir;
  $('#btn-notificaciones').setAttribute('aria-expanded', String(abrir));
}

let temporizadorToast;
function toast(mensaje, tipo = '') {
  const t = $('#toast');
  t.textContent = mensaje;
  t.className = `toast${tipo ? ` toast-${tipo}` : ''}`;
  t.hidden = false;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => { t.hidden = true; }, 3800);
}

// Modo demostración: simula reservas que llegan del chatbot de WhatsApp.
function simularChatbot() {
  if (!usuario || !datos.config.simular) return;
  const doc = datos.doctores[Math.floor(Math.random() * datos.doctores.length)];
  const procs = ESPECIALIDADES[doc.especialidad]?.procs || ['val'];
  const proc = procs[Math.floor(Math.random() * procs.length)];
  const p = procPor(proc);
  const nombre = NOMBRES_CHATBOT[Math.floor(Math.random() * NOMBRES_CHATBOT.length)];
  const telefono = '31' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const [horario] = proximosHorarios({ doctor: doc.id, duracion: p.duracion, proc, paciente: nombre, telefono },
    sumarDias(hoyISO(), 1 + Math.floor(Math.random() * 5)), 1);
  if (!horario) return;
  const r = crearCita({ paciente: nombre, telefono, proc, duracion: p.duracion, doctor: doc.id, fecha: horario.fecha, inicio: horario.inicio, origen: 'whatsapp' });
  if (r.error) return;
  notificar('Nueva cita desde WhatsApp', `${nombre} · ${p.nombre} con ${doc.nombre} · ${fmtCorta(horario.fecha)}, ${hhmm(horario.inicio)}`, 'cita');
  registrar('Confirmación enviada por WhatsApp', `${nombre} · ${fmtCorta(horario.fecha)}, ${hhmm(horario.inicio)}`);
  guardar();
  renderNotifs();
  renderContadores();
  if (ui.vista === 'panel' && ['resumen', 'agenda', 'cola'].includes(ui.seccion) && M.caja.hidden) mostrarSeccion(ui.seccion);
}

// Cada minuto: refresca horas, botones de asistencia y ocupación.
function tic() {
  if (ui.vista === 'panel' && ['resumen', 'agenda'].includes(ui.seccion) && M.caja.hidden) mostrarSeccion(ui.seccion);
}


/* ---------------------------------------------------------
   12. EVENTOS
   --------------------------------------------------------- */

// Clics generales (delegados)
document.addEventListener('click', e => {
  const t = e.target;

  const ir = t.closest('[data-ir]');
  if (ir) { e.preventDefault(); irA(ir.dataset.ir); return; }

  const sec = t.closest('[data-seccion]');
  if (sec) { mostrarSeccion(sec.dataset.seccion); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }

  const accion = t.closest('[data-accion]');
  if (accion) {
    const cita = datos.citas.find(c => c.id === accion.dataset.cita);
    if (!cita) return;
    if (accion.dataset.accion === 'cancelar') abrirCancelar(cita);
    else marcar(cita, accion.dataset.accion);
    return;
  }

  const detalle = t.closest('[data-cita-detalle]');
  if (detalle) { const c = datos.citas.find(x => x.id === detalle.dataset.citaDetalle); if (c) abrirDetalle(c); return; }

  const quitar = t.closest('[data-quitar-bloqueo]');
  if (quitar) {
    datos.bloqueos = datos.bloqueos.filter(b => b.id !== quitar.dataset.quitarBloqueo);
    refrescar();
    toast('Bloqueo eliminado. La agenda vuelve a estar disponible.', 'ok');
    return;
  }

  const reag = t.closest('[data-reagendar]');
  if (reag) { const q = datos.cola.find(x => x.id === reag.dataset.reagendar); if (q) abrirReagendar(q); return; }

  const fecha = t.closest('#cita-fechas [data-fecha]');
  if (fecha) { ui.nueva.fecha = fecha.dataset.fecha; ui.nueva.inicio = null; actualizarNueva(); return; }

  const hora = t.closest('#cita-horarios [data-hora]');
  if (hora) { ui.nueva.inicio = Number(hora.dataset.hora); actualizarNueva(); return; }

  const filtro = t.closest('[data-filtro]');
  if (filtro) { ui.filtroNotif = filtro.dataset.filtro; renderNotifs(); return; }

  const demo = t.closest('[data-demo]');
  if (demo) {
    const [correo, clave] = demo.dataset.demo.split('|');
    $('#login-correo').value = correo;
    $('#login-clave').value = clave;
    return;
  }
});

// Acceso: pestañas
$('#tab-login').addEventListener('click', () => cambiarTabAcceso('login'));
$('#tab-registro').addEventListener('click', () => cambiarTabAcceso('registro'));
$('#reg-rol').addEventListener('change', actualizarRolRegistro);

// Inicio de sesión
$('#form-login').addEventListener('submit', e => {
  e.preventDefault();
  const error = $('#login-error');
  const correo = $('#login-correo').value.trim().toLowerCase();
  const clave = $('#login-clave').value;
  if (!correo || !clave) return mostrarError(error, 'Escribe tu correo y tu contraseña.');
  const u = usuarios.find(x => x.correo === correo && x.clave === clave);
  if (!u) return mostrarError(error, 'Correo o contraseña incorrectos.');
  const recordar = $('#login-recordar').checked;
  error.hidden = true;
  e.currentTarget.reset();
  iniciarSesion(u, recordar);
});

// Registro
$('#form-registro').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('#reg-error');
  const nombre = $('#reg-nombre').value.trim();
  const correo = $('#reg-correo').value.trim().toLowerCase();
  const rol = $('#reg-rol').value;
  const especialidad = $('#reg-especialidad').value;
  const clave = $('#reg-clave').value;

  if (nombre.length < 5) return mostrarError(error, 'Escribe tu nombre completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return mostrarError(error, 'El correo no es válido.');
  if (usuarios.some(u => u.correo === correo)) return mostrarError(error, 'Ya existe una cuenta con ese correo.');
  if (clave.length < 8) return mostrarError(error, 'La contraseña debe tener al menos 8 caracteres.');
  if (clave !== $('#reg-confirmar').value) return mostrarError(error, 'Las contraseñas no coinciden.');
  if (!$('#reg-terminos').checked) return mostrarError(error, 'Debes aceptar el tratamiento de datos.');

  let doctorId = null;
  if (rol === 'odontologo') {
    doctorId = uid('d');
    datos.doctores.push({ id: doctorId, nombre, especialidad, experiencia: null, bio: 'Nuevo integrante del equipo de la clínica.' });
    guardar();
  }
  const nuevo = { nombre, correo, clave, rol, doctorId };
  usuarios.push(nuevo);
  escribir(CLAVES.usuarios, usuarios);
  error.hidden = true;
  form.reset();
  actualizarRolRegistro();
  cambiarTabAcceso('login');
  iniciarSesion(nuevo, true);
});

// Sesión y notificaciones
$('#btn-salir').addEventListener('click', cerrarSesion);
$('#btn-notificaciones').addEventListener('click', e => {
  e.stopPropagation();
  mostrarPanelNotif($('#panel-notificaciones').hidden);
});
$('#notif-cerrar').addEventListener('click', () => mostrarPanelNotif(false));
$('#notif-limpiar').addEventListener('click', () => {
  datos.notifs.forEach(n => { n.leida = true; });
  guardar();
  renderNotifs();
});
document.addEventListener('click', e => {
  const panel = $('#panel-notificaciones');
  if (!panel.hidden && !panel.contains(e.target) && !e.target.closest('#btn-notificaciones')) mostrarPanelNotif(false);
});

// Modal
$('#modal-cerrar').addEventListener('click', cerrarModal);
M.caja.addEventListener('click', e => { if (e.target === M.caja) cerrarModal(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!M.caja.hidden) cerrarModal();
  else mostrarPanelNotif(false);
});

// Agenda
$('#ag-doctor').addEventListener('change', e => { ui.agDoctor = e.target.value; renderAgenda(); });
$('#ag-fecha').addEventListener('change', e => { if (e.target.value) { ui.agFecha = e.target.value; renderAgenda(); } });
$('#ag-anterior').addEventListener('click', () => { ui.agFecha = sumarDias(ui.agFecha, -1); renderAgenda(); });
$('#ag-hoy').addEventListener('click', () => { ui.agFecha = hoyISO(); renderAgenda(); });
$('#ag-siguiente').addEventListener('click', () => { ui.agFecha = sumarDias(ui.agFecha, 1); renderAgenda(); });

// Nueva cita
$('#cita-proc').addEventListener('change', renderNueva);
$('#cita-doctor').addEventListener('change', actualizarNueva);
$('#pac-nombre').addEventListener('change', actualizarNueva);
$('#pac-telefono').addEventListener('change', actualizarNueva);
$('#form-cita').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('#cita-error');
  const nombre = $('#pac-nombre').value.trim();
  const telefono = $('#pac-telefono').value.trim();
  const proc = $('#cita-proc').value;
  const p = procPor(proc);

  if (nombre.length < 3) return mostrarError(error, 'Escribe el nombre del paciente.');
  if (soloDigitos(telefono).length < 7) return mostrarError(error, 'Escribe un celular válido para enviarle recordatorios.');
  if (!p || ui.nueva.inicio === null) return mostrarError(error, 'Elige un horario.');

  const r = crearCita({ paciente: nombre, telefono, proc, duracion: p.duracion, doctor: $('#cita-doctor').value, fecha: ui.nueva.fecha, inicio: ui.nueva.inicio, origen: 'panel' });
  if (r.error) { mostrarError(error, r.error); actualizarNueva(); return; }

  error.hidden = true;
  registrar('Confirmación de cita enviada por WhatsApp', `${nombre} · ${p.nombre} · ${fmtCorta(r.cita.fecha)}, ${hhmm(r.cita.inicio)}`);
  notificar('Nueva cita agendada', `${nombre} · ${p.nombre} · ${fmtCorta(r.cita.fecha)}, ${hhmm(r.cita.inicio)}`, 'cita');
  form.reset();
  ui.nueva.inicio = null;
  ui.agDoctor = r.cita.doctor;
  ui.agFecha = r.cita.fecha;
  refrescar();
  toast(`Cita agendada: ${fmtCorta(r.cita.fecha)}, ${hhmm(r.cita.inicio)}–${hhmm(r.cita.inicio + r.cita.duracion)}`, 'ok');
});

// Bloqueos
$('#blq-tipo').addEventListener('change', e => { $('#blq-rango').hidden = e.target.value !== 'parcial'; });
$('#form-bloqueo').addEventListener('submit', e => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('#blq-error');
  const doctor = $('#blq-doctor').value;
  const fecha = $('#blq-fecha').value;
  const tipo = $('#blq-tipo').value;
  const motivo = $('#blq-motivo').value.trim();

  if (!doctorPor(doctor)) return mostrarError(error, 'Selecciona un odontólogo.');
  if (!fecha) return mostrarError(error, 'Elige una fecha.');
  if (fecha < hoyISO()) return mostrarError(error, 'No puedes bloquear una fecha pasada.');
  if (!esLaborable(fecha)) return mostrarError(error, 'Ese día la clínica no atiende; no hace falta bloquearlo.');

  let desde = HORARIO.apertura, hasta = HORARIO.cierre;
  if (tipo === 'parcial') {
    desde = aMin($('#blq-desde').value || '00:00');
    hasta = aMin($('#blq-hasta').value || '00:00');
    if (desde % HORARIO.paso || hasta % HORARIO.paso) return mostrarError(error, 'Usa horas en bloques de 15 minutos (ej.: 14:00 o 14:15).');
    if (desde < HORARIO.apertura || hasta > HORARIO.cierre) return mostrarError(error, `El rango debe estar entre ${hhmm(HORARIO.apertura)} y ${hhmm(HORARIO.cierre)}.`);
    if (hasta <= desde) return mostrarError(error, 'La hora final debe ser posterior a la inicial.');
  }
  if (datos.bloqueos.some(b => b.doctor === doctor && b.fecha === fecha && solapa(desde, hasta, b.desde, b.hasta))) {
    return mostrarError(error, 'Ya existe un bloqueo en ese rango.');
  }
  error.hidden = true;

  const aplicar = () => {
    const items = aplicarBloqueo({ doctor, fecha, desde, hasta, motivo: motivo || (tipo === 'parcial' ? 'Bloqueo por horas' : 'Día no laborable'), tipo });
    if (items.length) notificar('Agenda bloqueada', `${plural(items.length, 'cita pasó', 'citas pasaron')} a re-agendamiento`, 'agenda');
    form.reset();
    $('#blq-rango').hidden = true;
    cerrarModal();
    refrescar();
    toast(items.length ? `Bloqueo creado. ${plural(items.length, 'paciente enviado', 'pacientes enviados')} a re-agendamiento.` : 'Bloqueo creado.', 'ok');
  };

  const afectadas = citasAfectadas(doctor, fecha, desde, hasta);
  if (!afectadas.length) return aplicar();
  abrirModal({
    titulo: 'Hay citas en ese horario',
    tipo: 'peligro',
    cuerpo: `<p>Este bloqueo afecta ${plural(afectadas.length, 'cita', 'citas')}. Se cancelarán, se avisará a los pacientes y pasarán a re-agendamiento.</p>${listaAfectadasHTML(afectadas)}`,
    acciones: [{ texto: 'Volver', accion: cerrarModal }, { texto: 'Bloquear y re-agendar', clase: 'btn-danger', accion: aplicar }]
  });
});

// Emergencias
$('#btn-emergencia').addEventListener('click', () => {
  const fecha = ui.seccion === 'agenda' && ui.agFecha >= hoyISO() ? ui.agFecha : hoyISO();
  abrirEmergencia(ui.agDoctor, fecha);
});
$('#em-ejecutar').addEventListener('click', () => abrirEmergencia($('#em-doctor').value, $('#em-fecha').value));

// Cola
$('#cola-auto').addEventListener('click', () => {
  const r = reagendarAutomatico(colaAlcance().slice());
  if (r.ok) notificar('Re-agendamiento automático', `${plural(r.ok, 'paciente recibió', 'pacientes recibieron')} un nuevo horario`, 'agenda');
  refrescar();
  toast(`${plural(r.ok, 'paciente re-agendado', 'pacientes re-agendados')}${r.sinCupo ? ` · ${r.sinCupo} sin cupo` : ''}`, r.ok ? 'ok' : 'error');
});

// Catálogo y ajustes
$('#cat-guardar').addEventListener('click', guardarCatalogo);
$$('[data-config]').forEach(input => input.addEventListener('change', () => {
  datos.config[input.dataset.config] = input.checked;
  guardar();
  toast('Preferencia guardada', 'ok');
}));
$('#btn-reset').addEventListener('click', () => abrirModal({
  titulo: 'Restablecer datos de ejemplo',
  tipo: 'peligro',
  cuerpo: '<p>Se borrarán las citas, bloqueos y cambios hechos en este navegador y se cargarán de nuevo los datos de demostración. Las cuentas creadas se conservan.</p>',
  acciones: [
    { texto: 'Volver', accion: cerrarModal },
    { texto: 'Restablecer', clase: 'btn-danger', accion: () => {
      const registrados = datos.doctores.filter(d => !DOCTORES_BASE.some(b => b.id === d.id));
      datos = crearDatosDemo();
      datos.doctores.push(...registrados);
      cerrarModal();
      ui.seccion = 'resumen';
      refrescar();
      renderPanel();
      toast('Datos de ejemplo restablecidos', 'ok');
    } }
  ]
}));


/* ---------------------------------------------------------
   13. INICIO
   --------------------------------------------------------- */
function iniciar() {
  datos = leer(CLAVES.datos, null);
  if (!datos || !Array.isArray(datos.citas)) {
    datos = crearDatosDemo();
    guardar();
  }
  usuarios = leer(CLAVES.usuarios, null);
  if (!Array.isArray(usuarios)) {
    usuarios = clonar(USUARIOS_BASE);
    escribir(CLAVES.usuarios, usuarios);
  }
  const correo = leerSesion();
  usuario = usuarios.find(u => u.correo === correo) || null;

  actualizarRolRegistro();
  renderSesion();
  irA(usuario ? 'panel' : 'paciente');
  setInterval(tic, 60000);
  setInterval(simularChatbot, 45000);
}

iniciar();