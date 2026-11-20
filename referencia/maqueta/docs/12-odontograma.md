# Odontograma (2D resumido y 3D)

Pantallas: pestaña «Odontograma» de la ficha (resumen 2D con plan sugerido) y el «Odontograma 3D» interactivo (`/`, botón «Abrir odontograma 3D»). Código de la maqueta: `odontograma-3d/app.js` + `index.html` (three.js; marcas, historial por diente, consultas, comparar, imprimir) y, en la gestión, `gestion/app.js` (`odoSvg`, pestaña `odontograma`, `p.marks`) y `gestion/data.js` (semilla). Dos almacenes separados en la maqueta: `odonto3d-sonrisa-v3` (3D) y `sptc-gestion-v1` (gestión); en la real es **uno solo**.

## Qué hace
- **Resumen 2D** (ficha): arcadas con colores (caries negro, extracción azul, problema periodontal rojo, sano claro), conteo por tipo, banner de alerta médica (02), «Plan sugerido» (máximo 6 líneas) con **Armar presupuesto** (03), accesos al 3D y a las radiografías (13). Dentición **temporal 51–85** si el paciente tiene menos de 12 años, **adulto 11–48** en los demás casos.
- **3D**: arcada completa o por arcada, adulto o pediátrico; rotar, acercar, tocar una cara del diente para marcar. Herramientas de marca: caries (clase de Black I a V, automática por la cara tocada), extracción indicada, periodontal, corona, implante, endodoncia, ausente, prótesis, sellante y patología del diente (lesión periapical, fractura, reabsorción radicular, movilidad con grado I a III, fístula).
- **Estado por hallazgo**: *por realizar* (rojo) o *realizado* (azul); un interruptor define el estado con que nacen las marcas nuevas.
- **Ficha del diente**: hallazgos con su estado e **historial** de entradas (fecha, diagnóstico, tratamiento, nota).
- **Consultas**: «Guardar consulta» toma una foto de todo el odontograma y los historiales (motivo, fecha); se puede **restaurar**, **comparar dos consultas** lado a lado e **imprimir / PDF**.
- Resumen inferior con listas por tipo y conteo «N por realizar · N realizados»; atajos «Desdentado superior / inferior», «Limpiar todo» y deshacer.

## Tablas
**diente_catalogo** (fija, no depende de la clínica)
| campo | nota |
|---|---|
| fdi | 11–18, 21–28, 31–38, 41–48 (adulto); 51–55, 61–65, 71–75, 81–85 (temporal) |
| denticion | adulto / temporal |
| tipo | incisivo central/lateral, canino, premolar, molar (temporal: molares 54/55, etc.) |
| caras | O/I, M, D, V, L/P (anteriores: incisal y palatino/lingual) |

**hallazgo_dental** (modelo recomendado: una fila por hallazgo en el tiempo, no un JSON pisado)
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, paciente_id | | |
| fdi | smallint | validado contra el catálogo |
| cara | enum O/M/D/V/L, nulo | nulo para hallazgos del diente entero |
| tipo | enum | caries, extraccion_indicada, periodontal, corona, implante, endodoncia, ausente, protesis, sellante, lesion_periapical, fractura, reabsorcion, movilidad, fistula |
| clase_black | enum I–V, nulo | solo caries |
| grado_movilidad | smallint 1–3, nulo | solo movilidad |
| estado | enum por_realizar / realizado | «ausente» no tiene estado (la maqueta lo excluye) |
| detectado_en, detectado_por | | |
| realizado_en, realizado_por, turno_id | | cierre del hallazgo |
| vigente_desde, vigente_hasta | timestamptz | `hasta` nulo = vigente; borrar una marca cierra la fila, no la elimina |
| presupuesto_item_id | FK nulo | enlace con el plan (03) |
| nota, created_*, updated_* | | |

**historial_diente** (entradas clínicas): id, paciente_id, fdi, fecha, diagnostico, tratamiento, nota, profesional_id, turno_id, created_*. Solo se agrega; una corrección es otra entrada o una anulación con motivo.

