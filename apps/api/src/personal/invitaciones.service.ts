/**
 * Invitaciones: alta, reenvío y anulación (con sesión, en `enContexto`), y las dos rutas públicas
 * que usa la persona invitada: consultar y aceptar (en `sinContexto`: la base resuelve la clínica
 * por el hash del token). Contrato: `packages/shared/src/contrato/personal.ts` («solo quien
 * controla el correo invitado puede usarla»).
 *
 * El token: 32 bytes aleatorios en base64url. La base guarda solo su SHA-256; el token en claro sale
 * en el enlace de la respuesta de crear o de reenviar (una vez) y en el `redirectTo` del correo de
 * Supabase, y no se registra en ningún lado.
 *
 * AVISO POR CORREO (crear y reenviar). Hace falta el correo de Supabase salvo que el correo ya tenga
 * una cuenta confirmada:
 *   1. Si el correo ya es de un usuario del sistema (`app.usuario`: aceptó alguna invitación con su
 *      correo confirmado), no se llama a la Admin API: entra con su contraseña.
 *   2. Si no, `inviteUserByEmail` con vuelta a `<WEB_ORIGEN_PUBLICO>/invitacion?token=…`. Supabase
 *      crea la cuenta sin confirmar (o reenvía si ya existe sin confirmar) y responde «ya existe» si
 *      está confirmada: entonces no se manda nada, salvo que esa cuenta haya nacido de una
 *      invitación y nunca haya aceptado ninguna (paso 1 no la encontró): su enlace de invitación ya
 *      se usó, así que se le manda un enlace de ingreso (magic link) a la misma vuelta.
 *   COMPENSACIÓN: el pedido a Supabase va DENTRO de la transacción, después de todas las escrituras
 *   (si la base rechaza algo, no sale ningún correo). Si Supabase falla, la transacción se revierte
 *   y la invitación no queda (503: probá de nuevo). Si Supabase mandó el correo y después falla el
 *   COMMIT (raro), queda un correo con un enlace que responde «no sirve» y, si era nueva, una cuenta
 *   sin confirmar en Auth: no da acceso a nada y la próxima invitación la reutiliza.
 *   Sin clave secreta: si hace falta el correo, 503 y la invitación no se crea.
 *
 * SIGUIENTE PASO (consultar): `cuenta_existente` si el correo tiene una cuenta CONFIRMADA que no nació
 * de una invitación, o si ya es usuario del sistema; `revisa_tu_correo` en el resto. Una cuenta que
 * nació de una invitación (`invited_at` en Auth, o la marca `conecta_invitacion` en sus metadatos)
 * sigue dando `revisa_tu_correo` aunque ya esté confirmada, hasta que acepte alguna invitación (y
 * tenga fila en `app.usuario`): quien vuelve desde el correo tiene que poder elegir su contraseña.
 *
 * FRONTERA DE CONFIANZA (aceptar): `app.aceptar_invitacion` confía en el usuario y el correo que le
 * pasa la API. Salen SOLO del JWT verificado (`sub` y `email`), y además la Admin API tiene que
 * decir que esa cuenta existe, tiene ese mismo correo y lo tiene confirmado. Nunca del cuerpo (el
 * esquema del contrato descarta cualquier otro campo). Se acepta con aal1.
 */
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  aceptarInvitacion,
  anularInvitacion,
  consultarInvitacion,
  crearInvitacion,
  hashTokenInvitacion,
  reenviarInvitacion,
  registrarEvento,
  type InvitacionConsultada,
  type TransaccionConecta,
} from '@conecta/db';
import {
  invitacionAceptadaSchema,
  invitacionCreadaSchema,
  invitacionPublicaSchema,
  type CrearInvitacion,
  type InvitacionCreada,
  type InvitacionPublica,
} from '@conecta/shared';
import type { z } from 'zod';
import { ServicioBd } from '../base/servicio-bd.js';
import { VERIFICADOR_JWT, tokenDeCabecera, type VerificadorJwt } from '../auth/verificador-jwt.js';
import { CONFIG, type Config } from '../config.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';
import { invitacionNoVigente } from '../errores/restricciones/personal.js';
import { ADMIN_AUTH, MENSAJE_SIN_CLAVE_SECRETA, type AdminAuth } from './admin-auth.js';
import { exigirEnAlcance, personaDe } from './personal.service.js';
import { exigirSedesAsignables, idsUnicos } from './sedes-asignables.js';

export type InvitacionAceptada = z.infer<typeof invitacionAceptadaSchema>;
type SiguientePaso = InvitacionPublica['siguientePaso'];

