# Sonrisa Para Todos Conecta — Plan de arquitectura y construcción

> Decisiones ya tomadas: **SIFEN queda fuera del plan** y **lo construye una sola persona con agentes de IA**. La Fase 0 se ejecuta con una rama y un Pull Request por sprint.

---

## 1. Resumen ejecutivo (una página)

**Qué es.** Sistema de gestión para clínicas odontológicas en Paraguay: agenda, ficha clínica (anamnesis, odontograma 3D, patología, radiografías, periodontograma, fotos), presupuestos, caja, documentos firmados (recetas, certificados, consentimientos), recordatorios por WhatsApp, reserva online, reportes, inventario y personal. Una base para todas las clínicas y sedes.

**Qué propongo.**
- **Stack**: TypeScript de punta a punta. API NestJS (monolito modular) + PostgreSQL con aislamiento por clínica a nivel de base (RLS) + React/Vite como PWA para web y tablet + Supabase (Postgres, Auth, Storage privado) + cola `pg-boss` sobre el mismo Postgres + Railway para API y worker. Pocas piezas, porque lo mantiene una persona.
- **Modelo de datos**: ~60 tablas en 8 dominios, todas con `clinica_id`, auditoría y baja lógica. Lo clínico es *solo agregar* (versiones, vigencias, contraasientos); nada firmado o cobrado se edita ni se borra.
- **Plan**: 20 sprints de 2 semanas (40 semanas), en 4 fases.

| Fase | Sprints | Resultado |
|---|---|---|
| 0 · Base | 1–2 | Repo, entornos, CI, login con 2FA, roles y permisos, sedes, auditoría, archivos privados |
| 1 · MVP para abrir | 3–10 | Pacientes, anamnesis, agenda, odontograma, presupuestos, caja y pagos. **Clínica operando en la semana 20** |
| 2 · Documentos y WhatsApp | 11–14 | Recetas/certificados, consentimiento con firma, recordatorios WhatsApp |
| 3 · Ampliación | 15–20 | Reserva online, fotos, radiografías, patología, periodontograma, reportes, inventario, personal |

**Cambios al orden que pediste** (detalle en §5.1):
1. **SIFEN sale del plan.** El cobro queda completo; la factura se emite por fuera y se anota su número en el pago. Las tablas quedan diseñadas para sumarlo después sin rehacer nada.
2. **Alta de usuarios e invitaciones pasa de Fase 3 a Fase 0**: sin eso nadie puede entrar al sistema.
3. **Fase 2 arranca por recetas y consentimiento, WhatsApp después**: WhatsApp depende de la aprobación de Meta (trámite externo, semanas) y además manda copias de esos documentos.
4. **Trámite de WhatsApp Business se inicia en el Sprint 1**, aunque el código llegue en el 13.

**Los cuatro riesgos mayores.**
1. *Sin SIFEN*: si la clínica ya está obligada a facturar electrónicamente, necesita otra herramienta en paralelo. Lo confirma el contador (pregunta P1).
2. *Odontograma 3D*: es el activo más caro de la maqueta (120 KB de JS sobre three.js) y hoy tiene su propia lista de pacientes y su propio almacén. Se prueba la integración en el Sprint 2, antes de comprometer los sprints 6–7.
3. *Validez de la firma*: los docs piden firma dibujada en tablet, no firma digital con certificado. Hay que validar con un asesor legal que alcanza para anamnesis y consentimientos.
4. *Datos de salud*: aislamiento entre clínicas en la base, auditoría de lectura, archivos nunca públicos.

**Esfuerzo.** ≈166 días-persona sobre 200 días hábiles (40 semanas); margen ±30 %. Desde el Sprint 11 se reserva ~20 % para soporte de la clínica ya en producción.

**Lo que encontré al revisar**: 16 contradicciones entre docs y 22 entre docs y código (§2). La más cara: el odontograma 3D hoy no recibe paciente ni emite datos; hay que encapsularlo, no solo conectarlo.

**Lo que necesito del cliente**: 14 respuestas (§7). Las que bloquean el Sprint 1 son P1 (facturación), P2 (qué significa «multi-clínica») y P3 (WhatsApp: número y cuenta de Meta).

---

## 2. Qué encontré

### 2.1 Material revisado
- **Docs**: los 15 (`00` a `14` + `LEEME.md`), completos.
- **Código**: `codigo/app.js` + `index.html` (odontograma 3D) y los 13 archivos de `codigo/gestion/`. No revisé `vendor/` (three.js de terceros).
- **Capturas**: 106 imágenes; usé los nombres como inventario de pantallas (escritorio, móvil `gestion-m*`, odontograma `v3-*`/`v4-*`). No las revisé una por una.

### 2.2 Módulos (23 pantallas, 14 docs)

| # | Módulo | Doc | Código de la maqueta |
|---|---|---|---|
| 1 | Inicio (tablero y alertas) | 01 | `gestion/app.js` VIEWS.inicio |
| 2 | Agenda día/semana, nuevo turno | 01 | `gestion/app.js` VIEWS.agenda |
| 3 | Pacientes (lista, alta) y ficha · Datos | 02 | `gestion/app.js` VIEWS.pacientes, patProfile |
| 4 | Anamnesis versionada, alerta médica, historial | 02 | `gestion/anam.js` |
| 5 | Odontograma resumen 2D | 12 | `gestion/app.js` odoSvg |
| 6 | Odontograma 3D | 12 | `codigo/app.js` + `index.html` |
| 7 | Patología bucal | 13 | `gestion/app.js` lesionTab |
| 8 | Radiografías (visor, comparar) | 13 | `gestion/rx.js` |
| 9 | Periodontograma | 13 | `gestion/perio.js` |
| 10 | Recetas, certificados, indicaciones | 04 | `gestion/rec.js` |
| 11 | Consentimiento informado | 05 | `gestion/cons.js` |
| 12 | Fotos clínicas | 07 | `gestion/fotos.js` |
| 13 | Presupuestos | 03 | `gestion/app2.js` |
| 14 | Caja y pagos | 03 | `gestion/app2.js`, `data.js` |
| 15 | Facturación SIFEN | 09 | `gestion/app2.js` — **fuera del plan** |
| 16 | Contabilidad (libro, CxC, CxP, IVA, resultado) | 09 | `gestion/app2.js` |
| 17 | Reportes | 10 | `gestion/app2.js` |
| 18 | Personal | 10 | `gestion/app2.js` |
| 19 | Inventario | 10 | `gestion/app2.js` |
| 20 | Recordatorios WhatsApp | 11 | `gestion/wa.js` |
| 21 | Reserva online (pública) | 06 | `gestion/reservar.html` + `.js` |
| 22 | Sedes y selector | 08 | `gestion/sedes.js` |
| 23 | Verificación pública de documentos `/verificar/<código>` | 04, 05 | no existe en la maqueta |

### 2.3 Contradicciones entre docs

| # | Dónde | Contradicción | Cómo lo resuelvo |
|---|---|---|---|
| D1 | 12 vs 14 §2 | La tabla del odontograma se llama `hallazgo_dental` en 12 y `odontograma_marca` en 14 | `hallazgo_dental` (el doc 12 es el detallado) |
| D2 | 01 vs 14 §5 | Estado de turno `cancelada` (01) vs `cancelado` (14) | `cancelada` / `ausente`, en femenino como el resto |
| D3 | 00 vs 11 | Mensajería: 00 nombra `wa_mensaje · wa_respuesta · wa_config`; 11 define `recordatorio_envio · mensaje_entrante · recordatorio_config` | Una sola bandeja `mensaje_saliente` + `mensaje_entrante` (11 regla 13 pide un solo canal) |
| D4 | 01 vs 04/05/06/08 | El clínico es `profesional` (01, 03) y `doctor` (`doctor_firma`, `doctor_id`, `doctor_disponibilidad`, `sede_profesional.doctor_id`). En 04 `doctor_id` apunta a *usuarios*, en 01 hay tabla `profesional` | Siempre `profesional`; `usuario` es la cuenta |
| D5 | 06 vs 08 | Disponibilidad definida dos veces: `doctor_disponibilidad` (por día) y `sede_profesional` (con `dias_semana[]`) | Una tabla `profesional_disponibilidad` (profesional + sede + día + horas) |
| D6 | 08 vs 09 | `sede.timbrado_id` y `timbrado.sede_id`: referencia en los dos sentidos | No aplica mientras SIFEN esté fuera; si vuelve, `timbrado.sede_id` solamente |
| D7 | 02 tabla vs 02 regla 3 | CI «única por clínica» (restricción) vs «CI duplicada → aviso» (permite) | Pregunta P6. Por defecto: aviso que hay que confirmar, sin bloquear |
| D8 | 03 vs 12 | `presupuesto_item` guarda «pieza y caras» (03) vs «`fdi` y cara» (12) | `fdi` + `caras[]` |
| D9 | 13 «Qué hace» vs regla 13 | Furca en «molares y premolares» vs «molares y 14, 24» | Regla 13 (la más precisa); configurable |
| D10 | 13 regla 2 vs 14 §13 | 13 dice que la evolución de una lesión no se edita; 14 dice que en la maqueta se puede editar (el código no lo permite: solo agrega) | No se edita, se agrega o se anula con motivo |
| D16 | 07 «Qué hace» vs regla 2 | Tamaño máximo de foto: 1200 px vs 1200–1600 px | 1600 px, parámetro |
| D11 | 03 vs 03 | Categorías de egreso: 6 «oficiales» + 3 más que solo usa la maqueta (Alquiler, Sueldos, Proveedores); 09 usa «Proveedores» al pagar una cuenta | Catálogo editable por clínica con las 9 |
| D12 | 03 regla 13 vs tabla `pago` | Anular pago = «contraasiento» (fila nueva) pero la tabla trae `anulado, motivo_anulacion` (marca en la fila) | Las dos cosas: fila de reverso enlazada + marca en la original (§4.6) |
| D13 | 02 vs 12/14 | «Pediátrico» = menor de 12 por edad (ficha) vs elección manual (3D) | Por edad con parámetro por clínica + cambio manual; dentición mixta muestra ambas |
| D14 | 00 vs ZIP | Los docs ubican el código en `odontograma-3d/gestion/`; en el ZIP está en `codigo/gestion/` | Solo de rutas; sin efecto |
| D15 | 10 vs 00 | `usuario.rol_id` (un rol) pero el dueño suele ser también odontólogo | Un rol por usuario y roles editables; pregunta P8 |

