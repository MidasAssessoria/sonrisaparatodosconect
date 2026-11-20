# Patología bucal, radiografías y periodontograma

Pantallas: pestañas «Patología bucal», «Radiografías» y «Periodontograma» de la ficha. Código de la maqueta: `gestion/app.js` (`lesionTab`, `ZONES`, `LES_TIPOS`, acciones `zone`, `les-*`, `ctl-*`), `gestion/rx.js` (visor) y `gestion/perio.js`. Datos de ejemplo: radiografías dibujadas, no son de pacientes reales.

## Qué hace
**Patología bucal (tejidos blandos)**
- Mapa esquemático de la boca con zonas tocables: labio superior / inferior, mucosa yugal derecha / izquierda, encía, paladar duro, paladar blando, orofaringe, lengua (dorso, bordes, cara ventral) y piso de boca. Cada lesión es un punto de color según su estado.
- **Registrar lesión**: tipo (úlcera, leucoplasia, eritroplasia, liquen plano, candidiasis, mucocele, fibroma, herpes, otra), tamaño en mm, color, consistencia, dolor sí / no, fecha, estado, observaciones y foto.
- Cada lesión tiene **evolución**: «Agregar control» suma fecha, tamaño, estado y nota; la lista muestra la línea de tiempo.
- Estados: en observación (amarillo), derivada a biopsia (rojo), resuelta (verde).

**Radiografías**
- Lista de estudios del paciente (periapical, bite-wing, panorámica, foto intraoral) con miniatura, fecha y dientes. Filtro por diente.
- **Visor**: zoom (rueda o botones, 50 % a 600 %), arrastrar, brillo, contraste, negativo y **comparar** dos estudios («Antes» y «Después») con los mismos ajustes.
- Subir imagen, cambiar el tipo, **unir el estudio a uno o varios dientes** (por ejemplo «36, 37») y nota del estudio. Acceso desde el odontograma con el diente ya filtrado.

**Periodontograma**
- Una ficha por fecha (botones por control + «Nuevo control»). Por diente: movilidad (0 a 3), furca (0 a 3, solo molares y premolares marcados) y ausente / implante. Por sitio (3 vestibulares y 3 palatinos / linguales): sangrado, placa, margen gingival y profundidad de sondaje.
- Tarjetas: sangrado al sondaje %, índice de placa %, sitios ≥ 4 mm, sitios ≥ 6 mm, NIC promedio, diagnóstico orientativo y variación contra el control anterior. Gráfico por arcada (línea del margen y del fondo de bolsa) con colores de 4 a 5 mm y de 6 mm en adelante.

## Tablas
**lesion_bucal**
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, paciente_id | | |
| zona | enum | las 12 zonas del mapa (tabla de referencia `zona_bucal`) |
| tipo | enum | lista de arriba; «otra» con texto |
| tamano_mm | numeric | 1 a 80 al registrar |
| color, consistencia | enum | listas de la maqueta (color: blanquecina, rojiza, mixta, color de la mucosa, azulada, amarillenta, pardo-oscura; consistencia: blanda, firme, dura, fluctuante, placa que no se desprende al raspado) |
| dolor | bool | |
| estado | enum | en_observacion / derivada_biopsia / resuelta (el estado vigente = el del último control) |
| observaciones | text | |
| foto_id | FK | a las fotos clínicas (07), no un booleano |
| created_*, deleted_at | | |

**lesion_control**: id, lesion_id, fecha, tamano_mm, estado, nota, profesional_id, foto_id, created_*. El primer registro crea también el primer control («Primer registro»).

**estudio_imagen**
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, paciente_id | | |
| tipo | enum | periapical / bite_wing / panoramica / foto_intraoral (más: CBCT, cefalometría, otras) |
| fecha_toma | date | |
| nota | text | |
| archivo_ref | text | almacenamiento privado (00); en la maqueta es un data URL |
| formato, bytes, ancho, alto | | validación de la subida |
| subido_por, created_at, deleted_at | | |

