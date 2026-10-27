# Guía de pruebas · Smart Mind

Paso a paso para revisar todo antes de modificar el chatbot. Cada paso dice qué hacer y qué debe pasar. Marca la casilla si salió bien; si algo no cuadra, anota el número del paso, lo que viste y el mensaje de la terminal.

Tiempo estimado: 45 a 60 minutos.

---

## 0. Preparación (una sola vez)

Usaremos una **base de pruebas aparte** (`smartmind-pruebas.db`), así tu base real no se toca.

1. Abre PowerShell en la carpeta `Api`:

   ```powershell
   cd C:\Users\Sistemas\Documents\SmartMind\Api
   ```

2. Indica la base de pruebas y llénala con datos de ejemplo (280 citas, 2 pacientes en la cola y 2 bloqueos):

   ```powershell
   $env:DB_PATH="smartmind-pruebas.db"; npm run demo
   ```

   Debe decir: `Listo: 280 citas, 2 paciente(s) en la cola y 2 bloqueos de ejemplo.`

3. En **la misma ventana**, enciende el servidor:

   ```powershell
   npm run dev
   ```

   Debe decir `Servidor ejecutándose en puerto 3000` (o el puerto de tu `.env`).

4. Abre `http://localhost:3000` en el navegador. Abre también las herramientas del navegador (F12 → Consola) para ver si aparecen errores en rojo.

> `$env:DB_PATH` solo vale para esa ventana de PowerShell. Si abres otra, el servidor usará la base real. Para volver a la base real, cierra la ventana o ejecuta `Remove-Item Env:DB_PATH`.

**Cuentas de prueba**

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | `admin@smartmind.co` | `admin1234` |
| Odontóloga (Dra. Camila Restrepo) | `camila@smartmind.co` | `demo1234` |

---

## 1. Página de pacientes (sin iniciar sesión)

- [ ] **1.1** Se ven 3 odontólogos en "Odontólogos de la clínica", cada uno con su especialidad.
- [ ] **1.2** La guía "¿Qué especialista necesito?" muestra 6 motivos. "Dolor fuerte…" dice *Te atiende: Dr. Andrés Villegas*.
- [ ] **1.3** La tabla de tarifas muestra 8 procedimientos con duración y precio.
- [ ] **1.4** Los botones "Escribir por WhatsApp" abren `wa.me/573144914328` con un mensaje ya escrito.

## 2. Inicio de sesión

- [ ] **2.1** Clic en **Ingresar**, escribe `admin@smartmind.co` con una contraseña equivocada → mensaje *Correo o contraseña incorrectos.*
- [ ] **2.2** Entra con la contraseña correcta → llegas a **Panel de la clínica**.
- [ ] **2.3** Recarga la página (F5) → sigues dentro del panel.
- [ ] **2.4** Clic en **Salir** → vuelves a la página de pacientes. Vuelve a entrar como administrador para seguir.

## 3. Resumen

- [ ] **3.1** Las estadísticas muestran números (asistidas, canceladas, inasistencias, programadas, tasa y ocupación).
- [ ] **3.2** "Citas de hoy" lista las citas del día (si hoy es domingo dirá que la clínica no atiende).
- [ ] **3.3** Aparece el aviso amarillo *2 pacientes esperan un nuevo horario*.

## 4. Agenda

- [ ] **4.1** Menú **Agenda**: se ve el calendario del día con las citas en bloques y el almuerzo de 12:00 a 13:00.
- [ ] **4.2** Cambia de odontólogo y de día con las flechas → el calendario cambia.
- [ ] **4.3** Clic en una cita → se abre su detalle (procedimiento, hora, celular y origen).
- [ ] **4.4** En una cita de hoy que ya empezó aparecen los botones **Asistió / No asistió**. Marca una como *Asistió* → cambia a verde y la estadística sube.

## 5. Nueva cita

1. Menú **Nueva cita**. Nombre: `Paciente Prueba Uno`. Celular: tu número o `3001234567`.
2. Procedimiento: **Limpieza dental**. Odontólogo: **Dra. Camila Restrepo**. Elige mañana.

- [ ] **5.1** Solo aparecen horarios libres; no hay ninguno que se cruce con el almuerzo.
- [ ] **5.2** Elige una hora → aparece el resumen con tarifa. **Confirmar cita** → mensaje *Cita agendada…*
- [ ] **5.3** En **Agenda**, ese día y con esa odontóloga, aparece la cita.
- [ ] **5.4** Repite con el **mismo nombre y celular**, procedimiento **Valoración inicial**, odontólogo **Dr. Andrés Villegas** y el mismo día: las horas que se cruzan con la cita que ya tiene el paciente **no** aparecen (un paciente no puede estar en dos citas a la vez).
- [ ] **5.5** Elige **Endodoncia (conducto)** → solo aparece el **Dr. Andrés Villegas** (es el único que la hace).

