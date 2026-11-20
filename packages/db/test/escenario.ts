/** Escenario con datos en todas las tablas de una clínica, para las pruebas de aislamiento. */
import type pg from 'pg';
import {
  crearClinicaDePrueba,
  crearSedeDePrueba,
  crearUsuarioDePrueba,
  type ClinicaDePrueba,
} from '../src/pruebas/index.js';
import { enTransaccion, valor } from './ayudas.js';

export interface DatosClinica extends ClinicaDePrueba {
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
      return {
        ...clinica,
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
    insertar: (d) => [
      `insert into app.membresia (clinica_id, usuario_id, rol_id) values ($1, $2, $3)`,
      [d.clinicaId, d.duenoId, d.rolId],
    ],
    referenciarAjena: (p, a) => [
      `insert into app.membresia (clinica_id, usuario_id, rol_id) values ($1, $2, $3)`,
      [p.clinicaId, a.duenoId, a.rolId],
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
