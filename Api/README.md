# Smart Mind · API

Servidor Node/Express que une el chatbot de WhatsApp (Whapi) y el panel web sobre una sola base SQLite.

```bash
cp .env.example .env   # y completa WHAPI_TOKEN y JWT_SECRET
npm install
npm run dev
```

- Web (pacientes + panel): `http://localhost:3000/`
- Webhook de Whapi: `POST /webhook/whapi` (con `?secreto=` si defines `WHAPI_WEBHOOK_SECRET`)
- Salud: `GET /salud`

## Estructura

| Archivo | Qué hace |
|---|---|
| `server.js` | Arranque, webhook, archivos estáticos |
| `whapi.js` | Envío de mensajes por Whapi |
| `src/config.js` | Horario, especialidades, datos iniciales |
| `src/db.js` | Esquema SQLite y datos iniciales |
| `src/agenda.js` | Reglas de agenda (cruces, bloqueos, re-agendamiento, estadísticas) |
| `src/auth.js` | Login con JWT y alcance por rol |
| `src/rutas.js` | Endpoints REST `/api/*` |
| `src/bot.js` | Conversación del chatbot |

Fechas `AAAA-MM-DD`; horas en minutos desde la medianoche (`840` = 14:00). Los endpoints que reciben `inicio`, `desde` o `hasta` aceptan también `"14:00"`. Los teléfonos se guardan como `57XXXXXXXXXX`.

## Endpoints

Públicos:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/publico/info` | Doctores, catálogo, especialidades, motivos, horario |
| POST | `/api/auth/login` | `{correo, clave}` → `{token, usuario}` |
| POST | `/api/auth/registro` | Solo administrador (o `REGISTRO_ABIERTO=true` para odontólogos) |

Con sesión (`Authorization: Bearer <token>`). Un odontólogo solo ve y modifica su propia agenda; el administrador ve toda la clínica y puede filtrar con `?doctor=`.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/auth/me` | Usuario actual |
| GET | `/api/doctores` | Odontólogos visibles |
| GET / PUT | `/api/catalogo` | Procedimientos; PUT `{val: {duracion, precio}}` solo admin |
| GET | `/api/disponibilidad?doctor&proc&fecha` | Horas libres del día |
| GET | `/api/disponibilidad/proximos?doctor&proc&desde&max` | Próximos horarios libres |
| GET | `/api/citas?doctor&fecha&desde&hasta&estado&telefono` | Listado |
| GET | `/api/citas/:id` | Detalle |
| POST | `/api/citas` | `{paciente, telefono, proc, doctor, fecha, inicio}` |
| PATCH | `/api/citas/:id/asistencia` | `{estado: 'asistida' \| 'noasistio'}` |
| POST | `/api/citas/:id/cancelar` | `{motivo}`; el paciente pasa a la cola |
| GET | `/api/bloqueos?doctor&desde` | Listado |
| GET | `/api/bloqueos/afectadas?doctor&fecha&tipo&desde&hasta` | Citas que se cancelarían |
| POST | `/api/bloqueos` | `{doctor, fecha, tipo: completo \| parcial \| emergencia, desde?, hasta?, motivo?}` |
| DELETE | `/api/bloqueos/:id` | Quitar bloqueo |
| GET | `/api/cola` | Pacientes por re-agendar |
| GET | `/api/cola/:id/opciones` | Horarios sugeridos |
| POST | `/api/cola/:id/reagendar` | `{fecha, inicio}` |
| POST | `/api/cola/reagendar-auto` | `{ids?}`; primer horario libre para cada uno |
| GET | `/api/estadisticas` | Asistidas, canceladas, inasistencias, tasa, ocupación |
| GET | `/api/mensajes` | Registro de mensajes de WhatsApp |
| GET | `/api/notificaciones` | Notificaciones del panel |
| POST | `/api/notificaciones/leer` | Marcar como leídas |
| GET / PUT | `/api/config` | Automatizaciones; PUT solo admin |

Errores: `{error: "mensaje"}` con 400 (datos), 401 (sin sesión), 403 (sin permiso), 404 o 409 (regla de agenda).
