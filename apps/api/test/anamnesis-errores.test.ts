/**
 * Errores de la anamnesis sin base: la verificación del PNG de la firma y la traducción de cada
 * regla de `RESTRICCIONES_ANAMNESIS` (lista exhaustiva) con su estado, código y campo.
 */
import { RESTRICCIONES_ANAMNESIS } from '@conecta/db';
import { describe, expect, it } from 'vitest';
import { decodificarFirma, FirmaInvalida, MAXIMO_BYTES_FIRMA } from '../src/anamnesis/firma-png.js';
import {
  errorDeAnamnesis,
  MENSAJE_CONFLICTO_VERSION,
  MENSAJES_ANAMNESIS,
} from '../src/errores/restricciones/anamnesis.js';
import { traducirError } from '../src/errores/traducir.js';
import { jpeg, png, SVG_LIMPIO } from './archivos-ayudas.js';

const url = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;

function motivo(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (error) {
    if (error instanceof FirmaInvalida) return error.motivo;
    throw error;
  }
}

/** Error como lo entrega node-postgres (con `severity`, `constraint` y `column`). */
function errorPg(codigo: string, restriccion: string | null, columna: string | null = null) {
  return Object.assign(new Error('mensaje de la base con datos'), {
    code: codigo,
    severity: 'ERROR',
    ...(restriccion ? { constraint: restriccion } : {}),
    ...(columna ? { column: columna } : {}),
  });
}

describe('firma PNG', () => {
  it('acepta un PNG real y devuelve su tamaño', () => {
    const contenido = png(120, 40);
    expect(decodificarFirma(url(contenido))).toEqual({ contenido, ancho: 120, alto: 40 });
    // Sin relleno base64 también.
    expect(decodificarFirma(url(png(7, 3)).replace(/=+$/, '')).ancho).toBe(7);
  });

  it('rechaza lo que no es PNG aunque el prefijo diga image/png', () => {
    expect(motivo(() => decodificarFirma(url(SVG_LIMPIO)))).toBe('no_png');
    expect(motivo(() => decodificarFirma(url(jpeg(10, 10))))).toBe('no_png');
    expect(motivo(() => decodificarFirma('data:image/svg+xml;base64,AAAA'))).toBe('no_png');
    const truncado = png(10, 10).subarray(0, 40);
    expect(motivo(() => decodificarFirma(url(truncado)))).toBe('no_png');
    const ihdrRoto = png(10, 10);
    ihdrRoto[24] = 3; // profundidad 8 con tipo de color 0 → 3 no es válida para gris
    expect(motivo(() => decodificarFirma(url(ihdrRoto)))).toBe('no_png');
    const gigante = png(1, 1);
    gigante.writeUInt32BE(100_000, 16); // ancho
    expect(motivo(() => decodificarFirma(url(gigante)))).toBe('no_png');
  });

  it('vacía y grande', () => {
    expect(motivo(() => decodificarFirma('data:image/png;base64,'))).toBe('vacia');
    expect(motivo(() => decodificarFirma(url(png(4, 4, MAXIMO_BYTES_FIRMA))))).toBe('grande');
  });
});