**consulta_odontograma** (instantánea guardada): id, paciente_id, fecha_hora, motivo (hasta 100 caracteres), profesional_id, created_by. Se reconstruye desde las fechas de vigencia de los hallazgos; si se quiere velocidad, guardar `snapshot_json` inmutable.

**diagnostico_catalogo / tratamiento_catalogo**: listas de sugerencias para el historial (la maqueta trae un conjunto de diagnósticos) y enlace al catálogo de precios (03).

## Reglas
1. Numeración **FDI** de dos dígitos: cuadrante + posición. Adultos: posiciones 1–8 en cuadrantes 1–4; temporales: posiciones 1–5 en cuadrantes 5–8. «Pediátrico» se define por edad (menos de 12 en la maqueta) y debe ser configurable; en dentición mixta hay que permitir ver ambas denticiones (la maqueta tiene una pestaña por dentición en el 3D, y el 2D elige por edad).
2. **Caries**: la clase de Black sale de la cara tocada (clase I: oclusal en posteriores, lingual en anteriores; II solo posteriores, cara proximal; III y IV solo incisivos y caninos, cara proximal; V cara libre vestibular / lingual). Elegir una clase que no corresponde (por ejemplo II en un incisivo) se rechaza con mensaje. Tocar de nuevo la misma clase **quita** la caries; una cara tiene a lo sumo una caries.
3. Cada tipo de marca es un **interruptor** por diente (tocar agrega, tocar de nuevo quita), con dos excepciones: **movilidad** sube de grado I → II → III y al cuarto toque se quita; **ausente** limpia caries, extracción y periodontal del diente.
4. Estado de tratamiento: toda marca nace según el interruptor «por realizar / realizado». Se puede cambiar el estado de cada hallazgo desde la ficha del diente. Si se quita la marca, desaparece también su estado.
5. **Deshacer**: la maqueta deshace el último toque en el mismo diente durante unos instantes; la real debe dejar rastro de cada cambio (`audit_log`) y permitir anular, no borrar.
6. **Plan sugerido → presupuesto**: cada hallazgo *por realizar* genera una línea sugerida (caries → restauración; extracción indicada → extracción; periodontal → tratamiento periodontal) con la pieza; el usuario elige el tratamiento y el precio del catálogo. La maqueta arma el texto, pero el presupuesto no conserva la pieza: en la real sí (campo `fdi` y cara en `presupuesto_item`, 03). Al marcar el ítem como realizado, el hallazgo pasa a *realizado* en el odontograma.
7. **Historial**: una entrada necesita diagnóstico, tratamiento o nota (al menos uno). Se muestra del más nuevo al más viejo con fecha y quién la hizo. La maqueta permite quitar entradas; la real no.
8. **Consultas guardadas**: guardan odontograma de ambas denticiones y los historiales del paciente; «Comparar» pide dos consultas y marca lo que cambió (hallazgos nuevos, cerrados, realizados). Restaurar una consulta reemplaza el estado actual, por lo que debe pedir confirmación y quedar auditado.
9. **Pacientes del 3D**: la maqueta tiene su propia lista de pacientes (nombre, CI, nacimiento); en la real el 3D se abre **para el paciente de la ficha** (parámetro de ruta) y usa la misma tabla `paciente` (02). Eliminar un paciente no existe como acción: se desactiva.
10. Alertas: el banner médico (02) se muestra también en el 3D. Un diente con movilidad, fístula o lesión periapical aparece resaltado en el resumen y sugiere radiografía (13).
11. Imprimir / PDF: hoja con odontograma, leyenda, listas por tipo y datos del paciente y de la clínica; el documento impreso queda como archivo con fecha (no se reescribe).
12. Rendimiento y accesibilidad (build real): mallas y texturas en caché, versión simplificada para celulares y alternativa textual/2D para quien no usa 3D.

## Conecta con
Pacientes (alertas, edad, 02), presupuestos (plan sugerido y pieza, 03), patología y radiografías por diente (13), recetas y consentimientos (por pieza, 04, 05), agenda (turno donde se realiza, 01), fotos clínicas (07).
