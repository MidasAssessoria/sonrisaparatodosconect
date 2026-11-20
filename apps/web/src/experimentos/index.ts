/**
 * Experimentos (prueba técnica R2: odontograma 3D como componente). El orquestador conecta
 * `PruebaOdontograma` a una ruta; nada de acá se usa todavía en pantallas del producto.
 */
export { PruebaOdontograma } from './PruebaOdontograma.js';
export {
  Odontograma3D,
  type CambioOdontograma,
  type ControlOdontograma,
  type PropsOdontograma3D,
  type Vista,
} from './odontograma/Odontograma3D.js';
export type {
  ClaseElegida,
  Denticion,
  EstadoHallazgo,
  EstadoOdontograma,
  Herramienta,
  MarcaDiente,
  TipoHallazgo,
} from './odontograma/modelo.js';
export type { CambioHallazgo } from './odontograma/reglas.js';
