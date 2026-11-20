# Agendamiento online del paciente

Página pública, pensada para celular: `gestion/reservar.html` + `gestion/reservar.js`. El link va en Instagram, Google y en la respuesta automática de WhatsApp.

## Flujo (4 pasos)
1. **Motivo**: lista corta de motivos públicos (no el catálogo interno). Cada motivo define tratamiento, duración y, si hace falta, el especialista (ortodoncia → Dra. Duarte; implante → Dr. Rojas).
2. **Profesional**: uno en particular o «cualquiera» (más horarios).
3. **Día y hora**: próximos 14 días hábiles; solo horarios **realmente libres** según la agenda de la clínica.
4. **Datos**: cédula primero. Si la cédula ya existe, usa la ficha («¡Hola, Laura! Ya sos paciente»); si no, pide nombre, WhatsApp y nacimiento y crea el paciente.
→ Confirmación con código (T-XXXXX) + mensaje de WhatsApp de confirmación y recordatorio del día anterior (módulo Recordatorios).

En la agenda de la clínica el turno aparece con la etiqueta **«Online»**.

## Tablas
**agenda_config** (por clínica/sede)
| campo | nota |
|---|---|
| dia_semana, hora_inicio, hora_fin | ej. lun–vie 08–18, sáb 08–12 |
| intervalo_min | 30 |
| anticipacion_min_min | 120: no se reserva para dentro de menos de 2 h |
| dias_adelante | 14 |
| reserva_online_activa | bool |

**doctor_disponibilidad**: doctor_id, dia_semana, hora_inicio, hora_fin (y **bloqueos**: doctor_id, desde, hasta, motivo — vacaciones, congreso).

**motivo_online**: id, nombre, descripcion, tratamiento_id, duracion_min, doctor_fijo_id (nullable), urgencia (bool), activo, orden.

**turno** (la misma tabla de la agenda) + campos nuevos:
| campo | nota |
|---|---|
| origen | recepcion / online / whatsapp |
| motivo_online_id | |
| codigo_reserva | único, para cambiar/cancelar |
| creado_en, ip | |

## Reglas
1. Horario libre = dentro de la disponibilidad del doctor, fuera de bloqueos y **sin superposición** con otro turno (`inicio < fin_otro y fin > inicio_otro`).
2. Al confirmar se vuelve a chequear dentro de una **transacción** (dos personas pueden elegir el mismo horario a la vez): si ya se ocupó, vuelve al paso 3 con aviso.
3. Un paciente tiene como máximo **1 turno online futuro**; para cambiarlo responde el WhatsApp.
4. Paciente nuevo entra marcado «Registrado por reserva online» para que recepción complete la ficha y la anamnesis en la primera visita.
5. «Tengo dolor» muestra el primer horario libre y avisa que, si es fuerte, llame por WhatsApp para un lugar hoy.
6. Anti-abuso: límite de reservas por teléfono/IP por día y captcha simple si se pasa.

## Conecta con
Agenda (misma tabla de turnos), pacientes (búsqueda por cédula), recordatorios WhatsApp (confirmación y aviso), sedes (cuando haya varias, el paciente elige sede en el paso 1).
