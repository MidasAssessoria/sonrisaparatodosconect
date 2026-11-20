# Índice y arquitectura general

Punto de partida para rehacer la maqueta como app real con base de datos. La maqueta (`odontograma-3d/gestion/`) es HTML + JS puro con datos de demostración ficticios en `localStorage`; sirve para ver **qué hace cada pantalla**, no como diseño de datos. Cada doc dice qué tablas hacen falta y qué reglas ya están probadas en la maqueta.

## Pantallas → doc → código
Rutas de la maqueta: `gestion/index.html#/<pantalla>`. Código en `odontograma-3d/gestion/` salvo que se indique otra cosa. `data.js` (semilla y utilidades) lo usan todos.

| Pantalla | Doc | Código de la maqueta |
|---|---|---|
| Inicio | 01 | `app.js` (VIEWS.inicio) |
| Agenda (día / semana, nuevo turno) | 01 | `app.js` (VIEWS.agenda) |
| Pacientes (lista, nuevo paciente) | 02 | `app.js` (VIEWS.pacientes) |
| Ficha · Datos | 02 | `app.js` (patProfile) |
| Ficha · Anamnesis e historial, alerta médica | 02 | `anam.js` |
| Ficha · Odontograma (resumen 2D + odontograma 3D) | 12 | `app.js` (odoSvg) · `../app.js` + `../index.html` (three.js) |
| Ficha · Patología bucal | 13 | `app.js` (lesionTab) |
| Ficha · Radiografías | 13 | `rx.js` |
| Ficha · Periodontograma | 13 | `perio.js` |
| Ficha · Recetas y certificados | 04 | `rec.js` |
| Ficha · Consentimientos | 05 | `cons.js` |
| Ficha · Fotos clínicas | 07 | `fotos.js` |
| Ficha · Presupuestos y Pagos | 03 | `app.js` (patProfile) |
| Presupuestos | 03 | `app2.js` |
| Caja | 03 | `app2.js` |
| Facturación SIFEN | 09 | `app2.js` |
| Contabilidad | 09 | `app2.js` |
| Reportes | 10 | `app2.js` |
| Personal | 10 | `app2.js` |
| Inventario | 10 | `app2.js` |
| Recordatorios WhatsApp | 11 | `wa.js` |
| Agendamiento online (página pública) | 06 | `reservar.html` + `reservar.js` |
| Sedes y selector de sede | 08 | `sedes.js` |

Docs: 01 inicio y agenda · 02 pacientes y ficha · 03 presupuestos, caja y pagos · 04 recetas y certificados · 05 consentimiento informado · 06 agendamiento online · 07 fotos clínicas · 08 varias sedes · 09 facturación SIFEN y contabilidad · 10 reportes, personal e inventario · 11 recordatorios WhatsApp · 12 odontograma · 13 patología bucal, radiografías y periodontograma.

## Entidades globales
```
clinica ─┬─ sede ─┬─ sillon
         │        └─ caja_sesion ── pago ┐
         │                               ├─ factura ── factura_item
         ├─ usuario ── rol / permisos    │      └─ (nota de crédito)
         │     └─ profesional ── firma/sello (04)
         │            │
         ├─ paciente ─┼─ turno ───────────┤ (turno → tratamiento, sede, sillón, profesional)
         │    │       │                   │
         │    │       ├─ presupuesto ── presupuesto_item ── tratamiento
         │    │       │        └─ pago (imputa a un presupuesto, o cobro particular)
         │    │       ├─ anamnesis (versiones) → alerta médica
         │    │       ├─ odontograma_hallazgo / historial por diente / visita clínica
         │    │       ├─ lesion_bucal ── lesion_control
         │    │       ├─ radiografia, periodontograma
         │    │       ├─ documento_clinico (recetas, certificados) · consentimiento · foto
         │    │       └─ paciente_relacion (familia, tutor, responsable de pago)
         │
         ├─ egreso · cuenta_por_pagar · proveedor
         ├─ insumo ── lote · movimiento_insumo
         ├─ wa_mensaje · wa_respuesta · wa_config
         └─ timbrado · punto de expedición SIFEN
```
Lectura rápida: el **paciente** es único para toda la clínica y todas las sedes; el **turno** une paciente + profesional + sede + tratamiento; el **presupuesto** convierte un plan en saldo; el **pago** (siempre dentro de una sesión de caja abierta) baja ese saldo y se factura 1 a 1; el **egreso** y la **cuenta por pagar** son el lado de las compras.

