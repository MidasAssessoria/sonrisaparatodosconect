/**
 * `@conecta/db`: esquema Drizzle, conexión con contexto de clínica, funciones SQL tipadas, ejecutor
 * de migraciones y semilla de desarrollo. Las migraciones SQL (`migraciones/`) son la fuente de
 * verdad del esquema; las constantes del contrato (módulos, acciones, estados de sede, roles de
 * sistema) están en `@conecta/shared`. El banco de pruebas está en `@conecta/db/pruebas`.
 */
export * from './esquema.js';
export {
  baseDeDatos,
  buscarMembresiaActiva,
  conContexto,
  conContextoCliente,
  conUsuario,
  crearPool,
  ErrorDeContexto,
  ErrorDeMembresia,
  type BaseDeDatos,
  type ContextoSesion,
  type MembresiaActiva,
  type MotivoErrorDeMembresia,
  type OpcionesContexto,
  type OpcionesPool,
  type TransaccionConecta,
} from './contexto.js';
export {
  activarMfa,
  cerrarSesion,
  desactivarMfa,
  registrarEvento,
  tocarSesion,
  type EventoAuditable,
} from './funciones.js';
export {
  calcularChecksum,
  DIRECTORIO_MIGRACIONES,
  ErrorDeMigracion,
  leerMigraciones,
  migrar,
  type Migracion,
  type OpcionesMigrar,
  type ResultadoMigrar,
} from './migrar.js';
export { DEMO, sembrarDemo, type OpcionesSemilla, type ResultadoSemilla } from './semilla.js';
