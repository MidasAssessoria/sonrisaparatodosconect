/**
 * Invitaciones: alta, reenvío y anulación (con sesión, en `enContexto`), y las dos rutas públicas
 * que usa la persona invitada: consultar y aceptar (en `sinContexto`: la base resuelve la clínica
 * por el hash del token).
 *
 * El token: 32 bytes aleatorios en base64url. La base guarda solo su SHA-256; el token en claro sale
 * una sola vez, en el enlace de la respuesta de crear o de reenviar, y no se registra en ningún lado.
 *
 * FRONTERA DE CONFIANZA (aceptar): `app.aceptar_invitacion` confía en el usuario y el correo que le
 * pasa la API. Solo salen de dos lugares:
 *   - con `Authorization`: el `sub` y el `email` del JWT, verificado con el verificador de `auth/`;
 *   - sin `Authorization`: el id y el correo de la cuenta que la API acaba de crear con la Admin API
 *     de Supabase, para el correo de la propia invitación.
 * Nunca del cuerpo del pedido (el esquema del contrato descarta cualquier otro campo).
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
import {
  VERIFICADOR_JWT,
  tokenDeCabecera,
  type IdentidadToken,
  type VerificadorJwt,
} from '../auth/verificador-jwt.js';
import { REGISTRO, type Registro } from '../comun/registro.js';
import type { ContextoPedido } from '../contexto/contexto-pedido.js';
import { errores } from '../errores/error-api.js';
import { invitacionNoVigente } from '../errores/restricciones/personal.js';
import { ADMIN_AUTH, MENSAJE_SIN_CLAVE_SECRETA, type AdminAuth } from './admin-auth.js';
import { personaDe } from './personal.service.js';
import { exigirSedesAsignables, idsUnicos } from './sedes-asignables.js';

export type InvitacionAceptada = z.infer<typeof invitacionAceptadaSchema>;

/** Ruta de la web que abre la persona invitada. */
export const RUTA_ENLACE = '/invitacion';

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

@Injectable()
export class InvitacionesService {
  constructor(
    private readonly bd: ServicioBd,
    @Inject(ADMIN_AUTH) private readonly adminAuth: AdminAuth,
    @Inject(VERIFICADOR_JWT) private readonly verificador: VerificadorJwt,
    @Inject(REGISTRO) private readonly registro: Registro,
  ) {}

  /** Membresía pendiente + invitación. El enlace con el token sale solo en esta respuesta. */
  crear(ctx: ContextoPedido, datos: CrearInvitacion): Promise<InvitacionCreada> {
    const token = nuevoToken();
    return this.bd.enContexto(ctx, async (tx) => {
      const sedeIds = idsUnicos(datos.sedeIds);
      await exigirSedesAsignables(tx, ctx, sedeIds, 'sedeIds');
      const creada = await crearInvitacion(tx, {
        nombre: datos.nombre,
        email: datos.email,
        rolId: datos.rolId.toLowerCase(),
        sedeIds,
        sedeDefectoId: datos.sedeDefectoId?.toLowerCase() ?? null,
        tokenHash: hashTokenInvitacion(token),
      });
      return invitacionCreadaSchema.parse({
        persona: await personaDe(tx, creada.membresiaId),
        enlace: enlaceDe(token),
        venceEn: creada.venceEn.toISOString(),
      });
    });
  }

  /**
   * Token nuevo para una membresía pendiente (`id`): la invitación abierta se anula y su token deja
   * de servir. Registra `enviar` (la base audita la anulación y el alta, no que se entregó otro
   * enlace).
   */
  reenviar(ctx: ContextoPedido, membresiaId: string): Promise<InvitacionCreada> {
    const token = nuevoToken();
    return this.bd.enContexto(ctx, async (tx) => {
      const reenviada = await reenviarInvitacion(tx, membresiaId, hashTokenInvitacion(token));
      await registrarEvento(tx, {
        accion: 'enviar',
        entidad: 'invitacion',
        entidadId: reenviada.invitacionId,
        detalle: { medio: 'enlace', reenvio: true },
      });
      return invitacionCreadaSchema.parse({
        persona: await personaDe(tx, membresiaId),
        enlace: enlaceDe(token),
        venceEn: reenviada.venceEn.toISOString(),
      });
    });
  }

  /** Anula la invitación abierta y deja la membresía pendiente inactiva. */
  async anular(ctx: ContextoPedido, membresiaId: string, motivo: string): Promise<void> {
    await this.bd.enContexto(ctx, (tx) => anularInvitacion(tx, membresiaId, motivo));
  }

