/**
 * Tabla completa de rutas de la API (bajo `/api/v1`) y el acceso que declara cada una. La
 * meta-prueba de la API exige que lo registrado coincida exactamente con esta lista: una ruta
 * nueva se agrega acá primero.
 *
 * Acceso: `modulo:accion` = permiso; `publica`; `sesion` (GET /sesion); `miembro` (cualquier
 * miembro activo); `cierre` (solo token válido).
 */
export const RUTAS_API = [
  // Sprint 1
  'GET /salud publica',
  'GET /sesion sesion',
  'POST /sesion/cerrar cierre',
  'DELETE /sesion/mfa miembro',
  'GET /sedes sedes:ver',
  'POST /sedes sedes:crear',
  'GET /sedes/:id sedes:ver',
  'PATCH /sedes/:id sedes:editar',
  'DELETE /sedes/:id sedes:anular',
  'PUT /sedes/:id/horarios sedes:editar',
  'POST /sedes/:id/sillones sedes:crear',
  'PATCH /sillones/:id sedes:editar',
  'GET /auditoria auditoria:ver',

  // Sprint 2 · personal e invitaciones (contrato/personal.ts)
  'GET /personal personal:ver',
  'PATCH /personal/:id personal:editar',
  'POST /personal/:id/desactivar personal:anular',
  'POST /personal/:id/reactivar personal:editar',
  'POST /invitaciones personal:crear',
  'POST /invitaciones/:id/reenviar personal:crear',
  'DELETE /invitaciones/:id personal:anular',
  'POST /invitaciones/consultar publica',
  'POST /invitaciones/aceptar publica',

  // Sprint 2 · roles (contrato/personal.ts)
  'GET /roles personal:ver',
  'POST /roles configuracion:crear',
  'PATCH /roles/:id configuracion:editar',
  'DELETE /roles/:id configuracion:anular',

  // Sprint 2 · profesionales (contrato/profesionales.ts)
  'GET /profesionales personal:ver',
  'POST /profesionales personal:crear',
  'GET /profesionales/:id personal:ver',
  'PATCH /profesionales/:id personal:editar',
  'PUT /profesionales/:id/disponibilidad personal:editar',
  'POST /profesionales/:id/bloqueos personal:editar',
  'DELETE /bloqueos/:id personal:editar',

  // Sprint 2 · catálogos (contrato/catalogos.ts)
  'GET /tratamientos configuracion:ver',
  'POST /tratamientos configuracion:crear',
  'PATCH /tratamientos/:id configuracion:editar',
  'GET /sedes/:id/agenda sedes:ver',
  'PUT /sedes/:id/agenda sedes:editar',

  // Sprint 2 · archivos (contrato/archivos.ts): el permiso depende de la categoría del archivo.
  'POST /archivos archivo',
  'GET /archivos/:id/url archivo',
  'GET /archivos/descarga publica',
] as const;
export type RutaApi = (typeof RUTAS_API)[number];

/*
 * Notas de acceso que la tabla no alcanza a decir:
 *   - `DELETE /invitaciones/:id` y `DELETE /bloqueos/:id` llevan cuerpo `bajaSchema` (motivo).
 *   - `POST /personal/:id/desactivar` lleva cuerpo `bajaSchema`. Desactivar corta el acceso en el
 *     pedido siguiente (la API verifica la membresía en cada pedido).
 *   - `archivo`: la ruta resuelve el módulo según la categoría del archivo y exige
 *     `<modulo>:crear` para subir y `<modulo>:ver` para pedir la URL.
 *   - `GET /archivos/descarga` es pública porque la autorización viaja en la URL firmada
 *     (`?t=…`), que vence en 5 minutos. Solo existe si el almacenamiento no firma por sí mismo
 *     (almacenamiento local de desarrollo y pruebas).
 */
