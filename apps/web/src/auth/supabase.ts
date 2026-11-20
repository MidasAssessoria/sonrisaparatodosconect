import { createClient, type AuthError, type SupabaseClient } from '@supabase/supabase-js';
import { ErrorAuth, type ServicioAuth, type TipoErrorAuth } from './servicioAuth.js';

/** Traduce los errores de Supabase Auth a los tipos que entiende la app. */
export function tipoDeErrorSupabase(
  error: Pick<AuthError, 'code' | 'status' | 'name'>,
): TipoErrorAuth {
  switch (error.code) {
    case 'invalid_credentials':
      return 'credenciales';
    case 'email_not_confirmed':
      return 'correo_sin_confirmar';
    case 'mfa_verification_failed':
    case 'mfa_challenge_expired':
      return 'codigo_invalido';
    case 'weak_password':
      return 'clave_debil';
    case 'same_password':
      return 'clave_repetida';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'demasiados_intentos';
    case 'insufficient_aal':
      return 'requiere_segundo_factor';
  }
  if (error.name === 'AuthRetryableFetchError') return 'sin_conexion';
  if (error.status === 429) return 'demasiados_intentos';
  return 'otro';
}

function fallar(error: AuthError | null): void {
  if (error) throw new ErrorAuth(tipoDeErrorSupabase(error), error.message);
}

export function crearServicioAuthSupabase(cliente: SupabaseClient): ServicioAuth {
  const auth = cliente.auth;
  return {
    async obtenerSesion() {
      const { data, error } = await auth.getSession();
      fallar(error);
      const u = data.session?.user;
      return u ? { usuarioId: u.id, email: u.email ?? '' } : null;
    },
    async obtenerToken() {
      const { data } = await auth.getSession();
      return data.session?.access_token ?? null;
    },
    async iniciarSesion(email, clave) {
      const { data, error } = await auth.signInWithPassword({ email, password: clave });
      fallar(error);
      return { usuarioId: data.user?.id ?? '', email: data.user?.email ?? email };
    },
    async cerrarSesion() {
      await auth.signOut({ scope: 'local' });
    },
    async enviarRecuperacion(email, redirigirA) {
      const { error } = await auth.resetPasswordForEmail(email, { redirectTo: redirigirA });
      fallar(error);
    },
    async cambiarClave(nueva) {
      const { error } = await auth.updateUser({ password: nueva });
      fallar(error);
    },
    async nivel() {
      const { data, error } = await auth.mfa.getAuthenticatorAssuranceLevel();
      fallar(error);
      return {
        actual: data?.currentLevel === 'aal2' ? 'aal2' : 'aal1',
        siguiente: data?.nextLevel === 'aal2' ? 'aal2' : 'aal1',
      };
    },
    async factoresTotp() {
      const { data, error } = await auth.mfa.listFactors();
      fallar(error);
      return (data?.all ?? [])
        .filter((f) => f.factor_type === 'totp')
        .map((f) => ({
          id: f.id,
          nombre: f.friendly_name ?? null,
          verificado: f.status === 'verified',
        }));
    },
    async verificarCodigo(factorId, codigo) {
      const { error } = await auth.mfa.challengeAndVerify({ factorId, code: codigo });
      fallar(error);
    },
    async inscribirTotp(nombre) {
      // Un intento anterior sin verificar bloquea uno nuevo con el mismo nombre: se limpia.
      const { data: lista } = await auth.mfa.listFactors();
      for (const f of lista?.all ?? []) {
        if (f.factor_type === 'totp' && f.status !== 'verified') {
          await auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error } = await auth.mfa.enroll({ factorType: 'totp', friendlyName: nombre });
      fallar(error);
      if (!data) throw new ErrorAuth('otro');
      return {
        factorId: data.id,
        qr: data.totp.qr_code,
        secreto: data.totp.secret,
        uri: data.totp.uri,
      };
    },
    async quitarFactor(factorId) {
      const { error } = await auth.mfa.unenroll({ factorId });
      fallar(error);
    },
    alCambiar(cb) {
      const { data } = auth.onAuthStateChange((evento) => {
        // No llamar a Supabase dentro del callback (se traba): se difiere.
        if (evento === 'SIGNED_OUT') setTimeout(() => cb('salio'), 0);
        if (evento === 'PASSWORD_RECOVERY') setTimeout(() => cb('recuperacion'), 0);
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

/** Cliente real a partir de las variables de entorno. `null` si faltan. */
export function crearServicioAuthDesdeEntorno(): ServicioAuth | null {
  const url = import.meta.env['VITE_SUPABASE_URL'] as string | undefined;
  const clave = import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string | undefined;
  if (!url || !clave) return null;
  const cliente = createClient(url, clave, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return crearServicioAuthSupabase(cliente);
}
