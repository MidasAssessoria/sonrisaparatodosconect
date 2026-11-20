/**
 * Resuelve el contexto de un pedido con sesión. Es el límite de confianza entre el JWT y la base:
 * `app_api` puede fijar cualquier clínica, así que la clínica sale SOLO de una membresía activa del
 * usuario del token (comprobada acá), nunca de un parámetro de ruta, de la consulta o del cuerpo.
 *
 *   1. `X-Clinica-Id`, si viene, tiene que ser un UUID.
 *   2. Con solo el usuario en el contexto (`comoUsuario`), una consulta: su fila de `usuario` y sus
 *      clínicas con membresía activa. Sin fila o sin membresías → `sin_membresia`.
 *   3. Elegir clínica: la de la cabecera si está entre esas membresías (si no → `sin_membresia`);
 *      sin cabecera, la única; con varias, la más antigua solo para `GET /sesion`
 *      (si no → `clinica_requerida`).
 *   4. Con la clínica en el contexto (`enContexto`, que vuelve a comprobar la membresía con bloqueo
 *      compartido y si no lanza `ErrorDeMembresia`), en una transacción:
 *      a. una consulta: membresía, rol (con sus atributos), clínica, permisos y sedes visibles;
 *      b. `tocar_sesion` con la inactividad del rol: `vencida` → se CONFIRMA la transacción (para
 *         que el cierre quede) y recién después se responde `no_autenticado`; `cerrada` →
 *         `no_autenticado`; un `session_id` de otra persona → `no_autenticado` (`sesion_ajena`);
 *      c. nivel efectivo: aal2 solo si el token es aal2 y posterior a la última baja del factor;
 *         con aal2 y el factor apagado, `activar_mfa` (si la base dice que el token es viejo, aal1);
 *      d. el rol exige doble factor o el usuario lo tiene activo, y el nivel es aal1 →
 *         `mfa_requerido`, revirtiendo la transacción (la sesión no se crea ni se renueva hasta que
 *         pase el segundo factor);
 *      e. sesión `nueva` → `ingresar` en la auditoría (una sola vez por sesión).
 */
import { Injectable } from '@nestjs/common';
import {
  activarMfa,
  cerrarSesion,
  registrarEvento,
  tocarSesion,
  type TransaccionConecta,
} from '@conecta/db';
import { ACCIONES, ESTADOS_SEDE, MODULOS, idSchema } from '@conecta/shared';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import type { IdentidadToken, NivelAutenticacion } from '../auth/verificador-jwt.js';
import { errores } from '../errores/error-api.js';
import type { ContextoPedido } from './contexto-pedido.js';

export interface OpcionesResolver {
  /** Solo `GET /sesion`: sin cabecera y con varias membresías, usar la más antigua. */
  toleraSinClinica: boolean;
}

/** Valida la cabecera `X-Clinica-Id`. Ausente o vacía = null. */
export function clinicaDeCabecera(cabecera: string | string[] | undefined): string | null {
  if (cabecera === undefined || cabecera === '') return null;
  const valor = Array.isArray(cabecera) ? null : cabecera.trim();
  const resultado = idSchema.safeParse(valor);
  if (!resultado.success) {
    throw errores.datosInvalidos(
      'La clínica elegida no es válida. Volvé a elegir la clínica e intentá de nuevo.',
      [{ campo: 'X-Clinica-Id', mensaje: 'Tiene que ser el identificador de una clínica.' }],
    );
  }
  return resultado.data.toLowerCase();
}

/** Fila del paso previo (usuario y sus clínicas). Los json_agg los arma la base. */
const filaUsuarioSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  email: z.string(),
  mfa_activo: z.boolean(),
  /** El token es posterior a la última baja del doble factor (o nunca hubo baja). */
  token_posterior_a_baja: z.boolean(),
  clinicas: z.array(z.object({ id: z.string(), nombre: z.string() })),
});

/** Fila del paso con clínica: membresía, rol, clínica, permisos y sedes visibles. */
const filaMembresiaSchema = z.object({
  membresia_id: z.string(),
  sede_defecto_id: z.string().nullable(),
  rol_id: z.string(),
  rol_codigo: z.string(),
  rol_nombre: z.string(),
  todas_las_sedes: z.boolean(),
  exige_mfa: z.boolean(),
  inactividad_min: z.number().int(),
  clinica_nombre: z.string(),
  zona_horaria: z.string(),
  permisos: z.array(z.object({ modulo: z.enum(MODULOS), accion: z.enum(ACCIONES) })),
  sedes: z.array(
    z.object({
      id: z.string(),
      nombre: z.string(),
      estado: z.enum(ESTADOS_SEDE),
      color: z.string().nullable(),
    }),
  ),
});
type FilaMembresia = z.infer<typeof filaMembresiaSchema>;

