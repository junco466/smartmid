// Inicio de sesión con JWT y control de alcance (odontólogo vs. administrador).
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');
const equipo = require('./equipo');
const { cifrarClave, verificarClave } = require('./claves');

let SECRETO = process.env.JWT_SECRET;
if (!SECRETO) {
  SECRETO = crypto.randomBytes(32).toString('hex');
  console.warn('JWT_SECRET no está definido en .env: las sesiones se cerrarán cada vez que se reinicie el servidor.');
}
const DURACION_SESION = process.env.JWT_DURACION || '12h';

// Las cuentas de odontólogos desactivados no pueden iniciar sesión.
const COLS_USUARIO = 'u.id, u.nombre, u.correo, u.rol, u.doctor_id AS doctorId';
const ACTIVO = 'LEFT JOIN doctores d ON d.id = u.doctor_id WHERE (u.doctor_id IS NULL OR d.activo = 1)';
const usuarioPor = id => db.prepare(`SELECT ${COLS_USUARIO} FROM usuarios u ${ACTIVO} AND u.id = ?`).get(id);

// Cada cambio de contraseña sube la versión de sesión: los tokens emitidos antes dejan de servir.
const versionSesion = id => db.prepare('SELECT sesion_version FROM usuarios WHERE id = ?').get(id)?.sesion_version ?? 0;
const emitirToken = u => jwt.sign({ sub: String(u.id), rol: u.rol, v: versionSesion(u.id) }, SECRETO, { expiresIn: DURACION_SESION });

function login(correo, clave) {
  const fila = db.prepare(`SELECT u.id, u.clave_hash FROM usuarios u ${ACTIVO} AND u.correo = ?`).get(String(correo || '').trim().toLowerCase());
  if (!fila || !verificarClave(clave, fila.clave_hash)) return null;
  const usuario = usuarioPor(fila.id);
  return { token: emitirToken(usuario), usuario };
}

// Crea la cuenta y, si es odontólogo, también su perfil en la agenda.
function registrar({ nombre, correo, clave, rol, especialidad }) {
  nombre = String(nombre || '').trim();
  correo = String(correo || '').trim().toLowerCase();
  if (nombre.length < 5) return { error: 'Escribe el nombre completo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return { error: 'El correo no es válido.' };
  if (String(clave || '').length < 8) return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  if (!['admin', 'odontologo'].includes(rol)) return { error: 'Rol no válido.' };
  if (db.prepare('SELECT 1 FROM usuarios WHERE correo = ?').get(correo)) return { error: 'Ya existe una cuenta con ese correo.' };

  if (rol === 'odontologo') {
    const r = equipo.guardarDoctor(null, { nombre, especialidades: [especialidad], correo, clave, bio: 'Nuevo integrante del equipo de la clínica.' });
    if (r.error) return r;
  } else {
    db.prepare(`INSERT INTO usuarios (nombre, correo, clave_hash, rol) VALUES (?, ?, ?, 'admin')`).run(nombre, correo, cifrarClave(clave));
  }
  const { id } = db.prepare('SELECT id FROM usuarios WHERE correo = ?').get(correo);
  return { usuario: usuarioPor(id) };
}

function leerUsuario(req) {
  const [tipo, token] = String(req.headers.authorization || '').split(' ');
  if (tipo !== 'Bearer' || !token) return null;
  try {
    const { sub, v = 0 } = jwt.verify(token, SECRETO);
    if (v !== versionSesion(Number(sub))) return null; // la contraseña cambió después de emitir este token
    return usuarioPor(Number(sub)) || null;
  } catch (e) {
    return null;
  }
}

// El usuario cambia su propia contraseña. Cierra sus demás sesiones y devuelve un token nuevo para esta.
function cambiarClave(id, actual, nueva) {
  const fila = db.prepare('SELECT clave_hash FROM usuarios WHERE id = ?').get(id);
  if (!fila) return { error: 'La cuenta no existe.' };
  if (!verificarClave(actual, fila.clave_hash)) return { error: 'La contraseña actual no es correcta.' };
  nueva = String(nueva || '');
  if (nueva.length < 8) return { error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  if (nueva === actual) return { error: 'La nueva contraseña debe ser distinta de la actual.' };
  db.prepare('UPDATE usuarios SET clave_hash = ?, sesion_version = sesion_version + 1 WHERE id = ?').run(cifrarClave(nueva), id);
  return { token: emitirToken(usuarioPor(id)) };
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

module.exports = { login, registrar, cambiarClave, leerUsuario, requiereSesion, requiereAdmin, esAdmin, alcance, puedeVer };
