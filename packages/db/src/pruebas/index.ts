/**
 * `@conecta/db/pruebas`: banco de pruebas con Postgres real para cualquier paquete del monorepo.
 * Uso típico: globalSetup `@conecta/db/pruebas/global-setup` y, en cada prueba,
 * `const { urlAdmin, urlApi } = inject('conectaDb')`.
 */
export {
  CLAVES_DE_PRUEBA,
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
  crearAlertaDePrueba,
  crearArchivoDePrueba,
  crearClinicaDePrueba,
  crearInvitacionDePrueba,
  crearPacienteDePrueba,
  crearProfesionalDePrueba,
  crearRelacionDePrueba,
  crearRolDePrueba,
  crearSedeDePrueba,
  crearTratamientoDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
  type InvitacionDePrueba,
  type UsuarioDePrueba,
} from './fabricas.js';
