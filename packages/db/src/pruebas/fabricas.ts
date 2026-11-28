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
  type TipoAlerta,
  type TipoRelacion,
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
 * clínica. Por defecto: rol recepcion (o `rolId`, p. ej. uno de `crearRolDePrueba`), estado activo,
 * sin sedes. Una inactiva nace con motivo de baja. `sedeIds` y `sedeDefectoId`, si vienen, se le
 * asignan.
 */
export async function crearUsuarioDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    rol?: RolSistema;
    rolId?: string;
    estado?: EstadoMembresia;
    usuarioId?: string;
    nombre?: string;
    email?: string;
    sedeIds?: string[];
    sedeDefectoId?: string;
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
      const rolId = await rolDe(cliente, opciones.clinicaId, opciones);
      const estado = opciones.estado ?? 'activo';
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.membresia (clinica_id, usuario_id, rol_id, estado, sede_defecto_id, motivo_baja)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          opciones.clinicaId,
          usuarioId,
          rolId,
          estado,
          opciones.sedeDefectoId ?? null,
          estado === 'inactivo' ? 'Baja de prueba' : null,
        ],
      );
      const membresiaId = rows[0]?.id;
      if (!membresiaId) throw new Error('No se pudo crear la membresía de prueba.');
      for (const sedeId of opciones.sedeIds ?? []) {
        await cliente.query(
          'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
          [opciones.clinicaId, membresiaId, sedeId],
        );
      }
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
 * Por defecto: rol recepcion, sin sedes, vence en 72 horas, invitada por el sistema.
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
         values ($1, $2, $3, $4, $5, coalesce($6::timestamptz, now() + interval '72 hours'))
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

/**
 * Crea un rol de la clínica (no de sistema) con su matriz, como administración (sin las reglas de
 * `app.proteger_acceso`). `permisos`: 'modulo:accion'. Por defecto sin todas las sedes, sin doble
 * factor y 30 minutos de inactividad.
 */
export async function crearRolDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    nombre?: string;
    permisos?: string[];
    todasLasSedes?: boolean;
    exigeMfa?: boolean;
  },
): Promise<{ rolId: string }> {
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', '', true)");
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.rol (clinica_id, nombre, todas_las_sedes, exige_mfa)
         values ($1, $2, $3, $4) returning id`,
        [
          opciones.clinicaId,
          opciones.nombre ?? `Rol de prueba ${sufijo()}`,
          opciones.todasLasSedes ?? false,
          opciones.exigeMfa ?? false,
        ],
      );
      const rolId = rows[0]?.id;
      if (!rolId) throw new Error('No se pudo crear el rol de prueba.');
      for (const permiso of opciones.permisos ?? []) {
        const [modulo, accion] = permiso.split(':');
        await cliente.query(
          'insert into app.rol_permiso (clinica_id, rol_id, modulo, accion) values ($1, $2, $3, $4)',
          [opciones.clinicaId, rolId, modulo, accion],
        );
      }
      return { rolId };
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
    /** Paciente del archivo (obligatorio con `firma_paciente`). */
    pacienteId?: string;
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
        `insert into app.archivo (clinica_id, categoria, sede_id, paciente_id, almacen, bucket, ruta,
                                  nombre_original, tipo, bytes, ancho, alto, sha256)
         values ($1, $2, $3, $4, 'local', 'pruebas', $5, 'logo.png', 'image/png', 2048, 64, 64, $6)
         returning id`,
        [
          opciones.clinicaId,
          categoria,
          opciones.sedeId ?? null,
          opciones.pacienteId ?? null,
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

/**
 * Crea un paciente activo (como alta del sistema: created_by NULL, sin las defensas de permisos).
 * Por defecto «Paciente <marca>» sin apellidos ni documentos. La base normaliza CI y teléfono. Con
 * `activo: false` queda dado de baja con motivo.
 */
export async function crearPacienteDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    nombres?: string;
    apellidos?: string | null;
    ci?: string | null;
    telefono?: string | null;
    /** `YYYY-MM-DD`. */
    fechaNac?: string | null;
    sexo?: 'F' | 'M' | null;
    activo?: boolean;
  },
): Promise<{ pacienteId: string }> {
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', '', true)");
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.paciente (clinica_id, nombres, apellidos, ci, telefono, fecha_nac, sexo)
         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [
          opciones.clinicaId,
          opciones.nombres ?? `Paciente ${sufijo()}`,
          opciones.apellidos ?? null,
          opciones.ci ?? null,
          opciones.telefono ?? null,
          opciones.fechaNac ?? null,
          opciones.sexo ?? null,
        ],
      );
      const pacienteId = rows[0]?.id;
      if (!pacienteId) throw new Error('No se pudo crear el paciente de prueba.');
      if (opciones.activo === false) {
        await cliente.query(
          "update app.paciente set activo = false, motivo_baja = 'Baja de prueba' where id = $1",
          [pacienteId],
        );
      }
      return { pacienteId };
    },
    SIN_VERIFICAR,
  );
}

/**
 * Crea un vínculo «familiar es `tipo` de paciente» (la base crea el espejo). `familiarEs*` son las
 * marcas del otro lado (se guardan en el espejo).
 */
export async function crearRelacionDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    pacienteId: string;
    familiarId: string;
    tipo: TipoRelacion;
    esTutorLegal?: boolean;
    esResponsablePago?: boolean;
    familiarEsTutorLegal?: boolean;
    familiarEsResponsablePago?: boolean;
  },
): Promise<{ relacionId: string }> {
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', '', true)");
      const { rows } = await cliente.query<{ id: string }>(
        `insert into app.paciente_relacion
           (clinica_id, paciente_id, familiar_id, tipo, es_tutor_legal, es_responsable_pago)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          opciones.clinicaId,
          opciones.pacienteId,
          opciones.familiarId,
          opciones.tipo,
          opciones.esTutorLegal ?? false,
          opciones.esResponsablePago ?? false,
        ],
      );
      const relacionId = rows[0]?.id;
      if (!relacionId) throw new Error('No se pudo crear el vínculo de prueba.');
      if (opciones.familiarEsTutorLegal || opciones.familiarEsResponsablePago) {
        await cliente.query(
          `update app.paciente_relacion set es_tutor_legal = $3, es_responsable_pago = $4
           where paciente_id = $1 and familiar_id = $2 and deleted_at is null`,
          [
            opciones.familiarId,
            opciones.pacienteId,
            opciones.familiarEsTutorLegal ?? false,
            opciones.familiarEsResponsablePago ?? false,
          ],
        );
      }
      return { relacionId };
    },
    SIN_VERIFICAR,
  );
}