**estudio_diente**: estudio_id, fdi. Vacío = boca completa (panorámicas).

**periodontograma**: id, clinica_id, paciente_id, fecha, profesional_id, nota, created_*.
**periodontograma_diente**: periodontograma_id, fdi, ausente (bool), movilidad (0–3), furca (0–3).
**periodontograma_sitio**: periodontograma_id, fdi, cara (vestibular / lingual), posicion (1–3), profundidad_sondaje (0–15), margen_gingival (−5 a 10), sangrado, placa.

## Reglas
1. **Lesión**: el tamaño en mm es obligatorio y mayor a 0 al registrar. Si la zona ya tiene lesiones, el sistema lo avisa y ofrece abrirlas antes de crear otra. Varias lesiones por zona se dibujan una al lado de otra.
2. Un **control** actualiza tamaño y estado de la lesión; la evolución se ordena por fecha. El control permite tamaño 0 (la maqueta acepta 0 a 80). No se edita ni se borra una evolución: se agrega otra (la clínica real debe poder anular con motivo y rastro).
3. «Derivada a biopsia» debería abrir una tarea de seguimiento (resultado de la biopsia, fecha) y mostrar alerta en la ficha hasta cerrarse; la maqueta solo pinta el punto en rojo.
4. La foto de la lesión se guarda en fotos clínicas (07) y se enlaza; la maqueta solo marca un casillero «con foto».
5. **Radiografías**: solo se aceptan imágenes (en la real: tipos y tamaño máximo definidos, con revisión de contenido y miniatura generada al subir). Se muestran del estudio más nuevo al más viejo; la panorámica aparece siempre aunque haya filtro por diente.
6. Unir un estudio a dientes: se leen los números de dos dígitos escritos (ej. «36, 37»); en la real se validan contra el catálogo FDI (12) y se rechazan los inexistentes.
7. **Comparar** ordena automáticamente: el más antiguo queda como «Antes» y el más nuevo como «Después». Zoom y filtros son de vista, **nunca modifican el archivo original**; si se imprime o se exporta, el original se conserva sin cambios.
8. Las imágenes son parte de la historia clínica: acceso por rol, registro de quién las vio y las descargó, y conservación por el plazo legal que defina la clínica con su asesor.
9. **Periodontograma — cálculos** (por sitio, solo dientes no ausentes): NIC = margen gingival + profundidad de sondaje; promedios sobre todos los sitios. Sangrado % = sitios con sangrado ÷ sitios totales; placa % igual. «Sitios ≥ 4 mm» y «≥ 6 mm» cuentan por profundidad de sondaje. Valores límite: profundidad 0 a 15, margen −5 a 10; movilidad y furca ciclan 0 → 1 → 2 → 3 → 0.
10. **Diagnóstico orientativo** de la maqueta: más de 2 sitios ≥ 6 mm o NIC promedio ≥ 4 → «Periodontitis · revisar estadio»; algún sitio ≥ 4 mm → «Periodontitis leve / bolsas localizadas»; sangrado superior al 10 % → «Gingivitis»; si no, «Salud periodontal». Es una ayuda y no reemplaza el diagnóstico del profesional (estadio y grado los define la clasificación vigente que use la clínica); el umbral se guarda como configuración.
11. «Nuevo control» **copia el anterior** como punto de partida y lo marca con la fecha de hoy; cada control anterior queda inmutable. La comparación contra el control anterior marca mejoras (▼) y empeoramientos (▲).
12. Cierre de brecha con el odontograma: un diente ausente o con implante en el periodontograma debe reflejarse en `hallazgo_dental` (12), y un diente con movilidad en el odontograma sugiere el sondaje.
13. Los furcas solo se registran en dientes multirradiculares (molares y primeros premolares superiores en la maqueta: 14, 24 y todos los molares).

## Conecta con
Odontograma (12), fotos clínicas (07), pacientes e historial (02), presupuestos (tratamiento periodontal y biopsias, 03), recetas y consentimientos (04, 05), agenda (controles, 01).
