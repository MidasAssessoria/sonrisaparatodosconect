# Boton

Botón de acción con etiqueta en verbo («Nuevo turno», «Cobrar», «Guardar atención»): 48px de alto, 56px en el sillón.

- **primario** (relleno turquesa, texto tinta): una sola vez por vista, para lo que la página existe. Nunca texto blanco sobre turquesa.
- **secundario** (por defecto): blanco con borde-control.
- **fantasma**: acciones terciarias en turquesa-texto («Ver todo», «Olvidé mi contraseña»).
- **peligro**: desactivar, anular un pago. Texto y borde coral-texto; siempre con confirmación en una HojaInferior.
- `tamano="lg"` en herramientas del odontograma y la acción fija al pie en móvil (`bloque`).
- `cargando` reemplaza el ícono por un giro y bloquea el botón: el texto no cambia de ancho.
- Solo ícono: pasá `aria-label` («Exportar», «Cerrar»). Tamaño mínimo 44×44 siempre.

El consumidor provee: el texto (verbo + objeto, sin punto final), `onClick`, y el ícono opcional por nombre.
