/**
 * Declaración de acceso de cada ruta. Negar por defecto: el guard global rechaza toda ruta que no
 * tenga una de estas declaraciones (y una meta-prueba recorre las rutas registradas).
 */
import { SetMetadata } from '@nestjs/common';
import type { Accion, Modulo } from '@conecta/shared';

export const ACCESO = 'conecta:acceso';

export type Acceso =
  /** Sin sesión (p. ej. `GET /salud`). */
  | { tipo: 'publica' }
  /**
   * Solo `POST /sesion/cerrar`: token válido (con `session_id`), sin clínica ni membresía y aunque
   * el token sea aal1 con el doble factor pendiente (la web lo llama desde la pantalla del código).
   */
  | { tipo: 'cierre' }
  /**
   * Solo `GET /sesion`: con sesión, tolera la falta de `X-Clinica-Id` con varias membresías. El
   * doble factor se exige igual que en el resto.
   */
  | { tipo: 'sesion' }
  /** Con sesión y membresía activa en la clínica, sin un permiso de módulo en particular. */
  | { tipo: 'miembro' }
  /** Con sesión, membresía activa y el permiso módulo + acción en `rol_permiso`. */
  | { tipo: 'permiso'; modulo: Modulo; accion: Accion };

/** Ruta sin sesión. Usala solo para lo que de verdad es público. */
export const Publica = () => SetMetadata(ACCESO, { tipo: 'publica' } satisfies Acceso);

/** Reservado para `POST /sesion/cerrar` (ver `Acceso`). */
export const CierreSesion = () => SetMetadata(ACCESO, { tipo: 'cierre' } satisfies Acceso);

/** Reservado para `GET /sesion` (ver `Acceso`). */
export const AccesoSesion = () => SetMetadata(ACCESO, { tipo: 'sesion' } satisfies Acceso);

/** Cualquier miembro activo de la clínica. */
export const SoloMiembro = () => SetMetadata(ACCESO, { tipo: 'miembro' } satisfies Acceso);

/** Exige el permiso `modulo:accion` del rol del usuario en la clínica del pedido. */
export const Permiso = (modulo: Modulo, accion: Accion) =>
  SetMetadata(ACCESO, { tipo: 'permiso', modulo, accion } satisfies Acceso);
