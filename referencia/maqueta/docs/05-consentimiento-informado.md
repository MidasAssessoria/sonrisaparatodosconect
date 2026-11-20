# Consentimiento informado con firma en tablet

Pantalla: ficha del paciente → pestaña «Consentimientos». Código de la maqueta: `gestion/cons.js`.

## Qué hace
- Modelos por procedimiento: extracción, endodoncia, implante, blanqueamiento, ortodoncia, anestesia local. Cada uno con descripción, riesgos y alternativas.
- El paciente lee en la tablet, marca «Leí, entendí y acepto» y **firma con el dedo o lápiz**.
- Paciente **menor de 18**: pide nombre del tutor/a y firma el tutor.
- Sale con la firma y el sello del **doctor responsable** (mismo módulo de recetas), código de verificación y QR; imprimible y copia por WhatsApp.

## Tablas
**consentimiento_modelo** (editable por la clínica)
| campo | tipo | nota |
|---|---|---|
| id, codigo, nombre | | ej. endodoncia |
| version | text | v1.2: cada cambio de texto crea versión nueva |
| descripcion, riesgos[], alternativas[] | text | |
| activo | bool | |

**consentimiento**
| campo | tipo | nota |
|---|---|---|
| id, numero | | CON-0012 correlativo |
| paciente_id, doctor_id, modelo_id | FK | |
| modelo_version + texto_firmado | text | **copia del texto exacto** que se firmó |
| pieza | text | opcional |
| firmante_nombre, firmante_ci | | paciente o tutor |
| es_tutor | bool | |
| firma_img | PNG | trazo de la tablet |
| aceptado_check | bool | |
| firmado_en, dispositivo, ip | | evidencia |
| codigo_verificacion | text único | QR |
| revocado, revocado_en | | se puede revocar antes del procedimiento |

## Reglas
1. No se guarda sin: firma dibujada, check marcado y (si es menor) nombre del tutor.
2. Se guarda el **texto completo** firmado, no solo el id del modelo: si la clínica cambia el modelo, el firmado no cambia.
3. Firmado no se edita; se revoca y se firma otro.
4. Recomendado: al agendar un procedimiento que exige consentimiento (implante, extracción…), avisar en la agenda si el paciente todavía no firmó.

## Conecta con
- Pacientes (edad → tutor), doctores (firma/sello de recetas), agenda/tratamientos (procedimiento y pieza), WhatsApp, verificación pública por código.
