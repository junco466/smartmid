// Inicio de sesión con JWT y control de alcance (odontólogo vs. administrador).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { cifrarClave, verificarClave } = require('./claves');
const { ESPECIALIDADES } = require('./config');

let SECRETO = process.env.JWT_SECRET;
if (!SECRETO) {
  SECRETO = crypto.randomBytes(32).toString('hex');
  console.warn('JWT_SECRET no está definido en .env: las sesiones se cerrarán cada vez que se reinicie el servidor.');
}
const DURACION_SESION = process.env.JWT_DURACION || '12h';

const COLS_USUARIO = 'id, nombre, correo, rol, doctor_id AS doctorId';
const usuarioPor = id => db.prepare(`SELECT ${COLS_USUARIO} FROM usuarios WHERE id = ?`).get(id);

const emitirToken = u => jwt.sign({ sub: String(u.id), rol: u.rol }, SECRETO, { expiresIn: DURACION_SESION });

function login(correo, clave) {
  const fila = db.prepare('SELECT id, clave_hash FROM usuarios WHERE correo = ?').get(String(correo || '').trim().toLowerCase());
  if (!fila || !verificarClave(clave, fila.clave_hash)) return null;
  const usuario = usuarioPor(fila.id);
  return { token: emitirToken(usuario), usuario };
}

// Crea la cuenta y, si es odontólogo, también su perfil en la agenda.
const registrar = db.transaction(({ nombre, correo, clave, rol, especialidad }) => {
  nombre = String(nombre || '').trim();
  correo = String(correo || '').trim().toLowerCase();
  if (nombre.length < 5) return { error: 'Escribe el nombre completo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: 'El correo no es válido.' };
  if (String(clave || '').length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  if (!['admin', 'odontologo'].includes(rol)) return { error: 'Rol no válido.' };
  if (rol === 'odontologo' && !ESPECIALIDADES[especialidad]) return { error: 'Especialidad no válida.' };
  if (db.prepare('SELECT 1 FROM usuarios WHERE correo = ?').get(correo)) return { error: 'Ya existe una cuenta con ese correo.' };

  let doctorId = null;
  if (rol === 'odontologo') {
    doctorId = 'd' + Date.now().toString(36);
    db.prepare('INSERT INTO doctores (id, nombre, especialidad, bio) VALUES (?, ?, ?, ?)')
      .run(doctorId, nombre, especialidad, 'Nuevo integrante del equipo de la clínica.');
  }
  const r = db.prepare('INSERT INTO usuarios (nombre, correo, clave_hash, rol, doctor_id) VALUES (?, ?, ?, ?, ?)')
    .run(nombre, correo, cifrarClave(clave), rol, doctorId);
  return { usuario: usuarioPor(r.lastInsertRowid) };
});

function leerUsuario(req) {
  const [tipo, token] = String(req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return null;
  try {
    const { sub } = jwt.verify(token, SECRETO);
    return usuarioPor(Number(sub)) || null;
  } catch (e) {
    return null;
  }
}

// Middleware: exige una sesión válida y deja el usuario en req.usuario.
function requiereSesion(req, res, next) {
  const usuario = leerUsuario(req);
  if (!usuario) return res.status(401).json({ error: 'Inicia sesión para continuar.' });
  req.usuario = usuario;
  next();
}

function requiereAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo el administrador puede hacer esto.' });
  next();
}

const esAdmin = req => req.usuario?.rol === 'admin';

// Odontólogo: siempre su propia agenda. Administrador: la que pida, o toda la clínica.
function alcance(req, doctorPedido) {
  if (esAdmin(req)) return doctorPedido || null;
  return req.usuario.doctorId;
}

// ¿Puede el usuario actuar sobre la agenda de este odontólogo?
const puedeVer = (req, doctor) => esAdmin(req) || (!!doctor && doctor === req.usuario.doctorId);

module.exports = { login, registrar, leerUsuario, requiereSesion, requiereAdmin, esAdmin, alcance, puedeVer };
