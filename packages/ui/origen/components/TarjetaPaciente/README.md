# TarjetaPaciente

Tarjeta de un paciente en listas: iniciales, nombre, edad, teléfono, próximo turno y chips de alerta; toda la tarjeta abre la ficha.

- Lista A–Z; en escritorio en rejilla de 2–3 columnas, en el celular una columna.
- Chips: alertas clínicas en `atencion`, pediátrico/familia en `familia`, deuda en `progreso`.
- Paciente desactivado: `desactivado` (fondo-suave) y va a la lista «Deshabilitados»; no se borra.
- Nunca fotos de las jornadas del proyecto: solo iniciales.

El consumidor provee: los datos del paciente y `onAbrir`.
