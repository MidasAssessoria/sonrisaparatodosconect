/**
 * `@conecta/db/pruebas`: banco de pruebas con Postgres real para cualquier paquete del monorepo.
 * Uso típico: globalSetup `@conecta/db/pruebas/global-setup` y, en cada prueba,
 * `const { urlAdmin, urlApi } = inject('conectaDb')`.
 */
export {
  crearBaseVacia,
  iniciarBanco,
  ROL_MIGRADOR_DE_PRUEBA,
  urlCon,
  type BancoDePruebas,
  type BaseVacia,
  type OpcionesBanco,
  type UrlsDeBanco,
} from './banco.js';
export {
  crearClinicaDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type UsuarioDePrueba,
} from './fabricas.js';