## Convenciones de datos
- **Id**: UUID (o bigint) en toda tabla; los ids de la maqueta (`p1`, `a3`, `b2`…) son solo de demo. No migrar datos de demo.
- **`clinica_id` en TODAS las tablas** (multi-clínica desde el día 1) y `sede_id` donde el dato es por sede (08). Toda consulta filtra por `clinica_id`; que no dependa solo del código de cada pantalla (filtro obligatorio central o políticas a nivel de base).
- **Dinero**: guaraníes sin decimales → entero (`bigint`). Precios con IVA incluido; el IVA se calcula, no se carga (ver 03 y 09).
- **Fechas**: `timestamptz` en UTC; zona de la clínica `America/Asuncion` para mostrar, agrupar «hoy» y cortar el día de caja. La maqueta usa el reloj del navegador.
- **Auditoría en cada tabla**: `created_at`, `created_by`, `updated_at`, `updated_by`.
- **Borrado**: `deleted_at` / `anulado` + motivo. Nunca borrar pagos, facturas, documentos firmados ni versiones de anamnesis; se anulan o se versionan. (La maqueta borra turnos cancelados: en la real pasan a estado `cancelada`.)
- **Enums**: guardarlos como texto controlado, mismos valores que la maqueta (ej. turno `agendada / confirmada / en sala / atendida`).
- **Búsqueda de pacientes**: nombre, CI y teléfono, sin tildes ni puntos (la maqueta busca por subcadena en minúsculas).

## Acceso, roles y permisos
- Login por usuario (correo + contraseña, ideal doble factor para dueño/administración), sesión con vencimiento y cierre por inactividad en recepción. La maqueta no tiene login.
- Roles que aparecen en Personal: **Odontólogo/a, Asistente dental, Recepción y caja, Administración** (+ dueño). Propuesta de acceso, a validar con la clínica: odontólogo → agenda propia, ficha clínica completa, presupuestos; asistente → agenda, ficha de lectura, inventario; recepción → agenda, pacientes (datos), cobros y caja; administración → facturación, contabilidad, reportes, personal; dueño → todo y todas las sedes.
- Permiso por **módulo + acción** (ver / crear / editar / anular / exportar) y por **sede** (08). Los datos clínicos (ficha, odontograma, radiografías, fotos, anamnesis) son sensibles: solo roles clínicos y recepción en lectura mínima.
- Cada documento firmado guarda **quién y cuándo** (firma del doctor y sello, ver 04).

## Registro de auditoría (audit_log)
Tabla única `audit_log`: id, clinica_id, usuario_id, fecha, entidad, entidad_id, acción (crear / editar / anular / ver / exportar / enviar), antes y después (JSON), ip. Obligatorio para: pagos, caja (apertura y cierre con diferencia), facturas, cambios de presupuesto, anamnesis, documentos clínicos, exportaciones CSV y accesos a ficha de otro profesional.

## Archivos (almacenamiento privado)
Radiografías, fotos clínicas, firmas (anamnesis, consentimientos, doctores), PDF y XML de facturas, certificados digitales: **bucket privado**, URL firmada con vencimiento corto, nunca URL pública ni indexable. En la base va solo la ruta, el tamaño, el tipo y quién lo subió. La maqueta guarda imágenes en base64 dentro de `localStorage`; en la real, no.

## Integraciones externas
- **SIFEN (factura electrónica)**: firma digital, envío, respuesta, QR/KuDE → 09. El certificado y su clave van en un almacén de secretos, no en la base común.
- **WhatsApp**: recordatorios, confirmación de reserva, copias de documentos → una sola bandeja de salida `wa_mensaje` (11).
- **Impresión / PDF**: recetas, consentimientos, factura, hoja de odontograma; se generan en el servidor o con la vista de impresión.

## Orden de construcción sugerido
1. Base: clínica, sedes, usuarios, roles, auditoría, almacenamiento privado.
2. Pacientes + anamnesis + alerta médica (02) y profesionales + agenda (01).
3. Tratamientos, presupuestos, caja y pagos (03).
4. Facturación SIFEN (09) y contabilidad.
5. Ficha clínica: odontograma (12), patología / radiografías / periodontograma (13), recetas (04), consentimientos (05), fotos (07).
6. Recordatorios (11) y agendamiento online (06).
7. Inventario, reportes, personal, varias sedes (10, 08).

## Datos de la maqueta
Dos almacenes **separados** en el navegador: `sptc-gestion-v1` (gestión) y `odonto3d-sonrisa-v3` (odontograma 3D, con su propia lista de pacientes). En la app real el odontograma 3D lee y escribe sobre el mismo `paciente` de la ficha (12).

## Límites de la maqueta
Ver `14-limites-de-la-maqueta.md`: atajos de demo que la app real tiene que resolver.
