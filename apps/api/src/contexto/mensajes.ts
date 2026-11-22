import type { Accion, Modulo } from '@conecta/shared';

const NOMBRE_MODULO: Record<Modulo, string> = {
  inicio: 'Inicio',
  agenda: 'Agenda',
  pacientes: 'Pacientes',
  ficha_clinica: 'Ficha clínica',
  presupuestos: 'Presupuestos',
  caja: 'Caja',
  contabilidad: 'Contabilidad',
  reportes: 'Reportes',
  personal: 'Personal',
  inventario: 'Inventario',
  mensajeria: 'Mensajería',
  sedes: 'Sedes',
  auditoria: 'Auditoría',
  configuracion: 'Configuración',
};

const VERBO_ACCION: Record<Accion, string> = {
  ver: 'ver',
  crear: 'crear',
  editar: 'editar',
  anular: 'dar de baja',
  exportar: 'exportar',
};

/** «Tu rol no tiene permiso para crear en Personal. Pedile acceso…» */
export function mensajeSinPermiso(modulo: Modulo, accion: Accion): string {
  return (
    `Tu rol no tiene permiso para ${VERBO_ACCION[accion]} en ${NOMBRE_MODULO[modulo]}. ` +
    'Pedile acceso a quien administra la clínica.'
  );
}
