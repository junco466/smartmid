// API REST que consume el panel web. Todas las rutas cuelgan de /api.
const express = require('express');
const agenda = require('./agenda');
const auth = require('./auth');
const equipo = require('./equipo');
const { HORARIO } = require('./config');
const { hoyISO, hhmm, aMin, fmtCorta } = require('./utils');

const router = express.Router();
const { requiereSesion, requiereAdmin, alcance, puedeVer } = auth;

// Acepta minutos (840) o texto "14:00".
const aMinutos = v => (typeof v === 'string' && v.includes(':') ? aMin(v) : Number(v));
const idNum = v => (Number.isInteger(Number(v)) ? Number(v) : null);
const fallo = (res, error, status = 400) => res.status(status).json({ error });


/* ---------- Público (página de pacientes) ---------- */
router.get('/publico/info', (req, res) => {
  res.json({
    doctores: agenda.doctores(),
    catalogo: agenda.catalogo(),
    especialidades: agenda.especialidades(),
    motivos: agenda.motivos(),
    horario: HORARIO,
    whatsapp: process.env.WHATSAPP_NUMERO || null
  });
});


/* ---------- Sesión ---------- */
router.post('/auth/login', (req, res) => {
  const r = auth.login(req.body?.correo, req.body?.clave);
  if (!r) return fallo(res, 'Correo o contraseña incorrectos.', 401);
  res.json(r);
});

// Solo el administrador crea cuentas, salvo que REGISTRO_ABIERTO=true
// (en ese caso cualquiera puede crear una cuenta de odontólogo, nunca de administrador).
router.post('/auth/registro', (req, res) => {
  const usuario = auth.leerUsuario(req);
  const abierto = process.env.REGISTRO_ABIERTO === 'true';
  const datos = { ...req.body };
  if (usuario?.rol !== 'admin') {
    if (!abierto) return fallo(res, 'Pide al administrador de la clínica que cree tu cuenta.', 403);
    datos.rol = 'odontologo';
  }
  const r = auth.registrar(datos);
  if (r.error) return fallo(res, r.error);
  // Si se registró solo, queda con la sesión iniciada.
  res.status(201).json(usuario ? r : auth.login(datos.correo, datos.clave));
});

router.use(requiereSesion);

router.get('/auth/me', (req, res) => res.json({ usuario: req.usuario }));


/* ---------- Odontólogos y catálogo ---------- */
router.get('/doctores', (req, res) => {
  const doc = alcance(req);
  res.json(doc ? agenda.doctores().filter(d => d.id === doc) : agenda.doctores());
});

router.get('/catalogo', (req, res) => res.json(agenda.catalogo()));

// Cuerpo: { val: { duracion: 30, precio: 40000 }, ... }
router.put('/catalogo', requiereAdmin, (req, res) => {
  const actual = agenda.catalogo({ todos: true });
  const cambios = {};
  for (const [id, v] of Object.entries(req.body || {})) {
    const p = actual[id];
    if (!p) return fallo(res, `El procedimiento "${id}" no existe.`);
    const duracion = Number(v?.duracion), precio = Number(v?.precio);
    if (!Number.isInteger(duracion) || duracion < 15 || duracion > 240 || duracion % HORARIO.paso) return fallo(res, `${p.nombre}: la duración debe ser múltiplo de 15 (entre 15 y 240 min).`);
    if (!Number.isFinite(precio) || precio < 0) return fallo(res, `${p.nombre}: la tarifa no es válida.`);
    cambios[id] = { duracion, precio: Math.round(precio) };
  }
  const catalogo = agenda.actualizarCatalogo(cambios);
  agenda.notificar('Catálogo actualizado', 'Las nuevas duraciones aplican a las próximas citas', 'agenda');
  res.json(catalogo);
});


/* ---------- Disponibilidad ---------- */
// ?doctor=d1&proc=val&fecha=2026-10-23[&paciente=&telefono=]
router.get('/disponibilidad', (req, res) => {
  const { doctor, proc, fecha, paciente, telefono } = req.query;
  if (!puedeVer(req, doctor)) return fallo(res, 'No tienes acceso a esa agenda.', 403);
  const p = agenda.procPor(proc);
  if (!p) return fallo(res, 'El procedimiento no existe.');
  const libres = agenda.horariosLibres({ doctor, proc, fecha, duracion: p.duracion, paciente, telefono });
  res.json({ fecha, duracion: p.duracion, libres, libresTexto: libres.map(hhmm) });
});

// ?doctor=d1&proc=val[&desde=2026-10-23&max=12]
router.get('/disponibilidad/proximos', (req, res) => {
  const { doctor, proc, paciente, telefono } = req.query;
  if (!puedeVer(req, doctor)) return fallo(res, 'No tienes acceso a esa agenda.', 403);
  const p = agenda.procPor(proc);
  if (!p) return fallo(res, 'El procedimiento no existe.');
  const max = Math.min(Number(req.query.max) || 12, 50);
  res.json(agenda.proximosHorarios({ doctor, proc, duracion: p.duracion, paciente, telefono }, req.query.desde || hoyISO(), max));
});


