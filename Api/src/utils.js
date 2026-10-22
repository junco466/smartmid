// Utilidades de fechas, horas y teléfonos (copiadas del prototipo web).
const { HORARIO } = require('./config');

const pad = n => String(n).padStart(2, '0');

const aISO = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const deISO = iso => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };
const hoyISO = () => aISO(new Date());
const sumarDias = (iso, n) => { const d = deISO(iso); d.setDate(d.getDate() + n); return aISO(d); };
const ahoraMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const aMin = txt => { const [h, m] = String(txt).split(':').map(Number); return h * 60 + (m || 0); };
const esLaborable = iso => HORARIO.diasLaborables.includes(deISO(iso).getDay());
const solapa = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;
const soloDigitos = txt => String(txt || '').replace(/\D/g, '');
const cap = txt => (txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : '');
const fmtCorta = iso => cap(deISO(iso).toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' }));

// Verifica que la fecha tenga formato AAAA-MM-DD y que exista.
function esFechaValida(fecha) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha))) return false;
  const [a, m, d] = fecha.split('-').map(Number);
  const f = new Date(a, m - 1, d);
  return f.getFullYear() === a && f.getMonth() === m - 1 && f.getDate() === d;
}

// Minutos de atención dentro de un rango (sin contar el almuerzo).
function minutosLaborales(desde, hasta) {
  const ini = Math.max(desde, HORARIO.apertura), fin = Math.min(hasta, HORARIO.cierre);
  if (fin <= ini) return 0;
  const almuerzo = Math.max(0, Math.min(fin, HORARIO.almuerzoFin) - Math.max(ini, HORARIO.almuerzoInicio));
  return fin - ini - almuerzo;
}

// Deja el teléfono en un solo formato: solo dígitos y con el código de Colombia (57).
// "300 123 4567", "+57 3001234567" y "573001234567@s.whatsapp.net" quedan como "573001234567".
function normalizarTelefono(txt) {
  const digitos = soloDigitos(String(txt || '').split('@')[0]);
  if (digitos.length === 10 && digitos.startsWith('3')) return '57' + digitos;
  return digitos;
}

module.exports = {
  pad, aISO, deISO, hoyISO, sumarDias, ahoraMin, hhmm, aMin, esLaborable, solapa,
  soloDigitos, fmtCorta, esFechaValida, minutosLaborales, normalizarTelefono
};
