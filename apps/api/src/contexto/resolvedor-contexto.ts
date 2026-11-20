/**
 * Resuelve el contexto de un pedido con sesión. Es el límite de confianza entre el JWT y la base:
 * `app_api` puede fijar cualquier clínica, así que la clínica sale SOLO de una membresía activa del
 * usuario del token (comprobada acá), nunca de un parámetro de ruta, de la consulta o del cuerpo.
 *
 *   1. `X-Clinica-Id`, si viene, tiene que ser un UUID.
 *   2. Con solo el usuario en el contexto (`conUsuario`): su fila de `usuario` y sus membresías
 *      activas en clínicas activas. Sin fila o sin membresías → `sin_membresia`.
 *   3. Elegir clínica: la de la cabecera si está entre esas membresías (si no → `sin_membresia`);
 *      sin cabecera, la única; con varias, la más antigua solo para `GET /sesion`
 *      (si no → `clinica_requerida`).
 *   4. Con la clínica en el contexto (`conContexto`): se vuelve a comprobar la membresía (por si
 *      cambió entre transacciones) y se cargan rol, permisos y sedes visibles. Si el token es aal2,
 *      se marca `mfa_activo`.
 */
import { Injectable } from '@nestjs/common';
import {
  clinica,
  membresia,
  rol,
  rolPermiso,
  sede,
  usuario,
  usuarioSede,
  type TransaccionConecta,
} from '@conecta/db';
import { idSchema, type Permiso } from '@conecta/shared';
import { and, asc, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { ServicioBd } from '../base/servicio-bd.js';
import type { IdentidadToken } from '../auth/verificador-jwt.js';
import { errores } from '../errores/error-api.js';
import { ROLES_TODAS_LAS_SEDES, type ContextoPedido, type SedeVisible } from './contexto-pedido.js';

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
    const { fila, membresias } = await this.bd.comoUsuario(usuarioId, ip, async (tx) => {
      const [fila] = await tx
        .select({
          id: usuario.id,
          nombre: usuario.nombre,
          email: usuario.email,
          mfaActivo: usuario.mfaActivo,
        })
        .from(usuario)
        .where(eq(usuario.id, usuarioId));
      const membresias = await tx
        .select({ id: clinica.id, nombre: clinica.nombre })
        .from(membresia)
        .innerJoin(clinica, eq(clinica.id, membresia.clinicaId))
        .where(
          and(
            eq(membresia.usuarioId, usuarioId),
            eq(membresia.estado, 'activo'),
            eq(clinica.activo, true),
          ),
        )
        .orderBy(asc(membresia.createdAt), asc(membresia.id));
      return { fila, membresias };
    });

    if (!fila || membresias.length === 0) {
      throw errores.sinMembresia(
        'Tu usuario no tiene acceso activo a ninguna clínica. Pedile a quien administra tu clínica que te habilite.',
      );
    }

    let clinicaId: string;
    if (pedida) {
      if (!membresias.some((m) => m.id === pedida)) throw errores.sinMembresia();
      clinicaId = pedida;
    } else if (membresias.length === 1 || opciones.toleraSinClinica) {
      clinicaId = (membresias[0] as { id: string }).id;
    } else {
      throw errores.clinicaRequerida();
    }

    const contextoBd = { clinicaId, usuarioId, ip };
    const detalle = await this.bd.enContexto(contextoBd, async (tx) => {
      const [m] = await tx
        .select({
          membresiaId: membresia.id,
          sedeDefectoId: membresia.sedeDefectoId,
          rolId: rol.id,
          rolCodigo: rol.codigo,
          rolNombre: rol.nombre,
          rolActivo: rol.activo,
          clinicaNombre: clinica.nombre,
          zonaHoraria: clinica.zonaHoraria,
        })
        .from(membresia)
        .innerJoin(rol, and(eq(rol.id, membresia.rolId), eq(rol.clinicaId, membresia.clinicaId)))
        .innerJoin(clinica, eq(clinica.id, membresia.clinicaId))
        .where(
          and(
            eq(membresia.clinicaId, clinicaId),
            eq(membresia.usuarioId, usuarioId),
            eq(membresia.estado, 'activo'),
            eq(clinica.activo, true),
          ),
        );
      if (!m) throw errores.sinMembresia();

      const permisos: Permiso[] = m.rolActivo
        ? await tx
            .select({ modulo: rolPermiso.modulo, accion: rolPermiso.accion })
            .from(rolPermiso)
            .where(and(eq(rolPermiso.rolId, m.rolId), eq(rolPermiso.activo, true)))
            .orderBy(asc(rolPermiso.modulo), asc(rolPermiso.accion))
        : [];

      const todasLasSedes = ROLES_TODAS_LAS_SEDES.includes(m.rolCodigo);
      const sedes = await this.sedesVisibles(
        tx,
        clinicaId,
        m.membresiaId,
        m.sedeDefectoId,
        todasLasSedes,
      );

      let mfaActivo = fila.mfaActivo;
      if (identidad.nivel === 'aal2' && !mfaActivo) {
        await tx.update(usuario).set({ mfaActivo: true }).where(eq(usuario.id, usuarioId));
        mfaActivo = true;
      }
      return { m, permisos, todasLasSedes, sedes, mfaActivo };
    });

    const { m, permisos, todasLasSedes, sedes, mfaActivo } = detalle;
    const sedesPermitidas = sedes.map((s) => s.id);
    return {
      ...contextoBd,
      membresiaId: m.membresiaId,
      nivel: identidad.nivel,
      usuario: { id: fila.id, nombre: fila.nombre, email: fila.email, mfaActivo },
      clinica: { id: clinicaId, nombre: m.clinicaNombre, zonaHoraria: m.zonaHoraria },
      clinicas: membresias,
      rol: { id: m.rolId, codigo: m.rolCodigo, nombre: m.rolNombre },
      permisos,
      todasLasSedes,
      sedes,
      sedesPermitidas,
      sedeDefectoId:
        m.sedeDefectoId && sedesPermitidas.includes(m.sedeDefectoId) ? m.sedeDefectoId : null,
      puedeVerTodasLasSedes: sedes.length > 1,
    };
  }

  private async sedesVisibles(
    tx: TransaccionConecta,
    clinicaId: string,
    membresiaId: string,
    sedeDefectoId: string | null,
    todas: boolean,
  ): Promise<SedeVisible[]> {
    const condiciones: SQL[] = [eq(sede.clinicaId, clinicaId), isNull(sede.deletedAt)];
    if (!todas) {
      const asignadas = tx
        .select({ id: usuarioSede.sedeId })
        .from(usuarioSede)
        .where(and(eq(usuarioSede.membresiaId, membresiaId), eq(usuarioSede.activo, true)));
      const alcance = sedeDefectoId
        ? or(inArray(sede.id, asignadas), eq(sede.id, sedeDefectoId))
        : inArray(sede.id, asignadas);
      if (alcance) condiciones.push(alcance);
    }
    return tx
      .select({ id: sede.id, nombre: sede.nombre, estado: sede.estado, color: sede.color })
      .from(sede)
      .where(and(...condiciones))
      .orderBy(asc(sede.nombre), asc(sede.id));
  }
}
