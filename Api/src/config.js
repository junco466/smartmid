// Reglas fijas de la clínica. Son las mismas que usaba el prototipo web.

// Horario de la clínica, en minutos desde la medianoche.
const HORARIO = {
  apertura: 8 * 60,                 // 08:00
  cierre: 17 * 60,                  // 17:00
  almuerzoInicio: 12 * 60,          // 12:00
  almuerzoFin: 13 * 60,             // 13:00
  paso: 15,                         // bloques de 15 minutos
  diasLaborables: [1, 2, 3, 4, 5, 6] // lunes a sábado (0 = domingo)
};

// Las especialidades, los motivos, el catálogo y los odontólogos de este archivo solo se usan
// para llenar una base de datos nueva. Después se administran desde el panel ("Equipo y servicios").

// Qué procedimientos puede hacer cada especialidad.
const ESPECIALIDADES = {
  general:     { nombre: 'Odontología general y estética', procs: ['val', 'lim', 'rx', 'res', 'ext', 'ble'] },
  endodoncia:  { nombre: 'Endodoncia', procs: ['val', 'rx', 'end'] },
  ortodoncia:  { nombre: 'Ortodoncia', procs: ['val', 'ort'] },
  periodoncia: { nombre: 'Periodoncia', procs: ['val', 'lim', 'rx'] },
  cirugia:     { nombre: 'Cirugía oral', procs: ['val', 'rx', 'ext'] }
};

// Guía de especialistas para pacientes.
const MOTIVOS = [
  { motivo: 'Dolor fuerte o sensibilidad al frío o al calor', especialidad: 'endodoncia', detalle: 'Puede indicar que el nervio del diente está comprometido.' },
  { motivo: 'Dientes desalineados o problemas de mordida', especialidad: 'ortodoncia', detalle: 'Brackets, alineadores y controles de ortodoncia.' },
  { motivo: 'Limpieza, caries o revisión general', especialidad: 'general', detalle: 'Prevención, limpiezas y resinas para caries.' },
  { motivo: 'Mejorar el color o la forma de mis dientes', especialidad: 'general', detalle: 'Blanqueamiento y resinas estéticas.' },
  { motivo: 'Encías inflamadas o que sangran', especialidad: 'periodoncia', detalle: 'Tratamiento de encías y tejidos de soporte.' },
  { motivo: 'Muela del juicio o extracción', especialidad: 'cirugia', detalle: 'Extracciones simples y valoración quirúrgica.' }
];

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

// Cuentas de prueba (las contraseñas se guardan cifradas al sembrarlas).
const USUARIOS_BASE = [
  { nombre: 'Dra. Camila Restrepo', correo: 'camila@smartmind.co', clave: 'demo1234', rol: 'odontologo', doctorId: 'd1' },
  { nombre: 'Administración Smart Mind', correo: 'admin@smartmind.co', clave: 'admin1234', rol: 'admin', doctorId: null }
];

const CONFIG_BASE = { rec24: true, rec2: true, autoReagendar: true, avisoEmergencia: true };

const ESTADOS = ['programada', 'asistida', 'noasistio', 'cancelada'];
const ORIGENES = ['whatsapp', 'panel', 'reagendada'];
const TIPOS_BLOQUEO = ['completo', 'parcial', 'emergencia'];

module.exports = {
  HORARIO,
  ESPECIALIDADES,
  MOTIVOS,
  CATALOGO_BASE,
  DOCTORES_BASE,
  USUARIOS_BASE,
  CONFIG_BASE,
  ESTADOS,
  ORIGENES,
  TIPOS_BLOQUEO
};
