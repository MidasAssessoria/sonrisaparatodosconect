/**
 * Cada regla de `RESTRICCIONES_PERSONAL` (y las restricciones reales que usan personal,
 * invitaciones y roles) tiene su respuesta del contrato, con un mensaje que dice qué hacer y sin
 * detalles internos.
 */
import { RESTRICCIONES_PERSONAL } from '@conecta/db';
import { errorApiSchema } from '@conecta/shared';
import { describe, expect, it } from 'vitest';
import { MENSAJE_INVITACION_NO_VIGENTE } from '../src/errores/restricciones/personal.js';
import { traducirError } from '../src/errores/traducir.js';

function errorPg(code: string, constraint: string): Error {
  return Object.assign(new Error('mensaje de Postgres con datos: Key (email)=(secreto@x.test)'), {
    code,
    severity: 'ERROR',
    constraint,
  });
}

const SIN_DETALLES_INTERNOS =
  /select |insert |update |constraint|violates|app\.|pg_|proteger_|42501|23514|23505|P0002|secreto@/i;

describe('errores de personal, invitaciones y roles', () => {
  it('cada regla de RESTRICCIONES_PERSONAL responde lo esperado', () => {
    const esperado: Record<string, [string, number, string]> = {
      membresia_por_invitacion: ['42501', 409, 'conflicto'],
      membresia_invitacion_abierta: ['42501', 409, 'conflicto'],
      rol_inactivo: ['23514', 409, 'conflicto'],
      rol_en_uso: ['23514', 409, 'conflicto'],
      rol_no_encontrado: ['P0002', 404, 'no_encontrado'],
      invitacion_no_vigente: ['P0002', 404, 'no_encontrado'],
      invitacion_no_encontrada: ['P0002', 404, 'no_encontrado'],
      invitacion_otro_correo: ['42501', 403, 'sin_permiso'],
      invitacion_otra_cuenta: ['42501', 409, 'conflicto'],
      invitacion_membresia: ['42501', 409, 'conflicto'],
      invitacion_ya_es_miembro: ['23505', 409, 'conflicto'],
      invitacion_vencimiento: ['22023', 400, 'datos_invalidos'],
      invitacion_sede_defecto: ['22023', 400, 'datos_invalidos'],
      sede_dada_de_baja: ['22023', 400, 'datos_invalidos'],
    };
    expect(Object.keys(esperado).sort()).toEqual([...RESTRICCIONES_PERSONAL].sort());
    for (const restriccion of RESTRICCIONES_PERSONAL) {
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

  it('restricciones reales con mensaje propio', () => {
    const casos: [string, string, number, RegExp][] = [
      ['23505', 'invitacion_abierta_email', 409, /Reenviala o anulala/],
      ['23505', 'invitacion_abierta_membresia', 409, /Reenviala o anulala/],
      ['23514', 'invitacion_email_check', 400, /correo/],
      ['23514', 'invitacion_nombre_check', 400, /nombre/],
      ['22023', 'invitacion_anulacion_check', 400, /motivo/],
      ['23505', 'membresia_usuario_clinica_key', 409, /acceso a esta clínica/],
      ['23505', 'usuario_email_unico', 409, /Ingresá con esa cuenta/],
      ['23514', 'rol_inactividad_min_check', 400, /entre 5 y 240/],
      ['23514', 'rol_permiso_modulo_check', 400, /módulo/],
      ['23514', 'rol_permiso_accion_check', 400, /acción/],
    ];
    for (const [codigoPg, restriccion, estado, mensaje] of casos) {
      const t = traducirError(errorPg(codigoPg, restriccion));
      expect({ restriccion, estado: t.estado }).toEqual({ restriccion, estado });
      expect(t.cuerpo.mensaje).toMatch(mensaje);
      expect(t.cuerpo.mensaje).not.toMatch(SIN_DETALLES_INTERNOS);
    }
  });

  it('un enlace que no sirve siempre dice lo mismo, sin decir por qué', () => {
    const t = traducirError(errorPg('P0002', 'invitacion_no_vigente'));
    expect(t.cuerpo).toEqual({ codigo: 'no_encontrado', mensaje: MENSAJE_INVITACION_NO_VIGENTE });
    expect(MENSAJE_INVITACION_NO_VIGENTE).toMatch(/Pedile un enlace nuevo/);
  });
});
