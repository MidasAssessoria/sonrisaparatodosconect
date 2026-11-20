# Recordatorios por WhatsApp

Pantalla: «Recordatorios WhatsApp» (menú, tercer ítem). Código de la maqueta: `gestion/wa.js`. Es solo demostración: no envía nada; los estados de la lista se asignan de forma fija por posición y «Enviar todos» / «Reenviar» solo muestran un aviso.

## Qué hace
- **Configuración** con interruptores: enviar recordatorios automáticos (activo / pausado), 24 horas antes, 2 horas antes, pedir confirmación (botones «Confirmo» y «Reprogramar»), saludo de cumpleaños.
- **Mensaje** editable con variables `{nombre}` `{dia}` `{hora}` `{doctor}`; el texto admite `*negrita*` al estilo WhatsApp.
- **Vista previa** en un celular dibujado, con el primer turno de mañana como ejemplo, los botones de respuesta y una conversación de muestra.
- **Turnos de mañana** (si no hay, los próximos 8): hora, paciente con teléfono, doctor, estado del recordatorio y acción. Contadores: confirmaron / enviados / piden reprogramar / sin respuesta.
- Acciones: **Enviar todos ahora**, **Reenviar** (en «Enviado» y «Sin respuesta») y **Ver agenda** (en «Pidió reprogramar»).

## Tablas
**recordatorio_config** (una por clínica; opcional por sede, 08)
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, sede_id | | |
| activo | bool | pausa general |
| aviso_24h, aviso_2h | bool | mejor: tabla de reglas `offset_horas` para poder agregar otros |
| pedir_confirmacion | bool | agrega botones de respuesta |
| saludo_cumple | bool | |
| plantilla_id | FK | |
| hora_envio | time | la maqueta muestra «se envía hoy 09:00» |
| ventana_silencio | | no enviar de noche ni fuera de horario |
| updated_by, updated_at | | |

**mensaje_plantilla**: id, clinica_id, tipo (recordatorio_24h / recordatorio_2h / cumpleaños / confirmación), idioma (es / gn, ver 02), texto, variables permitidas, estado de aprobación en el proveedor (las plantillas que inician conversación deben estar aprobadas), activa.

**recordatorio_envio** (uno por turno y aviso)
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, turno_id, paciente_id | FK | |
| tipo | enum | 24h / 2h / cumpleaños / manual |
| programado_para, enviado_en | timestamptz | |
| telefono | text | copia del número usado |
| texto_final | text | ya con las variables reemplazadas |
| estado | enum | pendiente / enviado / entregado / leído / confirmó / pidió reprogramar / sin respuesta / fallido / omitido |
| respuesta, respondido_en | | |
| proveedor_msg_id, error_codigo | | trazabilidad con el proveedor |
| origen | enum | automático / manual (quién lo disparó: usuario_id) |

**mensaje_entrante** (respuestas): id, clinica_id, telefono, paciente_id (si se reconoce), texto o id del botón, recibido_en, turno_id al que se asoció, procesado.

## Reglas
1. Estados de la maqueta: *Enviado, Confirmó, Pidió reprogramar, Sin respuesta, Se envía hoy 09:00*. En la real se suman entregado / leído / fallido.
2. **Quién recibe**: solo pacientes que **aceptaron WhatsApp** (campo de la ficha, 02) y con teléfono válido en formato internacional. Sin consentimiento o con teléfono inválido: se marca «omitido» y recepción lo ve para llamar.
3. Solo se recuerdan turnos en estado agendada o confirmada. Cancelado o atendido nunca; si el turno se mueve o se cancela después del envío, se manda el aviso de cambio y se invalida el pendiente.
4. **24 h antes** sale a la hora fija de envío del día anterior; **2 h antes** sale 2 horas antes del inicio del turno. Si el turno se agenda con menos de 24 h de anticipación, solo corresponde el aviso que todavía está a tiempo. Con el interruptor general en pausa no sale ninguno.
5. **Respuesta «Confirmo»**: el turno pasa a *confirmada* sin intervención de recepción (01) y se agradece al paciente. **«Reprogramar»**: el turno queda marcado «pidió reprogramar», aparece en la agenda y en Inicio para que recepción ofrezca otro horario; el sistema no mueve el turno solo.
6. Una respuesta se asocia al turno más próximo de ese teléfono; si la persona tiene varios turnos o un mismo número sirve a la familia (02), se pide aclarar. Textos libres que no son botón no cambian nada y se derivan a recepción.
7. **Sin respuesta**: pasado el plazo (por ejemplo, la mañana del turno) pasa a «sin respuesta» y entra en la lista de llamadas del día. **Reenviar** crea un nuevo envío (no pisa el anterior) y deja quién lo hizo.
8. **Plantilla**: se reemplazan `{nombre}` (primer nombre), `{dia}` (fecha larga sin el año), `{hora}` y `{doctor}` (si no hay, «tu doctor»); en español de Paraguay con «vos» y también en guaraní según el idioma del paciente (02). Variable desconocida: se rechaza al guardar. En la maqueta el nombre de la clínica está dentro del texto; en la real sale de los datos de la clínica o sede.
9. **Cumpleaños**: un envío por año por paciente activo con consentimiento; la maqueta tiene el interruptor sin lógica asociada.
10. **Envíos masivos** («Enviar todos»): piden confirmación, no repiten lo ya enviado y respetan el límite del proveedor (cola con ritmo controlado). Todo envío queda en `recordatorio_envio`.
11. El número emisor es el de la clínica (o de cada sede); credenciales del proveedor solo en el almacén de secretos (00). Se registra cada intento y cada fallo con su código para poder reintentar.
12. Mensajes con datos de salud: el recordatorio no incluye diagnóstico ni tratamiento, solo fecha, hora, profesional y lugar. Si el paciente pide dejar de recibirlos, se desactiva `acepta_whatsapp` y queda registrado.
13. Mismo canal para otros envíos: PDF de la factura (09), receta o certificado (04), enlace de consentimiento (05) y confirmación de reserva online (06); comparten proveedor, consentimiento y registro de envíos.

## Conecta con
Agenda (estado del turno, 01), pacientes (teléfono, idioma y consentimiento, 02), reserva online (06), sedes (número y horarios, 08), facturación (envío del PDF, 09) e Inicio (turnos sin confirmar).
