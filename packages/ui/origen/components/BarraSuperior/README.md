# BarraSuperior

Barra superior de escritorio: buscador global de pacientes, selector ES · GN, sede, notificaciones y perfil.

- El buscador está siempre visible: es la acción más usada en recepción.
- Notificaciones con número (coral con texto tinta) y `aria-label` que dice cuántas.
- Debajo de 900px de ancho se ocultan el nombre del perfil y de la sede (quedan los íconos con su etiqueta accesible).
- En tablet sin barra lateral, `conMarca` agrega la marca a la izquierda.

El consumidor provee: `resultados` del buscador, `idioma`, `sede`, `notificaciones` y `usuario`.
