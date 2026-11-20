# Recetas, certificados e indicaciones

Pantalla: ficha del paciente → pestaña «Recetas y certificados». Código de la maqueta: `gestion/rec.js`.

## Qué hace
- Emite tres tipos de documento: **receta** (REC-), **certificado médico** (CER-: reposo, asistencia, aptitud) e **indicaciones** (IND-).
- Cada documento sale con el **doctor responsable**: su firma digital y, si él lo activa, su **sello** (nombre + Reg. Prof.).
- Antes de firmar, cruza los remedios con las **alergias de la anamnesis**: si hay conflicto (ej. amoxicilina con alergia a penicilina), bloquea «Firmar y emitir».
- Documento A4 imprimible, con código de verificación y QR; copia por WhatsApp.

## Tablas
**doctor_firma** (1 por doctor)
| campo | tipo | nota |
|---|---|---|
| doctor_id | FK usuarios | |
| registro_prof | text | sale en el sello y bajo la firma |
| firma_img | blob/url PNG | firma cargada una vez (tablet o imagen) |
| sello_activo | bool | el doctor elige si imprime sello |
| sello_color | text | color del sello |

**medicamento** (catálogo)
| campo | tipo | nota |
|---|---|---|
| id, nombre, presentacion | | ej. Amoxicilina 500 mg cápsulas |
| posologia_sugerida | text | se puede editar en la receta |
| grupo_alergia | text | penicilina, aine, … (para el cruce) |

**documento_clinico**
| campo | tipo | nota |
|---|---|---|
| id, paciente_id, doctor_id | | |
| tipo | enum receta / certificado / indicaciones | |
| numero | text | correlativo por tipo (REC-0042) |
| fecha_emision | datetime | |
| diagnostico, observaciones | text | |
| cert_tipo, cert_dias, cert_texto | | solo certificado |
| codigo_verificacion | text único | ej. Q4MB-7TZR, va en el QR |
| firmado_por, firmado_en | | auditoría |
| sello_impreso | bool | foto del estado del sello al emitir |
| anulado, motivo_anulacion | | nunca se borra, se anula |

**documento_item** (receta): documento_id, medicamento_id, posologia, cantidad, duracion.

## Reglas
1. Numeración correlativa por tipo y clínica, sin huecos; se asigna al **firmar**, no al abrir el formulario.
2. Cruce de alergias: `grupo_alergia` del medicamento ∩ alergias marcadas en la última anamnesis → bloquea y explica.
3. Documento firmado **no se edita**: para corregir, se anula y se emite otro.
4. El PDF guarda la firma y el sello como estaban al emitir (si el doctor cambia la firma después, los viejos no cambian).
5. QR → página pública `/verificar/<codigo>` que muestra tipo, fecha, doctor y estado (válido/anulado), sin datos clínicos.

## Conecta con
- Anamnesis (alergias), usuarios/doctores (firma y sello), WhatsApp (envío de copia), historial del paciente.
