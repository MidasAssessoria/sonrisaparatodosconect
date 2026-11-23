/**
 * Pacientes, buscador global, grupo familiar y alertas manuales (Sprint 3, contrato/pacientes.ts).
 *
 * Todo corre en `enContexto` (RLS por clínica; la clínica sale solo del token verificado más la
 * membresía) y sobre las funciones de `@conecta/db`, que corren como app_api con las defensas de la
 * base (`app.proteger_pacientes`). Un id de otra clínica no existe para quien pregunta: 404.
 *
 * Datos clínicos:
 *   - La nota interna solo la ve quien tiene `ficha_clinica:ver` (la base la oculta por RLS; la API
 *     además la pone en null) y solo la cambia quien tiene `ficha_clinica:editar` y `ver`.
 *   - Las alertas inactivas solo se devuelven a quien tiene `ficha_clinica:ver`.
 *   - Abrir una ficha (`GET /pacientes/:id`) queda en auditoría como `ver`, en la misma transacción.
 *   Las altas, ediciones y bajas las audita la base (triggers).
 */
import { Injectable } from '@nestjs/common';
import {
  bajaRelacion,
  buscarPacientes,
  cambiarAlerta,
  crearAlerta,
  crearPaciente,
  crearRelacion,
  desactivarPaciente,
  editarPaciente,
  listarAlertas,
  listarPacientes,
  obtenerAlerta,
  obtenerPaciente,
  paciente,
  pacientesConCi,
  reactivarPaciente,
  registrarEvento,
  type TransaccionConecta,
} from '@conecta/db';
import {
  alertaManualSchema,
  paginaPacientesSchema,
  pacienteSchema,
  relacionSchema,
  resultadoBuscarSchema,
  type AlertaManual,
  type ConsultaPacientes,
  type CrearPaciente,
  type CrearRelacion,
  type EditarPaciente,
  type Paciente,
  type Relacion,
} from '@conecta/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import { tienePermiso, type ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';
import { ErrorCiDuplicada } from './ci-duplicada.js';

/** El buscador global no busca con menos de 2 caracteres (contrato). */
export const MINIMO_BUSCAR = 2;
/** Resultados del buscador global (contrato: hasta 6). */
export const LIMITE_BUSCAR = 6;

const pacienteNoEncontrado = () =>
  errores.noEncontrado('No encontramos ese paciente. Volvé a la lista y buscalo de nuevo.');
const familiarNoEncontrado = () =>
  errores.noEncontrado(
    'No encontramos a ese familiar entre los pacientes de la clínica. Buscalo de nuevo.',
  );
const alertaNoEncontrada = () =>
  errores.noEncontrado('No encontramos esa alerta. Recargá la ficha del paciente.');

/** ¿Ve la parte clínica (nota interna, alertas inactivas)? */
function veFichaClinica(ctx: ContextoPedido): boolean {
  return tienePermiso(ctx, 'ficha_clinica', 'ver');
}

@Injectable()
export class PacientesService {
  constructor(private readonly bd: ServicioBd) {}

  listar(
    ctx: ContextoPedido,
    consulta: ConsultaPacientes,
  ): Promise<z.infer<typeof paginaPacientesSchema>> {
    return this.bd.enContexto(ctx, async (tx) => {
      const pagina = await listarPacientes(tx, {
        texto: consulta.q ? consulta.q : undefined,
        filtro: consulta.filtro,
        cursor: consulta.cursor ?? null,
        limite: consulta.limite,
      });
      return paginaPacientesSchema.parse(pagina);
    });
  }

  /** Buscador global: hasta 6 activos; con menos de 2 caracteres, vacío (sin tocar la base). */
  async buscar(ctx: ContextoPedido, q: string): Promise<z.infer<typeof resultadoBuscarSchema>> {
    if ([...q.trim()].length < MINIMO_BUSCAR) return { pacientes: [] };
    return this.bd.enContexto(ctx, async (tx) => {
      const pacientes = await buscarPacientes(tx, q, { limite: LIMITE_BUSCAR });
      return resultadoBuscarSchema.parse({ pacientes });
    });
  }

  /** Abre la ficha: la devuelve y deja `ver` en la auditoría, en la misma transacción. */
  obtener(ctx: ContextoPedido, id: string): Promise<Paciente> {
    return this.bd.enContexto(ctx, async (tx) => {
      const ficha = await this.ficha(tx, ctx, id);
      await registrarEvento(tx, { accion: 'ver', entidad: 'paciente', entidadId: id });
      return ficha;
    });
  }

  crear(ctx: ContextoPedido, datos: CrearPaciente): Promise<Paciente> {
    const { confirmarCiDuplicada, ...alta } = datos;
    return this.bd.enContexto(ctx, async (tx) => {
      if (alta.ci && !confirmarCiDuplicada) await this.exigirCiLibre(tx, alta.ci, null);
      const id = await crearPaciente(tx, alta);
      return this.ficha(tx, ctx, id);
    });
  }