### 2.4 Contradicciones entre docs y código

Solo las que cambian una decisión de diseño. Las que el doc 14 ya reconoce como atajo de demo (SIFEN simulado, reportes por cobro, turno cancelado que se borra, etc.) no se repiten.

**Estructura general**
| # | Qué dice el doc | Qué hace el código | Consecuencia para el plan |
|---|---|---|---|
| C1 | 12 y 14: el 3D «se abre para el paciente de la ficha» | El enlace es `<a href="/">` sin id de paciente; el 3D no lee la URL, no emite eventos, todo es estado global del módulo atado a ids fijos del HTML y guarda en cada toque en su propio `localStorage` (`codigo/app.js`) | No es «cambiar de dónde lee»: hay que encapsularlo en un componente con entrada (`setEstado`) y salida (eventos por toque). Sprint 6 y riesgo R2 |
| C2 | 12: `hallazgo_dental.estado` y vigencias | No hay campo estado: «realizado» = la clave está en la lista `m.rea`; quitar una marca borra la clave. El 2D usa otros nombres (`caries/perio` vs `car/per`) | Hace falta un traductor entre el mapa del 3D y las filas de `hallazgo_dental`; `normM` y `canon` del código sirven de base |
| C3 | 08 regla 1: el selector de sede filtra agenda, caja, inventario y reportes | Solo filtra Agenda y la página Sedes. Pagos, caja, facturas e inventario no guardan sede (`sedes.js`, `app2.js`) | La sede es obligatoria en esas tablas desde el Sprint 1; no hay lógica de la maqueta que copiar |
| C4 | 03 regla 9 y 08 regla 4: una caja por sede | Una sola caja global (`openSes()`); quien abre está fijo en el código | Índice único de caja abierta por sede (§4.6) |
| C5 | 01 regla 7 y 08: la sede del turno sale de dónde atiende el profesional ese día (ej. lun/mié/vie Centro) | No se guarda: se deduce al leer por **paridad del día del mes** (`aptSede`) | La sede se guarda siempre en el turno; la disponibilidad real es P7 |
| C6 | 00: roles Odontólogo/a, Asistente, Recepción, Administración y dueño | Sin login ni permisos. En `S.staff` los roles son especialidades («Ortodoncista»); «dueño» no existe; Personal y profesionales no están enlazados | Rol y especialidad son campos distintos; `profesional` cuelga del usuario |

**Agenda y reserva**
| # | Qué dice el doc | Qué hace el código | Consecuencia |
|---|---|---|---|
| C7 | 01 regla 2: horario 08–18 | Tres horarios distintos: agenda 08–18 todos los días incluido domingo; reserva online sáb 8–12 y domingo cerrado; la sede San Lorenzo dice «lun–vie» | Un solo origen: `sede_horario` ∩ `profesional_disponibilidad` |
| C8 | 01 regla 5: los estados avanzan | El detalle del turno permite volver atrás (de atendida a confirmada) | Pregunta P7: ¿se permite retroceder? |
| C9 | 06: con varias sedes el paciente elige sede; «Tengo dolor» muestra el primer horario | La reserva no pregunta sede y guarda el turno sin ella; «Tengo dolor» lista todo; crea a todos los pacientes con sexo F | Sprint 15 lo construye según el doc, no según el código |
| C10 | 11 regla 5: «Confirmo» pasa el turno a confirmada; «pidió reprogramar» marca el turno | El estado del recordatorio y el del turno son independientes; «pidió reprogramar» solo existe en el recordatorio | Marca `pidio_reprogramar` en `turno` (§4.3) |

**Pacientes y dinero**
| # | Qué dice el doc | Qué hace el código | Consecuencia |
|---|---|---|---|
| C11 | 02 regla 1: búsqueda sin tildes ni puntos | Solo pasa a minúsculas; «4321001» no encuentra «4.321.001» | Columna de búsqueda normalizada (§4.4) |
| C12 | 02: RUC con dígito verificador; teléfono internacional; campo `acepta_whatsapp` | RUC = CI + dígito inventado; teléfono local sin validar; el consentimiento de WhatsApp no existe | Validadores de CI, RUC y teléfono en `shared`; migración de formato en P10 |
| C13 | 03 regla 7: el resto de redondeo va al 10 % | Va al 10 % aunque el presupuesto no tenga ítems al 10 % (`txFor`) | El resto va a la tasa de mayor base |
| C14 | 03 reglas 10–11: todo egreso exige caja abierta | Pagar una cuenta por pagar crea el egreso sin caja (`cxp-pagar`) | Los egresos que no son efectivo no exigen caja; los de efectivo sí (a confirmar, P9) |
| C15 | 09 regla 9: los totales del libro respetan el filtro | Las tarjetas y el CSV no lo respetan | Sprint 18 sigue al doc |

**Documentos clínicos**
| # | Qué dice el doc | Qué hace el código | Consecuencia |
|---|---|---|---|
| C16 | 04 regla 2: cruce de alergias por grupo | Solo funciona para penicilina; el de AINE no puede dispararse nunca y anestésicos no se cruzan (`recChoque`) | El grupo de alergia va en la regla de anamnesis y en el medicamento (§4.4, §4.5); catálogo a definir, P12 |
| C17 | 04 regla 4: firma y sello «como estaban al emitir» | Se redibujan con el estado actual del profesional: cambiar el sello cambia los documentos viejos. La firma es un garabato generado | PDF congelado con hash (Sprint 11) |
| C18 | 05 regla 2: se guarda el texto exacto firmado | No se guarda: se regenera desde el modelo; versión fija «v1.2»; con tutor imprime la CI del paciente | `texto_firmado` y `firmante_ci` obligatorios (Sprint 12) |
| C19 | 07: cada foto tiene vista y fase | Al subir, la vista es siempre «frontal» y la fase se decide sola | Formulario de carga con vista y fase (Sprint 16) |
| C20 | 13 regla 11: cada control periodontal anterior queda inmutable; incluye «implante» | Los controles viejos se editan; no hay implante; «ausente» no se puede marcar; «Nuevo control» copia el seleccionado, no el último | `cerrado_en` + trigger; copia siempre el último (Sprint 17) |
| C21 | 12 regla 8: restaurar una consulta reemplaza el estado | También pisa el historial por diente: se pierden las entradas posteriores. «Eliminar consulta» existe y no pide confirmación | Restaurar nunca toca `historial_diente`; no hay eliminar |
| C22 | 12 regla 10: banner médico y sugerencia de radiografía en el 3D | No existe nada de eso en el 3D | Se construye nuevo en Sprints 6–7 |

**En el código y en ningún doc**: botones «Reiniciar demo»; modo `?demo=ok` de la reserva; herramienta «Sano» que limpia el diente; «Limpiar todo» sin confirmación; comparar contra «Estado actual (sin guardar)». Los dos últimos y «Sano» se conservan con confirmación y auditoría; los de demo se descartan.

**En ningún lado (ni docs ni código)**: comisiones o liquidación a profesionales; cobros en otra moneda; precios distintos por sede. Van como preguntas (§7).

### 2.5 Design system vs docs
La carpeta de trabajo trae un design system («Conecta») que no venía en el ZIP. Diferencias con los docs:
| # | Design system | Docs | Cómo lo trato |
|---|---|---|---|
| S1 | Módulo «Sonrisa Comunitaria» (jornadas, formulario corto, seguimiento) | No existe | Fuera del plan; pregunta P14 |
| S2 | Registro sin conexión con sincronización en Odontología y Comunitaria | No se menciona | Cambia la arquitectura del cliente si se exige; pregunta P14 |
| S3 | Se define como SaaS | 00 dice «multi-clínica desde el día 1» sin aclarar | Refuerza el modelo con `membresia`; P2 sigue abierta |
| S4 | Módulos «Odontología» y «Estadísticas»; 8 módulos | «Ficha · Odontograma» y «Reportes»; 23 pantallas | Navegación según el design system; contenido según los docs |
| S5 | Caja con «pagos en partes» y chip de factura SIFEN | 03 deja cuotas sin definir; SIFEN fuera | Pagos a cuenta sí (ya están); chip de factura muestra «anotada / sin anotar» |
| S6 | Leyenda del odontograma con 4 marcas (caries, extracción, periodontal, sano) | 12 define 14 tipos | La leyenda se amplía en Sprint 6 respetando los 3 colores clínicos fijos |
| S7 | Montos «Gs. 300.000» | La maqueta muestra «₲ 300.000» | Formato del design system |

### 2.6 Qué se reutiliza del código
- **Odontograma 3D** (`codigo/app.js`): anatomía y numeración (`info`, `DIM`), geometría y materiales generados por código (sin modelos ni texturas externas), clase `Diente`, disposición y cámara, regla de clases de Black (`elegirClase`), normalizador `normM`, comparación (`canon`, `diferencias`) y captura para PDF (`capturar`). Se descarta su barra de pacientes, su persistencia, su ficha del diente, sus consultas y su impresión.
- **Visor de radiografías** (`rx.js`) y **comparador de fotos** (`fotos.js`): la interacción (zoom, brillo, contraste, deslizador) se porta.
- **Cálculos ya probados**: totales e IVA (`bTotal`, `iva10`, `iva5`), arqueo (`cashExpected`), antigüedad (`aging`), índices periodontales (`peStats`, `peDx`). Se pasan a `shared` con sus casos de prueba.
- **Contenido**: preguntas de anamnesis (`ANQ`), reglas de alerta (`ALERTA`), modelos de consentimiento (`CONS_MOD`), zonas bucales (`ZONES`), catálogo de marcas (`MARC`), motivos de reserva (`RV_MOT`). Entran como datos semilla editables.
- **Todo lo demás** (enrutador, estado global `S`, `localStorage`) no se reutiliza.

---

## 3. Stack propuesto

Criterio: lo construye y lo mantiene una persona con IA. Un solo lenguaje, pocos servicios, y que la base de datos haga cumplir las reglas críticas (aislamiento, solapamientos, numeración) aunque el código tenga un error.