## 6. Cancelar y re-agendar

- [ ] **6.1** Abre la cita del paso 5 → **Cancelar cita** → motivo *El paciente canceló* → **Cancelar y re-agendar**.
- [ ] **6.2** Se abre "Re-agendar cita" con horarios de la **misma duración** (45 min para limpieza).
- [ ] **6.3** Elige uno y **Confirmar nuevo horario** → la cita aparece en el nuevo horario como *re-agendada*.
- [ ] **6.4** Cancela otra cita y esta vez elige **Dejar en la cola** → el contador de **Re-agendamiento** en el menú sube.

## 7. Cola de re-agendamiento

- [ ] **7.1** Menú **Re-agendamiento**: se ven los pacientes pendientes con su cita original.
- [ ] **7.2** **Proponer horarios a todos** → mensaje *N pacientes re-agendados* y la cola queda vacía.

## 8. Bloqueos

- [ ] **8.1** Menú **Bloqueos y emergencias** → "Bloqueos programados" muestra los 2 de ejemplo.
- [ ] **8.2** Crea un bloqueo **Parcial** de 14:00 a 15:00 un día en que la odontóloga tenga citas en ese horario → aparece *Hay citas en ese horario* con la lista. **Bloquear y re-agendar** → esas citas pasan a la cola.
- [ ] **8.3** Intenta otro bloqueo de 14:30 a 15:30 el mismo día → error *Ya existe un bloqueo en ese rango.*
- [ ] **8.4** En **Nueva cita**, ese día y con esa odontóloga, no aparecen horarios entre 14:00 y 15:00.
- [ ] **8.5** **Quitar** el bloqueo → la agenda vuelve a estar disponible.

## 9. Emergencia

- [ ] **9.1** En "Emergencia o imprevisto", elige un odontólogo y un día con citas → **Activar emergencia** → muestra cuántas citas se cancelarán.
- [ ] **9.2** Confirma → **Re-agendar automáticamente** → mensaje *N pacientes re-agendados*.
- [ ] **9.3** En **Agenda**, ese día aparece completo como *Emergencia* y las citas se movieron a otros días.

## 10. Procedimientos

- [ ] **10.1** Menú **Procedimientos**: cambia la tarifa de *Radiografía periapical* y **Guardar cambios** → en la página de pacientes se ve la nueva tarifa.
- [ ] **10.2** Pon una duración de `40` en cualquier fila y guarda → error: debe ser múltiplo de 15.
- [ ] **10.3** **+ Nuevo procedimiento**: `Implante dental`, 90 min, $1.200.000, tipo `Cirugía`. **No** marques especialidades todavía → **Crear**.
- [ ] **10.4** Aparece al final de la tabla como *Activo*.

## 11. Equipo y servicios (lo nuevo)

- [ ] **11.1** Menú **Equipo y servicios**: se ven 3 odontólogos, 5 especialidades y 6 motivos.
- [ ] **11.2** **Especialidades → + Nueva**: `Implantología`, marca *Valoración inicial*, *Radiografía periapical* e *Implante dental* → **Crear**.
- [ ] **11.3** **+ Agregar odontólogo** sin marcar especialidades → el error *Elige al menos una especialidad.* aparece dentro del formulario.
- [ ] **11.4** Completa: `Dr. Juan Ortiz`, especialidades **Periodoncia** e **Implantología**, 8 años, una descripción, correo `juan@smartmind.co`, contraseña `juan12345` → **Agregar**.
- [ ] **11.5** En la lista aparece *Periodoncia · Implantología · juan@smartmind.co*.
- [ ] **11.6** **Motivos → + Nuevo**: `Me falta un diente` → Implantología → **Crear**.
- [ ] **11.7** Ve a **Pacientes**: aparece el Dr. Juan Ortiz con sus dos especialidades, el motivo *Me falta un diente → Te atiende: Dr. Juan Ortiz* y la tarifa del implante.
- [ ] **11.8** En **Nueva cita**, elige **Implante dental** → solo aparece el Dr. Juan Ortiz, con horarios de 90 min (el último a las 15:30). Agenda una cita.
- [ ] **11.9** Edita al **Dr. Juan Ortiz** y desmarca *Activo* → error *Tiene 1 cita(s) programada(s)…* (no se puede desactivar con citas pendientes).
- [ ] **11.10** Edita a la **Dra. Sofía Arango** y desmarca *Activo* → mismo tipo de error.

## 12. Entrar como el odontólogo nuevo