  editar(ctx: ContextoPedido, id: string, datos: EditarPaciente): Promise<Paciente> {
    const { confirmarCiDuplicada, ...cambios } = datos;
    // La ruta pide pacientes:editar; la nota interna es de la ficha clínica. Para reemplazarla hay
    // que poder verla (la base la oculta sin ficha_clinica:ver).
    if (
      cambios.notaInterna !== undefined &&
      !(tienePermiso(ctx, 'ficha_clinica', 'editar') && veFichaClinica(ctx))
    ) {
      throw errores.sinPermiso(
        'Tu rol no puede cambiar la nota interna: es parte de la ficha clínica. Pedíselo a un odontólogo o pedile acceso a quien administra la clínica.',
      );
    }
    return this.bd.enContexto(ctx, async (tx) => {
      const [actual] = await tx
        .select({ ci: paciente.ci })
        .from(paciente)
        .where(and(eq(paciente.clinicaId, ctx.clinicaId), eq(paciente.id, id)));
      if (!actual) throw pacienteNoEncontrado();
      if (typeof cambios.ci === 'string' && cambios.ci !== actual.ci && !confirmarCiDuplicada) {
        await this.exigirCiLibre(tx, cambios.ci, id);
      }
      if (!(await editarPaciente(tx, id, cambios))) throw pacienteNoEncontrado();
      return this.ficha(tx, ctx, id);
    });
  }

  desactivar(ctx: ContextoPedido, id: string, motivo: string): Promise<Paciente> {
    return this.bd.enContexto(ctx, async (tx) => {
      if (!(await desactivarPaciente(tx, id, motivo))) {
        throw errores.conflicto('Ese paciente ya está inactivo. Recargá la ficha.');
      }
      return this.ficha(tx, ctx, id);
    });
  }

  reactivar(ctx: ContextoPedido, id: string): Promise<Paciente> {
    return this.bd.enContexto(ctx, async (tx) => {
      if (!(await reactivarPaciente(tx, id))) {
        throw errores.conflicto('Ese paciente ya está activo. Recargá la ficha.');
      }
      return this.ficha(tx, ctx, id);
    });
  }

  /** Crea el vínculo y su espejo; responde la relación vista desde `pacienteId`. */
  crearRelacion(ctx: ContextoPedido, pacienteId: string, datos: CrearRelacion): Promise<Relacion> {
    return this.bd.enContexto(ctx, async (tx) => {
      const filas = await tx
        .select({ id: paciente.id })
        .from(paciente)
        .where(
          and(
            eq(paciente.clinicaId, ctx.clinicaId),
            inArray(paciente.id, [pacienteId, datos.familiarId]),
          ),
        );
      const ids = new Set(filas.map((f) => f.id));
      if (!ids.has(pacienteId)) throw pacienteNoEncontrado();
      if (!ids.has(datos.familiarId)) throw familiarNoEncontrado();
      // Consigo mismo, tipo y sexo, inactivos y par repetido: los decide la base (ver
      // errores/restricciones/pacientes.ts).
      const relacion = await crearRelacion(tx, {
        pacienteId,
        familiarId: datos.familiarId,
        tipo: datos.tipo,
        esTutorLegal: datos.esTutorLegal,
        esResponsablePago: datos.esResponsablePago,
      });
      return relacionSchema.parse(relacion);
    });
  }

  /** Da de baja el vínculo y su espejo; `id` es el de cualquiera de los dos lados. Idempotente. */
  quitarRelacion(ctx: ContextoPedido, id: string): Promise<void> {
    return this.bd.enContexto(ctx, async (tx) => {
      await bajaRelacion(tx, id);
    });
  }

  crearAlerta(ctx: ContextoPedido, pacienteId: string, texto: string): Promise<AlertaManual> {
    return this.bd.enContexto(ctx, async (tx) => {
      await this.exigirPaciente(tx, ctx, pacienteId);
      return alertaManualSchema.parse(await crearAlerta(tx, pacienteId, texto));
    });
  }

  /** Activa o desactiva (no se borra). Responde la alerta como queda. */
  cambiarAlerta(ctx: ContextoPedido, id: string, activa: boolean): Promise<AlertaManual> {
    return this.bd.enContexto(ctx, async (tx) => {
      await cambiarAlerta(tx, id, activa);
      const alerta = await obtenerAlerta(tx, id);
      if (!alerta) throw alertaNoEncontrada();
      return alertaManualSchema.parse(alerta);
    });
  }

  // -------------------------------------------------------------------------------------------

  /** La ficha tal como la puede ver quien pide, validada contra el contrato. */
  private async ficha(tx: TransaccionConecta, ctx: ContextoPedido, id: string): Promise<Paciente> {
    const ficha = await obtenerPaciente(tx, id);
    if (!ficha) throw pacienteNoEncontrado();
    const clinica = veFichaClinica(ctx);
    return pacienteSchema.parse({
      ...ficha,
      notaInterna: clinica ? ficha.notaInterna : null,
      alertas: clinica ? await listarAlertas(tx, id, { incluirInactivas: true }) : ficha.alertas,
    });
  }

  private async exigirPaciente(
    tx: TransaccionConecta,
    ctx: ContextoPedido,
    id: string,
  ): Promise<void> {
    const [fila] = await tx
      .select({ id: paciente.id })
      .from(paciente)
      .where(and(eq(paciente.clinicaId, ctx.clinicaId), eq(paciente.id, id)));
    if (!fila) throw pacienteNoEncontrado();
  }

  /** 409 con `existente` si otro paciente de la clínica ya tiene esa CI (activos primero). */
  private async exigirCiLibre(
    tx: TransaccionConecta,
    ci: string,
    excluirId: string | null,
  ): Promise<void> {
    const [existente] = await pacientesConCi(tx, ci, excluirId);
    if (existente) throw new ErrorCiDuplicada(existente);
  }
}
