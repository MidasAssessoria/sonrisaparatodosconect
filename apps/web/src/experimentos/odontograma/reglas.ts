/**
 * Reglas de marcado: de un toque sobre un diente a un evento de cambio. Lógica pura.
 *
 * Portado de `referencia/maqueta/codigo/app.js`: `elegirClase`, `alternarMarca` y `marcar`
 * (doc 12, reglas 2 a 4). Diferencia de fondo con la maqueta: no se modifica ningún estado; se
 * devuelve el diente resultante y la lista de hallazgos que se agregan o se quitan, y el que
 * guarda (el padre) decide.
 */
import {
  CARA,
  CATALOGO,
  LETRAS,
  ROM,
  TIPO_DE_MARCADOR,
  conEstado,
  estaSano,
  marcadorDeTipo,
  nombreCara,
  normM,
  type Cara,
  type ClaseBlack,
  type ClaseElegida,
  type EstadoHallazgo,
  type Herramienta,
  type InfoDiente,
  type MarcaDiente,
  type Marcador,
  type TipoHallazgo,
} from './modelo.js';

/** Dónde cayó el toque sobre la corona (lo calcula el motor 3D con `Diente.caraEn`). */
export interface PuntoCara {
  /** Región de la malla: 0 oclusal/incisal, 1 mesial, 2 distal, 3 vestibular, 4 lingual/palatina. */
  reg: number;
  /** Altura relativa en la corona: 0 cuello, 1 borde oclusal/incisal. */
  t: number;
  /** Posición mesio-distal normalizada: + hacia mesial. */
  u: number;
  /** Posición vestíbulo-lingual: + hacia vestibular. */
  w: number;
}

export interface Toque {
  fdi: number;
  /** `null` si el toque cayó en la raíz u otra parte que no es la corona. */
  cara: PuntoCara | null;
}

export type ResultadoClase = { cl: ClaseBlack; cara: Cara } | { error: string };

/**
 * Clase de Black a partir de la cara tocada (doc 12 regla 2). Con `clase` manual, una clase que no
 * corresponde al diente se rechaza con mensaje (II en un incisivo; III o IV en un premolar o molar).
 */
export function elegirClase(
  i: InfoDiente,
  c: PuntoCara,
  clase: ClaseElegida = 'auto',
): ResultadoClase {
  const lado: Cara = c.u >= 0 ? 'M' : 'D';
  const prox: Cara | null = c.reg === 1 || c.reg === 2 ? (LETRAS[c.reg] as Cara) : null;
  const vl: Cara = c.reg === 3 || c.reg === 4 ? (LETRAS[c.reg] as Cara) : c.w >= 0 ? 'V' : 'L';
  if (clase === 'auto') {
    if (!i.ant) {
      if (c.reg === 0) return { cl: 'I', cara: 'O' };
      if (prox) return { cl: 'II', cara: prox };
      if (i.kind === 'mol' && c.t >= 0.55) return { cl: 'I', cara: vl };
      return { cl: 'V', cara: vl };
    }
    if (c.reg === 0) return { cl: 'IV', cara: lado };
    if (prox) return { cl: c.t > 0.74 ? 'IV' : 'III', cara: prox };
    if (c.reg === 4 && c.t >= 0.3) return { cl: 'I', cara: 'L' };
    return { cl: 'V', cara: vl };
  }
  if (clase === 'I')
    return i.ant
      ? { cl: 'I', cara: 'L' }
      : i.kind === 'mol' && (c.reg === 3 || c.reg === 4) && c.t >= 0.55
        ? { cl: 'I', cara: vl }
        : { cl: 'I', cara: 'O' };
  if (clase === 'II')
    return i.ant
      ? { error: 'La clase II es para premolares y molares' }
      : { cl: 'II', cara: prox ?? lado };
  if (clase === 'III' || clase === 'IV')
    return i.ant
      ? { cl: clase, cara: prox ?? lado }
      : { error: `La clase ${clase} es para incisivos y caninos` };
  return { cl: 'V', cara: vl };
}

/** Un hallazgo que se agrega o se quita (una fila de `hallazgo_dental` que se abre o se cierra). */
export interface CambioHallazgo {
  tipo: TipoHallazgo;
  cara?: Cara;
  clase?: ClaseBlack;
  /** Solo movilidad: 1 a 3. */
  grado?: number;
  /** `null` para «ausente», que no tiene estado de tratamiento. */
  estado: EstadoHallazgo | null;
  accion: 'agregar' | 'quitar';
}

