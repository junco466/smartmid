const Database = require("better-sqlite3");

const db = new Database("smartmind.db");

// Crear tabla de citas
db.exec(`
  CREATE TABLE IF NOT EXISTS citas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL,
    fecha TEXT NOT NULL,
    hora TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'confirmada',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Buscar horarios disponibles
function horariosDisponibles(fecha) {
  const horarios = [
    "09:00",
    "10:00",
    "11:00",
    "14:00",
    "15:00",
    "16:00"
  ];

  const ocupados = db.prepare(`
    SELECT hora FROM citas
    WHERE fecha = ?
    AND estado = 'confirmada'
  `).all(fecha);

  const horasOcupadas = ocupados.map(cita => cita.hora);

  return horarios.filter(hora => !horasOcupadas.includes(hora));
}

// Crear cita
function crearCita(nombre, telefono, fecha, hora) {
  const existe = db.prepare(`
    SELECT id FROM citas
    WHERE fecha = ?
    AND hora = ?
    AND estado = 'confirmada'
  `).get(fecha, hora);

  if (existe) {
    return null;
  }

  const resultado = db.prepare(`
    INSERT INTO citas (nombre, telefono, fecha, hora)
    VALUES (?, ?, ?, ?)
  `).run(nombre, telefono, fecha, hora);

  return resultado.lastInsertRowid;
}

// Buscar citas de un paciente
function buscarCitas(telefono) {
  return db.prepare(`
    SELECT * FROM citas
    WHERE telefono = ?
    AND estado = 'confirmada'
    ORDER BY fecha, hora
  `).all(telefono);
}

// Cancelar cita
function cancelarCita(id, telefono) {
  const resultado = db.prepare(`
    UPDATE citas
    SET estado = 'cancelada'
    WHERE id = ?
    AND telefono = ?
    AND estado = 'confirmada'
  `).run(id, telefono);

  return resultado.changes > 0;
}

module.exports = {
  horariosDisponibles,
  crearCita,
  buscarCitas,
  cancelarCita
};