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
  crearArchivoDePrueba,
  crearClinicaDePrueba,
  crearInvitacionDePrueba,
  crearProfesionalDePrueba,
  crearRolDePrueba,
  crearSedeDePrueba,
  crearTratamientoDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type InvitacionDePrueba,
  type UsuarioDePrueba,
} from './fabricas.js';