/**
 * Lo que emite el componente por cada toque que cambia algo. Los campos de arriba describen el
 * cambio principal; `efectos` lista lo que se quita como consecuencia del mismo toque (ausente
 * limpia caries, extracción y periodontal; extracción limpia caries; movilidad II cierra la I;
 * otra clase en la misma cara reemplaza la caries anterior; «sano» quita todo). `marca` es el
 * diente resultante, ya normalizado (`null` = sin marcas), para que el padre no tenga que repetir
 * las reglas.
 */
export interface CambioOdontograma extends CambioHallazgo {
  fdi: string;
  herramienta: Herramienta;
  efectos: CambioHallazgo[];
  marca: MarcaDiente | null;
  /** Texto corto para un aviso: «36 · caries clase I, cara oclusal». */
  mensaje: string;
}

export type ResultadoToque =
  { tipo: 'cambio'; evento: CambioOdontograma } | { tipo: 'rechazo'; fdi: string; mensaje: string };

const estadoDe = (m: MarcaDiente, clave: string, id: string): EstadoHallazgo | null =>
  conEstado(id) ? (m.rea.includes(clave) ? 'realizado' : 'por_realizar') : null;

/** Todos los hallazgos de un diente, como cambios «quitar» (para «sano» y para los efectos). */
function hallazgosDe(m: MarcaDiente, filtro?: (t: TipoHallazgo) => boolean): CambioHallazgo[] {
  const out: CambioHallazgo[] = [];
  const pasa = (t: TipoHallazgo) => !filtro || filtro(t);
  if (pasa('caries'))
    for (const l of m.car)
      out.push({
        tipo: 'caries',
        cara: l.cara,
        clase: l.cl,
        estado: estadoDe(m, 'car:' + l.cara, 'car'),
        accion: 'quitar',
      });
  if (m.ext && pasa('extraccion_indicada'))
    out.push({ tipo: 'extraccion_indicada', estado: estadoDe(m, 'ext', 'ext'), accion: 'quitar' });
  if (m.per && pasa('periodontal'))
    out.push({ tipo: 'periodontal', estado: estadoDe(m, 'per', 'per'), accion: 'quitar' });
  for (const id of m.mk) {
    const t = TIPO_DE_MARCADOR[id];
    if (!pasa(t)) continue;
    const c: CambioHallazgo = { tipo: t, estado: estadoDe(m, id, id), accion: 'quitar' };
    if (id === 'movilidad') c.grado = m.mov;
    out.push(c);
  }
  return out;
}

const clon = (m: MarcaDiente): MarcaDiente => ({
  car: m.car.map((l) => ({ ...l })),
  ext: m.ext,
  per: m.per,
  mk: m.mk.slice(),
  rea: m.rea.slice(),
  mov: m.mov,
});

export interface OpcionesToque {
  herramienta: Herramienta;
  estadoNuevo: EstadoHallazgo;
  clase?: ClaseElegida;
}

/**
 * Traduce un toque a un evento (o a un rechazo con mensaje). `actual` es el diente tal como está en
 * el estado que recibió el componente (puede venir sin normalizar).
 */
