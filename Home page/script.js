/* =========================================================
   SMART MIND · script.js
   Acceso, agenda sin cruces, re-agendamiento, bloqueos,
   emergencias, estadísticas en vivo y catálogo.
   Los datos viven en el servidor (API /api): la misma base
   que usa el chatbot de WhatsApp.
   ========================================================= */
'use strict';

/* ---------------------------------------------------------
   1. CONFIGURACIÓN
   --------------------------------------------------------- */

// Valores por defecto; al cargar se reemplazan por los que envía el servidor.
let WHATSAPP_NUMERO = '573144914328';
let HORARIO = { apertura: 480, cierre: 1020, almuerzoInicio: 720, almuerzoFin: 780, paso: 15, diasLaborables: [1, 2, 3, 4, 5, 6] };
let ESPECIALIDADES = {};
let MOTIVOS = [];

const ESTADOS = { programada: 'Programada', asistida: 'Asistida', noasistio: 'No asistió', cancelada: 'Cancelada' };
const ORIGENES = { whatsapp: 'Chatbot de WhatsApp', panel: 'Agendada en el panel', reagendada: 'Re-agendamiento' };
const CLAVE_TOKEN = 'smartmind-token-v2';
const DIAS_HISTORIAL = 30;      // días hacia atrás que se cargan en el panel
const REFRESCO_MS = 30000;      // cada cuánto se consulta el servidor


/* ---------------------------------------------------------
   2. UTILIDADES
   --------------------------------------------------------- */
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const pad = n => String(n).padStart(2, '0');

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
const porId = (lista, id) => lista.find(x => String(x.id) === String(id));
const consulta = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

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


/* ---------------------------------------------------------
   3. CONEXIÓN CON LA API
   --------------------------------------------------------- */
let token = null;