/** Resultado de la transacción del paso 4 (lo que hay que hacer después del commit). */
type ResultadoPaso =
  | { tipo: 'vencida'; inactividadMin: number }
  | { tipo: 'lista'; m: FilaMembresia; nivel: NivelAutenticacion; mfaActivo: boolean };

@Injectable()
export class ResolvedorContexto {
  constructor(private readonly bd: ServicioBd) {}

  async resolver(
    identidad: IdentidadToken,
    cabeceraClinica: string | string[] | undefined,
    ip: string | null,
    opciones: OpcionesResolver,
  ): Promise<ContextoPedido> {
    const pedida = clinicaDeCabecera(cabeceraClinica);
    const usuarioId = identidad.usuarioId;

    // Paso previo, sin clínica en el contexto: RLS solo deja ver lo propio.
    const fila = await this.bd.comoUsuario(usuarioId, ip, async (tx) => {
      const { rows } = await tx.execute(sql`
        select u.id, u.nombre, u.email, u.mfa_activo,
               (u.mfa_desactivado_en is null
                or ${identidad.emitidoEn.toISOString()}::timestamptz > u.mfa_desactivado_en)
                 as token_posterior_a_baja,
               coalesce((
                 select json_agg(json_build_object('id', c.id, 'nombre', c.nombre)
                                 order by m.created_at, m.id)
                 from app.membresia m join app.clinica c on c.id = m.clinica_id
                 where m.usuario_id = u.id and m.estado = 'activo' and c.activo
               ), '[]'::json) as clinicas
        from app.usuario u
        where u.id = ${usuarioId}`);
      return rows[0] === undefined ? null : filaUsuarioSchema.parse(rows[0]);
    });

    if (!fila || fila.clinicas.length === 0) {
      throw errores.sinMembresia(
        'Tu usuario no tiene acceso activo a ninguna clínica. Pedile a quien administra tu clínica que te habilite.',
      );
    }

    let clinicaId: string;
    if (pedida) {
      if (!fila.clinicas.some((c) => c.id === pedida)) throw errores.sinMembresia();
      clinicaId = pedida;
    } else if (fila.clinicas.length === 1 || opciones.toleraSinClinica) {
      clinicaId = (fila.clinicas[0] as { id: string }).id;
    } else {
      throw errores.clinicaRequerida();
    }

    // aal2 solo si el token es posterior a la última baja del doble factor.
    const nivelToken: NivelAutenticacion =
      identidad.nivel === 'aal2' && fila.token_posterior_a_baja ? 'aal2' : 'aal1';

    const contextoBd = { clinicaId, usuarioId, ip };
    const paso = await this.bd.enContexto(contextoBd, async (tx): Promise<ResultadoPaso> => {
      const m = await this.membresia(tx, clinicaId, usuarioId);
      if (!m) throw errores.sinMembresia();

      const sesion = await tocarSesion(tx, identidad.sesionId, m.inactividad_min);
      // Con `vencida` la base ya cerró la sesión: hay que confirmar, no lanzar acá.
      if (sesion === 'vencida') return { tipo: 'vencida', inactividadMin: m.inactividad_min };
      if (sesion === 'cerrada') {
        throw errores.noAutenticado('Tu sesión ya está cerrada. Ingresá de nuevo.');
      }

      let nivel = nivelToken;
      let mfaActivo = fila.mfa_activo;
      if (nivel === 'aal2' && !mfaActivo) {
        if (await activarMfa(tx, identidad.emitidoEn)) mfaActivo = true;
        else nivel = 'aal1';
      }
      if ((m.exige_mfa || mfaActivo) && nivel !== 'aal2') {
        // Se revierte todo: ni la sesión ni el ingreso quedan hasta pasar el segundo factor.
        throw errores.mfaRequerido(
          mfaActivo
            ? undefined
            : 'Tu rol exige doble factor: activalo y confirmá el código de tu aplicación para seguir.',
        );
      }

      if (sesion === 'nueva') {
        await registrarEvento(tx, {
          accion: 'ingresar',
          entidad: 'sesion',
          entidadId: identidad.sesionId,
        });
      }
      return { tipo: 'lista', m, nivel, mfaActivo };
    });

    if (paso.tipo === 'vencida') {
      throw errores.noAutenticado(
        `Tu sesión se cerró porque pasaron más de ${String(paso.inactividadMin)} minutos sin actividad. Ingresá de nuevo.`,
      );
    }

    const { m, nivel, mfaActivo } = paso;
    const sedesPermitidas = m.sedes.map((s) => s.id);
    return {
      ...contextoBd,
      membresiaId: m.membresia_id,
      sesionId: identidad.sesionId,
      nivel,
      usuario: { id: fila.id, nombre: fila.nombre, email: fila.email, mfaActivo },
      clinica: { id: clinicaId, nombre: m.clinica_nombre, zonaHoraria: m.zona_horaria },
      clinicas: fila.clinicas,
      rol: { id: m.rol_id, codigo: m.rol_codigo, nombre: m.rol_nombre, exigeMfa: m.exige_mfa },
      permisos: m.permisos,
      todasLasSedes: m.todas_las_sedes,
      inactividadMin: m.inactividad_min,
      sedes: m.sedes,
      sedesPermitidas,
      sedeDefectoId:
        m.sede_defecto_id && sedesPermitidas.includes(m.sede_defecto_id) ? m.sede_defecto_id : null,
      puedeVerTodasLasSedes: m.sedes.length > 1,
    };
  }

