/**
 * `@conecta/db`: esquema Drizzle, conexión con contexto de clínica, ejecutor de migraciones y
 * semilla de desarrollo. Las migraciones SQL (`migraciones/`) son la fuente de verdad del esquema.
 * El banco de pruebas está en `@conecta/db/pruebas`.
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
  type BaseDeDatos,
  type ContextoSesion,
  type MembresiaActiva,
  type OpcionesPool,
  type TransaccionConecta,
} from './contexto.js';
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
