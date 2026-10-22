// Cifrado de contraseñas con scrypt (incluido en Node, sin dependencias externas).
const crypto = require('crypto');

function cifrarClave(clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(clave), sal, 64).toString('hex');
  return `${sal}:${hash}`;
}

function verificarClave(clave, guardada) {
  const [sal, hash] = String(guardada || '').split(':');
  if (!sal || !hash) return false;
  const calculado = crypto.scryptSync(String(clave), sal, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calculado.length && crypto.timingSafeEqual(esperado, calculado);
}

module.exports = { cifrarClave, verificarClave };