  /**
   * `POST /sesion/cerrar`: cierra la sesión del token. Solo con el usuario en el contexto (la sesión
   * es global, como el usuario): funciona sin clínica, sin membresía y con aal1. Un usuario sin fila
   * en `usuario` no puede tener sesiones (nunca pasó el paso 2): no hay nada que cerrar.
   */
  async cerrarSesion(identidad: IdentidadToken, ip: string | null): Promise<void> {
    await this.bd.comoUsuario(identidad.usuarioId, ip, async (tx) => {
      const { rows } = await tx.execute(
        sql`select 1 as existe from app.usuario u where u.id = app.usuario_actual()`,
      );
      if (rows.length === 0) return;
      await cerrarSesion(tx, identidad.sesionId);
    });
  }

  /**
   * Membresía activa con su rol, la clínica, los permisos activos del rol (ninguno si el rol está
   * desactivado) y las sedes no dadas de baja que puede ver: todas si el rol tiene
   * `todas_las_sedes`; si no, las de `usuario_sede` activas más su sede por defecto.
   */
  private async membresia(
    tx: TransaccionConecta,
    clinicaId: string,
    usuarioId: string,
  ): Promise<FilaMembresia | null> {
    const { rows } = await tx.execute(sql`
      select m.id as membresia_id, m.sede_defecto_id,
             r.id as rol_id, r.codigo as rol_codigo, r.nombre as rol_nombre,
             r.todas_las_sedes, r.exige_mfa, r.inactividad_min,
             c.nombre as clinica_nombre, c.zona_horaria,
             coalesce((
               select json_agg(json_build_object('modulo', p.modulo, 'accion', p.accion)
                               order by p.modulo, p.accion)
               from app.rol_permiso p
               where p.clinica_id = m.clinica_id and p.rol_id = r.id and p.activo and r.activo
             ), '[]'::json) as permisos,
             coalesce((
               select json_agg(json_build_object('id', s.id, 'nombre', s.nombre,
                                                 'estado', s.estado, 'color', s.color)
                               order by s.nombre, s.id)
               from app.sede s
               where s.clinica_id = m.clinica_id and s.deleted_at is null
                 and (r.todas_las_sedes or s.id = m.sede_defecto_id or exists (
                   select 1 from app.usuario_sede us
                   where us.clinica_id = m.clinica_id and us.membresia_id = m.id
                     and us.sede_id = s.id and us.activo))
             ), '[]'::json) as sedes
      from app.membresia m
      join app.rol r on r.clinica_id = m.clinica_id and r.id = m.rol_id
      join app.clinica c on c.id = m.clinica_id
      where m.clinica_id = ${clinicaId} and m.usuario_id = ${usuarioId}
        and m.estado = 'activo' and c.activo`);
    return rows[0] === undefined ? null : filaMembresiaSchema.parse(rows[0]);
  }
}
