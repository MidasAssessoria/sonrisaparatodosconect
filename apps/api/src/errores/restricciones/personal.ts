import type { RestriccionPersonal } from '@conecta/db';
import { errores, type ErrorApi } from '../error-api.js';

/**
 * Lo que responde la API ante cualquier enlace de invitación que no sirve (inexistente, vencido,
 * usado, anulado o reemplazado por un reenvío): siempre lo mismo, para no revelar cuál es el caso.
 */
export const MENSAJE_INVITACION_NO_VIGENTE =
  'Ese enlace de invitación no sirve: puede que haya vencido, que ya se haya usado o que lo hayan reemplazado. Pedile un enlace nuevo a la clínica.';

export const invitacionNoVigente = (): ErrorApi =>
  errores.noEncontrado(MENSAJE_INVITACION_NO_VIGENTE);

/** Reglas de `RESTRICCIONES_PERSONAL` (la lista exhaustiva de la base). */
const REGLAS_PERSONAL: Record<RestriccionPersonal, () => ErrorApi> = {
  membresia_por_invitacion: () =>
    errores.conflicto(
      'Una persona entra al equipo solo aceptando su invitación. Mandale el enlace para que la acepte.',
    ),
  membresia_invitacion_abierta: () =>
    errores.conflicto(
      'Esa invitación sigue abierta. Anulá la invitación en vez de dar de baja a la persona.',
    ),
  rol_inactivo: () =>
    errores.conflicto('Ese rol está desactivado. Elegí otro rol para esta persona.'),
  rol_en_uso: () =>
    errores.conflicto(
      'Ese rol lo usa alguien del equipo o una invitación pendiente. Cambiales el rol antes de desactivarlo.',
    ),
  rol_no_encontrado: () =>
    errores.noEncontrado('No encontramos ese rol. Volvé a la lista de roles y probá de nuevo.'),
  invitacion_no_vigente: invitacionNoVigente,
  invitacion_no_encontrada: () =>
    errores.noEncontrado(
      'No hay ninguna invitación pendiente para esa persona. Volvé a la lista del equipo y probá de nuevo.',
    ),
  invitacion_otro_correo: () =>
    errores.sinPermiso(
      'Esta invitación es para otro correo. Ingresá con la cuenta del correo invitado y abrí el enlace de nuevo.',
    ),
  invitacion_otra_cuenta: () =>
    errores.conflicto(
      'Ese correo ya tiene una cuenta. Ingresá con esa cuenta y abrí el enlace de nuevo para aceptar.',
    ),
  invitacion_membresia: () =>
    errores.conflicto(
      'Esa persona ya aceptó o ya no tiene una invitación pendiente. Recargá la lista del equipo.',
    ),
  invitacion_ya_es_miembro: () =>
    errores.conflicto(
      'Esa persona ya es o fue parte del equipo. Si está desactivada, reactivala en vez de invitarla.',
    ),
  invitacion_vencimiento: () =>
    errores.datosInvalidos('El enlace tiene que vencer dentro de los próximos 30 días.'),
  invitacion_sede_defecto: () =>
    errores.datosInvalidos('La sede por defecto tiene que estar entre las sedes elegidas.'),
  sede_dada_de_baja: () =>
    errores.datosInvalidos(
      'Alguna de las sedes elegidas está dada de baja. Recargá la página y elegí otras.',
    ),
};

/**
 * Mensajes para las restricciones de la base del módulo personal (nombre en `constraint`).
 * Cada una con el código del contrato y un mensaje en voseo que dice qué hacer, sin datos de otra
 * clínica.
 */
export const MENSAJES_PERSONAL: Record<string, () => ErrorApi> = {
  ...REGLAS_PERSONAL,
  // Restricciones reales de invitacion, membresia, usuario y rol.
  invitacion_abierta_email: () =>
    errores.conflicto(
      'Ya hay una invitación abierta para ese correo. Reenviala o anulala antes de crear otra.',
    ),
  invitacion_abierta_membresia: () =>
    errores.conflicto(
      'Esa persona ya tiene una invitación abierta. Reenviala o anulala antes de crear otra.',
    ),
  invitacion_email_check: () => errores.datosInvalidos('Revisá el correo de la persona invitada.'),
  invitacion_nombre_check: () => errores.datosInvalidos('Poné el nombre de la persona invitada.'),
  invitacion_anulacion_check: () => errores.datosInvalidos('Contanos el motivo de la anulación.'),
  membresia_usuario_clinica_key: () =>
    errores.conflicto(
      'Tu cuenta ya tiene (o tuvo) acceso a esta clínica. Ingresá y elegí la clínica; si no te deja, pedile a la clínica que te reactive.',
    ),
  usuario_email_unico: () =>
    errores.conflicto(
      'Ese correo ya tiene una cuenta. Ingresá con esa cuenta y abrí el enlace de nuevo para aceptar.',
    ),
  rol_inactividad_min_check: () =>
    errores.datosInvalidos('El cierre por inactividad tiene que estar entre 5 y 240 minutos.'),
  rol_permiso_modulo_check: () =>
    errores.datosInvalidos('Algún permiso tiene un módulo que no existe. Revisá la matriz.'),
  rol_permiso_accion_check: () =>
    errores.datosInvalidos('Algún permiso tiene una acción que no existe. Revisá la matriz.'),
};
