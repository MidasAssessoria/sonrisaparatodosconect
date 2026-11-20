/** Escenario con datos en todas las tablas de una clínica, para las pruebas de aislamiento. */
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  crearClinicaDePrueba,
  crearInvitacionDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, valor } from './ayudas.js';

const hashAlAzar = (): string => randomBytes(32).toString('hex');

export interface DatosClinica extends ClinicaDePrueba {
  /** Invitación abierta (de una membresía pendiente sin usuario). */
  invitacionId: string;
  /** Membresía pendiente, sin usuario y SIN invitación: sirve para insertar una invitación. */
  membresiaLibreId: string;
  /** Profesional asociado a la membresía de `usuarioId`. */
  profesionalId: string;
  disponibilidadId: string;
  bloqueoId: string;
  tratamientoId: string;
  agendaConfigId: string;
  archivoId: string;
  sedeId: string;
  sillonId: string;
  horarioId: string;
  rolId: string;
  rolPermisoId: string;
  membresiaId: string;
  /** Membresía del dueño. */
  membresiaDuenoId: string;
  usuarioSedeId: string;
  numeradorId: string;
  auditId: string;
  /** Usuario que solo pertenece a esta clínica (rol recepcion). */
  usuarioId: string;
  /** Otra persona de la clínica (rol asistente), sin sedes asignadas. */
  otroUsuarioId: string;
  otraMembresiaId: string;
}

export async function poblarClinica(admin: pg.Pool): Promise<DatosClinica> {
  const clinica = await crearClinicaDePrueba(admin);
  const miembro = await crearUsuarioDePrueba(admin, { clinicaId: clinica.clinicaId });
  const otro = await crearUsuarioDePrueba(admin, {
    clinicaId: clinica.clinicaId,
    rol: 'asistente',
  });
  const { sedeId, sillonId } = await crearSedeDePrueba(admin, clinica.clinicaId);
  const invitacion = await crearInvitacionDePrueba(admin, { clinicaId: clinica.clinicaId });
  return enTransaccion(
    admin,
    { clinica: clinica.clinicaId, usuario: clinica.duenoId },
    async (c) => {
      const horarioId = await valor<string>(
        c,
        `insert into app.sede_horario (clinica_id, sede_id, dia_semana, hora_inicio, hora_fin)
         values ($1, $2, 1, '08:00', '12:00') returning id`,
        [clinica.clinicaId, sedeId],
      );
      const usuarioSedeId = await valor<string>(
        c,
        `insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3) returning id`,
        [clinica.clinicaId, miembro.membresiaId, sedeId],
      );
      await c.query("select app.siguiente_numero('recibo')");
      const numeradorId = await valor<string>(
        c,
        "select id from app.numerador where clinica_id = $1 and tipo = 'recibo'",
        [clinica.clinicaId],
      );
      const rolPermisoId = await valor<string>(
        c,
        'select id from app.rol_permiso where rol_id = $1 order by modulo, accion limit 1',
        [clinica.roles.recepcion],
      );
      const membresiaDuenoId = await valor<string>(
        c,
        'select id from app.membresia where clinica_id = $1 and usuario_id = $2',
        [clinica.clinicaId, clinica.duenoId],
      );
      const auditId = await valor<string>(
        c,
        'select id from app.audit_log where clinica_id = $1 order by fecha limit 1',
        [clinica.clinicaId],
      );
      const membresiaLibreId = await valor<string>(
        c,
        `insert into app.membresia (clinica_id, rol_id) values ($1, $2) returning id`,
        [clinica.clinicaId, clinica.roles.asistente],
      );
      const profesionalId = await valor<string>(
        c,
        `insert into app.profesional (clinica_id, membresia_id, nombre, especialidad, color)
         values ($1, $2, 'Dra. Escenario', 'Ortodoncia', '#8B5CF6') returning id`,
        [clinica.clinicaId, miembro.membresiaId],
      );
      const disponibilidadId = await valor<string>(
        c,
        `insert into app.profesional_disponibilidad
           (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin, sillon_id)
         values ($1, $2, $3, 1, '08:00', '12:00', $4) returning id`,
        [clinica.clinicaId, profesionalId, sedeId, sillonId],
      );
      const bloqueoId = await valor<string>(
        c,
        `insert into app.profesional_bloqueo (clinica_id, profesional_id, desde, hasta, motivo)
         values ($1, $2, now() + interval '1 day', now() + interval '2 days', 'Congreso') returning id`,
        [clinica.clinicaId, profesionalId],
      );
      const tratamientoId = await valor<string>(
        c,
        `insert into app.tratamiento (clinica_id, nombre, precio, iva, duracion_min)
         values ($1, 'Limpieza dental', 250000, 10, 30) returning id`,
        [clinica.clinicaId],
      );
      const agendaConfigId = await valor<string>(
        c,
        'insert into app.agenda_config (clinica_id, sede_id) values ($1, $2) returning id',
        [clinica.clinicaId, sedeId],
      );
      const archivoId = await valor<string>(
        c,
        `insert into app.archivo (clinica_id, categoria, almacen, bucket, ruta, nombre_original,
                                  tipo, bytes, ancho, alto, sha256)
         values ($1, 'logo_clinica', 'local', 'pruebas', $2, 'logo.png', 'image/png', 2048, 64, 64, $3)
         returning id`,
        [clinica.clinicaId, `${clinica.clinicaId}/logo_clinica/${randomUUID()}.png`, hashAlAzar()],
      );
      return {
        ...clinica,
        invitacionId: invitacion.invitacionId,
        membresiaLibreId,
        profesionalId,
        disponibilidadId,
        bloqueoId,
        tratamientoId,
        agendaConfigId,
        archivoId,
        sedeId,
        sillonId,
        horarioId,
        rolId: clinica.roles.recepcion,
        rolPermisoId,
        membresiaId: miembro.membresiaId,
        membresiaDuenoId,
        usuarioSedeId,
        numeradorId,
        auditId,
        usuarioId: miembro.usuarioId,
        otroUsuarioId: otro.usuarioId,
        otraMembresiaId: otro.membresiaId,
      };
    },
    { confirmar: true },
  );
}