| Capa | Elección | Por qué (una línea) |
|---|---|---|
| Lenguaje y repo | TypeScript, monorepo pnpm (`api`, `web`, `worker`, `shared`) | Un lenguaje y los mismos tipos/validaciones (Zod) en cliente y servidor |
| Backend | NestJS, monolito modular, API REST `/api/v1` con OpenAPI | Un módulo por doc, guards para permisos e interceptores para auditoría sin repetir código |
| Base de datos | PostgreSQL 17 (Supabase; es la versión que crea hoy) | RLS para aislar clínicas, restricciones de exclusión para la agenda, búsqueda sin tildes (`unaccent` + `pg_trgm`), todo transaccional |
| Acceso a datos | Drizzle ORM + migraciones SQL versionadas | SQL explícito y tipado; permite RLS, índices parciales y `EXCLUDE` sin pelear con el ORM |
| Multi-clínica | `clinica_id` en toda tabla + RLS con `SET LOCAL app.clinica_id` por transacción | Es el «filtro obligatorio central» que pide el doc 00: un bug de pantalla no filtra datos de otra clínica |
| Autenticación | Supabase Auth (correo + contraseña, TOTP, invitación por enlace) | Login, 2FA y recuperación resueltos; la identidad no es donde conviene innovar |
| Autorización | Tablas propias `rol` / `rol_permiso` (módulo + acción) + `usuario_sede`, verificadas en la API | Los permisos son reglas de negocio de la clínica y tienen que poder editarse |
| Frontend | React 18 + Vite + TanStack Query, PWA instalable | Una sola app para celular, tablet y escritorio, con el odontograma three.js embebido como componente |
| Interfaz | Design system «Conecta» ya existente (`design-system/project`: tokens, 23 componentes React 18, reglas de voz y estados), empaquetado como `packages/ui` | Ya está diseñado, es mobile-first y define colores de estado y textos; no se inventa otro |
| Odontograma 3D | Se reutiliza el motor de la maqueta (three.js, sin build ni modelos externos) encapsulado en un componente con entrada de estado y eventos de salida | Es lo más caro de rehacer; se conserva el render y se reemplaza todo lo que hoy es global y `localStorage` (C1) |
| Página pública | Rutas públicas de la misma app (`/reservar`, `/verificar/:codigo`) con endpoints sin sesión y límite de uso | Evita un segundo proyecto; son dos pantallas |
| Archivos | Supabase Storage, buckets privados; la API entrega URL firmada de ≤ 5 min tras chequear permiso y auditar | Cumple «nunca URL pública»; mismo proveedor que la base |
| Imágenes | `sharp` en el worker: redimensionar, quitar EXIF, miniatura | Lo pide el doc 07; fuera del request para no trabar la tablet |
| Colas | `pg-boss` (sobre el mismo Postgres) | Sin Redis; el mensaje se encola en la misma transacción que el cambio del turno (no se pierde ni se duplica) |
| WhatsApp | API oficial de WhatsApp Business (Cloud API de Meta), con webhook de estados y respuestas | Plantillas con botones «Confirmo / Reprogramar» y estados entregado/leído que pide el doc 11. A confirmar (P3) |
| PDF | HTML → PDF con Chromium (Playwright) en el worker; se guarda el archivo y su hash SHA-256 | El documento firmado queda congelado como salió |
| Hosting | Railway (API, worker, web estática) + Supabase (región São Paulo) | Despliegue por push y la región más cercana a Paraguay |
| Entornos | local (Supabase CLI) · staging · producción | Bases, buckets y secretos separados; nunca datos reales en staging |
| CI/CD | GitHub Actions: lint, tipos, tests con Postgres real, migraciones; despliegue a staging al mergear | Una persona no puede revisar todo a mano |
| Pruebas | Vitest (unidad), integración contra Postgres real, Playwright (flujos críticos) | Dinero, RLS y concurrencia se prueban contra la base, no con mocks |
| Observabilidad | Sentry + logs estructurados sin datos clínicos + alerta de caída | Enterarse antes que la clínica |
| Secretos | Variables cifradas de Railway/Supabase | Credenciales de WhatsApp nunca en la base ni en el repo |

**Descartado**: Redis/BullMQ (una pieza más para un volumen de pocos cientos de mensajes por día), microservicios, app nativa de tablet (la PWA alcanza: firma con dedo/lápiz y cámara funcionan en navegador), certificado y almacén de secretos para SIFEN (fuera del plan).

---

## 4. Modelo de datos

### 4.1 Convenciones (valen para todas las tablas)
- `id uuid`; `clinica_id` obligatorio; `sede_id` donde el dato es por sede.
- FK compuestas `(clinica_id, id)` en las relaciones entre tablas de negocio: una fila no puede apuntar a otra clínica.
- **Auditoría de fila**: `created_at, created_by, updated_at, updated_by`.
- **Baja lógica**: `deleted_at, deleted_by, motivo_baja` en datos editables; catálogos usan `activo`.
- **Inmutables** (no `UPDATE`/`DELETE`, forzado con trigger): `anamnesis`, `anamnesis_respuesta`, `consentimiento`, `documento_clinico` firmado, `pago`, `egreso`, `caja_sesion` cerrada, `historial_diente`, `lesion_control`, `periodontograma` cerrado, `consulta_odontograma`, `audit_log`. Se corrigen con versión nueva, anulación con motivo o contraasiento.
- Dinero `bigint` en guaraníes; fechas `timestamptz` en UTC, se muestran en `America/Asuncion`.
- Enums como `text` + `CHECK`, con los valores de la maqueta.
- RLS en todas las tablas: `clinica_id = current_setting('app.clinica_id')`.

### 4.2 Acceso y organización
| Tabla | Campos clave | Relaciones / índices |
|---|---|---|
| `clinica` | nombre, razon_social, ruc, zona_horaria, edad_pediatrica (12), edad_tutor (18), tope_descuento_pct | raíz del tenant |
| `sede` | nombre, direccion, telefono, estado (abierta/proxima/cerrada), color | `clinica` 1—N |
| `sede_horario` | dia_semana, hora_inicio, hora_fin, intervalo_min | `sede` 1—N |
| `sillon` | nombre, activo | `sede` 1—N |
| `usuario` | id = id de Auth, nombre, email, telefono, mfa_activo, ultimo_acceso | identidad global; UNIQUE(email) |
| `membresia` | usuario_id, clinica_id, rol_id, sede_defecto_id, estado (pendiente/activo/inactivo) | UNIQUE(usuario_id, clinica_id) |
| `usuario_sede` | membresia_id, sede_id | sedes que puede ver |
| `rol` | nombre, es_sistema | por clínica; 5 iniciales del doc 00 |
| `rol_permiso` | rol_id, modulo, accion (ver/crear/editar/anular/exportar) | UNIQUE(rol_id, modulo, accion) |
| `invitacion` | email, rol_id, token_hash, vence_en, aceptada_en, invitada_por | índice por token_hash |
| `audit_log` | usuario_id, fecha, entidad, entidad_id, accion (crear/editar/anular/ver/exportar/enviar/ingresar), modulo, sede_id, usuario_nombre (congelado), antes, despues (jsonb), ip | sin particionar por ahora (se particiona por mes cuando el volumen lo pida); índices (clinica_id, fecha, id), (clinica_id, entidad, entidad_id) y (clinica_id, usuario_id, fecha); sin UPDATE/DELETE. La API solo muestra eventos de módulos y sedes que el rol puede ver |
| `numerador` | tipo (presupuesto, receta, certificado, indicaciones, consentimiento, recibo), sede_id (nulo), ultimo | UNIQUE(clinica_id, tipo, sede_id); se toma con `SELECT … FOR UPDATE` → correlativo sin huecos |
| `archivo` | bucket, ruta, mime, bytes, ancho, alto, sha256, subido_por | todo archivo del sistema se referencia desde acá |

`membresia` es el único desvío deliberado de los docs (el doc 10 pone `clinica_id` y `rol_id` en `usuario`): permite que una misma persona trabaje en dos clínicas sin duplicar cuenta. Depende de P2.

### 4.3 Profesionales y agenda
| Tabla | Campos clave | Relaciones / índices |
|---|---|---|
| `profesional` | membresia_id, nombre, especialidad, color, registro_prof, activo | 1 por usuario clínico |
| `profesional_firma` | firma_archivo_id, sello_activo, sello_color | 1—1 con `profesional` |
| `profesional_disponibilidad` | profesional_id, sede_id, dia_semana, hora_inicio, hora_fin, sillon_id (nulo) | índice (profesional_id, dia_semana) |
| `profesional_bloqueo` | profesional_id, desde, hasta, motivo | vacaciones, congresos |
| `agenda_config` | sede_id, anticipacion_min (120), dias_adelante (14), reserva_online_activa | 1 por sede |
| `turno` | sede_id, paciente_id, profesional_id, sillon_id, tratamiento_id, inicio, duracion_min, `rango tstzrange` (generado), estado (agendada/confirmada/en sala/atendida/cancelada/ausente), origen (recepcion/online/whatsapp), motivo_online_id, codigo_reserva, ip, nota, pidio_reprogramar, cancelado_por/en, motivo_cancelacion | **`EXCLUDE (profesional_id =, rango &&)`** y **`EXCLUDE (sillon_id =, rango &&)`**, ambas `WHERE estado NOT IN ('cancelada','ausente')`; índices (clinica_id, sede_id, inicio), (paciente_id, inicio); UNIQUE(codigo_reserva) |
| `turno_estado_log` | turno_id, estado_anterior, estado_nuevo, cambiado_por, cambiado_en | mide espera en sala y duración real |

