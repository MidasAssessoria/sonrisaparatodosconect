/**
 * Cada regla de `RESTRICCIONES_PACIENTES` y cada restricción real de las tablas de pacientes
 * (0019–0027) tiene su respuesta del contrato, con un mensaje en voseo que dice qué hacer y sin
 * detalles internos.
 */
import { RESTRICCIONES_PACIENTES } from '@conecta/db';
import { errorApiSchema } from '@conecta/shared';
import { describe, expect, it } from 'vitest';
import { MENSAJES_PACIENTES_COLUMNAS } from '../src/errores/restricciones/pacientes.js';
import { traducirError } from '../src/errores/traducir.js';

function errorPg(code: string, constraint: string, message = 'Key (ci)=(4123456) secreto'): Error {
  return Object.assign(new Error(message), { code, severity: 'ERROR', constraint });
}

const SIN_DETALLES_INTERNOS =
  /select |insert |update |constraint|violates|app\.|pg_|proteger_|42501|23514|23505|23503|P0002|22023|secreto|4123456/i;

describe('errores de pacientes', () => {
  it('cada regla de RESTRICCIONES_PACIENTES responde lo esperado', () => {
    const esperado: Record<string, [string, number, string]> = {
      pacientes_sin_permiso: ['42501', 403, 'sin_permiso'],
      ficha_clinica_sin_permiso: ['42501', 403, 'sin_permiso'],
      paciente_nace_activo: ['22023', 400, 'datos_invalidos'],
      paciente_fecha_nac_futura: ['23514', 400, 'datos_invalidos'],
      paciente_no_encontrado: ['P0002', 404, 'no_encontrado'],
      relacion_paciente_inactivo: ['22023', 409, 'conflicto'],
      relacion_tipo_sexo: ['23514', 400, 'datos_invalidos'],
      relacion_espejo_inconsistente: ['23514', 409, 'conflicto'],
      relacion_marca_un_sentido: ['23514', 400, 'datos_invalidos'],
      relacion_dada_de_baja: ['22023', 409, 'conflicto'],
      relacion_no_encontrada: ['P0002', 404, 'no_encontrado'],
      alerta_no_encontrada: ['P0002', 404, 'no_encontrado'],
      cursor_invalido: ['22023', 400, 'datos_invalidos'],
      pacientes_limite: ['22023', 400, 'datos_invalidos'],
      pacientes_filtro: ['22023', 400, 'datos_invalidos'],
    };
    expect(Object.keys(esperado).sort()).toEqual([...RESTRICCIONES_PACIENTES].sort());
    for (const restriccion of RESTRICCIONES_PACIENTES) {
      const [codigoPg, estado, codigo] = esperado[restriccion]!;
      const t = traducirError(errorPg(codigoPg, restriccion));
      expect({ restriccion, estado: t.estado, codigo: t.cuerpo.codigo }).toEqual({
        restriccion,
        estado,
        codigo,
      });
      expect(errorApiSchema.parse(t.cuerpo).mensaje).not.toMatch(SIN_DETALLES_INTERNOS);
      expect(t.registrar).toBeUndefined();
    }
  });

  it('las restricciones reales que lista la base tienen mensaje propio', () => {
    // La lista del comentario de RESTRICCIONES_PACIENTES (packages/db/src/esquema.ts).
    const reales: [string, string, number][] = [
      ['23514', 'paciente_nombres_check', 400],
      ['23514', 'paciente_apellidos_check', 400],
      ['23514', 'paciente_ci_check', 400],
      ['23514', 'paciente_ruc_check', 400],
      ['23514', 'paciente_fecha_nac_check', 400],
      ['23514', 'paciente_sexo_check', 400],
      ['23514', 'paciente_telefono_check', 400],
      ['23514', 'paciente_email_check', 400],
      ['23514', 'paciente_ciudad_check', 400],
      ['23514', 'paciente_direccion_check', 400],
      ['23514', 'paciente_idioma_check', 400],
      ['23514', 'paciente_origen_check', 400],
      ['23514', 'paciente_motivo_baja_check', 400],
      ['23514', 'paciente_relacion_tipo_check', 400],
      ['23514', 'paciente_relacion_consigo_mismo', 400],
      ['23514', 'paciente_relacion_motivo_baja_check', 400],
      ['23514', 'paciente_alerta_texto_check', 400],
      ['23514', 'paciente_alerta_tipo_check', 400],
      ['23514', 'paciente_nota_texto_check', 400],
      ['23505', 'paciente_relacion_par_activo', 409],
      ['23503', 'paciente_relacion_paciente_fkey', 404],
      ['23503', 'paciente_relacion_familiar_fkey', 404],
      ['23503', 'paciente_alerta_paciente_fkey', 404],
      ['23503', 'paciente_nota_paciente_fkey', 404],
    ];
    expect(reales.map((r) => r[1]).sort()).toEqual(Object.keys(MENSAJES_PACIENTES_COLUMNAS).sort());
    for (const [codigoPg, restriccion, estado] of reales) {
      const t = traducirError(errorPg(codigoPg, restriccion));
      expect({ restriccion, estado: t.estado }).toEqual({ restriccion, estado });
      const cuerpo = errorApiSchema.parse(t.cuerpo);
      expect(cuerpo.mensaje).not.toMatch(SIN_DETALLES_INTERNOS);
      // Dice qué hacer: lleva un verbo en voseo o en imperativo.
      expect(cuerpo.mensaje).toMatch(
        /Poné|Revis|Elegí|Escrib|Resum|Recargá|Buscal|quitá|Volvé|tiene que|pueden|puede/,
      );
    }
  });

  it('tipo y sexo: repite solo «madre» o «padre» del mensaje de la base', () => {
    const madre = traducirError(
      errorPg(
        '23514',
        'relacion_tipo_sexo',
        'El vínculo madre no coincide con el sexo cargado del familiar: revisá el vínculo o el sexo.',
      ),
    );
    expect(madre.cuerpo).toEqual({
      codigo: 'datos_invalidos',
      mensaje:
        'Madre tiene que ser una paciente de sexo femenino. Revisá el vínculo o el sexo cargado.',
      detalles: [
        {
          campo: 'tipo',
          mensaje:
            'Madre tiene que ser una paciente de sexo femenino. Revisá el vínculo o el sexo cargado.',
        },
      ],
    });
    const padre = traducirError(
      errorPg('23514', 'relacion_tipo_sexo', 'El vínculo padre no coincide con el sexo cargado'),
    );
    expect(padre.cuerpo.mensaje).toBe(
      'Padre tiene que ser un paciente de sexo masculino. Revisá el vínculo o el sexo cargado.',
    );
    const otro = traducirError(errorPg('23514', 'relacion_tipo_sexo', 'select secreto'));
    expect(otro.cuerpo.mensaje).toBe(
      'El vínculo no coincide con el sexo cargado del familiar. Revisá el vínculo o el sexo cargado.',
    );
  });

  it('cambio de sexo que choca con un vínculo cargado a mano: campo sexo, repite solo el vínculo', () => {
    const madre = traducirError(
      errorPg(
        '23514',
        'relacion_tipo_sexo',
        'Este paciente figura como madre en su grupo familiar y no coincide con el sexo nuevo: quitá ese vínculo y cargalo de nuevo, o revisá el sexo.',
      ),
    );
    expect(madre.estado).toBe(400);
    expect(madre.cuerpo).toEqual({
      codigo: 'datos_invalidos',
      mensaje:
        'Este paciente figura como madre en su grupo familiar y el sexo nuevo no coincide. Quitá ese vínculo y cargalo de nuevo, o revisá el sexo.',
      detalles: [{ campo: 'sexo', mensaje: 'No coincide con su grupo familiar.' }],
    });
    const padre = traducirError(
      errorPg('23514', 'relacion_tipo_sexo', 'Este paciente figura como padre en su grupo'),
    );
    expect(padre.cuerpo.mensaje).toMatch(/^Este paciente figura como padre /);
    expect(padre.cuerpo.detalles).toEqual([
      { campo: 'sexo', mensaje: 'No coincide con su grupo familiar.' },
    ]);
  });

  it('los mensajes nuevos de 0023–0027 dicen qué hacer, en voseo', () => {
    const casos: [string, string, RegExp][] = [
      ['42501', 'ficha_clinica_sin_permiso', /verla y editarla.*Pedíselo/],
      ['23514', 'relacion_marca_un_sentido', /marcá quién es tutor/],
      ['22023', 'cursor_invalido', /Volvé a cargarla desde el principio/],
      ['23514', 'paciente_alerta_tipo_check', /Elegí el tipo de alerta: alergia o condición/],
    ];
    for (const [codigoPg, restriccion, mensaje] of casos) {
      const t = traducirError(errorPg(codigoPg, restriccion));
      expect(t.cuerpo.mensaje, restriccion).toMatch(mensaje);
    }
    expect(traducirError(errorPg('22023', 'cursor_invalido')).cuerpo.detalles).toEqual([
      { campo: 'cursor', mensaje: 'Volvé a cargar la lista desde el principio.' },
    ]);
    expect(traducirError(errorPg('23514', 'paciente_alerta_tipo_check')).cuerpo.detalles).toEqual([
      { campo: 'tipo', mensaje: 'Alergia o condición.' },
    ]);
  });
});
