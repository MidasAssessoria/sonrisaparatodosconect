/**
 * Ayudas de las pruebas de profesionales, tratamientos y agenda (como administración, fuera de la
 * API). Las generales están en `ayudas.ts`.
 */
import { profesionalSchema, type Profesional } from '@conecta/shared';
import { comoSistema, segun, type Prueba } from './ayudas.js';

export interface Franja {
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
}

/** Carga franjas activas en el horario de una sede (sin pasar por la API). */
export async function fijarHorario(
  prueba: Prueba,
  clinicaId: string,
  sedeId: string,
  franjas: Franja[],
): Promise<void> {
  for (const f of franjas) {
    await comoSistema(
      prueba.admin,
      clinicaId,
      `insert into app.sede_horario (clinica_id, sede_id, dia_semana, hora_inicio, hora_fin)
       values ($1, $2, $3, $4, $5)`,
      [clinicaId, sedeId, f.diaSemana, f.horaInicio, f.horaFin],
    );
  }
}

/** Lunes a sábado de 08:00 a 18:00. */
export const SEMANA_COMPLETA: Franja[] = [1, 2, 3, 4, 5, 6].map((diaSemana) => ({
  diaSemana,
  horaInicio: '08:00',
  horaFin: '18:00',
}));

export async function crearProfesional(
  prueba: Prueba,
  token: string,
  cuerpo: object = {},
): Promise<Profesional> {
  const respuesta = await prueba
    .pedir('post', '/profesionales', {
      token,
      cuerpo: { nombre: 'Dra. Acosta', color: '#1A7F5A', ...cuerpo },
    })
    .expect(201);
  return segun(profesionalSchema, respuesta.body);
}

export interface FilaAuditoria {
  accion: string;
  modulo: string | null;
  usuario_id: string | null;
  sede_id: string | null;
}

/** Eventos de auditoría de una entidad, del más viejo al más nuevo. */
export async function auditoriaDe(
  prueba: Prueba,
  clinicaId: string,
  entidad: string,
  entidadId: string,
): Promise<FilaAuditoria[]> {
  const { rows } = await comoSistema<FilaAuditoria>(
    prueba.admin,
    clinicaId,
    `select accion, modulo, usuario_id, sede_id from app.audit_log
     where clinica_id = $1 and entidad = $2 and entidad_id = $3 order by fecha, id`,
    [clinicaId, entidad, entidadId],
  );
  return rows;
}
