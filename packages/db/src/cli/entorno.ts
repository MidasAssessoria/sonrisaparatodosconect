/** Lectura de variables de entorno de los scripts (el .env de la raíz lo carga Node con --env-file-if-exists). */
export function urlAdminDelEntorno(): string {
  const url = process.env['DATABASE_URL_ADMIN'];
  if (!url) {
    throw new Error(
      'Falta DATABASE_URL_ADMIN: la URL del rol que aplica migraciones (en Supabase, el rol postgres). ' +
        'Copiá .env.example a .env y completala.',
    );
  }
  return url;
}