/**
 * Crea una alerta manual (activa y de tipo alergia por defecto), como alta del sistema.
 */
export async function crearAlertaDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    pacienteId: string;
    tipo?: TipoAlerta;
    texto?: string;
    activa?: boolean;
  },
): Promise<{ alertaId: string }> {
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', '', true)");
      const alertaId = randomUUID();
      await cliente.query(
        `insert into app.paciente_alerta (id, clinica_id, paciente_id, tipo, texto, activa)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          alertaId,
          opciones.clinicaId,
          opciones.pacienteId,
          opciones.tipo ?? 'alergia',
          opciones.texto ?? 'Alergia a la penicilina',
          opciones.activa ?? true,
        ],
      );
      return { alertaId };
    },
    SIN_VERIFICAR,
  );
}

/** Archivo `firma_paciente` de un paciente (solo metadatos), para firmar una anamnesis. */
export async function crearFirmaDePrueba(
  admin: pg.Pool,
  opciones: { clinicaId: string; pacienteId: string },
): Promise<{ archivoId: string }> {
  const { archivoId } = await crearArchivoDePrueba(admin, {
    clinicaId: opciones.clinicaId,
    categoria: 'firma_paciente',
    pacienteId: opciones.pacienteId,
  });
  return { archivoId };
}

/** Respuesta a una pregunta de la anamnesis (forma de `respuestaSchema`). */
export interface RespuestaDePrueba {
  codigo: string;
  si?: boolean;
  opciones?: string[];
  texto?: string;
  numero?: number;
  detalle?: string;
}

/**
 * Guarda una versión de la anamnesis con `app.guardar_anamnesis` desde una sesión del dueño de las
 * tablas (sin las defensas de permisos, como alta del sistema: registrada_por NULL; o como
 * `usuarioId` si se pasa). Pasa por TODAS las validaciones del catálogo y del tutor. Crea la firma.
 * Por defecto: la versión siguiente a la vigente, sin respuestas, firmada por «Paciente de prueba»
 * (o, con `tutor`, por ese tutor con su CI).
 */
export async function crearAnamnesisDePrueba(
  admin: pg.Pool,
  opciones: {
    clinicaId: string;
    pacienteId: string;
    respuestas?: RespuestaDePrueba[];
    firmante?: string;
    tutor?: { nombre: string; ci: string };
    /** Por defecto, la vigente (la base la compara igual). */
    versionBase?: number | null;
    /** Por defecto, la del cuestionario de ahora. */
    huellaCatalogo?: string;
    signosVitales?: {
      presionSistolica?: number;
      presionDiastolica?: number;
      pulso?: number;
      pesoKg?: number;
    };
    usuarioId?: string;
  },
): Promise<{ anamnesisId: string; version: number; firmaArchivoId: string }> {
  const { archivoId } = await crearFirmaDePrueba(admin, opciones);
  return conContextoCliente(
    admin,
    { clinicaId: opciones.clinicaId, usuarioId: randomUUID() },
    async (cliente) => {
      await cliente.query("select set_config('app.usuario_id', $1, true)", [
        opciones.usuarioId ?? '',
      ]);
      const vigente = await cliente.query<{ version: number | null }>(
        'select max(version) as version from app.anamnesis where clinica_id = $1 and paciente_id = $2',
        [opciones.clinicaId, opciones.pacienteId],
      );
      const base =
        opciones.versionBase !== undefined
          ? opciones.versionBase
          : (vigente.rows[0]?.version ?? null);
      const signos = opciones.signosVitales ?? {};
      const { rows } = await cliente.query<{ id: string; version: number }>(
        `select id, version from app.guardar_anamnesis($1, $2, coalesce($12, app.huella_catalogo()),
                                                        $3::jsonb, $4, $5, $6, $7, true,
                                                        $8, $9, $10, $11)`,
        [
          opciones.pacienteId,
          base,
          JSON.stringify(opciones.respuestas ?? []),
          opciones.tutor?.nombre ?? opciones.firmante ?? 'Paciente de prueba',
          opciones.tutor?.ci ?? null,
          opciones.tutor !== undefined,
          archivoId,
          signos.presionSistolica ?? null,
          signos.presionDiastolica ?? null,
          signos.pulso ?? null,
          signos.pesoKg ?? null,
          opciones.huellaCatalogo ?? null,
        ],
      );
      const fila = rows[0];
      if (!fila) throw new Error('No se pudo guardar la anamnesis de prueba.');
      return { anamnesisId: fila.id, version: fila.version, firmaArchivoId: archivoId };
    },
    SIN_VERIFICAR,
  );
}
