# Fotos clínicas antes / después

Pantalla: ficha del paciente → pestaña «Fotos clínicas». Código de la maqueta: `gestion/fotos.js` (las fotos de demo son ilustraciones; en la app real son fotos de la cámara o del celular).

## Qué hace
- Fotos organizadas por **serie** (un tratamiento: blanqueamiento, ortodoncia, carillas, implante 36…).
- Cada foto tiene **vista estándar** (frontal, lateral derecha/izquierda, oclusal superior/inferior, sonrisa) y **fase** (antes, durante, después) con fecha.
- **Comparador** antes/después con deslizador, por vista; se puede mandar al paciente por WhatsApp.
- «Subir foto» abre la cámara en tablet/celular; la imagen se achica a 1200 px antes de guardar.
- **Autorización para redes** por serie: sin ella la foto no se puede exportar para marketing.

## Tablas
**foto_serie**: id, paciente_id, titulo, tratamiento_id (opcional), fecha_inicio, autoriza_redes (bool), autoriza_fecha, autoriza_firma (reusar consentimiento), doctor_id.

**foto_clinica**
| campo | nota |
|---|---|
| id, serie_id, paciente_id | |
| vista | frontal / lat_d / lat_i / oc_sup / oc_inf / sonrisa |
| fase | antes / durante / despues |
| fecha_toma | |
| archivo_url, miniatura_url | **almacenamiento privado** (bucket con URL firmada que vence), nunca público |
| ancho, alto, tamano_bytes | |
| subido_por, subido_en | auditoría |
| pieza (opcional), nota | |

## Reglas
1. Las fotos son **dato clínico sensible**: acceso solo de usuarios de la clínica con permiso; URLs firmadas con vencimiento; nunca indexables.
2. Al subir: comprimir (máx. 1200–1600 px, JPEG ~80 %), quitar metadatos EXIF (ubicación del celular) y generar miniatura.
3. Comparar exige antes + después (o durante) **de la misma vista**.
4. Exportar para redes solo si `autoriza_redes = true`; el export puede recortar/difuminar la cara.
5. Borrar foto = baja lógica con motivo (queda en auditoría).

## Conecta con
Pacientes, tratamientos/presupuestos (serie ligada al tratamiento), consentimiento (autorización de imagen), WhatsApp (enviar comparación al paciente).
