/** Ayudas de las pruebas de anamnesis (Sprint 4). Las generales están en `ayudas.ts`. */
import { anamnesisSchema, type Anamnesis } from '@conecta/shared';
import { png } from './archivos-ayudas.js';
import { comoSistema, segun, type Prueba } from './ayudas.js';

/** `data:` URL de un PNG (por defecto, uno válido de 40 × 20). */
export function firmaDataUrl(contenido: Buffer = png(40, 20)): string {
  return `data:image/png;base64,${contenido.toString('base64')}`;
}

/** Cuerpo de `POST /pacientes/:id/anamnesis` válido para un adulto, con lo que se pise. */
export function cuerpoAnamnesis(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    versionBase: null,
    respuestas: [],
    firmante: { nombre: 'Ana Benítez', ci: null, esTutor: false },
    firmaPng: firmaDataUrl(),
    declaracionVeracidad: true,
    ...extra,
  };
}

/** Respuesta con alergia a la penicilina y su detalle (genera una alerta médica). */
export const ALERGIA_PENICILINA = {
  codigo: 'alergias',
  opciones: ['penicilina'],
  detalle: 'urticaria con amoxicilina',
};

/** Guarda una versión por la API (201) y la devuelve validada contra el contrato. */
export async function guardarApi(
  prueba: Prueba,
  token: string,
  pacienteId: string,
  extra: Record<string, unknown> = {},
): Promise<Anamnesis> {
  const respuesta = await prueba
    .pedir('post', `/pacientes/${pacienteId}/anamnesis`, { token, cuerpo: cuerpoAnamnesis(extra) })
    .expect(201);
  return segun(anamnesisSchema, respuesta.body);
}

/** Archivos `firma_paciente` de un paciente (como administración). */
export async function firmasDe(
  prueba: Prueba,
  clinicaId: string,
  pacienteId: string,
): Promise<{ id: string; ruta: string; sha256: string; bytes: string }[]> {
  const { rows } = await comoSistema<{ id: string; ruta: string; sha256: string; bytes: string }>(
    prueba.admin,
    clinicaId,
    `select id, ruta, sha256, bytes::text as bytes from app.archivo
     where clinica_id = $1 and paciente_id = $2 and categoria = 'firma_paciente'`,
    [clinicaId, pacienteId],
  );
  return rows;
}

/** Versiones guardadas de un paciente (como administración). */
export async function versionesDe(
  prueba: Prueba,
  clinicaId: string,
  pacienteId: string,
): Promise<number[]> {
  const { rows } = await comoSistema<{ version: number }>(
    prueba.admin,
    clinicaId,
    'select version from app.anamnesis where clinica_id = $1 and paciente_id = $2 order by version',
    [clinicaId, pacienteId],
  );
  return rows.map((r) => r.version);
}

/** Token de la URL firmada del almacén local (`…/archivos/descarga?t=<token>`). */
export function tokenDeUrl(url: string): string {
  const token = new URL(url).searchParams.get('t');
  if (!token) throw new Error('La URL no trae token.');
  return token;
}

/** Vencimiento (segundos desde la época) que lleva un token del almacén local. */
export function vencimientoDe(token: string): number {
  const [parte] = token.split('.');
  const datos = JSON.parse(Buffer.from(parte ?? '', 'base64url').toString('utf8')) as {
    e: number;
  };
  return datos.e;
}
