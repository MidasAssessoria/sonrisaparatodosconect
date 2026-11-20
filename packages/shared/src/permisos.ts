/** Acciones sobre un módulo que se pueden habilitar por rol (y por sede). */
export const ACCIONES = ['ver', 'crear', 'editar', 'anular', 'exportar'] as const;
export type Accion = (typeof ACCIONES)[number];

/** Módulos del sistema; cada permiso es módulo + acción. */
export const MODULOS = [
  'inicio',
  'agenda',
  'pacientes',
  'ficha_clinica',
  'presupuestos',
  'caja',
  'contabilidad',
  'reportes',
  'personal',
  'inventario',
  'mensajeria',
  'sedes',
  'auditoria',
  'configuracion',
] as const;
export type Modulo = (typeof MODULOS)[number];