  /** Pública. Cualquier token que no sirve responde lo mismo (`no_encontrado`). */
  async consultar(token: string, ip: string | null): Promise<InvitacionPublica> {
    const invitacion = await this.vigente(token, ip);
    return invitacionPublicaSchema.parse({
      clinica: invitacion.clinica,
      rol: invitacion.rol,
      nombre: invitacion.nombre,
      emailEnmascarado: enmascararCorreo(invitacion.email),
      requiereIngreso: await this.correoTieneCuenta(invitacion),
      venceEn: invitacion.venceEn.toISOString(),
    });
  }

  /**
   * Pública. Con `Authorization` (la persona ya tiene cuenta): el JWT tiene que ser válido y su
   * correo el de la invitación. Sin `Authorization`: hace falta `clave`, el correo no puede tener
   * cuenta y la API la crea confirmada; si la aceptación falla después, la borra.
   */
  async aceptar(
    datos: { token: string; clave?: string | undefined },
    autorizacion: string | undefined,
    ip: string | null,
  ): Promise<InvitacionAceptada> {
    if (autorizacion !== undefined) {
      const identidad = await this.verificador.verificar(tokenDeCabecera(autorizacion));
      return this.aceptarConCuenta(datos.token, identidad, ip);
    }
    return this.aceptarSinCuenta(datos.token, datos.clave, ip);
  }

  private async aceptarConCuenta(
    token: string,
    identidad: IdentidadToken,
    ip: string | null,
  ): Promise<InvitacionAceptada> {
    const email = identidad.email?.trim().toLowerCase();
    if (!email) {
      throw errores.noAutenticado(
        'Tu sesión no trae un correo. Ingresá de nuevo con tu correo y contraseña.',
      );
    }
    const tokenHash = hashTokenInvitacion(token);
    const clinicaId = await this.bd.sinContexto(ip, async (tx) => {
      const invitacion = await consultarInvitacion(tx, tokenHash);
      if (!invitacion) throw invitacionNoVigente();
      // La base vuelve a compararlo (invitacion_otro_correo); acá se corta antes de escribir nada.
      if (invitacion.email !== email) {
        throw errores.sinPermiso(
          'Esta invitación es para otro correo. Ingresá con la cuenta del correo invitado y abrí el enlace de nuevo.',
        );
      }
      return aceptarInvitacion(tx, { tokenHash, usuarioId: identidad.usuarioId, email });
    });
    return invitacionAceptadaSchema.parse({ email, clinicaId });
  }

  private async aceptarSinCuenta(
    token: string,
    clave: string | undefined,
    ip: string | null,
  ): Promise<InvitacionAceptada> {
    const tokenHash = hashTokenInvitacion(token);
    const invitacion = await this.vigente(token, ip);
    if (await this.correoTieneCuenta(invitacion)) {
      throw errores.noAutenticado(
        'Ese correo ya tiene una cuenta. Ingresá con esa cuenta y abrí el enlace de nuevo para aceptar.',
      );
    }
    if (clave === undefined) {
      throw errores.datosInvalidos('Elegí una contraseña para tu cuenta nueva.', [
        { campo: 'clave', mensaje: 'Elegí una contraseña de al menos 10 caracteres.' },
      ]);
    }
    if (!this.adminAuth.disponible) throw errores.servicioNoDisponible(MENSAJE_SIN_CLAVE_SECRETA);

    // La cuenta es para el correo de la invitación, no para uno que mande el cliente.
    const cuenta = await this.adminAuth.crearCuentaConfirmada(invitacion.email, clave);
    try {
      const clinicaId = await this.bd.sinContexto(ip, (tx) =>
        aceptarInvitacion(tx, { tokenHash, usuarioId: cuenta.id, email: cuenta.email }),
      );
      return invitacionAceptadaSchema.parse({ email: cuenta.email, clinicaId });
    } catch (error) {
      // Compensación: la cuenta se creó para esta aceptación y la aceptación no quedó.
      try {
        await this.adminAuth.borrarCuenta(cuenta.id);
      } catch {
        // Sin correo ni id de Supabase en el registro: alcanza con saber que quedó una cuenta suelta.
        this.registro.error('invitacion_cuenta_huerfana', { motivo: 'no_se_pudo_borrar' });
      }
      throw error;
    }
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
   * ¿El correo invitado ya tiene cuenta en Supabase Auth? Si ya es usuario del sistema
   * (`app.usuario`), sí. Si no, decide la Admin API. Sin clave secreta solo se puede mirar la base:
   * una cuenta de Auth sin fila en `app.usuario` no se detecta acá (la creación de la cuenta la
   * rechaza igual, porque el correo ya existe).
   */
  private async correoTieneCuenta(invitacion: InvitacionConsultada): Promise<boolean> {
    if (invitacion.usuarioExiste) return true;
    if (!this.adminAuth.disponible) return false;
    return (await this.adminAuth.buscarPorCorreo(invitacion.email)) !== null;
  }
}
