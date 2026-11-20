# Campo

Campo de formulario con etiqueta real arriba (nunca solo placeholder), ayuda y error con ícono.

- 48px de alto, borde-control 1.5px, texto 16px (evita el zoom del celular).
- `requerido` agrega «· obligatorio» en texto, no un asterisco suelto.
- Error: borde coral-texto 2px + mensaje con ícono que dice cómo resolverlo («Ingresá el CI sin puntos»).
- `tipo="password"` trae mostrar/ocultar; `select` y `textarea` con el mismo aspecto.
- En el celular, un campo por fila; en escritorio, rejilla de 12 columnas.

El consumidor provee: `etiqueta`, `tipo`, valor/onChange y `error` validado.
