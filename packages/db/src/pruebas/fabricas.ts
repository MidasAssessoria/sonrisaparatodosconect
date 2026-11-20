/**
 * Utilidades para crear datos de prueba como rol de administración. Cada llamada usa ids nuevos,
 * así varias pruebas pueden compartir la base sin pisarse.
 *
 * Corren con el rol dueño de las tablas: `app.proteger_acceso()` no se les aplica (pueden crear
 * membresías ya activas, asignar sedes, etc.) y fijan contextos sin membresía, por eso usan
 * `verificarMembresia: false`. Lo que hace la API pasa por las reglas completas.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import {
  ROLES_SISTEMA,
  type CategoriaArchivo,
  type RolSistema,
  type TasaIva,
} from '@conecta/shared';
import type pg from 'pg';
import { conContextoCliente } from '../contexto.js';
import type { EstadoMembresia } from '../esquema.js';
import { hashTokenInvitacion } from '../funciones.js';

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

/** Id de un rol de sistema de la clínica (o el `rolId` dado). */
async function rolDe(
  cliente: pg.PoolClient,
  clinicaId: string,
  opciones: { rol?: RolSistema | undefined; rolId?: string | undefined },
): Promise<string> {
  if (opciones.rolId) return opciones.rolId;
  const { rows } = await cliente.query<{ id: string }>(
    'select id from app.rol where clinica_id = $1 and codigo = $2',
    [clinicaId, opciones.rol ?? 'recepcion'],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`No existe el rol ${opciones.rol ?? 'recepcion'} en la clínica.`);
  return id;
}

export interface InvitacionDePrueba {
  /** Membresía pendiente, sin usuario. */
  membresiaId: string;
  invitacionId: string;
  /** Token en claro (lo que iría en el enlace). */
  token: string;
  /** `hashTokenInvitacion(token)`: lo que guarda la base. */
  tokenHash: string;
  email: string;
  nombre: string;
  venceEn: Date;
}

/**
 * Crea una membresía pendiente sin usuario y su invitación, como administración (sin las reglas de
 * `app.proteger_invitacion`: sirve para armar invitaciones vencidas con `venceEn` en el pasado).
 * Por defecto: rol recepcion, sin sedes, vence en 7 días, invitada por el sistema.
 */
export async function crearInvitacionDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    rol?: RolSistema;
    rolId?: string;
    email?: string;
    nombre?: string;
    sedeIds?: string[];
    sedeDefectoId?: string;
    venceEn?: Date;
    invitadaPor?: string;
  },
): Promise<InvitacionDePrueba> {
  const marca = sufijo();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashTokenInvitacion(token);
  const email = (opciones.email ?? `invitada-${marca}@prueba.test`).trim().toLowerCase();
  const nombre = opciones.nombre ?? `Invitada ${marca}`;
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', $1, true)", [
        opciones.invitadaPor ?? '',
      ]);
      const rolId = await rolDe(cliente, opciones.clinicaId, opciones);
      const membresia = await cliente.query<{ id: string }>(
        `insert into app.membresia (clinica_id, rol_id, sede_defecto_id, estado)
         values ($1, $2, $3, 'pendiente') returning id`,
        [opciones.clinicaId, rolId, opciones.sedeDefectoId ?? null],
      );
      const membresiaId = membresia.rows[0]?.id;
      if (!membresiaId) throw new Error('No se pudo crear la membresía pendiente.');
      for (const sedeId of opciones.sedeIds ?? []) {
        await cliente.query(
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [opciones.clinicaId, membresiaId, sedeId],
        );
      }
      const invitacion = await cliente.query<{ id: string; vence_en: Date }>(
        `insert into app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en)
         values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now() + interval '7 days'))
         returning id, vence_en`,
        [
          opciones.clinicaId,
          membresiaId,
          email,
          nombre,
          tokenHash,
          opciones.venceEn?.toISOString() ?? null,
        ],
      );
      const fila = invitacion.rows[0];
      if (!fila) throw new Error('No se pudo crear la invitación.');
      return {
        membresiaId,
        invitacionId: fila.id,
        token,
        tokenHash,
        email,
        nombre,
        venceEn: fila.vence_en,
      };
    },
    SIN_VERIFICAR,
  );
}

/** Crea un profesional (activo), opcionalmente asociado a una membresía. */
export async function crearProfesionalDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    membresiaId?: string;
    nombre?: string;
    especialidad?: string;
    color?: string;
  },
): Promise<{ profesionalId: string }> {
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', '', true)");
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.profesional (clinica_id, membresia_id, nombre, especialidad, color)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          opciones.clinicaId,
          opciones.membresiaId ?? null,
          opciones.nombre ?? `Dra. Prueba ${sufijo()}`,
          opciones.especialidad ?? null,
          opciones.color ?? '#18BFB0',
        ],
      );
      const profesionalId = rows[0]?.id;
      if (!profesionalId) throw new Error('No se pudo crear el profesional de prueba.');
      return { profesionalId };
    },
    SIN_VERIFICAR,
  );
}

/** Crea un tratamiento activo del catálogo. Por defecto Gs. 150.000, IVA 10, 30 minutos. */
export async function crearTratamientoDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    nombre?: string;
    categoria?: string;
    precio?: number;
    iva?: TasaIva;
    duracionMin?: number;
  },
): Promise<{ tratamientoId: string }> {
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', '', true)");
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.tratamiento (clinica_id, nombre, categoria, precio, iva, duracion_min)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          opciones.clinicaId,
          opciones.nombre ?? `Tratamiento ${sufijo()}`,
          opciones.categoria ?? null,
          opciones.precio ?? 150_000,
          opciones.iva ?? 10,
          opciones.duracionMin ?? 30,
        ],
      );
      const tratamientoId = rows[0]?.id;
      if (!tratamientoId) throw new Error('No se pudo crear el tratamiento de prueba.');
      return { tratamientoId };
    },
    SIN_VERIFICAR,
  );
}

/**
 * Registra los metadatos de un archivo (no guarda ningún contenido). Por defecto categoría
 * logo_clinica, almacén local, bucket «pruebas», ruta `<clinica_id>/<categoria>/<uuid>.png`.
 */
export async function crearArchivoDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    categoria?: CategoriaArchivo;
    sedeId?: string;
    /** Usuario del contexto (subido_por y created_by). Por defecto, el sistema (NULL). */
    usuarioId?: string;
  },
): Promise<{ archivoId: string; ruta: string }> {
  const categoria = opciones.categoria ?? 'logo_clinica';
  const ruta = `${opciones.clinicaId}/${categoria}/${randomUUID()}.png`;
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', $1, true)", [
        opciones.usuarioId ?? '',
      ]);
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.archivo (clinica_id, categoria, sede_id, almacen, bucket, ruta,
                                  nombre_original, tipo, bytes, ancho, alto, sha256)
         values ($1, $2, $3, 'local', 'pruebas', $4, 'logo.png', 'image/png', 2048, 64, 64, $5)
         returning id`,
        [
          opciones.clinicaId,
          categoria,
          opciones.sedeId ?? null,
          ruta,
          randomBytes(32).toString('hex'),
        ],
      );
      const archivoId = rows[0]?.id;
      if (!archivoId) throw new Error('No se pudo crear el archivo de prueba.');
      return { archivoId, ruta };
    },
    SIN_VERIFICAR,
  );
}