### 4.4 Pacientes y anamnesis
| Tabla | Campos clave | Relaciones / índices |
|---|---|---|
| `paciente` | nombres, apellidos, ci, ruc, fecha_nac, sexo, telefono (E.164), email, ciudad, direccion, idioma (es/gn), acepta_whatsapp, nota_interna, origen (recepcion/online), activo | índice parcial (clinica_id, ci) donde ci no es nulo; columna generada `busqueda` (nombre sin tildes + CI y teléfono solo dígitos) con índice GIN trigram |
| `paciente_relacion` | paciente_id, familiar_id, tipo, es_tutor_legal, es_responsable_pago | fila espejo en la misma transacción; UNIQUE(paciente_id, familiar_id) |
| `paciente_alerta` | texto, activa, creada_por | manuales; las médicas se derivan |
| `anamnesis_pregunta` | codigo, seccion (1–5), orden, texto, tipo (txt/si_no/multi/numero), opciones[], solo_sexo, activo | catálogo por clínica |
| `anamnesis` | paciente_id, version, fecha, registrado_por, firmante_nombre, firmante_ci, es_tutor, firma_archivo_id, declaracion_veracidad, presion_sistolica, presion_diastolica, pulso, peso_kg | UNIQUE(paciente_id, version); inmutable |
| `anamnesis_respuesta` | anamnesis_id, pregunta_codigo, respuesta_si, opciones[], detalle, texto | UNIQUE(anamnesis_id, pregunta_codigo) |
| `alerta_medica_regla` | pregunta_codigo, opcion, texto_alerta, gravedad, grupo_alergia | `grupo_alergia` alimenta el cruce con recetas |

### 4.5 Ficha clínica
| Tabla | Campos clave | Relaciones / índices |
|---|---|---|
| `diente_catalogo` | fdi, denticion, tipo, caras[], multirradicular | global, sin `clinica_id` |
| `hallazgo_dental` | paciente_id, fdi, cara (nulo = diente entero), tipo (14 valores), clase_black, grado_movilidad, estado (por_realizar/realizado), detectado_en/por, realizado_en/por, turno_id, vigente_desde, vigente_hasta, presupuesto_item_id, nota | índice parcial (paciente_id, fdi) donde vigente_hasta es nulo; UNIQUE parcial (paciente_id, fdi, cara) para caries vigente. Quitar una marca cierra la vigencia, no borra |
| `historial_diente` | paciente_id, fdi, fecha, diagnostico, tratamiento, nota, profesional_id, turno_id, anulado, motivo_anulacion | solo agregar |
| `consulta_odontograma` | paciente_id, fecha_hora, motivo (≤100), profesional_id, snapshot_json, pdf_archivo_id | inmutable |
| `diagnostico_catalogo` | texto, activo | sugerencias del historial |
| `zona_bucal` | codigo, nombre | global, 12 zonas |
| `lesion_bucal` | paciente_id, zona, tipo, tipo_otro, tamano_mm, color, consistencia, dolor, estado, observaciones | estado vigente = último control |
| `lesion_control` | lesion_id, fecha, tamano_mm, estado, nota, profesional_id, foto_id, anulado | solo agregar |
| `estudio_imagen` | paciente_id, tipo, fecha_toma, nota, archivo_id, miniatura_archivo_id | índice (paciente_id, fecha_toma desc) |
| `estudio_diente` | estudio_id, fdi | vacío = boca completa |
| `periodontograma` | paciente_id, fecha, profesional_id, nota, cerrado_en | uno por control |
| `periodontograma_diente` | periodontograma_id, fdi, ausente, implante, movilidad, furca | UNIQUE(periodontograma_id, fdi) |
| `periodontograma_sitio` | periodontograma_id, fdi, cara, posicion (1–3), profundidad_sondaje (0–15), margen_gingival (−5–10), sangrado, placa | UNIQUE(periodontograma_id, fdi, cara, posicion) |
| `foto_serie` | paciente_id, titulo, tratamiento_id, fecha_inicio, profesional_id, autoriza_redes, autoriza_consentimiento_id | |
| `foto_clinica` | serie_id, paciente_id, vista, fase, fecha_toma, archivo_id, miniatura_archivo_id, fdi, nota | índice (serie_id, vista, fase) |
| `medicamento` | nombre, presentacion, posologia_sugerida, grupo_alergia, activo | catálogo |
| `documento_clinico` | paciente_id, profesional_id, tipo (receta/certificado/indicaciones), numero, fecha_emision, diagnostico, observaciones, cert_tipo, cert_dias, cert_texto, codigo_verificacion, firmado_por/en, sello_impreso, pdf_archivo_id, pdf_sha256, anulado, motivo_anulacion | UNIQUE(clinica_id, tipo, numero); UNIQUE(codigo_verificacion) |
| `documento_item` | documento_id, medicamento_id, nombre (copia), posologia, cantidad, duracion | |
| `consentimiento_modelo` | codigo, nombre, version, descripcion, riesgos[], alternativas[], activo | UNIQUE(clinica_id, codigo, version) |
| `consentimiento` | numero, paciente_id, profesional_id, modelo_id, modelo_version, texto_firmado, fdi, firmante_nombre, firmante_ci, es_tutor, firma_archivo_id, aceptado_check, firmado_en, dispositivo, ip, codigo_verificacion, pdf_archivo_id, pdf_sha256, revocado, revocado_en, revocado_por | UNIQUE(codigo_verificacion); inmutable salvo revocación |

### 4.6 Económico
| Tabla | Campos clave | Relaciones / índices |
|---|---|---|
| `tratamiento` | nombre, precio (IVA incluido), iva (10/5/0), duracion_min, categoria, requiere_consentimiento_codigo, activo | catálogo por clínica |
| `presupuesto` | sede_id, paciente_id, profesional_id, numero, estado (borrador/aprobado/anulado), fecha, aprobado_en/por, descuento_pct, nota | UNIQUE(clinica_id, numero); índice (paciente_id, estado). Los 5 pasos de pantalla se derivan |
| `presupuesto_item` | presupuesto_id, tratamiento_id, nombre, precio, iva (copias), cantidad, fdi, caras[], estado (pendiente/realizado), realizado_en/por | |
| `caja_sesion` | sede_id, abierta_en/por, fondo_inicial, cerrada_en/por, esperado, contado, diferencia, nota_diferencia | **UNIQUE parcial (sede_id) donde cerrada_en es nulo** → una caja abierta por sede |
| `pago` | sede_id, caja_sesion_id, paciente_id, presupuesto_id (nulo), profesional_id, tratamiento_id, monto, forma (efectivo/tarjeta/transferencia/qr), concepto, base_10, base_5, exento, fecha_hora, **revierte_pago_id** (nulo), anulado_en/por, motivo_anulacion, recibo_numero, **factura_numero_manual**, factura_fecha_manual | CHECK base_10+base_5+exento = monto; índices (clinica_id, sede_id, fecha_hora), (presupuesto_id), (paciente_id) |
| `egreso` | sede_id, caja_sesion_id, fecha_hora, concepto, categoria_id, monto, forma, iva, proveedor_id, comprobante_numero, comprobante_timbrado, anulado | |
| `egreso_categoria` | nombre, activo | las 9 de la maqueta como semilla |
| `proveedor` | nombre, ruc, telefono, activo | |
| `cuenta_por_pagar` | proveedor_id, concepto, monto, iva, vencimiento, pagada_en, egreso_id, comprobante | índice (clinica_id, vencimiento) donde pagada_en es nulo |

**SIFEN, reservado y no construido**: `timbrado`, `factura`, `factura_item`, `nota_credito` (doc 09) no se crean. `pago` conserva `base_10 / base_5 / exento` porque cuesta nada y es lo que una factura futura necesitaría; el número de la factura hecha por fuera va en `factura_numero_manual`.

### 4.7 Mensajería y reserva online
| Tabla | Campos clave | Relaciones / índices |
|---|---|---|
| `mensajeria_config` | sede_id (nulo = clínica), activo, pedir_confirmacion, saludo_cumple, hora_envio, silencio_desde, silencio_hasta | |
| `recordatorio_regla` | offset_horas (24, 2…), plantilla_id, activa | reemplaza los booleanos 24h/2h |
| `mensaje_plantilla` | tipo, idioma (es/gn), texto, variables[], estado_aprobacion, id_proveedor, activa | |
| `mensaje_saliente` | turno_id (nulo), paciente_id, tipo (recordatorio/cumpleaños/confirmacion_reserva/documento/manual), regla_id, documento_ref, programado_para, enviado_en, telefono, texto_final, estado (pendiente/enviado/entregado/leído/confirmó/pidió reprogramar/sin respuesta/fallido/omitido), proveedor_msg_id, error_codigo, origen (automático/manual), disparado_por | UNIQUE parcial (turno_id, regla_id) donde origen = automático → nunca dos recordatorios iguales; índice (estado, programado_para) |
| `mensaje_entrante` | telefono, paciente_id, texto, boton_id, recibido_en, turno_id, procesado, proveedor_msg_id | UNIQUE(proveedor_msg_id) → webhook idempotente |
| `motivo_online` | nombre, descripcion, tratamiento_id, duracion_min, profesional_fijo_id, urgencia, activo, orden | |
| `reserva_intento` | telefono, ip, creado_en | límite anti-abuso |

### 4.8 Inventario
| Tabla | Campos clave | Relaciones / índices |
|---|---|---|
| `insumo` | nombre, categoria, unidad, stock_minimo, proveedor_id, activo | |
| `lote_insumo` | insumo_id, sede_id, lote, vencimiento, cantidad_inicial | índice (vencimiento) |
| `movimiento_insumo` | insumo_id, lote_id, sede_id, tipo (entrada/salida/ajuste), cantidad, motivo, turno_id, costo_unitario, usuario_id, fecha | **stock = suma de movimientos** (vista `insumo_stock` por sede); solo agregar |

---

## 5. Plan por fases y sprints

Sprints de 2 semanas = 10 días hábiles de una persona. «Esfuerzo» son días-persona estimados; lo que sobra es colchón. Cada sprint termina con demo en staging.

### 5.1 Por qué cambié el orden
1. **SIFEN fuera** (decisión tuya). La Fase 2 baja de 4 temas a 3 y el paso «Facturado» del presupuesto pasa a significar «todos sus pagos tienen número de factura anotado».
2. **Usuarios, invitaciones y roles a Fase 0.** «Personal» estaba en Fase 3, pero sin alta de usuarios no hay con quién abrir. En Fase 3 queda solo la parte de gestión (horarios, asignaciones, tarjetas).
3. **Profesionales y catálogo de tratamientos a Fase 0.** La agenda (Sprint 5) no existe sin ellos.
4. **Servicio de archivos privado a Fase 0.** La firma de la anamnesis (Sprint 4) ya lo necesita.
5. **Prueba de integración del odontograma 3D en el Sprint 2.** Un día para confirmar que el motor de la maqueta carga dentro de la app con un paciente real, antes de planificar dos sprints sobre eso.
6. **En Fase 2, documentos antes que WhatsApp.** WhatsApp depende de Meta y envía copias de recetas y consentimientos; conviene que existan.
7. **Reserva online después de WhatsApp.** Su confirmación y su «para cambiar respondé el WhatsApp» lo necesitan.
8. **Fotos y radiografías juntas; patología y periodontograma juntos.** Las dos primeras comparten todo el circuito de imágenes; la patología enlaza fotos, por eso va después.
9. **Un sprint de piloto (10) antes de dar por abierto el MVP.**

