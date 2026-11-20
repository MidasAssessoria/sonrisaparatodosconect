import type { AccionAuditoria } from '@conecta/shared';
import type { IconoNombre, Tono } from '@conecta/ui';

export interface CampoCambiado {
  campo: string;
  antes: unknown;
  despues: unknown;
}

type Registro = Record<string, unknown> | null;

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Solo los campos que cambiaron entre `antes` y `despues` (en un alta, todos los de `despues`). */
export function camposCambiados(antes: Registro, despues: Registro): CampoCambiado[] {
  const claves = [...new Set([...Object.keys(despues ?? {}), ...Object.keys(antes ?? {})])];
  return claves
    .filter((c) => !igual(antes?.[c], despues?.[c]))
    .map((c) => ({ campo: c, antes: antes?.[c], despues: despues?.[c] }));
}

/** Valor legible para el detalle. */
export function valorLegible(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null || v === '') return 'Vacío';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

/** «motivo_baja» → «Motivo baja». */
export function nombreCampo(c: string): string {
  const t = c
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Entidades conocidas en el Sprint 1 (tablas de `docs/plan.md` §4.2). Se suman las que aparezcan. */
export const ENTIDADES: Record<string, string> = {
  sede: 'Sede',
  sede_horario: 'Horario de sede',
  sillon: 'Sillón',
  usuario: 'Usuario',
  membresia: 'Membresía',
  usuario_sede: 'Sedes de usuario',
  rol: 'Rol',
  rol_permiso: 'Permiso de rol',
  clinica: 'Clínica',
};

export function nombreEntidad(e: string): string {
  return ENTIDADES[e] ?? nombreCampo(e);
}

export const ACCION_AUDITORIA: Record<
  AccionAuditoria,
  { texto: string; tono: Tono; icono: IconoNombre }
> = {
  crear: { texto: 'Alta', tono: 'exito', icono: 'mas' },
  editar: { texto: 'Edición', tono: 'info', icono: 'info' },
  anular: { texto: 'Baja', tono: 'atencion', icono: 'alerta' },
  ver: { texto: 'Consulta', tono: 'neutro', icono: 'ojo' },
  exportar: { texto: 'Exportación', tono: 'categoria', icono: 'exportar' },
  enviar: { texto: 'Envío', tono: 'info', icono: 'mensaje' },
};