export function resolverToque(
  actual: unknown,
  i: InfoDiente,
  toque: Toque,
  op: OpcionesToque,
): ResultadoToque {
  const fdi = String(i.fdi);
  const antes = normM(actual);
  const m = clon(antes);
  const rea = op.estadoNuevo === 'realizado';
  const nuevoEstado = (id: string): EstadoHallazgo | null =>
    conEstado(id) ? op.estadoNuevo : null;
  const aus = m.mk.includes('ausente');
  const rechazo = (mensaje: string): ResultadoToque => ({
    tipo: 'rechazo',
    fdi,
    mensaje: `${fdi}: ${mensaje}`,
  });
  const h = op.herramienta;
  let principal: CambioHallazgo;
  let efectos: CambioHallazgo[] = [];
  let msg: string;

  if (h === 'sano') {
    const todos = hallazgosDe(antes);
    const [primero, ...resto] = todos;
    if (!primero) return rechazo('ya está sin marcas');
    principal = primero;
    efectos = resto;
    m.car = [];
    m.ext = false;
    m.per = false;
    m.mk = [];
    m.rea = [];
    m.mov = 0;
    msg = 'sin marcas';
  } else if (h === 'caries') {
    if (m.ext) return rechazo('está marcado para extracción');
    if (aus) return rechazo('diente ausente');
    if (!toque.cara) return rechazo('tocá la corona del diente para marcar la caries');
    const r = elegirClase(i, toque.cara, op.clase ?? 'auto');
    if ('error' in r) return { tipo: 'rechazo', fdi, mensaje: r.error };
    const k = m.car.findIndex((x) => x.cara === r.cara);
    const nom = nombreCara(i, CARA[r.cara]);
    const previa = k >= 0 ? m.car[k] : undefined;
    if (previa && previa.cl === r.cl) {
      principal = {
        tipo: 'caries',
        cara: r.cara,
        clase: r.cl,
        estado: estadoDe(antes, 'car:' + r.cara, 'car'),
        accion: 'quitar',
      };
      m.car.splice(k, 1);
      msg = `caries clase ${r.cl} ${nom} quitada`;
    } else {
      if (previa) {
        efectos.push({
          tipo: 'caries',
          cara: previa.cara,
          clase: previa.cl,
          estado: estadoDe(antes, 'car:' + previa.cara, 'car'),
          accion: 'quitar',
        });
        m.car.splice(k, 1);
      }
      m.car.push({ cl: r.cl, cara: r.cara });
      m.rea = m.rea.filter((x) => x !== 'car:' + r.cara);
      if (rea) m.rea.push('car:' + r.cara);
      principal = {
        tipo: 'caries',
        cara: r.cara,
        clase: r.cl,
        estado: op.estadoNuevo,
        accion: 'agregar',
      };
      msg = `caries clase ${r.cl}, cara ${nom}` + (rea ? ' (realizado)' : '');
    }
  } else if (h === 'extraccion_indicada' || h === 'periodontal') {
    if (aus) return rechazo('diente ausente');
    const clave = h === 'extraccion_indicada' ? 'ext' : 'per';
    const on = !m[clave];
    m[clave] = on;
    if (on) {
      m.rea = m.rea.filter((x) => x !== clave);
      if (rea) m.rea.push(clave);
      principal = { tipo: h, estado: op.estadoNuevo, accion: 'agregar' };
      if (clave === 'ext' && m.car.length) {
        efectos = hallazgosDe(antes, (t) => t === 'caries');
        m.car = [];
      }
    } else principal = { tipo: h, estado: estadoDe(antes, clave, clave), accion: 'quitar' };
    msg =
      clave === 'ext'
        ? on
          ? 'extracción marcada'
          : 'extracción quitada'
        : on
          ? 'problema periodontal marcado'
          : 'problema periodontal quitado';
  } else {
    const id = marcadorDeTipo(h) as Marcador;
    const k = m.mk.indexOf(id);
    if (id === 'movilidad') {
      // cada toque sube el grado I → II → III; el cuarto lo quita
      if (k < 0) {
        m.mk.push(id);
        m.mov = 1;
        m.rea = m.rea.filter((x) => x !== id);
        if (rea) m.rea.push(id);
        principal = { tipo: h, grado: 1, estado: op.estadoNuevo, accion: 'agregar' };
      } else if (m.mov < 3) {
        m.mov++;
        // subir de grado cierra el hallazgo del grado anterior y abre uno nuevo (conserva su estado)
        const est = estadoDe(antes, id, id);
        principal = { tipo: h, grado: m.mov, estado: est, accion: 'agregar' };
        efectos.push({ tipo: h, grado: antes.mov, estado: est, accion: 'quitar' });
      } else {
        principal = { tipo: h, grado: m.mov, estado: estadoDe(antes, id, id), accion: 'quitar' };
        m.mk.splice(k, 1);
        m.mov = 0;
      }
      msg = m.mov ? `movilidad grado ${ROM[m.mov] ?? ''}` : 'movilidad quitada';
    } else {
      if (k >= 0) {
        principal = { tipo: h, estado: estadoDe(antes, id, id), accion: 'quitar' };
        m.mk.splice(k, 1);
      } else {
        m.mk.push(id);
        m.rea = m.rea.filter((x) => x !== id);
        if (rea && conEstado(id)) m.rea.push(id);
        principal = { tipo: h, estado: nuevoEstado(id), accion: 'agregar' };
        if (id === 'ausente') {
          efectos = hallazgosDe(
            antes,
            (t) => t === 'caries' || t === 'extraccion_indicada' || t === 'periodontal',
          );
          m.car = [];
          m.ext = false;
          m.per = false;
        }
      }
      msg = `${CATALOGO[h].nombre.toLowerCase()} ${k >= 0 ? 'quitado' : 'marcado'}`;
    }
  }
  const final = normM(m);
  return {
    tipo: 'cambio',
    evento: {
      ...principal,
      fdi,
      herramienta: h,
      efectos,
      marca: estaSano(final) ? null : final,
      mensaje: `${fdi} · ${msg}`,
    },
  };
}