Mantengo tu orden dentro del MVP (pacientes → anamnesis → agenda → odontograma → presupuestos → caja) porque el presupuesto nace del plan sugerido del odontograma. Si la clínica necesita cobrar antes, se pueden correr los sprints 8–9 delante de 6–7 sin romper nada: `presupuesto_item` ya nace con `fdi` y `caras`.

### FASE 0 — Base

#### Sprint 1 · Fundaciones — esfuerzo 9 d
**Objetivo**: repositorio, entornos, CI y base multi-clínica con login.
**Historias**
- Como desarrollador, cada push corre lint, tipos, pruebas y migraciones contra un Postgres real, y mergear despliega a staging. *CA*: una prueba roja bloquea el merge; staging y producción con base, bucket y secretos distintos. *(Estado: CI hecho; el despliegue a staging quedó fuera de la primera ejecución y se decide al cerrar el sprint.)*
- Como dueño, entro con correo y contraseña y activo doble factor. *CA*: la sesión vence; cierre por inactividad configurable por rol, aplicado en la web y en la API; el doble factor es obligatorio para dueño y administración; los ingresos quedan en auditoría (los fallos de ingreso quedan en el registro de Supabase Auth, no en el nuestro).
- Como sistema, ningún dato cruza de clínica. *CA*: prueba automática con dos clínicas: con el contexto de A no se lee ni se modifica nada de B, aunque la consulta no filtre.
- Como administración, creo sedes y sillones. *CA*: estados abierta / próxima / cerrada; no se borran, se dan de baja.
- Como auditor, veo quién hizo qué. *CA*: toda alta, edición y anulación deja antes/después; `audit_log` rechaza UPDATE y DELETE.

**Tablas**: clinica, sede, sede_horario, sillon, usuario, membresia, usuario_sede, rol, rol_permiso, audit_log, numerador.
**Endpoints**: `/auth/*`, `GET /me`, CRUD `/sedes`, `/sedes/:id/sillones`, `GET /auditoria`.
**Pruebas**: aislamiento RLS, guard de permisos, auditoría automática, migraciones solo hacia adelante con checksum (una corrección es una migración nueva; no hay migraciones de vuelta).
**Entregable**: login con doble factor, alta de sede y su registro de auditoría, en local contra el Supabase de desarrollo (staging cuando se decida el despliegue).
**En paralelo (no es código)**: iniciar verificación de la cuenta de WhatsApp Business.

#### Sprint 2 · Usuarios, permisos, archivos y esqueleto — esfuerzo 10 d
**Objetivo**: que cada persona entre con su rol y su sede, y dejar listas las piezas transversales.
**Historias**
- Como dueño, invito a alguien con nombre, correo y rol. *CA*: queda «pendiente de activar»; el enlace vence y se guarda solo su hash; al aceptar crea su contraseña.
- Como dueño, desactivo a un usuario. *CA*: pierde acceso en el acto; sus registros siguen apuntando a él.
- Como administración, defino qué puede hacer cada rol por módulo y acción. *CA*: la pantalla oculta lo no permitido y la API responde 403 igual.
- Como recepcionista, entro en mi sede por defecto. *CA*: el selector solo ofrece mis sedes; «Todas» solo si tengo más de una.
- Como administración, cargo profesionales (especialidad, color, registro), su disponibilidad por sede y día, sus bloqueos y el catálogo de tratamientos. *CA*: se desactivan, no se borran; cambiar un precio no toca nada ya emitido.
- Como sistema, los archivos son privados. *CA*: sin sesión y permiso no hay URL; la URL vence en ≤ 5 minutos; cada descarga queda auditada.

**Tablas**: invitacion, profesional, profesional_disponibilidad, profesional_bloqueo, agenda_config, tratamiento, archivo.
**Endpoints**: `/usuarios`, `/invitaciones`, `/roles`, `/profesionales`, `/tratamientos`, `POST /archivos`, `GET /archivos/:id/url`.
**Pruebas**: matriz rol × módulo × acción × sede; invitación vencida y reusada; URL firmada expirada.
**Entregable**: el dueño invita a una recepcionista, que entra y solo ve su sede y sus módulos. Cola y worker con un trabajo de prueba. Odontograma 3D de la maqueta abriendo dentro de la app (prueba técnica).

### FASE 1 — MVP para abrir la clínica

#### Sprint 3 · Pacientes y ficha — esfuerzo 7 d
**Objetivo**: alta, búsqueda y ficha de datos.
**Historias**
- Como recepción, busco por nombre, CI o teléfono. *CA*: «gonzalez» encuentra «González»; «4.123.456» = «4123456»; responde en < 300 ms con 20.000 pacientes.
- Como recepción, doy de alta con solo el nombre. *CA*: si la CI ya existe en la clínica avisa y muestra la ficha existente; al guardar abre la ficha.
- Como recepción, filtro Todos / Con saldo / Pediátricos / Con alerta. *CA*: «pediátrico» usa el parámetro de la clínica.
- Como recepción, armo el grupo familiar. *CA*: el vínculo se crea en ambos sentidos; marca tutor legal y responsable de pago.
- Como odontólogo, cargo alertas manuales y notas internas.
- Como sistema, registro quién abrió cada ficha. *CA*: recepción no ve pestañas clínicas.

**Tablas**: paciente, paciente_relacion, paciente_alerta. **Endpoints**: `GET/POST /pacientes`, `/pacientes/:id`, `/pacientes/:id/relaciones`, `/pacientes/:id/alertas`, `GET /buscar`.
**Pruebas**: normalización de búsqueda, CI duplicada, espejo de relación, permisos por rol.
**Entregable**: recepción da de alta y encuentra pacientes desde la tablet.

#### Sprint 4 · Anamnesis versionada y alerta médica — esfuerzo 8 d
**Objetivo**: cuestionario firmado en tablet y banner de alerta.
**Historias**
- Como administración, edito el catálogo de preguntas (5 secciones, sí/no, opción múltiple, texto, número).
- Como paciente, completo y firmo en la tablet. *CA*: sin firma o sin «Declaro que es verdadero» no guarda; si es menor de 18 exige nombre y CI del tutor y firma el tutor.
- Como odontólogo, actualizo la anamnesis. *CA*: abre con los valores vigentes y guarda la versión siguiente; la anterior queda intacta y consultable.
- Como odontólogo, veo la alerta médica. *CA*: se calcula de la versión vigente; con detalle queda «Alergia a la penicilina (urticaria con amoxicilina)»; embarazo solo se pregunta si sexo F.
- Como recepción, el filtro «Con alerta» incluye las derivadas.
- Historial del paciente (línea de tiempo), primera versión.

**Tablas**: anamnesis_pregunta, anamnesis, anamnesis_respuesta, alerta_medica_regla.
**Endpoints**: `/anamnesis/preguntas`, `GET/POST /pacientes/:id/anamnesis`, `GET /pacientes/:id/alerta-medica`, `GET /pacientes/:id/historial`.
**Pruebas**: inmutabilidad (UPDATE rechazado por la base), numeración de versiones con dos guardados simultáneos, reglas de alerta, flujo de tutor.
**Entregable**: un paciente firma en la tablet y aparece el banner rojo en su ficha. Queda el componente de firma que reutilizan consentimientos y recetas.

#### Sprint 5 · Agenda — esfuerzo 10 d
**Objetivo**: agenda por sede sin turnos pisados.
**Historias**
- Como recepción, veo el día (una columna por profesional, grilla de 30 min, línea de «ahora») y la semana (lunes a sábado).
- Como recepción, toco un hueco y creo el turno. *CA*: carga la duración del tratamiento, editable, con pasos de 15 min.
- Como sistema, rechazo solapamientos. *CA*: mismo profesional o mismo sillón → error con «quién atiende y de qué hora a qué hora»; turnos pegados sí; **50 pedidos simultáneos al mismo hueco crean exactamente uno**.
- Como sistema, valido horario de sede y de profesional, bloqueos y fechas pasadas; aviso (sin bloquear) si el paciente ya tiene turno a esa hora.
- Como recepción, avanzo el estado y cancelo. *CA*: cada cambio guarda quién y cuándo; cancelar pide motivo, libera el hueco y no borra; existe «ausente».
- Como odontólogo, al abrir el turno veo la alerta médica.
- Inicio v1: turnos de hoy con botón de avance.

**Tablas**: turno, turno_estado_log. **Endpoints**: `GET /agenda`, `GET /disponibilidad`, `POST /turnos`, `PATCH /turnos/:id`, `POST /turnos/:id/estado`, `POST /turnos/:id/cancelar`.
**Pruebas**: concurrencia contra Postgres real, bordes de horario, sede «Todas», cambio de día en zona de Asunción.
**Entregable**: recepción opera la agenda de dos sedes.

#### Sprint 6 · Odontograma I: 3D sobre el paciente real — esfuerzo 10 d
**Objetivo**: el odontograma lee y escribe en la ficha del paciente.
**Historias**
- Como desarrollador, el motor 3D es un componente. *CA*: recibe dentición y estado, emite un evento por toque (diente, tipo, cara, clase, grado, estado), admite modo solo lectura y no usa `localStorage` ni ids fijos del HTML.
- Como odontólogo, abro el 3D desde la ficha. *CA*: abre ese paciente; ya no existe la lista de pacientes propia del 3D.
- Como odontólogo, marco hallazgos (14 tipos) tocando la cara. *CA*: caries asigna clase de Black por cara y rechaza las que no corresponden; movilidad cicla I→II→III→quita; «ausente» limpia caries, extracción y periodontal.
- Como odontólogo, defino «por realizar / realizado» por hallazgo.
- Como sistema, no pierdo historia. *CA*: quitar una marca cierra su vigencia; nada se borra; cada cambio en auditoría.
- Como odontólogo, registro el historial del diente. *CA*: exige diagnóstico, tratamiento o nota; no se quita, se anula con motivo.
- Resumen 2D en la ficha con conteos y banner médico. *CA*: dentición por edad con cambio manual; en mixta se ven ambas.

