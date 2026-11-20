# Inicio y agenda

Pantallas: «Inicio» y «Agenda» (día / semana). Código de la maqueta: `gestion/app.js` (VIEWS.inicio, VIEWS.agenda y acciones `ag-*`); semilla en `gestion/data.js`.

## Qué hace
- **Inicio**: tablero del día. Tarjetas: ingresos de hoy (suma de cobros y cantidad, con estado de la caja), ingresos del mes, saldos pendientes (presupuestos aprobados sin cobrar) y turnos de hoy (atendidos / por atender). Gráfico de ingresos de los últimos 7 días, tabla de turnos de hoy y los 4 pacientes con mayor saldo.
- **Alertas de Inicio**: stock bajo (inventario), presupuestos en borrador y pago vencido a proveedor. Cada una lleva al módulo correspondiente.
- En la tabla de hoy cada turno tiene un botón que avanza el estado (**Confirmar → Pasar a sala → Marcar atendida**); si ya está atendido, el botón es **Cobrar**.
- **Agenda día**: una columna por profesional (con su sillón y color), grilla de 30 min de 08:00 a 18:00, línea de «ahora» en el día de hoy. Clic en un hueco abre «Nuevo turno» con profesional y hora ya cargados.
- **Agenda semana**: lunes a sábado, lista de turnos por día. Navegación ‹ Hoy ›.
- Clic en un turno: detalle, cambio de estado, cancelar, ir a la ficha. Si el paciente tiene **alerta médica** (anamnesis) o alertas clínicas, se muestran en el turno.
- Turnos reservados por el paciente en la web llevan la etiqueta **«Online»** (06).
- Al marcar «atendida» ofrece **«Cobrar ahora»** (03).

## Tablas
**profesional** (el «doctor» de la maqueta; 1 por usuario clínico)
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, usuario_id | FK | |
| nombre, especialidad | text | ej. Endodoncia y cirugía |
| color | text | color de su columna en la agenda |
| registro_prof | text | sale en recetas y consentimientos (04, 05) |
| activo | bool | no se borra: se desactiva |

**turno**
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, sede_id | | sede: ver 08 |
| paciente_id, profesional_id, sillon_id | FK | sillón sale de la sede del profesional ese día |
| tratamiento_id | FK | tratamiento principal (catálogo en 03) |
| inicio, duracion_min | timestamptz, int | el fin se calcula (`inicio + duracion`) |
| estado | enum | agendada / confirmada / en sala / atendida / **cancelada** / **ausente** (las dos últimas faltan en la maqueta) |
| origen | enum | recepcion / online / whatsapp (06, 11) |
| motivo_online_id, codigo_reserva, creado_en, ip | | solo reservas online (06) |
| nota | text | opcional |
| cancelado_por, cancelado_en, motivo_cancelacion | | auditoría de cancelación |
| created_by, created_at, updated_by, updated_at | | auditoría |

**turno_estado_log**: turno_id, estado_anterior, estado_nuevo, cambiado_por, cambiado_en. Permite medir espera en sala y duración real.

## Reglas
1. **Superposición**: un profesional no puede tener dos turnos que se pisen el mismo día: se rechaza si `inicio < fin_otro y fin > inicio_otro`. Turnos pegados (uno termina cuando empieza el otro) sí se permiten. El mensaje dice quién atiende y de qué hora a qué hora.
2. **Horario**: el turno debe empezar desde las 08:00 y terminar a las 18:00 como máximo (constantes de la maqueta). En la real sale del horario de la sede y del profesional (06, 08), no de un valor fijo.
3. Fecha y hora son obligatorias. Paciente, profesional y tratamiento se eligen de listas.
4. **Duración**: al elegir tratamiento se carga su duración estándar; se puede cambiar (30 / 45 / 60 / 90 min). La hora acepta pasos de 15 min aunque la grilla visual sea de 30.
5. **Estados**: agendada → confirmada → en sala → atendida. El botón rápido avanza un paso; el detalle del turno permite marcar cualquiera de los tres últimos. Cada cambio guarda quién y cuándo.
6. **Cancelar**: en la maqueta el turno se borra; en la real pasa a `cancelada` con motivo y el hueco queda libre. Ausencia sin aviso = `ausente`.
7. Un turno nuevo guarda la **sede activa**; si el selector está en «Todas», la sede sale de dónde atiende el profesional ese día (08).
8. Al abrir un turno, la **alerta médica** (alergias, anticoagulantes, cardiopatía, diabetes, embarazo) sale de la última anamnesis; si no hay, se muestran las alertas manuales de la ficha (02).
9. **Atendida → cobro**: marcar atendida no cobra solo; ofrece abrir el cobro del paciente (03). El cobro exige caja abierta.
10. Cuando el estado cambie por respuesta del paciente al WhatsApp («Confirmo»), el turno pasa a confirmada sin intervención de recepción (11).
11. No existe todavía en la maqueta, y la app real necesita: no permitir turnos en fechas pasadas, avisar si el **paciente** ya tiene otro turno a esa hora con otro profesional, validar el **sillón** (no solo el profesional) y bloquear horarios de vacaciones o ausencias del profesional (06).
12. Los KPIs de Inicio se calculan con consultas del día/mes en la zona de la clínica, nunca con números guardados a mano.

## Conecta con
Pacientes (ficha desde el turno), presupuestos y caja (cobrar al atender), agendamiento online (06), recordatorios (11), sedes (08), inventario y contabilidad (alertas), anamnesis (alerta médica).
