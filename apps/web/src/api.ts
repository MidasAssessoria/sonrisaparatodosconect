import { respuestaSaludSchema, type RespuestaSalud } from '@conecta/shared';

export const URL_SALUD = '/api/v1/salud';

export async function consultarSalud(): Promise<RespuestaSalud> {
  const respuesta = await fetch(URL_SALUD);
  if (!respuesta.ok) {
    throw new Error(`La API respondió ${respuesta.status}`);
  }
  return respuestaSaludSchema.parse(await respuesta.json());
}