**Tablas**: diente_catalogo, hallazgo_dental, historial_diente, diagnostico_catalogo.
**Endpoints**: `GET /pacientes/:id/odontograma`, `POST /pacientes/:id/hallazgos`, `POST /hallazgos/:id/cerrar`, `PATCH /hallazgos/:id/estado`, `GET/POST /pacientes/:id/dientes/:fdi/historial`.
**Pruebas**: reglas de Black por tipo de diente y cara, vigencias, validación FDI, rendimiento en tablet de gama media.
**Entregable**: se marca un odontograma en tablet, se cierra la app y al volver está igual.

#### Sprint 7 · Odontograma II: consultas, comparar, imprimir, plan — esfuerzo 9 d
**Objetivo**: cerrar el odontograma como herramienta de consulta.
**Historias**
- Como odontólogo, guardo la consulta con motivo. *CA*: instantánea inmutable de ambas denticiones e historiales.
- Como odontólogo, comparo dos consultas. *CA*: marca hallazgos nuevos, cerrados y realizados.
- Como odontólogo, restauro una consulta. *CA*: pide confirmación, queda auditado y no destruye lo intermedio (crea vigencias nuevas).
- Como odontólogo, imprimo. *CA*: el PDF se guarda con fecha y no se reescribe.
- Como odontólogo, veo el plan sugerido. *CA*: una línea por hallazgo por realizar, con su pieza; movilidad, fístula o lesión periapical sugieren radiografía.
- Alternativa 2D o textual para equipos donde el 3D no rinde.

**Tablas**: consulta_odontograma. **Endpoints**: `GET/POST /pacientes/:id/consultas`, `GET /consultas/comparar`, `POST /consultas/:id/restaurar`, `POST /consultas/:id/pdf`, `GET /pacientes/:id/plan-sugerido`.
**Pruebas**: comparación (diff), restauración, PDF generado y archivado.
**Entregable**: dos consultas de un paciente comparadas lado a lado e impresas.

#### Sprint 8 · Presupuestos — esfuerzo 7 d
**Objetivo**: convertir el plan en saldo a cobrar.
**Historias**
- Como odontólogo, armo un presupuesto desde el catálogo o desde el plan sugerido. *CA*: cada ítem copia nombre, precio e IVA y guarda pieza y caras; elijo el profesional responsable.
- Como odontólogo, aplico descuento. *CA*: tope configurable; se reparte proporcional entre tasas; IVA 10 % = base ÷ 11, 5 % = base ÷ 21, redondeo al guaraní.
- Como odontólogo, guardo borrador o apruebo. *CA*: borrador no genera deuda; aprobar fija `aprobado_en`; número correlativo sin huecos.
- Como odontólogo, marco un ítem como realizado. *CA*: el hallazgo enlazado pasa a «realizado» en el odontograma.
- Como recepción, veo el avance en 5 pasos (derivado) y el saldo en la ficha y en el filtro «Con saldo».
- Como administración, anulo un presupuesto sin pagos, con motivo.

**Tablas**: presupuesto, presupuesto_item. **Endpoints**: `/presupuestos`, `/presupuestos/:id/aprobar`, `/presupuestos/:id/anular`, `/presupuesto-items/:id/realizar`.
**Pruebas**: tabla de casos de totales, descuento e IVA (redondeos), numeración concurrente, enlace con hallazgo.
**Entregable**: del odontograma al presupuesto aprobado, con saldo en la ficha.

#### Sprint 9 · Caja y pagos — esfuerzo 9 d
**Objetivo**: cobrar, registrar egresos y cerrar la caja por sede.
**Historias**
- Como recepción, abro la caja con fondo inicial. *CA*: una sola abierta por sede (lo garantiza la base).
- Como recepción, registro un pago. *CA*: exige caja abierta; contra presupuesto no supera el saldo y sugiere el saldo completo; reparte el monto entre 10 % / 5 % / exento según los ítems y manda el resto de redondeo al 10 %; cobro particular con una sola tasa.
- Como recepción, registro un egreso con categoría, forma e IVA 10 / 5 / exento.
- Como recepción, cierro con arqueo. *CA*: esperado = fondo + efectivo cobrado − efectivo egresado; diferencia = contado − esperado; con diferencia exige nota; cerrada no admite más movimientos.
- Como administración, anulo un pago. *CA*: crea la fila de reverso, el saldo del presupuesto sube, el original no se toca.
- Como recepción, anoto el número de la factura emitida por fuera y entrego un recibo interno. *CA*: el recibo dice que no es comprobante fiscal (texto a validar, P1).
- Inicio v2: ingresos de hoy y del mes, saldos pendientes, 4 mayores deudores, «Cobrar» al marcar atendida.

**Tablas**: caja_sesion, pago, egreso, egreso_categoria. **Endpoints**: `/caja/abrir`, `/caja/cerrar`, `GET /caja/actual`, `/pagos`, `/pagos/:id/anular`, `/pagos/:id/factura-manual`, `/pagos/:id/recibo`, `/egresos`, `GET /inicio`.
**Pruebas**: reparto de IVA (suma exacta al monto), dos cobros simultáneos sobre el mismo saldo, caja cerrada, arqueo, corte del día en Asunción.
**Entregable**: turno atendido → cobro → cierre de caja con arqueo.

#### Sprint 10 · Piloto y salida a producción — esfuerzo 8 d
**Objetivo**: abrir la clínica sobre el sistema.
**Historias**
- Como dueño, tengo mis datos iniciales cargados (sedes, personal, tratamientos y precios, preguntas de anamnesis; pacientes si hay de dónde importarlos, P10).
- Como dueño, sé que hay respaldo. *CA*: restauración completa ensayada y cronometrada.
- Como equipo de la clínica, hago un día simulado completo en staging y luego una semana real en una sede.
- Como dueño, reviso la matriz de permisos con casos reales.

**Tablas**: ninguna nueva. **Pruebas**: flujo completo en Playwright (alta → anamnesis → turno → odontograma → presupuesto → cobro → cierre), carga con 20.000 pacientes, revisión de seguridad (permisos, URLs de archivos, cabeceras).
**Entregable**: **MVP en producción en una sede.**

### FASE 2 — Documentos y WhatsApp

#### Sprint 11 · Recetas, certificados e indicaciones — esfuerzo 8 d
**Objetivo**: documentos firmados por el profesional, verificables.
**Historias**
- Como odontólogo, cargo mi firma una vez y elijo si imprimo sello.
- Como odontólogo, emito receta, certificado (reposo / asistencia / aptitud) o indicaciones. *CA*: el número se asigna al firmar, correlativo por tipo y sin huecos.
- Como sistema, cruzo alergias. *CA*: `grupo_alergia` del medicamento contra la anamnesis vigente; si choca, bloquea «Firmar y emitir» y explica.
- Como sistema, congelo lo firmado. *CA*: PDF A4 con firma y sello como estaban al emitir, guardado con su hash; no se edita, se anula con motivo.
- Como tercero, verifico por QR. *CA*: `/verificar/<código>` muestra tipo, fecha, profesional y válido/anulado, sin datos clínicos y con límite de consultas.

**Tablas**: profesional_firma, medicamento, documento_clinico, documento_item. **Endpoints**: `/profesionales/:id/firma`, `/medicamentos`, `/pacientes/:id/documentos`, `/documentos/:id/firmar`, `/documentos/:id/anular`, `GET /publico/verificar/:codigo`.
**Pruebas**: cruce de alergias, numeración concurrente, inmutabilidad, que la página pública no filtre datos.
**Entregable**: receta firmada, impresa y verificada escaneando el QR.

#### Sprint 12 · Consentimiento informado con firma — esfuerzo 6 d (+ soporte del piloto)
**Objetivo**: consentimiento firmado en tablet con evidencia.
**Historias**
- Como administración, edito modelos por procedimiento. *CA*: cada cambio de texto crea versión nueva.
- Como paciente, leo, marco «Leí, entendí y acepto» y firmo. *CA*: sin firma o sin check no guarda; menor de 18 exige tutor.
- Como sistema, guardo evidencia. *CA*: texto exacto firmado, versión, fecha y hora, dispositivo, IP, usuario presente, PDF con hash.
- Como odontólogo, revoco antes del procedimiento. *CA*: no se edita; se revoca y se firma otro.
- Como recepción, la agenda avisa si un turno de un tratamiento que exige consentimiento no lo tiene firmado.

**Tablas**: consentimiento_modelo, consentimiento. **Endpoints**: `/consentimiento-modelos`, `/pacientes/:id/consentimientos`, `/consentimientos/:id/revocar`.
**Pruebas**: copia del texto frente a cambios del modelo, flujo de tutor, revocación, aviso en agenda.
**Entregable**: consentimiento de extracción firmado en tablet, impreso y verificable.

#### Sprint 13 · WhatsApp I: bandeja de salida y recordatorios — esfuerzo 9 d
**Objetivo**: recordatorios automáticos que salen solos y dejan rastro.
**Historias**
- Como administración, configuro avisos (24 h, 2 h u otros), hora de envío, ventana de silencio y pausa general.
- Como administración, edito plantillas por idioma (es / gn). *CA*: variable desconocida se rechaza al guardar; se ve el estado de aprobación del proveedor.
- Como sistema, programo recordatorios al crear o mover un turno. *CA*: solo agendada/confirmada; si el turno se cancela o se mueve se invalida el pendiente; sin consentimiento o teléfono inválido queda «omitido» y visible para recepción; nunca dos iguales para el mismo turno.
- Como sistema, registro enviado / entregado / leído / fallido con el código del proveedor y reintento con espera creciente.
- Como sistema, el mensaje no lleva datos de salud: fecha, hora, profesional y lugar.

**Tablas**: mensajeria_config, recordatorio_regla, mensaje_plantilla, mensaje_saliente. **Endpoints**: `/mensajeria/config`, `/mensajeria/plantillas`, `GET /mensajeria/envios`, `POST /webhooks/whatsapp` (firma verificada).
**Pruebas**: proveedor simulado; idempotencia; turno movido/cancelado; ventana de silencio; turno agendado con menos de 24 h.
**Entregable**: un turno de mañana genera su recordatorio y llega a un teléfono de prueba.
**Depende de**: cuenta de WhatsApp Business aprobada (iniciada en Sprint 1).

