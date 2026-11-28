/**
 * Ayudas de las pruebas de pacientes (Sprint 3). Las generales están en `ayudas.ts`.
 */
import {
  crearAlertaDePrueba,
  crearPacienteDePrueba,
  crearRelacionDePrueba,
} from '@conecta/db/pruebas';
import { pacienteSchema, type Paciente, type TipoRelacion } from '@conecta/shared';
import { comoSistema, segun, type Prueba } from './ayudas.js';

/** Alta por la API (201) y la ficha que responde, validada contra el contrato. */
export async function crearPacienteApi(
  prueba: Prueba,
  token: string,
  cuerpo: object = {},
): Promise<Paciente> {
  const respuesta = await prueba
    .pedir('post', '/pacientes', { token, cuerpo: { nombres: 'Ana', ...cuerpo } })
    .expect(201);
  return segun(pacienteSchema, respuesta.body);
}

/** Ficha por la API (200), validada contra el contrato. */
export async function fichaApi(prueba: Prueba, token: string, id: string): Promise<Paciente> {
  const respuesta = await prueba.pedir('get', `/pacientes/${id}`, { token }).expect(200);
  return segun(pacienteSchema, respuesta.body);
}

/** Paciente cargado como administración (sin pasar por la API). */
export async function paciente(
  prueba: Prueba,
  clinicaId: string,
  opciones: Omit<Parameters<typeof crearPacienteDePrueba>[1], 'clinicaId'> = {},
): Promise<string> {
  return (await crearPacienteDePrueba(prueba.admin, { clinicaId, ...opciones })).pacienteId;
}

export async function vinculo(
  prueba: Prueba,
  clinicaId: string,
  pacienteId: string,
  familiarId: string,
  tipo: TipoRelacion,
): Promise<string> {
  return (await crearRelacionDePrueba(prueba.admin, { clinicaId, pacienteId, familiarId, tipo }))
    .relacionId;
}

export async function alerta(
  prueba: Prueba,
  clinicaId: string,
  pacienteId: string,
  opciones: { texto?: string; activa?: boolean } = {},
): Promise<string> {
  return (await crearAlertaDePrueba(prueba.admin, { clinicaId, pacienteId, ...opciones })).alertaId;
}

export interface EventoAuditoria {
  accion: string;
  modulo: string | null;
  entidad: string;
  usuario_id: string | null;
}

/** Eventos de auditoría de un registro, del más viejo al más nuevo. */
export async function eventosDe(
  prueba: Prueba,
  clinicaId: string,
  entidadId: string,
): Promise<EventoAuditoria[]> {
  const { rows } = await comoSistema<EventoAuditoria>(
    prueba.admin,
    clinicaId,
    `select accion, modulo, entidad, usuario_id from app.audit_log
     where clinica_id = $1 and entidad_id = $2 order by fecha, id`,
    [clinicaId, entidadId],
  );
  return rows;
}

/** Una fila de una tabla de pacientes como la ve administración. */
export async function filaDe<T extends Record<string, unknown>>(
  prueba: Prueba,
  clinicaId: string,
  tabla: 'paciente' | 'paciente_relacion' | 'paciente_alerta',
  id: string,
): Promise<T | undefined> {
  const { rows } = await comoSistema<T>(
    prueba.admin,
    clinicaId,
    `select * from app.${tabla} where id = $1`,
    [id],
  );
  return rows[0];
}
