# Pacientes, ficha, anamnesis e historial

Pantallas: «Pacientes» (lista) y ficha del paciente → pestañas «Datos» y «Anamnesis e historial». Código de la maqueta: `gestion/app.js` (VIEWS.pacientes, patProfile) y `gestion/anam.js`. Las demás pestañas de la ficha tienen su doc: odontograma (12), patología / radiografías / periodontograma (13), recetas (04), consentimientos (05), fotos (07), presupuestos y pagos (03).

## Qué hace
- **Lista**: búsqueda por nombre, CI o teléfono; filtros *Todos / Con saldo / Pediátricos / Con alerta clínica*. Columnas: paciente (con edad), CI, teléfono, próximo turno, saldo, alertas. Buscador global arriba con los 6 primeros resultados.
- **Nuevo paciente**: solo el nombre es obligatorio; CI, teléfono, nacimiento, sexo (F/M) e idioma (español / guaraní). Al guardar abre la ficha.
- **Ficha**: cabecera con edad, CI, teléfono, alertas, saldo y accesos a *Nuevo turno* y *Nuevo presupuesto*; debajo, las pestañas.
- **Datos**: CI, RUC, nacimiento, teléfono, correo, ciudad, idioma, aceptación de recordatorios por WhatsApp, alertas clínicas, **grupo familiar** (vínculo en ambos sentidos, ej. madre ↔ hijo) y notas internas.
- **Anamnesis**: cuestionario médico y odontológico **versionado** y firmado en pantalla. Cada actualización crea una versión nueva; las anteriores quedan para consultar.
- **Alerta médica**: banner rojo calculado desde la última anamnesis; aparece en la cabecera de la ficha, en odontograma, anamnesis y en el detalle del turno.
- **Historial** (línea de tiempo): consultas atendidas, planes aprobados, evolución de lesiones y versiones de anamnesis, del más nuevo al más viejo.

## Tablas
**paciente**
| campo | tipo | nota |
|---|---|---|
| id, clinica_id | | |
| nombres, apellidos | text | la maqueta tiene un solo campo «nombre» |
| ci | text | **único por clínica**; puede ser nulo en niños (avisar si ya existe) |
| ruc | text | con dígito verificador; sale en la factura (09) |
| fecha_nac, sexo (F/M) | | el sexo habilita la pregunta de embarazo |
| telefono | text | formato internacional, se usa para WhatsApp |
| email, ciudad, direccion | text | |
| idioma | enum es / gn | elige idioma de mensajes (11) |
| acepta_whatsapp | bool | consentimiento de recordatorios |
| nota_interna | text | |
| origen | enum recepcion / online | «Registrado por reserva online» (06) |
| activo, deleted_at, created_*, updated_* | | auditoría; no se borra |

**paciente_relacion**: paciente_id, familiar_id, tipo (madre / padre / tutor / hijo / otro), es_tutor_legal, es_responsable_pago. Se crea espejo en ambos sentidos.

**paciente_alerta** (manual): paciente_id, texto, activa, creada_por. Las alertas médicas **no se cargan a mano**: se derivan de la anamnesis (regla 5).

**anamnesis_pregunta** (catálogo editable)
| campo | nota |
|---|---|
| codigo, seccion, orden, texto | secciones 1–5 abajo |
| tipo | txt / si_no / multi |
| opciones[] | solo multi |
| solo_sexo | ej. «F» para embarazo |

**anamnesis** (una fila por versión, inmutable): id, paciente_id, version, fecha, registrado_por, firmante_nombre, firmante_ci, es_tutor, firma_img (almacenamiento privado), declaracion_veracidad (bool).
**anamnesis_respuesta**: anamnesis_id, pregunta_codigo, respuesta_si (bool), opciones[], detalle, texto.
**alerta_medica_regla**: pregunta_codigo, opcion, texto_alerta, gravedad. Contenido de la maqueta: alergias (penicilina, anestésicos locales, látex, material dental, otro medicamento), anticoagulantes, diabetes, problemas cardíacos (→ «Cardiopatía»), alteraciones de coagulación y embarazo / lactancia.

**Secciones del cuestionario**: 1 motivo y síntoma actual (motivo, síntoma, qué lo desencadena, encías) · 2 antecedentes odontológicos (última consulta, tratamientos previos, prótesis, experiencia desagradable, ATM) · 3 hábitos (cepillado, auxiliares de higiene, parafunciones, sustancias) · 4 antecedentes médicos (enfermedades, medicación, alergias, cirugías, embarazo/lactancia) · 5 datos complementarios (hepatitis, VIH, epilepsia, enfermedad renal, cáncer / radioterapia; presión arterial, pulso, peso).

## Reglas
1. Buscar y filtrar no distingue mayúsculas ni tildes. «Pediátrico» = menor de 12 años en la maqueta (misma edad que usa el odontograma 2D para dentición temporal); es un parámetro de la clínica.
2. El **saldo** del paciente = suma de saldos de sus presupuestos aprobados (03). El **próximo turno** = el más cercano desde hoy.
3. Nombre obligatorio; CI duplicada dentro de la clínica → aviso (no silencioso). Paciente creado por reserva online entra marcado para que recepción complete la ficha y la anamnesis (06).
4. **Anamnesis versionada**: nunca se edita una versión guardada. «Actualizar» abre el formulario con los valores de la versión vigente y guarda la siguiente (versión = anterior + 1). La vigente es la última; se puede ver cualquier versión anterior.
5. **Alerta médica**: se recalcula cada vez que se pide, desde la anamnesis vigente con `alerta_medica_regla`. Si la respuesta tiene detalle, se agrega al texto entre paréntesis (ej. «Alergia a la penicilina (urticaria con amoxicilina)»). Embarazo / lactancia alerta solo si la respuesta es sí.
6. La pregunta de embarazo solo se muestra si el sexo del paciente es F.
7. Para guardar una anamnesis hacen falta **firma** y la casilla «Declaro que la información es verdadera». Se guarda quién la registró y cuándo. Para menores de 18 firma el tutor y se registra su nombre y CI (la maqueta guarda siempre al paciente como firmante).
8. La alerta médica alimenta el **cruce de alergias** de las recetas (04) y se muestra al abrir un turno (01).
9. El historial es una vista que une eventos de varias tablas (turno atendido, presupuesto aprobado, lesión, anamnesis; en la real también recetas, consentimientos, fotos, radiografías). Cada evento enlaza a su origen.
10. Alertas manuales (`paciente_alerta`) y alertas derivadas se muestran juntas, con distinto estilo; el filtro «Con alerta clínica» considera ambas (la maqueta solo mira las manuales).
11. Datos del paciente = datos de salud: acceso por rol, auditoría de lectura y exportación (00). Soft delete: un paciente con historia no se elimina.

## Conecta con
Agenda (turnos), presupuestos y caja (saldo, pagos), odontograma y demás pestañas clínicas, recetas (alergias), recordatorios (idioma, teléfono, aceptación), facturación (RUC), agendamiento online (alta de paciente nuevo).
