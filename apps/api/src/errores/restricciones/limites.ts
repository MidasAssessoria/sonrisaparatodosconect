import type { RestriccionLimite } from '@conecta/db';
import { ACCIONES, MODULOS } from '@conecta/shared';
import { ErrorApi, errores } from '../error-api.js';

/**
 * Límites de quien administra (migración 0015, contrato de personal): nadie da ni asigna permisos
 * que no tiene (salvo el dueño), los roles de sistema solo los cambia un dueño, Dueño/a y
 * Administración exigen siempre doble factor, la dimensión sede en personal y la baja con motivo.
 *
 * `rol_permisos_ajenos` y `asignacion_rol_superior` traen en el mensaje de la base la lista de
 * permisos que sobran (`modulo:accion`). La API la repite solo si cada elemento es un permiso del
 * contrato: nada más del mensaje de la base llega al cliente.
 */

const PERMISO = /^([a-z_]+):([a-z]+)$/;

/** Los `modulo:accion` del paréntesis del mensaje de la base, o null si no hay o no son válidos. */
export function permisosDelMensaje(mensaje: string | undefined): string[] | null {
  const lista = /\(([^()]{1,2000})\)/.exec(mensaje ?? '')?.[1];
  if (!lista) return null;
  const permisos = lista.split(',').map((p) => p.trim());
  const validos = permisos.every((p) => {
    const m = PERMISO.exec(p);
    return (
      m !== null &&
      (MODULOS as readonly string[]).includes(m[1] ?? '') &&
      (ACCIONES as readonly string[]).includes(m[2] ?? '')
    );
  });
  return validos && permisos.length > 0 ? permisos : null;
}

function conLista(mensaje: string | undefined, inicio: string, fin: string): string {
  const permisos = permisosDelMensaje(mensaje);
  return permisos ? `${inicio}: ${permisos.join(', ')}. ${fin}` : `${inicio}. ${fin}`;
}

const fueraDeSedes = (): ErrorApi =>
  new ErrorApi(
    403,
    'sede_no_permitida',
    'Esa persona trabaja en sedes que vos no ves, o elegiste una sede que no ves. Pedíselo a alguien que vea todas las sedes.',
  );

/** Reglas de `RESTRICCIONES_LIMITES` (la lista exhaustiva de la base). */
export const MENSAJES_LIMITES: Record<RestriccionLimite, (pg: { message: string }) => ErrorApi> = {
  rol_permisos_ajenos: (pg) =>
    errores.sinPermiso(
      conLista(
        pg.message,
        'Ese rol quedaría con permisos que tu rol no tiene',
        'Quitáselos o pedile al dueño que haga el cambio.',
      ),
    ),
  rol_todas_las_sedes_ajeno: () =>
    errores.sinPermiso(
      'Tu rol no ve todas las sedes, así que no podés dejar un rol que las vea todas. Pedile al dueño que haga el cambio.',
    ),
  asignacion_rol_superior: (pg) =>
    errores.sinPermiso(
      conLista(
        pg.message,
        'Ese rol da permisos que tu rol no tiene',
        'Pedile al dueño que lo asigne.',
      ),
    ),
  asignacion_todas_las_sedes: () =>
    errores.sinPermiso('Ese rol ve todas las sedes y el tuyo no. Pedile al dueño que lo asigne.'),
  rol_sistema_solo_dueno: () =>
    errores.sinPermiso(
      'Los roles de sistema solo los cambia un dueño. Creá un rol propio o pedile el cambio al dueño.',
    ),
  rol_mfa_obligatorio: () =>
    errores.datosInvalidos(
      'Los roles Dueño/a y Administración exigen siempre doble factor. Dejá activado el doble factor.',
      [{ campo: 'exigeMfa', mensaje: 'Este rol siempre exige doble factor.' }],
    ),
  acceso_fuera_de_sedes: fueraDeSedes,
  baja_sin_motivo: () =>
    errores.datosInvalidos('Contanos el motivo de la baja.', [
      { campo: 'motivo', mensaje: 'Completá este dato.' },
    ]),
  membresia_no_activa: () =>
    errores.conflicto('Esa persona no está activa. Recargá la lista del equipo.'),
};

/** Restricciones reales de 0015 con mensaje propio. */
export const MENSAJES_LIMITES_COLUMNAS: Record<string, () => ErrorApi> = {
  membresia_motivo_baja_check: () =>
    errores.datosInvalidos('El motivo puede tener hasta 500 caracteres. Resumilo.', [
      { campo: 'motivo', mensaje: 'Hasta 500 caracteres.' },
    ]),
  rol_motivo_baja_check: () =>
    errores.datosInvalidos('El motivo puede tener hasta 500 caracteres. Resumilo.', [
      { campo: 'motivo', mensaje: 'Hasta 500 caracteres.' },
    ]),
};