describe('traducción de errores de la anamnesis', () => {
  it('cada regla de RESTRICCIONES_ANAMNESIS tiene estado, código y campo', () => {
    const esperado: Record<string, [number, string, string | null]> = {
      configuracion_sin_permiso: [403, 'sin_permiso', null],
      anamnesis_catalogo_invalido: [400, 'datos_invalidos', 'preguntas'],
      anamnesis_pregunta_invalida: [400, 'datos_invalidos', 'preguntas.x1'],
      anamnesis_pregunta_repetida: [400, 'datos_invalidos', 'preguntas.x1'],
      anamnesis_conflicto_version: [409, 'conflicto', null],
      anamnesis_paciente_inactivo: [400, 'datos_invalidos', null],
      anamnesis_pregunta_desconocida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_respuesta_repetida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_respuesta_invalida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_opcion_desconocida: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_numero_fuera_de_rango: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_obligatoria_sin_responder: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_pregunta_no_aplica: [400, 'datos_invalidos', 'respuestas.x1'],
      anamnesis_firmante_nombre: [400, 'datos_invalidos', 'firmante.nombre'],
      anamnesis_firmante_ci: [400, 'datos_invalidos', 'firmante.ci'],
      anamnesis_tutor_requerido: [400, 'datos_invalidos', 'firmante.esTutor'],
      anamnesis_tutor_sin_ci: [400, 'datos_invalidos', 'firmante.ci'],
      anamnesis_sin_firma: [400, 'datos_invalidos', 'firmaPng'],
      anamnesis_firma_invalida: [400, 'datos_invalidos', 'firmaPng'],
      anamnesis_sin_declaracion: [400, 'datos_invalidos', 'declaracionVeracidad'],
      anamnesis_signos_vitales: [400, 'datos_invalidos', 'signosVitales.pulso'],
      anamnesis_inmutable: [409, 'conflicto', null],
      historial_limite: [400, 'datos_invalidos', 'limite'],
    };
    expect(Object.keys(esperado).sort()).toEqual([...RESTRICCIONES_ANAMNESIS].sort());
    expect(Object.keys(MENSAJES_ANAMNESIS).sort()).toEqual([...RESTRICCIONES_ANAMNESIS].sort());
    for (const restriccion of RESTRICCIONES_ANAMNESIS) {
      const [estado, codigo, campo] = esperado[restriccion] ?? [0, '', null];
      // Columna como la manda la base cuando hay una (las de contrato fijo vienen igual).
      const columna = campo;
      for (const traducido of [
        errorDeAnamnesis(errorPg('22023', restriccion, columna)),
        (() => {
          const t = traducirError(errorPg('22023', restriccion, columna));
          return { estado: t.estado, codigo: t.cuerpo.codigo, detalles: t.cuerpo.detalles };
        })(),
      ]) {
        expect(traducido, restriccion).not.toBeNull();
        const t = traducido as { estado: number; codigo: string; detalles?: { campo: string }[] };
        expect({ r: restriccion, estado: t.estado, codigo: t.codigo }).toEqual({
          r: restriccion,
          estado,
          codigo,
        });
        expect(t.detalles?.[0]?.campo ?? null, restriccion).toBe(campo);
      }
    }
    const conflicto = errorDeAnamnesis(errorPg('40001', 'anamnesis_conflicto_version'));
    expect(conflicto?.message).toBe(MENSAJE_CONFLICTO_VERSION);
  });

  it('en el contexto de la anamnesis: permiso, paciente, cursor y CHECK del catálogo', () => {
    expect(errorDeAnamnesis(errorPg('42501', 'ficha_clinica_sin_permiso'))).toMatchObject({
      estado: 403,
      codigo: 'sin_permiso',
    });
    expect(errorDeAnamnesis(errorPg('P0002', 'paciente_no_encontrado'))?.estado).toBe(404);
    expect(errorDeAnamnesis(errorPg('23503', 'archivo_paciente_fkey'))?.estado).toBe(404);
    const cursor = errorDeAnamnesis(errorPg('22023', 'cursor_invalido'));
    expect(cursor?.detalles?.[0]?.campo).toBe('cursor');
    expect(cursor?.message).toContain('historial');
    const check = errorDeAnamnesis(
      errorPg('23514', 'anamnesis_pregunta_tipo_campos', 'preguntas.encias'),
    );
    expect(check).toMatchObject({ estado: 400, codigo: 'datos_invalidos' });
    expect(check?.detalles?.[0]?.campo).toBe('preguntas.encias');
    // Lo que no es suyo sigue al traductor global; nunca se copia el mensaje de la base.
    expect(errorDeAnamnesis(errorPg('23505', 'sede_nombre_unico'))).toBeNull();
    expect(errorDeAnamnesis(new Error('otra cosa'))).toBeNull();
    for (const r of RESTRICCIONES_ANAMNESIS) {
      expect(errorDeAnamnesis(errorPg('22023', r))?.message).not.toContain('mensaje de la base');
    }
  });
});
