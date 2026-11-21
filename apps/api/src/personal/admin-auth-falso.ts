/**
 * `AdminAuth` en memoria para pruebas (y para desarrollo sin Supabase): guarda las cuentas en un
 * mapa, registra qué se creó y qué se borró, y se le puede pedir que falle.
 */
import { randomUUID } from 'node:crypto';
import { errores } from '../errores/error-api.js';
import { cuentaExistente, type AdminAuth, type CuentaAuth } from './admin-auth.js';

export type OperacionAdminAuth = 'buscar' | 'crear' | 'borrar';

export class AdminAuthFalso implements AdminAuth {
  readonly disponible = true;
  /** Cuentas por id. La clave no se guarda: solo si vino. */
  readonly cuentas = new Map<string, CuentaAuth>();
  /** Ids creados por `crearCuentaConfirmada`, en orden. */
  readonly creadas: string[] = [];
  /** Ids borrados por `borrarCuenta`, en orden. */
  readonly borradas: string[] = [];
  /** Operaciones que fallan como si Supabase no respondiera (503). */
  readonly fallas = new Set<OperacionAdminAuth>();
  /** Se ejecuta justo después de crear una cuenta (p. ej. para que la aceptación falle después). */
  alCrear: ((cuenta: CuentaAuth) => Promise<void>) | null = null;

  /** Agrega una cuenta existente (alguien que ya se registró, p. ej. en otra clínica). */
  agregar(email: string, id: string = randomUUID()): CuentaAuth {
    const cuenta = { id, email: email.trim().toLowerCase() };
    this.cuentas.set(id, cuenta);
    return cuenta;
  }

  buscarPorCorreo(email: string): Promise<CuentaAuth | null> {
    if (this.fallas.has('buscar')) return Promise.reject(errores.servicioNoDisponible());
    const buscado = email.trim().toLowerCase();
    return Promise.resolve([...this.cuentas.values()].find((c) => c.email === buscado) ?? null);
  }

  async crearCuentaConfirmada(email: string, clave: string): Promise<CuentaAuth> {
    if (this.fallas.has('crear')) throw errores.servicioNoDisponible();
    if (clave.length < 10) throw errores.datosInvalidos('Usá al menos 10 caracteres.');
    if (await this.buscarPorCorreo(email)) throw cuentaExistente();
    const cuenta = this.agregar(email);
    this.creadas.push(cuenta.id);
    if (this.alCrear) await this.alCrear(cuenta);
    return cuenta;
  }

  borrarCuenta(id: string): Promise<void> {
    if (this.fallas.has('borrar')) return Promise.reject(errores.servicioNoDisponible());
    this.cuentas.delete(id);
    this.borradas.push(id);
    return Promise.resolve();
  }
}
