/**
 * Trabajo de prueba `archivo.verificar`: relee del almacén un archivo recién subido, recalcula su
 * SHA-256 y lo compara con el de la base. Lee app.archivo con solo la clínica del trabajo en el
 * contexto (RLS, solo lectura) y no escribe en app: el resultado queda en el registro (ids y
 * resultado, nada personal) y como salida del trabajo en la cola.
 *
 *   ok            mismo SHA-256 y mismo tamaño.
 *   distinto      el contenido cambió: error en el registro, sin reintentos (no se arregla solo).
 *   no_encontrado no hay fila vigente en esa clínica (otra clínica, dada de baja, o datos falsos).
 *   invalido      los datos del trabajo no tienen la forma esperada.
 * Si el archivo falta en el almacén o el almacén no responde, lanza: pg-boss reintenta con espera
 * creciente (opciones de la cola en la migración 0014).
 */
import { createHash } from 'node:crypto';
import { conClinica, leerTrabajoVerificarArchivo } from '@conecta/db';
import type pg from 'pg';
import type { LectorArchivos, Ubicacion } from './almacen.js';
import type { Registro } from './registro.js';

export type ResultadoVerificacion = 'ok' | 'distinto' | 'no_encontrado' | 'invalido';

export class ArchivoFaltante extends Error {
  override name = 'ArchivoFaltante';
}

interface FilaArchivo extends Ubicacion {
  sha256: string;
  bytes: string | number;
}

export async function verificarArchivo(
  trabajo: { id: string; data: unknown; retryCount: number },
  pool: pg.Pool,
  lector: LectorArchivos,
  registro: Registro,
): Promise<{ resultado: ResultadoVerificacion }> {
  const datos = leerTrabajoVerificarArchivo(trabajo.data);
  if (!datos) {
    registro.error('archivo_verificacion', { trabajo: trabajo.id, resultado: 'invalido' });
    return { resultado: 'invalido' };
  }
  const inicio = Date.now();
  const base = { trabajo: trabajo.id, clinica: datos.clinicaId, archivo: datos.archivoId };
  const fila = await conClinica(pool, datos.clinicaId, async (cliente) => {
    const { rows } = await cliente.query<FilaArchivo>(
      `select almacen, bucket, ruta, sha256, bytes from app.archivo
       where id = $1 and clinica_id = app.clinica_actual() and deleted_at is null`,
      [datos.archivoId],
    );
    return rows[0];
  });
  if (!fila) {
    registro.advertencia('archivo_verificacion', { ...base, resultado: 'no_encontrado' });
    return { resultado: 'no_encontrado' };
  }
  const contenido = await lector.leer(fila);
  if (!contenido) {
    registro.advertencia('archivo_verificacion_reintento', {
      ...base,
      motivo: 'falta_en_almacen',
      intento: trabajo.retryCount + 1,
    });
    throw new ArchivoFaltante('El archivo no está en el almacén.');
  }
  const sha256 = createHash('sha256').update(contenido).digest('hex');
  const resultado: ResultadoVerificacion =
    sha256 === fila.sha256 && contenido.length === Number(fila.bytes) ? 'ok' : 'distinto';
  const datosRegistro = { ...base, resultado, ms: Date.now() - inicio };
  if (resultado === 'ok') registro.info('archivo_verificacion', datosRegistro);
  else registro.error('archivo_verificacion', datosRegistro);
  return { resultado };
}
