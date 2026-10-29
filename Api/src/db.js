// Base de datos única de Smart Mind: la usan el chatbot de WhatsApp y el panel web.
const path = require('path');
const Database = require('better-sqlite3');
const {
  CATALOGO_BASE, DOCTORES_BASE, USUARIOS_BASE, CONFIG_BASE, ESPECIALIDADES, MOTIVOS,
  ESTADOS, ORIGENES, TIPOS_BLOQUEO
} = require('./config');
const { cifrarClave } = require('./claves');

const db = new Database(process.env.DB_PATH || path.join(__dirname, '..', 'smartmind.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const lista = valores => valores.map(v => `'${v}'`).join(', ');

// La primera versión del bot guardaba citas sin odontólogo ni procedimiento.
// Esa tabla se conserva como "citas_legacy" para no perder los datos.
const columnasCitas = db.prepare(`SELECT name FROM pragma_table_info('citas')`).all().map(c => c.name);
if (columnasCitas.includes('hora')) {
  db.exec('ALTER TABLE citas RENAME TO citas_legacy');
  console.log('Tabla de citas antigua renombrada a citas_legacy.');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS doctores (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    experiencia INTEGER,
    bio TEXT,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS procedimientos (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    duracion INTEGER NOT NULL CHECK (duracion > 0 AND duracion % 15 = 0),
    precio INTEGER NOT NULL CHECK (precio >= 0),
    tipo TEXT,
    orden INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS especialidades (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    orden INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1
  );

  -- Qué procedimientos incluye cada especialidad.
  CREATE TABLE IF NOT EXISTS especialidad_procs (
    especialidad_id TEXT NOT NULL REFERENCES especialidades(id) ON DELETE CASCADE,
    proc_id TEXT NOT NULL REFERENCES procedimientos(id) ON DELETE CASCADE,
    PRIMARY KEY (especialidad_id, proc_id)
  );

  -- Un odontólogo puede tener varias especialidades.
  CREATE TABLE IF NOT EXISTS doctor_especialidades (
    doctor_id TEXT NOT NULL REFERENCES doctores(id) ON DELETE CASCADE,
    especialidad_id TEXT NOT NULL REFERENCES especialidades(id) ON DELETE CASCADE,
    PRIMARY KEY (doctor_id, especialidad_id)
  );

  -- Guía "¿Qué especialista necesito?" que usan la página y el chatbot.
  CREATE TABLE IF NOT EXISTS motivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    motivo TEXT NOT NULL,
    especialidad_id TEXT NOT NULL REFERENCES especialidades(id),
    detalle TEXT,
    orden INTEGER NOT NULL DEFAULT 0,
    activo INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    correo TEXT NOT NULL UNIQUE,
    clave_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin', 'odontologo')),
    doctor_id TEXT REFERENCES doctores(id),
    creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- fecha: AAAA-MM-DD · inicio y duracion: minutos (inicio 840 = 14:00)
  CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paciente TEXT NOT NULL,
    telefono TEXT NOT NULL DEFAULT '',
    proc TEXT NOT NULL REFERENCES procedimientos(id),
    duracion INTEGER NOT NULL CHECK (duracion > 0 AND duracion % 15 = 0),
    doctor_id TEXT NOT NULL REFERENCES doctores(id),
    fecha TEXT NOT NULL,
    inicio INTEGER NOT NULL CHECK (inicio % 15 = 0),
    estado TEXT NOT NULL DEFAULT 'programada' CHECK (estado IN (${lista(ESTADOS)})),
    origen TEXT NOT NULL DEFAULT 'panel' CHECK (origen IN (${lista(ORIGENES)})),
    motivo_cancelacion TEXT,
    rec24_enviado INTEGER NOT NULL DEFAULT 0,
    rec2_enviado INTEGER NOT NULL DEFAULT 0,
    creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_citas_doctor_fecha ON citas (doctor_id, fecha);
  CREATE INDEX IF NOT EXISTS idx_citas_telefono ON citas (telefono);

  CREATE TABLE IF NOT EXISTS bloqueos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id TEXT NOT NULL REFERENCES doctores(id),
    fecha TEXT NOT NULL,
    desde INTEGER NOT NULL,
    hasta INTEGER NOT NULL CHECK (hasta > desde),
    motivo TEXT,
    tipo TEXT NOT NULL CHECK (tipo IN (${lista(TIPOS_BLOQUEO)})),
    creado TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_bloqueos_doctor_fecha ON bloqueos (doctor_id, fecha);

  -- Pacientes cuya cita se canceló y esperan un nuevo horario.
  CREATE TABLE IF NOT EXISTS cola (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cita_id INTEGER REFERENCES citas(id),
    paciente TEXT NOT NULL,
    telefono TEXT NOT NULL DEFAULT '',
    proc TEXT NOT NULL REFERENCES procedimientos(id),
    duracion INTEGER NOT NULL,
    doctor_id TEXT NOT NULL REFERENCES doctores(id),
    fecha_original TEXT NOT NULL,
    inicio_original INTEGER NOT NULL,
    motivo TEXT,
    creado INTEGER NOT NULL
  );

  -- Registro de mensajes de WhatsApp (t en milisegundos).
  CREATE TABLE IF NOT EXISTS mensajes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    t INTEGER NOT NULL,
    telefono TEXT,
    titulo TEXT NOT NULL,
    detalle TEXT,
    doctor_id TEXT
  );

  CREATE TABLE IF NOT EXISTS notificaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    t INTEGER NOT NULL,
    titulo TEXT NOT NULL,
    detalle TEXT,
    tipo TEXT NOT NULL DEFAULT 'agenda',
    doctor_id TEXT,
    leida INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS config (
    clave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );

  -- En qué paso de la conversación va cada paciente del chatbot (sobrevive a reinicios).
  CREATE TABLE IF NOT EXISTS sesiones_bot (
    telefono TEXT PRIMARY KEY,
    estado TEXT NOT NULL,
    actualizado INTEGER NOT NULL
  );

  -- Pacientes que han escrito por WhatsApp: el bot los saluda por su nombre.
  CREATE TABLE IF NOT EXISTS pacientes (
    telefono TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    actualizado INTEGER NOT NULL
  );
`);

const columnas = tabla => db.prepare(`SELECT name FROM pragma_table_info('${tabla}')`).all().map(c => c.name);
const vacia = tabla => !db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get().n;

// Bases creadas antes de que el catálogo se administrara desde el panel.
if (!columnas('procedimientos').includes('activo')) {
  db.exec('ALTER TABLE procedimientos ADD COLUMN activo INTEGER NOT NULL DEFAULT 1');
}

// Carga los datos iniciales solo en tablas vacías: después todo se administra desde el panel.
function sembrar() {
  const insProc = db.prepare('INSERT INTO procedimientos (id, nombre, duracion, precio, tipo, orden) VALUES (?, ?, ?, ?, ?, ?)');
  const insEsp = db.prepare('INSERT INTO especialidades (id, nombre, orden) VALUES (?, ?, ?)');
  const insEspProc = db.prepare('INSERT OR IGNORE INTO especialidad_procs (especialidad_id, proc_id) VALUES (?, ?)');
  const insDoctor = db.prepare('INSERT INTO doctores (id, nombre, experiencia, bio) VALUES (@id, @nombre, @experiencia, @bio)');
  const insDocEsp = db.prepare('INSERT OR IGNORE INTO doctor_especialidades (doctor_id, especialidad_id) VALUES (?, ?)');
  const insMotivo = db.prepare('INSERT INTO motivos (motivo, especialidad_id, detalle, orden) VALUES (?, ?, ?, ?)');
  const insConfig = db.prepare('INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)');
  const insUsuario = db.prepare('INSERT INTO usuarios (nombre, correo, clave_hash, rol, doctor_id) VALUES (?, ?, ?, ?, ?)');

  db.transaction(() => {
    if (vacia('procedimientos')) {
      Object.entries(CATALOGO_BASE).forEach(([id, p], i) => insProc.run(id, p.nombre, p.duracion, p.precio, p.tipo, i));
    }
    if (vacia('especialidades')) {
      Object.entries(ESPECIALIDADES).forEach(([id, e], i) => {
        insEsp.run(id, e.nombre, i);
        e.procs.forEach(proc => insEspProc.run(id, proc));
      });
    }

    // Antes cada odontólogo tenía una sola especialidad en la columna doctores.especialidad.
    if (columnas('doctores').includes('especialidad')) {
      db.exec(`INSERT OR IGNORE INTO doctor_especialidades (doctor_id, especialidad_id)
        SELECT d.id, d.especialidad FROM doctores d JOIN especialidades e ON e.id = d.especialidad`);
      db.exec('ALTER TABLE doctores DROP COLUMN especialidad');
      console.log('Especialidades de los odontólogos migradas a doctor_especialidades.');
    }

    if (vacia('doctores')) {
      DOCTORES_BASE.forEach(d => {
        insDoctor.run(d);
        insDocEsp.run(d.id, d.especialidad);
      });
    }
    if (vacia('motivos')) {
      MOTIVOS.forEach((m, i) => insMotivo.run(m.motivo, m.especialidad, m.detalle, i));
    }
    Object.entries(CONFIG_BASE).forEach(([clave, valor]) => insConfig.run(clave, JSON.stringify(valor)));
    if (vacia('usuarios')) {
      USUARIOS_BASE.forEach(u => insUsuario.run(u.nombre, u.correo, cifrarClave(u.clave), u.rol, u.doctorId));
    }
  })();
}
sembrar();

module.exports = db;