// Llama a /api<ruta>. Si el servidor responde con error, lanza un Error con su mensaje.
async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  const headers = {};
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let r;
  try {
    r = await fetch(`/api${ruta}`, { method: metodo, headers, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor.');
  }
  if (r.status === 204) return null;
  let datosRespuesta = null;
  try { datosRespuesta = await r.json(); } catch (e) { /* respuesta sin cuerpo */ }

  if (r.status === 401 && token && ruta !== '/auth/login') sesionExpirada();
  if (!r.ok) {
    const error = new Error(datosRespuesta?.error || 'Ocurrió un error en el servidor.');
    error.status = r.status;
    throw error;
  }
  return datosRespuesta;
}

// El token se guarda en localStorage ("mantener sesión") o solo en esta pestaña.
function guardarToken(valor, recordar) {
  try {
    localStorage.removeItem(CLAVE_TOKEN);
    sessionStorage.removeItem(CLAVE_TOKEN);
    (recordar ? localStorage : sessionStorage).setItem(CLAVE_TOKEN, valor);
  } catch (e) { /* sin almacenamiento: la sesión dura mientras la página esté abierta */ }
}
function leerToken() {
  try { return localStorage.getItem(CLAVE_TOKEN) || sessionStorage.getItem(CLAVE_TOKEN); } catch (e) { return null; }
}
function borrarToken() {
  try { localStorage.removeItem(CLAVE_TOKEN); sessionStorage.removeItem(CLAVE_TOKEN); } catch (e) { /* sin almacenamiento */ }
}


/* ---------------------------------------------------------
   4. ESTADO (copia local de lo que hay en el servidor)
   --------------------------------------------------------- */
const datosVacios = () => ({
  doctores: [], catalogo: {}, citas: [], bloqueos: [], cola: [], registro: [], notifs: [], config: {}, stats: null,
  diaExtra: null // citas de un día anterior al historial cargado (agenda)
});
let datos = datosVacios();
let usuario = null;
const ui = {
  vista: 'paciente',
  seccion: 'resumen',
  agDoctor: null,
  agFecha: hoyISO(),
  nueva: { fecha: null, inicio: null, libres: [], consulta: 0 },
  filtroNotif: 'todas'
};

const doctorPor = id => datos.doctores.find(d => d.id === id);
const procPor = id => datos.catalogo[id];
const nombreProc = id => procPor(id)?.nombre || 'Procedimiento';
const nombreDoc = id => doctorPor(id)?.nombre || 'Odontólogo';
const puedeHacer = (doc, proc) => !!doc && (ESPECIALIDADES[doc.especialidad]?.procs || []).includes(proc);
const esAdmin = () => usuario?.rol === 'admin';
const doctoresVisibles = () => (esAdmin() || !usuario?.doctorId) ? datos.doctores : datos.doctores.filter(d => d.id === usuario.doctorId);
const inicioHistorial = () => sumarDias(hoyISO(), -DIAS_HISTORIAL);

// Información pública: equipo, catálogo, especialidades y horario.
async function cargarPublico() {
  const info = await api('/publico/info');
  HORARIO = info.horario;
  ESPECIALIDADES = info.especialidades;
  MOTIVOS = info.motivos;
  if (info.whatsapp) WHATSAPP_NUMERO = info.whatsapp;
  datos.doctores = info.doctores;
  datos.catalogo = info.catalogo;
}

// Todo lo que necesita el panel. El servidor ya filtra según el rol del usuario.
async function cargarPanel() {
  const desde = inicioHistorial();
  const [, citas, bloqueos, cola, registro, notifs, config, stats] = await Promise.all([
    cargarPublico(),
    api(`/citas?${consulta({ desde })}`),
    api(`/bloqueos?${consulta({ desde })}`),
    api('/cola'),
    api('/mensajes'),
    api('/notificaciones'),
    api('/config'),
    api('/estadisticas')
  ]);
  Object.assign(datos, { citas, bloqueos, cola, registro, notifs, config, stats });
}

// Vuelve a pedir los datos y redibuja. Se usa después de cada cambio.
async function recargar() {
  try {
    await cargarPanel();
  } catch (e) {
    toast(e.message, 'error');
  }
  refrescar();
}

// Ejecuta una operación en el servidor: muestra el error si falla y recarga si sale bien.
async function ejecutar(operacion) {
  try {
    const r = await operacion();
    await recargar();
    return r;
  } catch (e) {
    toast(e.message, 'error');
    return null;
  }
}


/* ---------------------------------------------------------
   5. OPERACIONES (todas pasan por la API)
   --------------------------------------------------------- */
const citasAlcance = () => datos.citas;
const colaAlcance = () => datos.cola;

async function marcar(cita, estado) {
  if (cita.estado !== 'programada') return;
  const r = await ejecutar(() => api(`/citas/${cita.id}/asistencia`, { metodo: 'PATCH', cuerpo: { estado } }));
  if (!r) return;
  cerrarModal();
  toast(estado === 'asistida' ? `${cita.paciente}: asistencia registrada` : `${cita.paciente}: inasistencia registrada`, 'ok');
}

async function reagendarAutomatico(ids) {
  return ejecutar(() => api('/cola/reagendar-auto', { metodo: 'POST', cuerpo: ids ? { ids } : {} }));
}


/* ---------------------------------------------------------
   6. NAVEGACIÓN Y SESIÓN
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

async function iniciarSesion(respuesta, recordar) {
  token = respuesta.token;
  usuario = respuesta.usuario;
  guardarToken(token, recordar);
  try {
    await cargarPanel();
  } catch (e) {
    toast(e.message, 'error');
  }
  ui.agDoctor = null;
  ui.seccion = 'resumen';
  renderSesion();
  irA('panel');
  toast(`Bienvenido(a), ${usuario.nombre}`, 'ok');
}

function salir() {
  token = null;
  usuario = null;
  borrarToken();
  const { doctores, catalogo } = datos;
  datos = { ...datosVacios(), doctores, catalogo };
  cerrarModal();
  renderSesion();
}

function cerrarSesion() {
  salir();
  irA('paciente');
  toast('Sesión cerrada');
}

// El servidor rechazó el token (expiró o ya no es válido).
function sesionExpirada() {
  if (!usuario) return;
  salir();
  irA('acceso');
  toast('Tu sesión expiró. Vuelve a ingresar.', 'error');
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

// Desactiva el botón de envío mientras el servidor responde.
async function conBotonOcupado(form, tarea) {
  const boton = form.querySelector('[type="submit"]');
  if (boton) boton.disabled = true;
  try { return await tarea(); } finally { if (boton) boton.disabled = false; }
}


/* ---------------------------------------------------------
   7. VISTA PACIENTES (información + enlaces a WhatsApp)
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
    const esp = ESPECIALIDADES[m.especialidad] || { nombre: '' };
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
   8. PANEL DEL ODONTÓLOGO
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
  const opciones = docs.map(d => `<option value="${esc(d.id)}">${esc(d.nombre)}</option>`).join('');
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

/* --- 8.1 Resumen y estadísticas --- */

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
  const s = datos.stats || { asistidas: 0, canceladas: 0, noasistio: 0, programadas: 0, tasa: 0, ocupacion: 0 };
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

/* --- 8.2 Elementos de cita reutilizables --- */
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

// Busca una cita en lo cargado (incluye el día extra de la agenda).
const citaPorId = id => porId(datos.citas, id) || porId(datos.diaExtra?.citas || [], id);

/* --- 8.3 Agenda (calendario por odontólogo) --- */
function eventoHTML({ inicio, fin, estado, titulo, meta = '', id = null }) {
  const fila = (inicio - HORARIO.apertura) / HORARIO.paso + 1;
  const bloques = Math.max(1, (fin - inicio) / HORARIO.paso);
  const etiqueta = id ? 'button' : 'div';
  const atributos = id ? ` type="button" data-cita-detalle="${id}"` : '';
  return `<${etiqueta} class="cal-event${bloques <= 1 ? ' is-short' : ''}" data-estado="${estado}" style="--row:${fila}; --span:${bloques}"${atributos}>
    <span class="cal-event-time">${hhmm(inicio)}–${hhmm(fin)}</span><span class="cal-event-title">${esc(titulo)}</span>${meta ? `<span class="cal-event-meta">${esc(meta)}</span>` : ''}
  </${etiqueta}>`;
}

// Citas de un día. Si es anterior al historial cargado, se piden al servidor.
function citasDelDia(doctor, fecha) {
  if (fecha >= inicioHistorial()) return datos.citas.filter(c => c.doctor === doctor && c.fecha === fecha);
  const clave = `${doctor}|${fecha}`;
  if (datos.diaExtra?.clave === clave) return datos.diaExtra.citas;
  if (datos.diaExtra?.pendiente !== clave) {
    datos.diaExtra = { pendiente: clave };
    api(`/citas?${consulta({ doctor, fecha })}`)
      .then(citas => { datos.diaExtra = { clave, citas }; if (ui.seccion === 'agenda') renderAgenda(); })
      .catch(e => { datos.diaExtra = null; toast(e.message, 'error'); });
  }
  return null;
}

function renderAgenda() {
  const sel = $('#ag-doctor');
  if (ui.agDoctor && sel.value !== ui.agDoctor) sel.value = ui.agDoctor;
  $('#ag-fecha').value = ui.agFecha;

  const grid = $('#calendar-grid');
  const fecha = ui.agFecha;
  const doc = doctorPor(ui.agDoctor);
  const delDia = citasDelDia(ui.agDoctor, fecha);
  if (delDia === null) {
    grid.classList.add('is-empty');
    grid.innerHTML = '<p class="cal-empty">Cargando agenda…</p>';
    $('#lista-dia').innerHTML = vacio('Cargando…');
    return;
  }
  const citas = delDia.slice().sort((a, b) => a.inicio - b.inicio);
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

/* --- 8.4 Nueva cita --- */
function renderNueva() {
  const selProc = $('#cita-proc'), selDoc = $('#cita-doctor');
  const procActual = selProc.value, docActual = selDoc.value;

  selProc.innerHTML = Object.entries(datos.catalogo)
    .map(([id, p]) => `<option value="${esc(id)}">${esc(p.nombre)} · ${p.duracion} min</option>`).join('');
  selProc.value = datos.catalogo[procActual] ? procActual : 'val';

  const docs = doctoresVisibles().filter(d => puedeHacer(d, selProc.value));
  selDoc.innerHTML = docs.length
    ? docs.map(d => `<option value="${esc(d.id)}">${esc(d.nombre)}</option>`).join('')
    : '<option value="">Ningún odontólogo disponible realiza este procedimiento</option>';
  selDoc.value = docs.some(d => d.id === docActual) ? docActual : (docs[0]?.id || '');
  actualizarNueva();
}

function pintarHorariosNueva(p, doctor, cargando) {
  const libres = ui.nueva.libres;
  if (!libres.includes(ui.nueva.inicio)) ui.nueva.inicio = null;
  pintarSiCambia('#cita-horarios', cargando
    ? '<p class="chips-empty">Buscando horarios libres…</p>'
    : libres.length
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

// Redibuja fechas y pide al servidor los horarios libres (`soloPintar` evita la consulta).
async function actualizarNueva(soloPintar = false) {
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

  if (soloPintar) return pintarHorariosNueva(p, doctor, false);
  if (!doctor || !p) {
    ui.nueva.libres = [];
    return pintarHorariosNueva(p, doctor, false);
  }

  // Solo se pinta la respuesta de la última consulta (el usuario puede cambiar de fecha rápido).
  const numero = ++ui.nueva.consulta;
  pintarHorariosNueva(p, doctor, true);
  try {
    const r = await api(`/disponibilidad?${consulta({
      doctor, proc, fecha: ui.nueva.fecha, paciente: $('#pac-nombre').value.trim(), telefono: $('#pac-telefono').value.trim()
    })}`);
    if (numero !== ui.nueva.consulta) return;
    ui.nueva.libres = r.libres;
  } catch (e) {
    if (numero !== ui.nueva.consulta) return;
    ui.nueva.libres = [];
    toast(e.message, 'error');
  }
  pintarHorariosNueva(p, doctor, false);
}

/* --- 8.5 Bloqueos y emergencias --- */
function renderBloqueos() {
  const hoy = hoyISO();
  ['#blq-fecha', '#em-fecha'].forEach(sel => {
    const el = $(sel);
    el.min = hoy;
    if (!el.value || el.value < hoy) el.value = hoy;
  });
  const lista = datos.bloqueos.filter(b => b.fecha >= hoy)
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

async function abrirEmergencia(doctor, fecha) {
  const doc = doctorPor(doctor);
  if (!doc) return toast('Selecciona un odontólogo', 'error');
  if (!fecha || fecha < hoyISO()) return toast('Elige hoy o una fecha futura', 'error');
  if (!esLaborable(fecha)) return toast('Ese día la clínica no atiende', 'error');

  let afectadas;
  try {
    afectadas = await api(`/bloqueos/afectadas?${consulta({ doctor, fecha, tipo: 'emergencia' })}`);
  } catch (e) {
    return toast(e.message, 'error');
  }
  abrirModal({
    titulo: 'Emergencia / día no laborable',
    tipo: 'peligro',
    cuerpo: `<p>Se bloqueará todo el <strong>${esc(fmtLarga(fecha))}</strong> para <strong>${esc(doc.nombre)}</strong>.</p>
      ${afectadas.length
        ? `<p class="alert alert-danger">${plural(afectadas.length, 'cita se cancelará', 'citas se cancelarán')} automáticamente. Los pacientes recibirán un aviso por WhatsApp y pasarán a re-agendamiento.</p>${listaAfectadasHTML(afectadas)}`
        : '<p class="alert">No hay citas programadas ese día.</p>'}`,
    acciones: [
      { texto: 'Volver', accion: cerrarModal },
      { texto: 'Activar emergencia', clase: 'btn-danger', accion: async () => {
        const r = await ejecutar(() => api('/bloqueos', { metodo: 'POST', cuerpo: { doctor, fecha, tipo: 'emergencia' } }));
        if (!r) return;
        const items = r.items;
        if (!items.length) { cerrarModal(); return toast('Día bloqueado. No había citas que cancelar.', 'ok'); }
        abrirModal({
          titulo: 'Emergencia activada',
          cuerpo: `<p>Se ${items.length === 1 ? 'canceló 1 cita' : `cancelaron ${items.length} citas`} y se avisó a los pacientes.</p>
            <p class="alert">¿Quieres que el sistema les asigne el primer horario libre con la misma duración de su procedimiento?</p>`,
          acciones: [
            { texto: 'Lo haré desde la cola', accion: () => { cerrarModal(); mostrarSeccion('cola'); } },
            { texto: 'Re-agendar automáticamente', clase: 'btn-primary', accion: async () => {
              const res = await reagendarAutomatico(items.map(i => i.id));
              cerrarModal();
              if (res) toast(`${plural(res.ok, 'paciente re-agendado', 'pacientes re-agendados')}${res.sinCupo ? ` · ${res.sinCupo} sin cupo` : ''}`, 'ok');
            } }
          ]
        });
      } }
    ]
  });
}

/* --- 8.6 Cola de re-agendamiento --- */
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

/* --- 8.7 Catálogo --- */
function renderCatalogo() {
  const editable = esAdmin();
  $('#cat-aviso').hidden = editable;
  $('#cat-guardar').hidden = !editable;
  $('#tabla-catalogo tbody').innerHTML = Object.entries(datos.catalogo).map(([id, p]) => `<tr data-proc="${esc(id)}">
      <td>${esc(p.nombre)}</td>
      <td><input type="number" data-campo="duracion" value="${p.duracion}" min="15" max="240" step="15" aria-label="Duración de ${esc(p.nombre)} en minutos"${editable ? '' : ' disabled'}></td>
      <td><input type="number" data-campo="precio" value="${p.precio}" min="0" step="1000" aria-label="Tarifa de ${esc(p.nombre)}"${editable ? '' : ' disabled'}></td>
      <td>${esc(p.tipo)}</td>
    </tr>`).join('');
}

async function guardarCatalogo() {
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
  const r = await ejecutar(() => api('/catalogo', { metodo: 'PUT', cuerpo: nuevos }));
  if (r) toast('Catálogo guardado. Tarifas publicadas para pacientes.', 'ok');
}

/* --- 8.8 Automatizaciones --- */
function renderAjustes() {
  $$('[data-config]').forEach(input => {
    input.checked = !!datos.config[input.dataset.config];
    input.disabled = !esAdmin();
  });
  $('#ajustes-aviso').hidden = esAdmin();
  $('#ajustes-whatsapp').textContent = `+${WHATSAPP_NUMERO}`;
}


/* ---------------------------------------------------------
   9. MODALES
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
    // Mientras la acción espera al servidor, los botones quedan desactivados.
    b.addEventListener('click', async () => {
      const botones = Array.from(M.acciones.querySelectorAll('button'));
      botones.forEach(x => { x.disabled = true; });
      try { await a.accion(); } finally { botones.forEach(x => { x.disabled = false; }); }
    });
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
      <dt>Celular</dt><dd>${esc(c.telefono ? `+${c.telefono}` : '—')}</dd>
      <dt>Origen</dt><dd>${esc(ORIGENES[c.origen] || 'Panel')}</dd>
      ${c.motivoCancelacion ? `<dt>Motivo</dt><dd>${esc(c.motivoCancelacion)}</dd>` : ''}
    </dl>`,
    acciones
  });
}

function abrirCancelar(c) {
  const autoReagendar = !!datos.config.autoReagendar;
  abrirModal({
    titulo: 'Cancelar cita',
    tipo: 'peligro',
    cuerpo: `<p>Vas a cancelar la cita de <strong>${esc(c.paciente)}</strong> (${esc(nombreProc(c.proc))}, ${esc(fmtCorta(c.fecha))} a las ${hhmm(c.inicio)}).</p>
      <div class="field"><label for="cancel-motivo">Motivo</label>
        <select id="cancel-motivo"><option>El paciente canceló</option><option>El odontólogo no puede atender</option><option>Decisión de la clínica</option></select>
      </div>
      ${autoReagendar ? `<p class="alert">Al confirmar, le ofreceremos de inmediato un nuevo horario con la misma duración (${c.duracion} min).</p>` : ''}`,
    acciones: [
      { texto: 'Volver', accion: cerrarModal },
      { texto: autoReagendar ? 'Cancelar y re-agendar' : 'Cancelar cita', clase: 'btn-danger', accion: async () => {
        const motivo = $('#cancel-motivo').value;
        const r = await ejecutar(() => api(`/citas/${c.id}/cancelar`, { metodo: 'POST', cuerpo: { motivo } }));
        if (!r) return;
        if (autoReagendar && r.item) await abrirReagendar(r.item, true);
        else { cerrarModal(); toast('Cita cancelada. El paciente quedó en la cola de re-agendamiento.'); }
      } }
    ]
  });
}

async function abrirReagendar(item, recienCancelada = false) {
  let opciones;
  try {
    opciones = await api(`/cola/${item.id}/opciones`);
  } catch (e) {
    return toast(e.message, 'error');
  }
  const grupos = opciones.reduce((acc, h) => { (acc[h.fecha] = acc[h.fecha] || []).push(h.inicio); return acc; }, {});
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
      { texto: 'Confirmar nuevo horario', clase: 'btn-primary', accion: async () => {
        if (!elegido) return toast('Elige un horario primero', 'error');
        const r = await ejecutar(() => api(`/cola/${item.id}/reagendar`, { metodo: 'POST', cuerpo: elegido }));
        if (!r) return;
        cerrarModal();
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
   10. NOTIFICACIONES Y AVISOS
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

// Consulta el servidor cada cierto tiempo: así llegan las citas que agenda el chatbot.
let actualizando = false;
async function actualizarEnSegundoPlano() {
  if (!usuario || actualizando || document.hidden) return;
  actualizando = true;
  const ultimaNotif = Math.max(0, ...datos.notifs.map(n => n.id));
  try {
    await cargarPanel();
  } catch (e) {
    return;
  } finally {
    actualizando = false;
  }
  const nueva = datos.notifs.find(n => n.id > ultimaNotif && !n.leida);
  if (nueva) toast(`${nueva.titulo}: ${nueva.detalle}`, 'ok');
  renderNotifs();
  renderContadores();
  // No se redibuja si hay un modal abierto o si se está llenando una nueva cita.
  if (ui.vista === 'panel' && ['resumen', 'agenda', 'cola', 'bloqueos'].includes(ui.seccion) && M.caja.hidden) mostrarSeccion(ui.seccion);
}

// Cada minuto: refresca horas, botones de asistencia y ocupación.
function tic() {
  if (ui.vista === 'panel' && ['resumen', 'agenda'].includes(ui.seccion) && M.caja.hidden) mostrarSeccion(ui.seccion);
}


/* ---------------------------------------------------------
   11. EVENTOS
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
    const cita = citaPorId(accion.dataset.cita);
    if (!cita) return;
    if (accion.dataset.accion === 'cancelar') abrirCancelar(cita);
    else marcar(cita, accion.dataset.accion);
    return;
  }

  const detalle = t.closest('[data-cita-detalle]');
  if (detalle) { const c = citaPorId(detalle.dataset.citaDetalle); if (c) abrirDetalle(c); return; }

  const quitar = t.closest('[data-quitar-bloqueo]');
  if (quitar) {
    quitar.disabled = true;
    api(`/bloqueos/${quitar.dataset.quitarBloqueo}`, { metodo: 'DELETE' })
      .then(() => toast('Bloqueo eliminado. La agenda vuelve a estar disponible.', 'ok'))
      .catch(err => toast(err.message, 'error'))
      .finally(recargar);
    return;
  }

  const reag = t.closest('[data-reagendar]');
  if (reag) { const q = porId(datos.cola, reag.dataset.reagendar); if (q) abrirReagendar(q); return; }

  const fecha = t.closest('#cita-fechas [data-fecha]');
  if (fecha) { ui.nueva.fecha = fecha.dataset.fecha; ui.nueva.inicio = null; actualizarNueva(); return; }

  const hora = t.closest('#cita-horarios [data-hora]');
  if (hora) { ui.nueva.inicio = Number(hora.dataset.hora); actualizarNueva(true); return; }

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
  const form = e.currentTarget;
  const error = $('#login-error');
  const correo = $('#login-correo').value.trim().toLowerCase();
  const clave = $('#login-clave').value;
  if (!correo || !clave) return mostrarError(error, 'Escribe tu correo y tu contraseña.');
  const recordar = $('#login-recordar').checked;

  conBotonOcupado(form, async () => {
    try {
      const r = await api('/auth/login', { metodo: 'POST', cuerpo: { correo, clave } });
      error.hidden = true;
      form.reset();
      await iniciarSesion(r, recordar);
    } catch (err) {
      mostrarError(error, err.message);
    }
  });
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
  if (clave.length < 8) return mostrarError(error, 'La contraseña debe tener al menos 8 caracteres.');
  if (clave !== $('#reg-confirmar').value) return mostrarError(error, 'Las contraseñas no coinciden.');
  if (!$('#reg-terminos').checked) return mostrarError(error, 'Debes aceptar el tratamiento de datos.');

  conBotonOcupado(form, async () => {
    try {
      const r = await api('/auth/registro', { metodo: 'POST', cuerpo: { nombre, correo, clave, rol, especialidad } });
      error.hidden = true;
      form.reset();
      actualizarRolRegistro();
      cambiarTabAcceso('login');
      await iniciarSesion(r, true);
    } catch (err) {
      mostrarError(error, err.message);
    }
  });
});

// Sesión y notificaciones
$('#btn-salir').addEventListener('click', cerrarSesion);
$('#btn-notificaciones').addEventListener('click', e => {
  e.stopPropagation();
  mostrarPanelNotif($('#panel-notificaciones').hidden);
});
$('#notif-cerrar').addEventListener('click', () => mostrarPanelNotif(false));
$('#notif-limpiar').addEventListener('click', () => ejecutar(() => api('/notificaciones/leer', { metodo: 'POST' })));
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
$('#cita-doctor').addEventListener('change', () => actualizarNueva());
$('#pac-nombre').addEventListener('change', () => actualizarNueva());
$('#pac-telefono').addEventListener('change', () => actualizarNueva());
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

  conBotonOcupado(form, async () => {
    let cita;
    try {
      // El servidor vuelve a validar todo justo antes de guardar.
      cita = await api('/citas', { metodo: 'POST', cuerpo: { paciente: nombre, telefono, proc, doctor: $('#cita-doctor').value, fecha: ui.nueva.fecha, inicio: ui.nueva.inicio } });
    } catch (err) {
      mostrarError(error, err.message);
      actualizarNueva();
      return;
    }
    error.hidden = true;
    form.reset();
    ui.nueva.inicio = null;
    ui.agDoctor = cita.doctor;
    ui.agFecha = cita.fecha;
    await recargar();
    toast(`Cita agendada: ${fmtCorta(cita.fecha)}, ${hhmm(cita.inicio)}–${hhmm(cita.inicio + cita.duracion)}`, 'ok');
  });
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
  const desde = tipo === 'parcial' ? $('#blq-desde').value : undefined;
  const hasta = tipo === 'parcial' ? $('#blq-hasta').value : undefined;

  if (!doctorPor(doctor)) return mostrarError(error, 'Selecciona un odontólogo.');
  if (!fecha) return mostrarError(error, 'Elige una fecha.');
  if (tipo === 'parcial' && (!desde || !hasta)) return mostrarError(error, 'Indica la hora de inicio y de fin.');

  const aplicar = async () => {
    let r;
    try {
      r = await api('/bloqueos', { metodo: 'POST', cuerpo: { doctor, fecha, tipo, desde, hasta, motivo } });
    } catch (err) {
      cerrarModal();
      return mostrarError(error, err.message);
    }
    form.reset();
    $('#blq-rango').hidden = true;
    cerrarModal();
    await recargar();
    toast(r.items.length ? `Bloqueo creado. ${plural(r.items.length, 'paciente enviado', 'pacientes enviados')} a re-agendamiento.` : 'Bloqueo creado.', 'ok');
  };

  conBotonOcupado(form, async () => {
    // El servidor valida el rango y dice qué citas quedarían afectadas.
    let afectadas;
    try {
      afectadas = await api(`/bloqueos/afectadas?${consulta({ doctor, fecha, tipo, desde, hasta })}`);
    } catch (err) {
      return mostrarError(error, err.message);
    }
    error.hidden = true;
    if (!afectadas.length) return aplicar();
    abrirModal({
      titulo: 'Hay citas en ese horario',
      tipo: 'peligro',
      cuerpo: `<p>Este bloqueo afecta ${plural(afectadas.length, 'cita', 'citas')}. Se cancelarán, se avisará a los pacientes y pasarán a re-agendamiento.</p>${listaAfectadasHTML(afectadas)}`,
      acciones: [{ texto: 'Volver', accion: cerrarModal }, { texto: 'Bloquear y re-agendar', clase: 'btn-danger', accion: aplicar }]
    });
  });
});

// Emergencias
$('#btn-emergencia').addEventListener('click', () => {
  const fecha = ui.seccion === 'agenda' && ui.agFecha >= hoyISO() ? ui.agFecha : hoyISO();
  abrirEmergencia(ui.agDoctor, fecha);
});
$('#em-ejecutar').addEventListener('click', () => abrirEmergencia($('#em-doctor').value, $('#em-fecha').value));

// Cola
$('#cola-auto').addEventListener('click', async () => {
  const r = await reagendarAutomatico();
  if (r) toast(`${plural(r.ok, 'paciente re-agendado', 'pacientes re-agendados')}${r.sinCupo ? ` · ${r.sinCupo} sin cupo` : ''}`, r.ok ? 'ok' : 'error');
});

// Catálogo y ajustes
$('#cat-guardar').addEventListener('click', guardarCatalogo);
$$('[data-config]').forEach(input => input.addEventListener('change', async () => {
  const r = await ejecutar(() => api('/config', { metodo: 'PUT', cuerpo: { [input.dataset.config]: input.checked } }));
  if (r) toast('Preferencia guardada', 'ok');
}));


/* ---------------------------------------------------------
   12. INICIO
   --------------------------------------------------------- */
async function iniciar() {
  actualizarRolRegistro();
  try {
    await cargarPublico();
  } catch (e) {
    toast('No se pudo conectar con el servidor. Revisa que esté encendido.', 'error');
  }

  // Si hay una sesión guardada, se valida con el servidor.
  token = leerToken();
  if (token) {
    try {
      usuario = (await api('/auth/me')).usuario;
      await cargarPanel();
    } catch (e) {
      token = null;
      usuario = null;
      borrarToken();
    }
  }

  renderSesion();
  irA(usuario ? 'panel' : 'paciente');
  setInterval(tic, 60000);
  setInterval(actualizarEnSegundoPlano, REFRESCO_MS);
}

iniciar();