/* ---------- Citas ---------- */
// ?doctor&fecha&desde&hasta&estado&telefono
router.get('/citas', (req, res) => {
  const { fecha, desde, hasta, estado, telefono } = req.query;
  res.json(agenda.listarCitas({ doctor: alcance(req, req.query.doctor), fecha, desde, hasta, estado, telefono }));
});

router.get('/citas/:id', (req, res) => {
  const cita = agenda.citaPor(idNum(req.params.id));
  if (!cita || !puedeVer(req, cita.doctor)) return fallo(res, 'La cita no existe.', 404);
  res.json(cita);
});

// Cuerpo: { paciente, telefono, proc, doctor, fecha, inicio }
router.post('/citas', (req, res) => {
  const b = req.body || {};
  if (!puedeVer(req, b.doctor)) return fallo(res, 'No tienes acceso a esa agenda.', 403);
  const r = agenda.crearCita({ ...b, inicio: aMinutos(b.inicio), origen: 'panel' });
  if (r.error) return fallo(res, r.error, 409);
  const { cita } = r;
  const detalle = `${cita.paciente} · ${agenda.nombreProc(cita.proc)} · ${fmtCorta(cita.fecha)}, ${hhmm(cita.inicio)}`;
  agenda.registrar('Confirmación de cita enviada por WhatsApp', detalle, { telefono: cita.telefono, doctor: cita.doctor });
  agenda.notificar('Nueva cita agendada', detalle, 'cita', cita.doctor);
  res.status(201).json(cita);
});

// Cuerpo: { estado: 'asistida' | 'noasistio' }
router.patch('/citas/:id/asistencia', (req, res) => {
  const cita = agenda.citaPor(idNum(req.params.id));
  if (!cita || !puedeVer(req, cita.doctor)) return fallo(res, 'La cita no existe.', 404);
  const r = agenda.marcarAsistencia(cita.id, req.body?.estado);
  if (r.error) return fallo(res, r.error, 409);
  res.json(r.cita);
});

// Cuerpo: { motivo }. La cita pasa a la cola de re-agendamiento.
router.post('/citas/:id/cancelar', (req, res) => {
  const cita = agenda.citaPor(idNum(req.params.id));
  if (!cita || !puedeVer(req, cita.doctor)) return fallo(res, 'La cita no existe.', 404);
  const r = agenda.cancelarCita(cita.id, String(req.body?.motivo || 'El paciente canceló'));
  if (r.error) return fallo(res, r.error, 409);
  const detalle = `${cita.paciente} · ${fmtCorta(cita.fecha)}, ${hhmm(cita.inicio)}`;
  agenda.registrar('Cancelación confirmada por WhatsApp', `${cita.paciente} · ${agenda.nombreProc(cita.proc)} · ${fmtCorta(cita.fecha)}, ${hhmm(cita.inicio)}`, { telefono: cita.telefono, doctor: cita.doctor });
  agenda.notificar('Cita cancelada', detalle, 'agenda', cita.doctor);
  res.json(r);
});


/* ---------- Bloqueos y emergencias ---------- */
router.get('/bloqueos', (req, res) => {
  res.json(agenda.listarBloqueos({ doctor: alcance(req, req.query.doctor), desde: req.query.desde }));
});

// Vista previa: qué citas se cancelarían. ?doctor&fecha&tipo[&desde&hasta]
router.get('/bloqueos/afectadas', (req, res) => {
  const { doctor, fecha, tipo = 'completo' } = req.query;
  if (!puedeVer(req, doctor)) return fallo(res, 'No tienes acceso a esa agenda.', 403);
  const parcial = tipo === 'parcial';
  const desde = parcial ? aMinutos(req.query.desde) : HORARIO.apertura;
  const hasta = parcial ? aMinutos(req.query.hasta) : HORARIO.cierre;
  const error = agenda.validarBloqueo({ doctor, fecha, desde, hasta, tipo });
  if (error) return fallo(res, error);
  res.json(agenda.citasAfectadas(doctor, fecha, desde, hasta));
});

// Cuerpo: { doctor, fecha, tipo: 'completo' | 'parcial' | 'emergencia', desde?, hasta?, motivo? }
router.post('/bloqueos', (req, res) => {
  const b = req.body || {};
  if (!puedeVer(req, b.doctor)) return fallo(res, 'No tienes acceso a esa agenda.', 403);
  const r = agenda.aplicarBloqueo({ ...b, desde: aMinutos(b.desde), hasta: aMinutos(b.hasta) });
  if (r.error) return fallo(res, r.error, 409);
  res.status(201).json(r);
});

