/**
 * Validación de entrada con los esquemas Zod del contrato. Los errores salen como `datos_invalidos`
 * con un detalle por campo. Los mensajes propios del contrato («Poné el nombre de la sede.») tienen
 * prioridad; para el resto se usa este mapa en español con voseo.
 */
import { Injectable, type PipeTransform } from '@nestjs/common';
import { idSchema } from '@conecta/shared';
import { z } from 'zod';
import { errores, type DetalleError } from './error-api.js';

const mapaDeErrores: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input === undefined
        ? 'Completá este dato.'
        : `Este dato tiene un tipo que no esperábamos (tiene que ser ${traducirTipo(issue.expected)}).`;
    case 'too_small':
      if (issue.origin === 'string') {
        return issue.minimum === 1
          ? 'Completá este dato.'
          : `Tiene que tener al menos ${String(issue.minimum)} caracteres.`;
      }
      if (issue.origin === 'array') return `Agregá al menos ${String(issue.minimum)} elementos.`;
      return `Tiene que ser como mínimo ${String(issue.minimum)}.`;
    case 'too_big':
      if (issue.origin === 'string') {
        return `Puede tener como máximo ${String(issue.maximum)} caracteres.`;
      }
      if (issue.origin === 'array')
        return `Puede tener como máximo ${String(issue.maximum)} elementos.`;
      return `Tiene que ser como máximo ${String(issue.maximum)}.`;
    case 'invalid_format':
      if (issue.format === 'uuid' || issue.format === 'guid')
        return 'No es un identificador válido.';
      if (issue.format === 'datetime') {
        return 'Usá una fecha y hora ISO con zona, por ejemplo 2026-03-01T08:00:00Z.';
      }
      if (issue.format === 'email') return 'Revisá el correo.';
      return 'Revisá el formato de este dato.';
    case 'invalid_value':
      return `Elegí uno de estos valores: ${issue.values.map(String).join(', ')}.`;
    case 'unrecognized_keys':
      return `Hay datos que no esperábamos: ${issue.keys.join(', ')}.`;
    default:
      return 'Revisá este dato.';
  }
};

function traducirTipo(tipo: string): string {
  const tipos: Record<string, string> = {
    string: 'un texto',
    number: 'un número',
    int: 'un número entero',
    boolean: 'verdadero o falso',
    object: 'un objeto',
    array: 'una lista',
  };
  return tipos[tipo] ?? tipo;
}

function detallesDe(error: z.ZodError): DetalleError[] {
  return error.issues.map((issue) => ({
    campo: issue.path.length > 0 ? issue.path.map(String).join('.') : '(cuerpo)',
    mensaje: issue.message,
  }));
}

/** Valida `valor` con `esquema` o lanza `datos_invalidos` con detalles por campo. */
export function validar<S extends z.ZodType>(esquema: S, valor: unknown): z.output<S> {
  const resultado = esquema.safeParse(valor, { error: mapaDeErrores });
  if (resultado.success) return resultado.data;
  const detalles = detallesDe(resultado.error);
  const primero = detalles[0];
  const mensaje =
    detalles.length === 1 && primero
      ? `Revisá el dato «${primero.campo}»: ${primero.mensaje}`
      : 'Hay datos para revisar. Corregí los campos marcados y probá de nuevo.';
  throw errores.datosInvalidos(mensaje, detalles);
}

/** Pipe de Nest: `@Body(new ValidarCon(esquema))`, `@Query(new ValidarCon(esquema))`. */
export class ValidarCon<S extends z.ZodType> implements PipeTransform<unknown, z.output<S>> {
  constructor(
    private readonly esquema: S,
    private readonly preparar: (valor: unknown) => unknown = (valor) => valor,
  ) {}

  transform(valor: unknown): z.output<S> {
    return validar(this.esquema, this.preparar(valor));
  }
}

/**
 * Id de ruta (`:id`). Un id que no es UUID no puede existir: responde `no_encontrado`, sin llegar a
 * la base.
 */
@Injectable()
export class IdDeRuta implements PipeTransform<unknown, string> {
  transform(valor: unknown): string {
    const resultado = idSchema.safeParse(valor);
    if (!resultado.success) throw errores.noEncontrado();
    return resultado.data.toLowerCase();
  }
}