#### Sprint 14 · WhatsApp II: respuestas y envíos de documentos — esfuerzo 8 d
**Objetivo**: cerrar el ciclo con la respuesta del paciente.
**Historias**
- Como paciente, respondo «Confirmo». *CA*: el turno pasa a confirmada sin recepción y recibe un agradecimiento.
- Como paciente, respondo «Reprogramar». *CA*: el turno queda marcado, aparece en agenda e Inicio; el sistema no lo mueve.
- Como sistema, asocio la respuesta al turno más próximo de ese teléfono. *CA*: si hay varios o el número es compartido en la familia, pide aclarar; texto libre se deriva a recepción.
- Como recepción, veo la pantalla de recordatorios con contadores, reenvío (crea envío nuevo, guarda quién) y «Enviar todos» con confirmación y ritmo controlado.
- Como recepción, mando por WhatsApp receta, certificado, consentimiento o recibo. *CA*: enlace que vence, no adjunto público.
- Saludo de cumpleaños, uno por año. Baja: si el paciente pide no recibir más, se apaga `acepta_whatsapp` y queda registrado.

**Tablas**: mensaje_entrante. **Endpoints**: `/mensajeria/envios/:id/reenviar`, `/mensajeria/enviar-todos`, `/documentos/:id/enviar`, `GET /mensajeria/entrantes`.
**Pruebas**: webhook duplicado, teléfono compartido, masivo sin repetir, baja.
**Entregable**: un paciente confirma desde su celular y el turno cambia solo en la agenda.

### FASE 3 — Ampliación

#### Sprint 15 · Reserva online — esfuerzo 8 d
**Objetivo**: que el paciente se agende solo desde el celular.
**Historias**
- Como paciente, sigo 4 pasos: (sede y) motivo → profesional o «cualquiera» → día y hora → datos. *CA*: solo horarios realmente libres (horario de sede ∩ disponibilidad ∩ bloqueos ∩ sillón); próximos 14 días hábiles; nada a menos de 2 h.
- Como sistema, confirmo sin duplicar. *CA*: al confirmar se revalida en transacción; si se ocupó, vuelve al paso 3 con aviso.
- Como paciente, entro con mi cédula. *CA*: si existe usa la ficha; si no, crea el paciente marcado «Registrado por reserva online». La respuesta no revela más que el primer nombre (P11).
- Como sistema, limito abuso: un turno online futuro por paciente, tope por teléfono/IP y captcha al pasarlo.
- Como paciente, recibo código T-XXXXX y confirmación por WhatsApp. Como recepción, veo la etiqueta «Online». «Tengo dolor» muestra el primer hueco.

**Tablas**: motivo_online, reserva_intento (+ campos de `turno` ya creados). **Endpoints**: `GET /publico/reserva/config`, `GET /publico/reserva/horarios`, `POST /publico/reserva/identificar`, `POST /publico/reserva`.
**Pruebas**: carrera entre dos reservas, límites, sede «próxima» sin horarios, móvil.
**Entregable**: reserva hecha desde un celular que aparece en la agenda con «Online».

#### Sprint 16 · Fotos clínicas y radiografías — esfuerzo 9 d
**Objetivo**: imágenes clínicas privadas, con comparador.
**Historias**
- Como odontólogo, subo fotos desde la cámara de la tablet a una serie, con vista y fase. *CA*: se reducen a 1600 px, se quita EXIF, se genera miniatura.
- Como odontólogo, comparo antes/después de la misma vista con deslizador.
- Como administración, exporto para redes solo si la serie tiene autorización firmada.
- Como odontólogo, subo radiografías, las uno a dientes (validado contra FDI) y agrego nota. *CA*: tipos y tamaño máximo definidos; la panorámica aparece siempre aunque filtre por diente.
- Como odontólogo, uso el visor (zoom 50–600 %, brillo, contraste, negativo) y comparo dos estudios. *CA*: el original nunca se modifica.
- Como sistema, registro quién vio y quién descargó cada imagen. Baja lógica con motivo.

**Tablas**: foto_serie, foto_clinica, estudio_imagen, estudio_diente. **Endpoints**: `/pacientes/:id/foto-series`, `/foto-series/:id/fotos`, `/pacientes/:id/estudios`, `/estudios/:id/dientes`.
**Pruebas**: EXIF eliminado, URL vencida, permisos, archivos no imagen rechazados.
**Entregable**: comparación antes/después y dos radiografías lado a lado en tablet.

#### Sprint 17 · Patología bucal y periodontograma — esfuerzo 9 d
**Objetivo**: completar la ficha clínica.
**Historias**
- Como odontólogo, registro una lesión tocando la zona en el mapa. *CA*: tamaño obligatorio > 0; avisa si la zona ya tiene lesiones; foto enlazada a fotos clínicas.
- Como odontólogo, agrego controles. *CA*: el estado vigente es el del último; no se editan, se anulan con motivo.
- Como odontólogo, «derivada a biopsia» deja alerta en la ficha hasta cargar el resultado.
- Como odontólogo, cargo un periodontograma. *CA*: 6 sitios por diente, rangos validados, furca solo en multirradiculares; «Nuevo control» copia el anterior, que queda cerrado.
- Como odontólogo, veo índices: sangrado %, placa %, sitios ≥ 4 y ≥ 6 mm, NIC promedio, variación contra el control anterior y diagnóstico orientativo con umbrales configurables y leyenda «no reemplaza el diagnóstico».
- Como sistema, diente ausente o implante se refleja en el odontograma.

**Tablas**: zona_bucal, lesion_bucal, lesion_control, periodontograma, periodontograma_diente, periodontograma_sitio. **Endpoints**: `/pacientes/:id/lesiones`, `/lesiones/:id/controles`, `/pacientes/:id/periodontogramas`, `/periodontogramas/:id/cerrar`.
**Pruebas**: fórmulas con casos de la maqueta, inmutabilidad del control cerrado, sincronía con odontograma.
**Entregable**: dos controles periodontales comparados y una lesión con su evolución.

#### Sprint 18 · Reportes y contabilidad liviana — esfuerzo 8 d
**Objetivo**: números para decidir, por sede y consolidado.
**Historias**
- Como dueño, veo ingresos, cantidad de cobros y cobro promedio por rango (atajos Hoy / 7 días / Este mes / 30 días).
- Como dueño, separo **cobranza** (por pago) de **producción** (ítems realizados × precio) por profesional y por tratamiento.
- Como odontólogo, veo solo mi producción.
- Como administración, veo libro de ingresos y egresos, cuentas por cobrar con antigüedad (0–30 / 31–60 / 61–90 / +90) y resultado mensual. *CA*: el total de cuentas por cobrar coincide con «Saldos pendientes» de Inicio.
- Como administración, exporto CSV («;», UTF-8 con BOM). *CA*: cada exportación queda en auditoría.
- IVA mensual: solo como estimación desde cobros y egresos, rotulada «no fiscal» (P1 decide si se hace).

**Tablas**: ninguna (consultas e índices). **Endpoints**: `/reportes/cobranza`, `/reportes/produccion`, `/contabilidad/libro`, `/contabilidad/cxc`, `/contabilidad/resultado`, `/exportar/*`.
**Pruebas**: cuadre entre reportes, caja e Inicio; corte por zona horaria; permisos.
**Entregable**: tablero de reportes del mes y CSV abierto en Excel.

#### Sprint 19 · Inventario, proveedores y personal — esfuerzo 8 d
**Objetivo**: gestión interna.
**Historias**
- Como asistente, registro entradas (con lote y vencimiento) y salidas con motivo. *CA*: stock por sede = suma de movimientos; nunca negativo; salida por vencimiento descuenta del lote que vence primero.
- Como asistente, veo nivel bajo (≤ mínimo), agotado y «vence pronto» (≤ 30 días); la alerta aparece en Inicio.
- Como administración, cargo proveedores y cuentas por pagar. *CA*: «Registrar pago» crea el egreso; estados pagada / vencida / vence en N días / al día; alerta de vencida en Inicio.
- Como dueño, veo Personal en tarjetas con rol, sede, horario (filas por día, no texto libre) y asignación.

**Tablas**: insumo, lote_insumo, movimiento_insumo, proveedor, cuenta_por_pagar. **Endpoints**: `/insumos`, `/insumos/:id/movimientos`, `/proveedores`, `/cuentas-por-pagar`, `/cuentas-por-pagar/:id/pagar`, `/personal`.
**Pruebas**: stock por suma, salidas concurrentes, orden de lotes, división por cero con mínimo 0.
**Entregable**: alerta de stock bajo que nace de una salida y llega a Inicio.

#### Sprint 20 · Cierre — esfuerzo 6 d
**Objetivo**: dejar el sistema mantenible.
**Historias**: revisión de seguridad completa (permisos, archivos, página pública, webhook); rendimiento con datos de un año; manual corto por rol; pendientes acumulados del piloto; plan de continuidad (qué hacer si se cae Supabase, Railway o WhatsApp).
**Entregable**: informe de cierre y lista priorizada de lo que quedó fuera.

### 5.2 Trazabilidad doc → sprint
| Doc | Sprint(s) |
|---|---|
| 00 arquitectura, roles, auditoría, archivos | 1, 2 |
| 01 inicio y agenda | 5, 9 |
| 02 pacientes, anamnesis | 3, 4 |
| 03 presupuestos, caja, pagos | 8, 9 |
| 04 recetas y certificados | 11 |
| 05 consentimiento | 12 |
| 06 reserva online | 15 |
| 07 fotos | 16 |
| 08 sedes | 1, 2, 5, 9 |
| 09 SIFEN | **fuera**; contabilidad en 18 y 19 |
| 10 reportes, personal, inventario | 2, 18, 19 |
| 11 WhatsApp | 13, 14 |
| 12 odontograma | 6, 7 |
| 13 patología, radiografías, periodontograma | 16, 17 |
| 14 límites de la maqueta | repartidos; cada punto está cubierto por un criterio de aceptación |

---

## 6. Riesgos

