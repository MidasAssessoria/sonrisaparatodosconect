/**
 * `AdminAuth` en memoria para pruebas: guarda las cuentas en un mapa, registra cada invitación por
 * correo (correo y `redirectTo`), cuenta las búsquedas y se le puede pedir que falle. Imita lo que
 * hace Supabase con `inviteUserByEmail`: crea la cuenta sin confirmar (nacida por invitación), la
 * reenvía si existe sin confirmar y rechaza una confirmada.
 */
import { randomUUID } from 'node:crypto';
import { errores } from '../errores/error-api.js';
import { correoNoEnviado, type AdminAuth, type CuentaAuth } from './admin-auth.js';

export type OperacionAdminAuth = 'buscar' | 'obtener' | 'invitar' | 'enlace';

export interface InvitacionEnviada {
  email: string;
  redirectTo: string;
}

export class AdminAuthFalso implements AdminAuth {
  readonly disponible = true;
  /** Cuentas por id. */
  readonly cuentas = new Map<string, CuentaAuth>();
  /** Correos de invitación pedidos a «Supabase», en orden. */
  readonly invitaciones: InvitacionEnviada[] = [];
  /** Enlaces de ingreso (magic link) pedidos, en orden. */
  readonly enlaces: InvitacionEnviada[] = [];
  /** Cuántas veces se llamó a cada operación (para medir el costo). */
  readonly llamadas: Record<OperacionAdminAuth, number> = {
    buscar: 0,
    obtener: 0,
    invitar: 0,
    enlace: 0,
  };
  /** Operaciones que fallan como si Supabase no respondiera (503). */
  readonly fallas = new Set<OperacionAdminAuth>();

  /**
   * Agrega una cuenta (por defecto, confirmada y registrada por su cuenta, p. ej. alguien que ya
   * trabaja en otra clínica).
   */
  agregar(
    email: string,
    opciones: { id?: string; confirmada?: boolean; nacidaPorInvitacion?: boolean } = {},
  ): CuentaAuth {
    const cuenta: CuentaAuth = {
      id: opciones.id ?? randomUUID(),
      email: email.trim().toLowerCase(),
      confirmada: opciones.confirmada ?? true,
      nacidaPorInvitacion: opciones.nacidaPorInvitacion ?? false,
    };
    this.cuentas.set(cuenta.id, cuenta);
    return cuenta;
  }

  /** Como cuando la persona abre el correo de invitación: la cuenta queda confirmada. */
  confirmar(email: string): CuentaAuth {
    const cuenta = this.porCorreo(email);
    if (!cuenta) throw new Error(`No hay cuenta para ${email}.`);
    cuenta.confirmada = true;
    return cuenta;
  }

  porCorreo(email: string): CuentaAuth | undefined {
    const buscado = email.trim().toLowerCase();
    return [...this.cuentas.values()].find((c) => c.email === buscado);
  }

  buscarPorCorreo(email: string): Promise<CuentaAuth | null> {
    this.llamadas.buscar++;
    if (this.fallas.has('buscar')) return Promise.reject(errores.servicioNoDisponible());
    const cuenta = this.porCorreo(email);
    return Promise.resolve(cuenta ? { ...cuenta } : null);
  }

  obtenerCuenta(id: string): Promise<CuentaAuth | null> {
    this.llamadas.obtener++;
    if (this.fallas.has('obtener')) return Promise.reject(errores.servicioNoDisponible());
    const cuenta = this.cuentas.get(id);
    return Promise.resolve(cuenta ? { ...cuenta } : null);
  }

  invitarPorCorreo(email: string, redirectTo: string): Promise<'enviada' | 'ya_confirmada'> {
    this.llamadas.invitar++;
    if (this.fallas.has('invitar')) return Promise.reject(correoNoEnviado());
    const existente = this.porCorreo(email);
    if (existente?.confirmada) return Promise.resolve('ya_confirmada');
    if (existente) existente.nacidaPorInvitacion = true;
    else this.agregar(email, { confirmada: false, nacidaPorInvitacion: true });
    this.invitaciones.push({ email: email.trim().toLowerCase(), redirectTo });
    return Promise.resolve('enviada');
  }

  enviarEnlaceIngreso(email: string, redirectTo: string): Promise<void> {
    this.llamadas.enlace++;
    if (this.fallas.has('enlace')) return Promise.reject(correoNoEnviado());
    if (!this.porCorreo(email)) return Promise.reject(correoNoEnviado());
    this.enlaces.push({ email: email.trim().toLowerCase(), redirectTo });
    return Promise.resolve();
  }
}
