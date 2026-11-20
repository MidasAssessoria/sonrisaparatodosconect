# Buscador

Buscador de pacientes por nombre, apellido, CI o teléfono, con resultados mientras se escribe.

- Visible en todas las páginas (dentro de BarraSuperior en escritorio; arriba del contenido en el celular).
- Cada resultado muestra iniciales, nombre, CI y teléfono, y un Chip de atención si tiene alerta clínica.
- Sin resultados: decí qué probar («buscá por CI»), sin culpar.
- Nunca fotos reales en resultados: solo Avatar con iniciales.

El consumidor provee: `resultados` (sin `valor` filtra solo; controlado con `valor` + `onCambio` si filtrás en el servidor) y `onElegir`.