| # | Riesgo | Impacto | Mitigación |
|---|---|---|---|
| R1 | **SIFEN fuera**: la clínica puede estar ya obligada a facturar electrónicamente | Legal y fiscal; no se resuelve con software propio | Confirmar con el contador antes del Sprint 1 (P1). El sistema registra el número de la factura hecha por fuera; `pago` guarda las bases por tasa, así sumar SIFEN (propio o por integrador) después no obliga a migrar datos |
| R2 | **Integración del odontograma 3D**: hoy no tiene ninguna integración (C1): estado global, ids fijos del HTML, guarda en cada toque, pacientes propios | Puede comerse más de los 2 sprints previstos | Prueba técnica en Sprint 2; encapsular sin tocar geometría ni materiales; traductor mapa ↔ `hallazgo_dental` con pruebas; alternativa 2D si en tablet no rinde |
| R3 | **Datos clínicos sensibles**: fuga entre clínicas, acceso indebido, archivos expuestos | El más grave para el negocio | Tablas en un schema que la API de datos de Supabase no expone y rol de conexión sin permiso de saltarse RLS; RLS en la base probado en CI; permisos por módulo, acción y sede; auditoría también de lectura; archivos solo con URL firmada corta; nada clínico en logs, Sentry ni WhatsApp; respaldo y restauración ensayados |
| R4 | **Marco legal de datos de salud y conservación de historias clínicas** en Paraguay | Define retención, consentimiento y dónde pueden alojarse los datos | Lo valida un asesor legal (P4). El diseño ya evita borrados físicos y permite fijar plazos |
| R5 | **Validez de la firma**: es un trazo en tablet, no firma digital con certificado | Un consentimiento podría ser cuestionado | Paquete de evidencia (texto exacto, hash del PDF, fecha, IP, dispositivo, usuario presente). Asesor legal define si alcanza (P5) |
| R6 | **Concurrencia en la agenda**: dos personas toman el mismo hueco (recepción y reserva online) | Turnos pisados | Restricción de exclusión en la base por profesional y por sillón; revalidación en transacción; prueba con 50 pedidos simultáneos |
| R7 | **Concurrencia en dinero y numeración**: dos cobros sobre el mismo saldo, dos cajas, números repetidos | Saldos negativos, huecos | Bloqueo de fila del presupuesto al cobrar; índice único de caja abierta por sede; numerador con bloqueo |
| R8 | **WhatsApp depende de Meta**: verificación del negocio, aprobación de plantillas, costo por conversación, posible suspensión del número | Puede atrasar la Fase 2 | Trámite desde el Sprint 1; proveedor detrás de una interfaz para poder cambiarlo; los «omitidos» y fallidos caen en la lista de llamadas de recepción |
| R9 | **Una sola persona**: sin revisión de pares, sin reemplazo | Calidad y continuidad | CI estricto, pruebas contra la base, staging obligatorio, documentación mínima por módulo, 20 % de capacidad para soporte desde el Sprint 11 |
| R10 | **Dependencia de proveedores** (Supabase, Railway) | Caída o cambio de precios | Postgres y almacenamiento compatibles con S3 son estándar; migrar es posible; respaldo fuera del proveedor |
| R11 | **Zona horaria**: «hoy», corte de caja y recordatorios | Cierres y avisos corridos | Todo en UTC y conversión a `America/Asuncion` en el servidor, con datos de zona actualizados; pruebas en el cambio de día |
| R12 | **Reserva online expone si una cédula es paciente** | Privacidad | Respuesta mínima y límite de intentos (P11) |
| R13 | **Alcance**: 23 pantallas con mucho detalle clínico | El MVP se estira | El MVP es fijo (sprints 3–10); todo lo demás se negocia por sprint |

---

## 7. Decisiones que necesita responder el cliente

**Bloquean el arranque**
- **P1 · Facturación.** ¿La clínica ya está obligada a factura electrónica? ¿Con qué va a facturar (talonario, herramienta del contador, otra)? ¿El recibo interno del sistema sirve o molesta? ¿Hace falta la pestaña de IVA estimado sin facturas?
- **P2 · «Multi-clínica».** ¿Es un producto para vender a otras clínicas (empresas distintas, datos totalmente separados) o una sola empresa con varias sedes? ¿Una misma persona puede trabajar en dos clínicas?
- **P3 · WhatsApp.** ¿Hay número dedicado y cuenta de Meta Business verificada? ¿Un número por clínica o por sede? ¿Quién paga las conversaciones? ¿Quién traduce las plantillas al guaraní?

**Bloquean un sprint concreto**
- **P4 · Legal de datos de salud** (antes del Sprint 3): plazo de conservación de la historia clínica, si los datos pueden alojarse fuera de Paraguay, qué consentimiento de tratamiento de datos firma el paciente.
- **P5 · Firma** (antes del Sprint 4): ¿alcanza la firma dibujada con evidencia para anamnesis y consentimientos, o se exige otra cosa? ¿Las recetas necesitan algo más que la firma en imagen del profesional?
- **P6 · CI duplicada** (Sprint 3): ¿se bloquea o solo se avisa? ¿Qué pasa con niños sin CI?
- **P7 · Agenda** (Sprint 5): horario real de cada sede y de cada profesional en cada sede (la maqueta tiene tres versiones, C7); ¿se atiende domingos?; ¿se permiten sobreturnos a propósito?; ¿el sillón es fijo por profesional y día o se elige por turno?; ¿un turno puede volver a un estado anterior?; ¿quién marca «ausente» y cuándo?
- **P8 · Roles** (Sprint 2): validar la propuesta del doc 00. ¿Recepción ve algo clínico (alertas sí, ¿diagnósticos?)? ¿Un odontólogo ve fichas de pacientes de otro profesional? ¿El dueño-odontólogo usa un solo usuario?
- **P9 · Cobros** (Sprints 8–9): el doc 03 deja sin definir pagos en varias formas a la vez, cuotas, adelantos sin presupuesto y devoluciones. ¿Cuáles hacen falta el día 1? ¿Quién puede anular un pago y hasta cuándo? ¿Se cobra en dólares o reales? ¿Un presupuesto aprobado se puede editar, vence? ¿El descuento es global o por ítem y quién lo autoriza? ¿La caja es por sede o por puesto? ¿Pagar a un proveedor por transferencia exige caja abierta?
- **P10 · Datos existentes** (Sprint 10): ¿hay pacientes en papel, Excel u otro sistema para importar?
- **P11 · Reserva online** (Sprint 15): al poner una cédula existente, ¿cuánto se muestra? ¿Se exige verificar el WhatsApp antes de confirmar?
- **P12 · Clínico** (Sprints 6, 11, 16, 17): edad de corte pediátrica; qué es una «consulta» del odontograma (¿un turno o una foto guardada a mano?); catálogo de grupos de alergia para el cruce con recetas (hoy solo funciona penicilina); requisitos para recetas de medicamentos controlados; qué clasificación periodontal usan y sus umbrales; formatos de radiografía (¿solo imagen o también DICOM/CBCT?) y tamaño máximo; ¿hace falta la tarea de seguimiento de biopsia?; ¿quién puede corregir o anular un registro clínico y hay ventana de corrección el mismo día?
- **P13 · Comisiones a profesionales** (Sprint 18): no aparecen en ningún doc ni en el código. ¿Se liquidan por el sistema? ¿Sobre cobrado o sobre producido?
- **P14 · Sonrisa Comunitaria y modo sin conexión** (antes del Sprint 6): el design system los pide y los docs no. ¿Entran al alcance? Trabajar sin conexión en el sillón obliga a guardar en el dispositivo y resolver conflictos al sincronizar: es un cambio grande si se decide tarde.

**No bloquean**: tope de descuento; categorías de egreso; qué tratamientos exigen consentimiento; precios por clínica o por sede; si «cerrar un mes» debe bloquear cambios (doc 09, regla 13); consumo estándar de insumos por tratamiento (doc 10, regla 11).

---

## 8. Estimación de esfuerzo

Una persona con IA, 10 días hábiles por sprint. Días-persona estimados, margen ±30 %.

| Sprint | Tema | Esfuerzo | Riesgo |
|---|---|---|---|
| 1 | Fundaciones | 9 | Medio |
| 2 | Usuarios, permisos, archivos | 10 | Medio |
| 3 | Pacientes | 7 | Bajo |
| 4 | Anamnesis | 8 | Medio |
| 5 | Agenda | 10 | Alto |
| 6 | Odontograma I | 10 | Alto |
| 7 | Odontograma II | 9 | Alto |
| 8 | Presupuestos | 7 | Bajo |
| 9 | Caja y pagos | 9 | Medio |
| 10 | Piloto y producción | 8 | Medio |
| 11 | Recetas y certificados | 8 | Medio |
| 12 | Consentimiento | 6 | Bajo |
| 13 | WhatsApp I | 9 | Alto (externo) |
| 14 | WhatsApp II | 8 | Medio |
| 15 | Reserva online | 8 | Medio |
| 16 | Fotos y radiografías | 9 | Medio |
| 17 | Patología y periodontograma | 9 | Medio |
| 18 | Reportes y contabilidad | 8 | Bajo |
| 19 | Inventario y personal | 8 | Bajo |
| 20 | Cierre | 6 | Bajo |
| | **Total** | **166 de 200** | |

- Fase 0: 19 d · Fase 1: 68 d · Fase 2: 31 d · Fase 3: 48 d.
- **MVP en producción al final del Sprint 10 (semana 20).** Sistema completo en la semana 40.
- Los sprints 2, 5 y 6 están al límite: si algo se corre, lo que se recorta es, en orden, la alternativa 2D del odontograma (7), la vista semana de la agenda (5) y la edición de roles por pantalla (2, se resuelve con roles fijos).
- Costos de terceros a presupuestar aparte: Supabase, Railway, WhatsApp (por conversación), dominio, Sentry.

---

## 9. Verificación de este plan

- Cada doc 00–14 tiene sprint asignado (§5.2) y cada tabla que piden los docs aparece en §4, salvo las cuatro de SIFEN, que están listadas como reservadas.
- Cada punto de `14-limites-de-la-maqueta.md` está cubierto por un criterio de aceptación.
- Cada sprint cierra con un entregable que se puede mostrar en staging sin explicar código.
- Siguiente paso tras aprobar: ejecutar la Fase 0 y llevar §7 al cliente. La Fase 1 no arranca sin P1, P2, P4 y P5.
