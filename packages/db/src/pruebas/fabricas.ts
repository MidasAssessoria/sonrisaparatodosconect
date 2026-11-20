/**
 * Utilidades para crear datos de prueba como rol de administración. Cada llamada usa ids nuevos,
 * así varias pruebas pueden compartir la base sin pisarse.
 *
 * Corren con el rol dueño de las tablas: `app.proteger_acceso()` no se les aplica (pueden crear
 * membresías ya activas, asignar sedes, etc.) y fijan contextos sin membresía, por eso usan
 * `verificarMembresia: false`. Lo que hace la API pasa por las reglas completas.
 */
import { randomUUID } from 'node:crypto';
import { ROLES_SISTEMA, type RolSistema } from '@conecta/shared';
import type pg from 'pg';
import { conContextoCliente } from '../contexto.js';
import type { EstadoMembresia } from '../esquema.js';

export interface ClinicaDePrueba {
  clinicaId: string;
  nombre: string;
  /** Usuario dueño (membresía activa con rol dueno). */
  duenoId: string;
  /** Membresía del dueño. */
  membresiaDuenoId: string;
  /** Id de cada rol de sistema de la clínica. */
  roles: Record<RolSistema, string>;
}

function sufijo(): string {
  return randomUUID().slice(0, 8);
}

const SIN_VERIFICAR = { verificarMembresia: false } as const;

/** Da de alta una clínica con `app.alta_clinica()` (5 roles, permisos y dueño activo). */
export async function crearClinicaDePrueba(
  admin: pg.Pool,
  opciones: { nombre?: string } = {},
): Promise<ClinicaDePrueba> {
  const clinicaId = randomUUID();
  const duenoId = randomUUID();
  const marca = sufijo();
  const nombre = opciones.nombre ?? `Clínica de prueba ${marca}`;
  return conContextoCliente(
    admin,
    { clinicaId, usuarioId: duenoId },
    async (cliente) => {
      await cliente.query(
        `select app.alta_clinica(p_nombre => $1, p_dueno_id => $2, p_dueno_nombre => $3,
                                 p_dueno_email => $4, p_clinica_id => $5)`,
        [nombre, duenoId, `Dueño ${marca}`, `dueno-${marca}@prueba.test`, clinicaId],
      );
      const { rows } = await cliente.query<{ codigo: RolSistema; id: string }>(
        'select codigo, id from app.rol where clinica_id = $1 and es_sistema',
        [clinicaId],
      );
      const roles = Object.fromEntries(rows.map((fila) => [fila.codigo, fila.id]));
      for (const codigo of ROLES_SISTEMA) {
        if (!roles[codigo]) throw new Error(`alta_clinica no creó el rol ${codigo}.`);
      }
      const membresia = await cliente.query<{ id: string }>(
        'select id from app.membresia where clinica_id = $1 and usuario_id = $2',
        [clinicaId, duenoId],
      );
      const membresiaDuenoId = membresia.rows[0]?.id;
      if (!membresiaDuenoId) throw new Error('alta_clinica no creó la membresía del dueño.');
      return {
        clinicaId,
        nombre,
        duenoId,
        membresiaDuenoId,
        roles: roles as Record<RolSistema, string>,
      };
    },
    SIN_VERIFICAR,
  );
}

export interface UsuarioDePrueba {
  usuarioId: string;
  membresiaId: string;
  email: string;
}

/**
 * Crea (o reutiliza, si se pasa `usuarioId` de uno existente) un usuario y su membresía en una
 * clínica. Por defecto: rol recepcion, estado activo.
 */
export async function crearUsuarioDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    rol?: RolSistema;
    estado?: EstadoMembresia;
    usuarioId?: string;
    nombre?: string;
    email?: string;
  },
): Promise<UsuarioDePrueba> {
  const usuarioId = opciones.usuarioId ?? randomUUID();
  const marca = sufijo();
  const email = opciones.email ?? `usuario-${marca}@prueba.test`;
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId },
    async (cliente) => {
      const existe = await cliente.query<{ email: string }>(
        'select email from app.usuario where id = $1',
        [usuarioId],
      );
      if (!existe.rowCount) {
        await cliente.query('insert into app.usuario (id, nombre, email) values ($1, $2, $3)', [
          usuarioId,
          opciones.nombre ?? `Usuario ${marca}`,
          email,
        ]);
      }
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.membresia (clinica_id, usuario_id, rol_id, estado)
         select $1, $2, r.id, $4 from app.rol r where r.clinica_id = $1 and r.codigo = $3
         returning id`,
        [opciones.clinicaId, usuarioId, opciones.rol ?? 'recepcion', opciones.estado ?? 'activo'],
      );
      const membresiaId = rows[0]?.id;
      if (!membresiaId)
        throw new Error(`No existe el rol ${opciones.rol ?? 'recepcion'} en la clínica.`);
      return { usuarioId, membresiaId, email: existe.rows[0]?.email ?? email };
    },
    SIN_VERIFICAR,
  );
}

/** Crea una sede (abierta) con un sillón. */
export async function crearSedeDePrueba(
  admin: pg.Pool,
  clinicaId: string,
  opciones: { nombre?: string } = {},
): Promise<{ sedeId: string; sillonId: string }> {
  return conContextoCliente(
    admin,
    { clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      // Sin usuario existente en el contexto: created_by queda NULL (el FK a usuario no se viola).
      await cliente.query("select set_config('app.usuario_id', '', true)");
      const sede = await cliente.query<{ id: string }>(
        `insert into app.sede (clinica_id, nombre, estado) values ($1, $2, 'abierta') returning id`,
        [clinicaId, opciones.nombre ?? `Sede ${sufijo()}`],
      );
      const sedeId = sede.rows[0]?.id;
      if (!sedeId) throw new Error('No se pudo crear la sede de prueba.');
      const sillon = await cliente.query<{ id: string }>(
        `insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, 'Sillón 1') returning id`,
        [clinicaId, sedeId],
      );
      const sillonId = sillon.rows[0]?.id;
      if (!sillonId) throw new Error('No se pudo crear el sillón de prueba.');
      return { sedeId, sillonId };
    },
    SIN_VERIFICAR,
  );
}
