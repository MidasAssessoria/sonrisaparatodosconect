/** Datos ficticios para la página de prueba (los del ejemplo de la maqueta, `EJEMPLO`). */
import { normEstado, type EstadoOdontograma } from './odontograma/modelo.js';

const car = (cl: string, cara: string) => ({ cl, cara });

export const EJEMPLO_ADULTO: EstadoOdontograma = normEstado({
  16: { car: [car('I', 'O')] },
  25: { car: [car('II', 'D')] },
  36: { car: [car('I', 'O'), car('V', 'V')], mk: ['fistula'], rea: ['car:V'] },
  11: { car: [car('III', 'M')], mk: ['fractura'] },
  22: { car: [car('IV', 'D')] },
  28: { ext: true },
  48: { ext: true },
  31: { per: true, mk: ['movilidad'], mov: 2 },
  41: { per: true, mk: ['movilidad'], mov: 1 },
  42: { per: true },
  14: { mk: ['corona'], rea: ['corona'] },
  46: { mk: ['endodoncia', 'corona', 'periapical'], rea: ['endodoncia', 'corona'] },
  21: { mk: ['implante'], rea: ['implante'] },
  37: { mk: ['ausente'] },
  35: { mk: ['protesis'] },
  17: { mk: ['sellante'], rea: ['sellante'] },
  26: { mk: ['sellante'] },
});

export const EJEMPLO_PEDIATRICO: EstadoOdontograma = normEstado({
  55: { car: [car('I', 'O')] },
  64: { car: [car('II', 'M')] },
  74: { car: [car('I', 'O')] },
  61: { car: [car('V', 'V')] },
  52: { ext: true },
  81: { per: true },
  82: { per: true },
  54: { mk: ['corona'], rea: ['corona'] },
  84: { mk: ['endodoncia', 'fistula'] },
  71: { mk: ['ausente'] },
  65: { mk: ['sellante'] },
  75: { mk: ['sellante'] },
});
