# TablaLista

Tabla en escritorio que se vuelve lista de tarjetas cuando el contenedor mide menos de 640px — nunca scroll horizontal.

- La primera columna es el título de cada tarjeta en móvil; el resto, pares etiqueta/valor.
- Números alineados a la derecha (`alinear: 'fin'`) con cifras tabulares; montos en Gs.
- Estados dentro de celdas con Chip. Filas clicables: poné un botón o enlace en la primera celda.

El consumidor provee: `columnas` (clave, título, render opcional), `filas` y `titulo` accesible.