- [ ] **12.1** **Salir** y entra con `juan@smartmind.co` / `juan12345`.
- [ ] **12.2** El panel dice *Hola, Dr. Juan* y *Periodoncia · Implantología*.
- [ ] **12.3** Solo ve su cita del implante. El menú **no** muestra "Equipo y servicios".
- [ ] **12.4** En **Procedimientos** ve las tarifas pero no puede editarlas. En **Automatizaciones** los interruptores están bloqueados.

## 13. Desactivar un odontólogo

1. Como **Dr. Juan**, abre su cita del implante → **Cancelar cita** → **Dejar en la cola**. Luego **Salir** y entra como **administrador**.

- [ ] **13.1** Ahora el Dr. Juan no tiene citas programadas: en **Equipo y servicios** edítalo, desmarca *Activo* y guarda → se guarda sin error.
- [ ] **13.2** En **Pacientes** ya no aparece. En **Agenda** y **Nueva cita** ya no se puede elegir. El paciente sigue en **Re-agendamiento** con el nombre del Dr. Juan.
- [ ] **13.3** **Salir** e intenta entrar con `juan@smartmind.co` → *Correo o contraseña incorrectos.*
- [ ] **13.4** Entra como administrador y reactívalo → vuelve a aparecer en la página y puede entrar de nuevo.
- [ ] **13.5** En **Re-agendamiento**, re-agenda al paciente del implante → la cita conserva sus 90 minutos.

## 14. Permisos de la Dra. Camila

- [ ] **14.1** Entra como `camila@smartmind.co`: en Agenda y en Bloqueos solo puede elegirse a sí misma.
- [ ] **14.2** Las estadísticas dicen *Tu agenda* y solo cuentan sus citas.

## 15. Chatbot

Hay dos formas. La **A** no necesita celular; la **B** es la prueba real.

> ⚠️ El servidor **envía de verdad** las respuestas por WhatsApp con tu `WHAPI_TOKEN`. En la opción A usa **tu propio número** (con 57 adelante), nunca uno inventado: podría ser de otra persona.

**A. Simulando los mensajes (otra ventana de PowerShell, con el servidor encendido):**

```powershell
$numero = "57TU_NUMERO"; $fecha = "2026-11-03"; foreach ($t in "hola", "1", "Paciente WhatsApp", $fecha, "1") { $cuerpo = @{ messages = @(@{ id = [guid]::NewGuid().ToString(); from_me = $false; type = "text"; chat_id = "$numero@s.whatsapp.net"; text = @{ body = $t } }) } | ConvertTo-Json -Depth 5; Invoke-RestMethod -Method Post -Uri "http://localhost:3000/webhook/whapi" -ContentType "application/json" -Body $cuerpo; Start-Sleep -Milliseconds 700 }
```

Cambia `$fecha` por un día de lunes a sábado que no haya pasado.

**B. Desde tu celular** (ngrok encendido y apuntando al mismo puerto): escribe `hola` → `1` → tu nombre → una fecha `AAAA-MM-DD` → el número de un horario.

- [ ] **15.1** La terminal del servidor muestra `Mensaje de 57…` por cada mensaje.
- [ ] **15.2** Con el panel abierto como administrador, en **30 segundos o menos** aparece el aviso *Nueva cita desde WhatsApp…* y la campana suma una notificación.
- [ ] **15.3** La cita aparece en la agenda de la Dra. Camila como *vía WhatsApp*.
- [ ] **15.4** Por WhatsApp: `menu` → `2` → número de la cita → se cancela, y el paciente aparece en **Re-agendamiento**.
- [ ] **15.5** (Opción B) Las respuestas llegan a tu celular.

## 16. Errores del servidor y del navegador

- [ ] **16.1** Apaga el servidor (Ctrl+C) con la página abierta e intenta guardar algo → aviso *No se pudo conectar con el servidor.* Vuelve a encenderlo.
- [ ] **16.2** Revisa la consola del navegador (F12): solo deberían verse errores 400, 401 o 409 de las pruebas que fallan a propósito, ninguno de JavaScript.

---

## Volver a empezar

- **Recrear los datos de ejemplo** (borra citas, cola, bloqueos, mensajes y notificaciones; conserva odontólogos, especialidades y procedimientos):

  ```powershell
  $env:DB_PATH="smartmind-pruebas.db"; npm run demo -- --forzar
  ```

- **Empezar de cero por completo:** apaga el servidor y borra `smartmind-pruebas.db` (y los archivos `-wal` y `-shm` si existen). Luego repite el paso 0.

## Si algo falla

Anota:

1. El número del paso.
2. Qué esperabas y qué pasó.
3. El mensaje que salió en pantalla.
4. Lo que muestra la terminal del servidor.
5. Los errores en rojo de la consola (F12).

Con eso se puede reproducir y corregir.