router.delete('/bloqueos/:id', (req, res) => {
  const bloqueo = agenda.bloqueoPor(idNum(req.params.id));
  if (!bloqueo || !puedeVer(req, bloqueo.doctor)) return fallo(res, 'El bloqueo no existe.', 404);
  agenda.quitarBloqueo(bloqueo.id);
  res.status(204).end();
});


/* ---------- Cola de re-agendamiento ---------- */
router.get('/cola', (req, res) => res.json(agenda.listarCola({ doctor: alcance(req, req.query.doctor) })));

const itemPermitido = (req, res) => {
  const item = agenda.itemColaPor(idNum(req.params.id));
  if (!item || !puedeVer(req, item.doctor)) { fallo(res, 'El paciente ya no está en la cola.', 404); return null; }
  return item;
};

router.get('/cola/:id/opciones', (req, res) => {
  const item = itemPermitido(req, res);
  if (item) res.json(agenda.opcionesReagendar(item.id));
});

// Cuerpo: { fecha, inicio }
router.post('/cola/:id/reagendar', (req, res) => {
  const item = itemPermitido(req, res);
  if (!item) return;
  const r = agenda.reagendar(item.id, req.body?.fecha, aMinutos(req.body?.inicio));
  if (r.error) return fallo(res, r.error, 409);
  agenda.notificar('Cita re-agendada', `${item.paciente} · ${fmtCorta(r.cita.fecha)}, ${hhmm(r.cita.inicio)}`, 'agenda', item.doctor);
  res.json(r.cita);
});

// Cuerpo opcional: { ids: [1, 2] }. Sin ids, re-agenda toda la cola visible.
router.post('/cola/reagendar-auto', (req, res) => {
  const visibles = agenda.listarCola({ doctor: alcance(req) }).map(q => q.id);
  const pedidos = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(id => visibles.includes(id)) : visibles;
  res.json(agenda.reagendarAutomatico(pedidos));
});


/* ---------- Estadísticas, mensajes y notificaciones ---------- */
router.get('/estadisticas', (req, res) => res.json(agenda.estadisticas({ doctor: alcance(req, req.query.doctor) })));

router.get('/mensajes', (req, res) => res.json(agenda.listarMensajes({ doctor: alcance(req) })));

router.get('/notificaciones', (req, res) => res.json(agenda.listarNotificaciones({ doctor: alcance(req) })));

router.post('/notificaciones/leer', (req, res) => {
  agenda.marcarNotificacionesLeidas({ doctor: alcance(req) });
  res.status(204).end();
});


/* ---------- Automatizaciones ---------- */
router.get('/config', (req, res) => res.json(agenda.leerConfig()));
router.put('/config', requiereAdmin, (req, res) => res.json(agenda.guardarConfig(req.body || {})));


/* ---------- Equipo y servicios (solo administrador) ---------- */
// Responde 201 al crear y 200 al editar; las reglas incumplidas devuelven 400.
const guardar = (fn, { crear = false } = {}) => (req, res) => {
  const r = fn(crear ? null : req.params.id, req.body || {});
  if (r.error) return fallo(res, r.error);
  res.status(crear ? 201 : 200).json(r);
};

router.get('/admin/equipo', requiereAdmin, (req, res) => res.json(equipo.equipo()));

// Cuerpo: { nombre, especialidades: ['general'], experiencia?, bio?, correo?, clave?, activo? }
router.post('/admin/doctores', requiereAdmin, guardar(equipo.guardarDoctor, { crear: true }));
router.put('/admin/doctores/:id', requiereAdmin, guardar(equipo.guardarDoctor));

// Cuerpo: { nombre, procs: ['val', 'rx'], activo? }
router.post('/admin/especialidades', requiereAdmin, guardar(equipo.guardarEspecialidad, { crear: true }));
router.put('/admin/especialidades/:id', requiereAdmin, guardar(equipo.guardarEspecialidad));

// Cuerpo: { nombre, duracion, precio, tipo?, activo?, especialidades?: ['general'] }
router.post('/admin/procedimientos', requiereAdmin, guardar(equipo.guardarProcedimiento, { crear: true }));
router.put('/admin/procedimientos/:id', requiereAdmin, guardar(equipo.guardarProcedimiento));

// Cuerpo: { motivo, especialidad, detalle?, activo? }
router.post('/admin/motivos', requiereAdmin, guardar(equipo.guardarMotivo, { crear: true }));
router.put('/admin/motivos/:id', requiereAdmin, guardar((id, b) => equipo.guardarMotivo(idNum(id), b)));
router.delete('/admin/motivos/:id', requiereAdmin, (req, res) => {
  if (!equipo.eliminarMotivo(idNum(req.params.id))) return fallo(res, 'El motivo no existe.', 404);
  res.status(204).end();
});


router.use((req, res) => fallo(res, 'Ruta no encontrada.', 404));

module.exports = router;
