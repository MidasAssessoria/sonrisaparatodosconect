# MenuExportar

Botón «Exportar» con menú PDF · Excel / CSV · Imprimir, presente en el encabezado de cada página (listas, reportes, fichas).

- Va a la derecha del título de la página, junto a la acción primaria. En móvil, `soloIcono` dentro del menú de acciones.
- Mostrá siempre el estado: `preparando` («Preparando archivo…») mientras se genera y `listo` cuando se puede descargar; `error` con un texto que dice qué hacer.
- Exporta lo que el filtro actual muestra: decilo en el nombre del archivo, no en el botón.

El consumidor provee: `onElegir(formato)` y el `estado` del archivo.
