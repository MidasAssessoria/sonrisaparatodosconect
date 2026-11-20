/**
 * Puerto de autenticación. La app solo habla con esta interfaz; `supabase.ts` la implementa
 * con `@supabase/supabase-js` y las pruebas pasan una versión falsa.
 */

export type NivelAutenticacion = 'aal1' | 'aal2';

export interface SesionAuth {
  usuarioId: string;
  email: string;
}

export interface FactorTotp {
  id: string;
  nombre: string | null;
  verificado: boolean;
}

export interface InscripcionTotp {
  factorId: string;
  /** Imagen del QR (SVG como data URL, tal como la entrega Supabase). */
  qr: string;
  secreto: string;
  uri: string;
}

export type EventoAuth = 'salio' | 'recuperacion';

export type TipoErrorAuth =
  | 'credenciales'
  | 'correo_sin_confirmar'
  | 'codigo_invalido'
  | 'clave_debil'
  | 'clave_repetida'
  | 'demasiados_intentos'
  | 'requiere_segundo_factor'
  | 'sin_conexion'
  | 'otro';

export class ErrorAuth extends Error {
  readonly tipo: TipoErrorAuth;
  constructor(tipo: TipoErrorAuth, mensaje?: string) {
    super(mensaje ?? tipo);
    this.name = 'ErrorAuth';
    this.tipo = tipo;
  }
}

export interface ServicioAuth {
  /** Sesión guardada por Supabase (o `null`). */
  obtenerSesion(): Promise<SesionAuth | null>;
  /** Token de acceso vigente (Supabase lo refresca solo). */
  obtenerToken(): Promise<string | null>;
  iniciarSesion(email: string, clave: string): Promise<SesionAuth>;
  cerrarSesion(): Promise<void>;
  /** Manda el correo con el enlace para definir una contraseña nueva. */
  enviarRecuperacion(email: string, redirigirA: string): Promise<void>;
  cambiarClave(nueva: string): Promise<void>;
  nivel(): Promise<{ actual: NivelAutenticacion; siguiente: NivelAutenticacion }>;
  factoresTotp(): Promise<FactorTotp[]>;
  /** Desafío + verificación de un código de 6 dígitos. Sube la sesión a aal2. */
  verificarCodigo(factorId: string, codigo: string): Promise<void>;
  inscribirTotp(nombre: string): Promise<InscripcionTotp>;
  quitarFactor(factorId: string): Promise<void>;
  /** Pide un token nuevo (p. ej. aal1 después de quitar el factor). */
  refrescarSesion(): Promise<void>;
  /**
   * Eventos de Supabase que importan a la app (también llegan de otras pestañas). Un
   * `recuperacion` que llegó antes de suscribirse (al leer el enlace del correo) se entrega igual.
   */
  alCambiar(cb: (evento: EventoAuth) => void): () => void;
}