/** Ruta de la web que abre la persona invitada. */
export const RUTA_ENLACE = '/invitacion';

/** Cómo se avisó a la persona (queda en la auditoría de `enviar`). */
type Medio = 'correo_invitacion' | 'correo_ingreso' | 'enlace';

/** Token nuevo: 32 bytes aleatorios en base64url (43 caracteres). */
export function nuevoToken(): string {
  return randomBytes(32).toString('base64url');
}

export function enlaceDe(token: string): string {
  return `${RUTA_ENLACE}?token=${encodeURIComponent(token)}`;
}

/**
 * «maria@gmail.com» → «ma***@gmail.com». Muestra a lo sumo dos caracteres de la parte local (uno si
 * es corta) y el dominio completo.
 */
export function enmascararCorreo(email: string): string {
  const arroba = email.lastIndexOf('@');
  if (arroba <= 0) return '***';
  const local = email.slice(0, arroba);
  const visibles = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, visibles)}***${email.slice(arroba)}`;
}

const MENSAJE_OTRO_CORREO =
  'Esta invitación es para otro correo. Ingresá con la cuenta del correo invitado y abrí el enlace de nuevo.';

@Injectable()
export class InvitacionesService {
  constructor(
    private readonly bd: ServicioBd,
    @Inject(ADMIN_AUTH) private readonly adminAuth: AdminAuth,
    @Inject(VERIFICADOR_JWT) private readonly verificador: VerificadorJwt,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  /**
   * Membresía pendiente + invitación + aviso por correo (ver arriba). El enlace con el token sale
   * solo en esta respuesta.
   */
  crear(ctx: ContextoPedido, datos: CrearInvitacion): Promise<InvitacionCreada> {
    const token = nuevoToken();
    const tokenHash = hashTokenInvitacion(token);
    return this.bd.enContexto(ctx, async (tx) => {
      const sedeIds = idsUnicos(datos.sedeIds);
      await exigirSedesAsignables(tx, ctx, sedeIds, 'sedeIds');
      const creada = await crearInvitacion(tx, {
        nombre: datos.nombre,
        email: datos.email,
        rolId: datos.rolId.toLowerCase(),
        sedeIds,
        sedeDefectoId: datos.sedeDefectoId?.toLowerCase() ?? null,
        tokenHash,
      });
      const persona = await personaDe(tx, creada.membresiaId);
      const medio = await this.avisar(tx, tokenHash, token);
      if (medio !== 'enlace') {
        await registrarEvento(tx, {
          accion: 'enviar',
          entidad: 'invitacion',
          entidadId: creada.invitacionId,
          detalle: { medio, reenvio: false },
        });
      }
      return invitacionCreadaSchema.parse({
        persona,
        enlace: enlaceDe(token),
        venceEn: creada.venceEn.toISOString(),
      });
    });
  }

  /**
   * Token nuevo para una membresía pendiente (`id`): la invitación abierta se anula y su token deja
   * de servir; si la cuenta todavía no está confirmada, Supabase vuelve a mandar el correo. Registra
   * `enviar` (la base audita la anulación y el alta, no que se entregó otro enlace). Una persona
   * fuera del alcance de sedes de quien pide no existe para él (404).
   */
  reenviar(ctx: ContextoPedido, membresiaId: string): Promise<InvitacionCreada> {
    const token = nuevoToken();
    const tokenHash = hashTokenInvitacion(token);
    return this.bd.enContexto(ctx, async (tx) => {
      await exigirEnAlcance(tx, membresiaId);
      const reenviada = await reenviarInvitacion(tx, membresiaId, tokenHash);
      const persona = await personaDe(tx, membresiaId);
      const medio = await this.avisar(tx, tokenHash, token);
      await registrarEvento(tx, {
        accion: 'enviar',
        entidad: 'invitacion',
        entidadId: reenviada.invitacionId,
        detalle: { medio, reenvio: true },
      });
      return invitacionCreadaSchema.parse({
        persona,
        enlace: enlaceDe(token),
        venceEn: reenviada.venceEn.toISOString(),
      });
    });
  }

  /** Anula la invitación abierta y deja la membresía pendiente inactiva (fuera de alcance: 404). */
  async anular(ctx: ContextoPedido, membresiaId: string, motivo: string): Promise<void> {
    await this.bd.enContexto(ctx, async (tx) => {
      await exigirEnAlcance(tx, membresiaId);
      await anularInvitacion(tx, membresiaId, motivo);
    });
  }

  /** Pública. Cualquier token que no sirve responde lo mismo (`no_encontrado`). */
  async consultar(token: string, ip: string | null): Promise<InvitacionPublica> {
    const invitacion = await this.vigente(token, ip);
    return invitacionPublicaSchema.parse({
      clinica: invitacion.clinica,
      rol: invitacion.rol,
      nombre: invitacion.nombre,
      emailEnmascarado: enmascararCorreo(invitacion.email),
      siguientePaso: await this.siguientePaso(invitacion),
      venceEn: invitacion.venceEn.toISOString(),
    });
  }

  /**
   * Pública, pero exige `Authorization`: el JWT tiene que ser válido (aal1 alcanza), su correo el de
   * la invitación y, según la Admin API, esa cuenta tiene que tener ese correo confirmado.
   */
  async aceptar(
    token: string,
    autorizacion: string | undefined,
    ip: string | null,
  ): Promise<InvitacionAceptada> {
    const identidad = await this.verificador.verificar(tokenDeCabecera(autorizacion));
    const email = identidad.email?.trim().toLowerCase();
    if (!email) {
      throw errores.noAutenticado(
        'Tu sesión no trae un correo. Ingresá de nuevo con tu correo y contraseña.',
      );
    }
    // Primero el token: cualquier enlace que no sirve responde lo mismo, venga quien venga.
    const invitacion = await this.vigente(token, ip);
    // La base vuelve a compararlo (invitacion_otro_correo); acá se corta antes de escribir nada.
    if (invitacion.email !== email) throw errores.sinPermiso(MENSAJE_OTRO_CORREO);
    if (!this.adminAuth.disponible) throw errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA);
    const cuenta = await this.adminAuth.obtenerCuenta(identidad.usuarioId);
    if (cuenta?.email !== email) throw errores.sinPermiso(MENSAJE_OTRO_CORREO);
    if (!cuenta.confirmada) {
      throw errores.sinPermiso(
        'Todavía no confirmaste tu correo. Abrí el correo de invitación que te mandamos y volvé desde ahí para aceptar.',
      );
    }
    const tokenHash = hashTokenInvitacion(token);
    const clinicaId = await this.bd.sinContexto(ip, (tx) =>
      aceptarInvitacion(tx, { tokenHash, usuarioId: identidad.usuarioId, email }),
    );
    return invitacionAceptadaSchema.parse({ email, clinicaId });
  }

  /** La invitación vigente de ese token, o `no_encontrado` (siempre el mismo). */
  private async vigente(token: string, ip: string | null): Promise<InvitacionConsultada> {
    const invitacion = await this.bd.sinContexto(ip, (tx) =>
      consultarInvitacion(tx, hashTokenInvitacion(token)),
    );
    if (!invitacion) throw invitacionNoVigente();
    return invitacion;
  }

  /**
   * Ver «SIGUIENTE PASO» arriba. Sin clave secreta solo se puede mirar la base: un correo que no es
   * usuario del sistema da `revisa_tu_correo` (sin clave no se pueden crear invitaciones que
   * necesiten correo, así que es el caso de una invitación vieja).
   */
  private async siguientePaso(invitacion: InvitacionConsultada): Promise<SiguientePaso> {
    if (invitacion.usuarioExiste) return 'cuenta_existente';
    if (!this.adminAuth.disponible) return 'revisa_tu_correo';
    const cuenta = await this.adminAuth.buscarPorCorreo(invitacion.email);
    return cuenta?.confirmada && !cuenta.nacidaPorInvitacion
      ? 'cuenta_existente'
      : 'revisa_tu_correo';
  }

  /**
   * Avisa por correo, si hace falta, a la persona de la invitación recién creada con `tokenHash`
   * (en esta misma transacción). Ver «AVISO POR CORREO» arriba.
   */
  private async avisar(tx: TransaccionConecta, tokenHash: string, token: string): Promise<Medio> {
    const invitacion = await consultarInvitacion(tx, tokenHash);
    if (!invitacion) throw errores.interno();
    if (invitacion.usuarioExiste) return 'enlace';
    if (!this.adminAuth.disponible) throw errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA);
    const redirectTo = `${this.config.webOrigenPublico}${enlaceDe(token)}`;
    const resultado = await this.adminAuth.invitarPorCorreo(invitacion.email, redirectTo);
    if (resultado === 'enviada') return 'correo_invitacion';
    const cuenta = await this.adminAuth.buscarPorCorreo(invitacion.email);
    if (cuenta?.confirmada && cuenta.nacidaPorInvitacion) {
      await this.adminAuth.enviarEnlaceIngreso(invitacion.email, redirectTo);
      return 'correo_ingreso';
    }
    return 'enlace';
  }
}