/** Tablas de negocio (con clinica_id) y cómo crear/editar/dar de baja una fila de cada una. */
export interface CasoTabla {
  tabla: string;
  /** Id de la fila de la clínica dada. */
  id: (d: DatosClinica) => string;
  /** SET de una edición inofensiva. null si app_api no tiene UPDATE. */
  editar: string | null;
  /** SET de una baja lógica. null si la tabla no tiene baja. */
  baja: string | null;
  /** INSERT válido para la clínica `d` (null si app_api no tiene INSERT). */
  insertar: ((d: DatosClinica) => [string, unknown[]]) | null;
  /**
   * INSERT con clinica_id de `propia` pero que referencia filas de `ajena` por FK.
   * null si la tabla no tiene FK a otra tabla de negocio o app_api no puede insertar.
   */
  referenciarAjena: ((propia: DatosClinica, ajena: DatosClinica) => [string, unknown[]]) | null;
}

export const CASOS: CasoTabla[] = [
  {
    tabla: 'sede',
    id: (d) => d.sedeId,
    editar: "nombre = nombre || ' (editada)'",
    baja: "deleted_at = now(), motivo_baja = 'ataque'",
    insertar: (d) => [
      'insert into app.sede (clinica_id, nombre) values ($1, $2)',
      [d.clinicaId, 'Sede X'],
    ],
    referenciarAjena: null,
  },
  {
    tabla: 'sede_horario',
    id: (d) => d.horarioId,
    editar: 'intervalo_min = 15',
    baja: 'activo = false',
    insertar: (d) => [
      `insert into app.sede_horario (clinica_id, sede_id, dia_semana, hora_inicio, hora_fin)
       values ($1, $2, 2, '08:00', '09:00')`,
      [d.clinicaId, d.sedeId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.sede_horario (clinica_id, sede_id, dia_semana, hora_inicio, hora_fin)
       values ($1, $2, 2, '08:00', '09:00')`,
      [p.clinicaId, a.sedeId],
    ],
  },
  {
    tabla: 'sillon',
    id: (d) => d.sillonId,
    editar: "nombre = 'Sillón editado'",
    baja: 'activo = false',
    insertar: (d) => [
      'insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, $3)',
      [d.clinicaId, d.sedeId, 'Sillón X'],
    ],
    referenciarAjena: (p, a) => [
      'insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, $3)',
      [p.clinicaId, a.sedeId, 'Sillón X'],
    ],
  },
  {
    tabla: 'rol',
    id: (d) => d.rolId,
    editar: "nombre = 'Rol editado'",
    baja: 'activo = false',
    insertar: (d) => [
      'insert into app.rol (clinica_id, nombre, codigo) values ($1, $2, $3)',
      [d.clinicaId, 'Rol X', 'rol_x'],
    ],
    referenciarAjena: null,
  },
  {
    tabla: 'rol_permiso',
    id: (d) => d.rolPermisoId,
    editar: null,
    baja: 'activo = false',
    insertar: (d) => [
      `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion) values ($1, $2, 'auditoria', 'exportar')`,
      [d.clinicaId, d.rolId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.rol_permiso (clinica_id, rol_id, modulo, accion) values ($1, $2, 'auditoria', 'exportar')`,
      [p.clinicaId, a.rolId],
    ],
  },
  {
    tabla: 'membresia',
    id: (d) => d.membresiaId,
    editar: 'sede_defecto_id = null',
    baja: "estado = 'inactivo'",
    // Desde 0010 una membresía nace sin usuario (lo recibe al aceptar la invitación).
    insertar: (d) => [
      `insert into app.membresia (clinica_id, rol_id) values ($1, $2)`,
      [d.clinicaId, d.rolId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.membresia (clinica_id, rol_id) values ($1, $2)`,
      [p.clinicaId, a.rolId],
    ],
  },
  {
    tabla: 'usuario_sede',
    id: (d) => d.usuarioSedeId,
    editar: null,
    baja: 'activo = false',
    // La de otra persona: las propias sedes no se asignan (app.proteger_acceso).
    insertar: (d) => [
      'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
      [d.clinicaId, d.otraMembresiaId, d.sedeId],
    ],
    referenciarAjena: (p, a) => [
      'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
      [p.clinicaId, p.membresiaId, a.sedeId],
    ],
  },
  {
    tabla: 'invitacion',
    id: (d) => d.invitacionId,
    // app_api solo puede anular (UPDATE por columna de anulada_en y motivo_anulacion).
    editar: null,
    baja: "anulada_en = now(), motivo_anulacion = 'ataque'",
    insertar: (d) => [
      `insert into app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en)
       values ($1, $2, $3, 'Invitada X', $4, now() + interval '1 day')`,
      [d.clinicaId, d.membresiaLibreId, `x-${randomUUID()}@prueba.test`, hashAlAzar()],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.invitacion (clinica_id, membresia_id, email, nombre, token_hash, vence_en)
       values ($1, $2, $3, 'Invitada X', $4, now() + interval '1 day')`,
      [p.clinicaId, a.membresiaLibreId, `x-${randomUUID()}@prueba.test`, hashAlAzar()],
    ],
  },
  {
    tabla: 'profesional',
    id: (d) => d.profesionalId,
    editar: "especialidad = 'Editada'",
    baja: 'activo = false',
    insertar: (d) => [
      "insert into app.profesional (clinica_id, nombre, color) values ($1, 'Prof X', '#123456')",
      [d.clinicaId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.profesional (clinica_id, membresia_id, nombre, color)
       values ($1, $2, 'Prof X', '#123456')`,
      [p.clinicaId, a.otraMembresiaId],
    ],
  },
  {
    tabla: 'profesional_disponibilidad',
    id: (d) => d.disponibilidadId,
    // Un tramo no se edita: se desactiva y se crea otro.
    editar: null,
    baja: 'activo = false',
    insertar: (d) => [
      `insert into app.profesional_disponibilidad
         (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin)
       values ($1, $2, $3, 2, '08:00', '09:00')`,
      [d.clinicaId, d.profesionalId, d.sedeId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.profesional_disponibilidad
         (clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin)
       values ($1, $2, $3, 2, '08:00', '09:00')`,
      [p.clinicaId, p.profesionalId, a.sedeId],
    ],
  },
  {
    tabla: 'profesional_bloqueo',
    id: (d) => d.bloqueoId,
    editar: null,
    baja: "deleted_at = now(), motivo_baja = 'ataque'",
    insertar: (d) => [
      `insert into app.profesional_bloqueo (clinica_id, profesional_id, desde, hasta, motivo)
       values ($1, $2, now(), now() + interval '1 hour', 'Prueba')`,
      [d.clinicaId, d.profesionalId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.profesional_bloqueo (clinica_id, profesional_id, desde, hasta, motivo)
       values ($1, $2, now(), now() + interval '1 hour', 'Prueba')`,
      [p.clinicaId, a.profesionalId],
    ],
  },
  {
    tabla: 'tratamiento',
    id: (d) => d.tratamientoId,
    editar: 'precio = precio + 1',
    baja: 'activo = false',
    insertar: (d) => [
      'insert into app.tratamiento (clinica_id, nombre, precio) values ($1, $2, 1000)',
      [d.clinicaId, `Tratamiento ${randomUUID()}`],
    ],
    referenciarAjena: null,
  },
  {
    tabla: 'agenda_config',
    id: (d) => d.agendaConfigId,
    editar: 'dias_adelante = 30',
    baja: null,
    // Como la API: reemplazar la configuración de la sede (upsert por sede).
    insertar: (d) => [
      `insert into app.agenda_config (clinica_id, sede_id, dias_adelante) values ($1, $2, 21)
       on conflict (clinica_id, sede_id) do update set dias_adelante = excluded.dias_adelante`,
      [d.clinicaId, d.sedeId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.agenda_config (clinica_id, sede_id, dias_adelante) values ($1, $2, 21)
       on conflict (clinica_id, sede_id) do update set dias_adelante = excluded.dias_adelante`,
      [p.clinicaId, a.sedeId],
    ],
  },
  {
    tabla: 'archivo',
    id: (d) => d.archivoId,
    // Metadatos inmutables: solo baja.
    editar: null,
    baja: "deleted_at = now(), motivo_baja = 'ataque'",
    insertar: (d) => [
      `insert into app.archivo (clinica_id, categoria, almacen, bucket, ruta, nombre_original, tipo,
                                bytes, sha256)
       values ($1, 'logo_clinica', 'local', 'pruebas', $2, 'x.png', 'image/png', 10, $3)`,
      [d.clinicaId, `${d.clinicaId}/logo_clinica/${randomUUID()}.png`, hashAlAzar()],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.archivo (clinica_id, categoria, sede_id, almacen, bucket, ruta,
                                nombre_original, tipo, bytes, sha256)
       values ($1, 'logo_clinica', $2, 'local', 'pruebas', $3, 'x.png', 'image/png', 10, $4)`,
      [p.clinicaId, a.sedeId, `${p.clinicaId}/logo_clinica/${randomUUID()}.png`, hashAlAzar()],
    ],
  },
  {
    tabla: 'numerador',
    id: (d) => d.numeradorId,
    editar: 'ultimo = 0',
    baja: null,
    insertar: null,
    referenciarAjena: null,
  },
  {
    tabla: 'audit_log',
    id: (d) => d.auditId,
    editar: "entidad = 'falsa'",
    baja: null,
    insertar: null,
    referenciarAjena: null,
  },
];
