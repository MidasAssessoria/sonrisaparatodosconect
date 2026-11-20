# BarraLateral

Navegación de escritorio y tablet: la marca arriba y los módulos con ícono + nombre, el activo en turquesa-suave con filete turquesa.

- Orden fijo: Inicio, Pacientes, Odontología, Agenda, Caja, Personal, Inventario, Sonrisa Comunitaria, Estadísticas.
- Cada rol ve solo lo que le corresponde: pasá `modulos` con los ids permitidos; los demás **no se muestran** (no se deshabilitan).
- Ancho `barra-lateral` (248px). Por debajo de 768px se reemplaza por BarraInferior.
- La marca es tipográfica («Sonrisa Para Todos» + «Conecta» en Fredoka) hasta que exista un logo definitivo: pasalo en `logo`.

El consumidor provee: `activo`, `rutas` o `onNavegar`, y `modulos` según el rol.
