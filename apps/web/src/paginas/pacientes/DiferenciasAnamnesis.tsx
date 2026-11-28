import type { Anamnesis, Pregunta, Respuesta } from '@conecta/shared';
import { Boton, Chip, Icono } from '@conecta/ui';
import type { Textos } from '../../i18n/es.js';
import { useTextos } from '../../i18n/idioma.js';
import { CasillaVerificacion } from '../personal/componentes.js';
import {
  alertasDe,
  armarRespuesta,
  describirRespuesta,
  mismaRespuesta,
  respuestaDeGuardada,
  VALOR_VACIO,
  valorDeRespuesta,
  type ValoresFormulario,
  type ValorPregunta,
} from './respuestasAnamnesis.js';

type TextosForm = Textos['pacientes']['formularioAnamnesis'];

/** Una pregunta en la que la versión que guardó otra persona y este formulario no coinciden. */
export interface FilaDiferencia {
  codigo: string;
  pregunta: string;
  /** Lo que guardó la otra persona. */
  suya: string;
  alertasSuya: string[];
  /** Lo que tiene este formulario. */
  nuestra: string;
  alertasNuestra: string[];
  /** Valor para «Usar la de la versión N» (`null` si la pregunta ya no está en el formulario). */
  usar: ValorPregunta | null;
}

/**
 * Diferencias por pregunta entre una versión guardada y lo que tiene el formulario. Primero las
 * que dejan (o sacan) una alerta médica.
 */
export function filasDiferencias(
  preguntas: Pregunta[],
  version: Anamnesis,
  valores: ValoresFormulario,
  t: TextosForm,
): FilaDiferencia[] {
  const suyas = new Map(version.respuestas.map((r) => [r.codigo, r]));
  const filas: FilaDiferencia[] = [];
  for (const p of preguntas) {
    const g = suyas.get(p.codigo);
    const suya: Respuesta | undefined = g ? respuestaDeGuardada(g) : undefined;
    const nuestra = armarRespuesta(p, valores[p.codigo] ?? VALOR_VACIO, t).respuesta;
    if (mismaRespuesta(suya, nuestra)) continue;
    filas.push({
      codigo: p.codigo,
      pregunta: p.texto,
      suya: describirRespuesta(p, suya, t, g?.etiquetas),
      alertasSuya: alertasDe(p, suya),
      nuestra: describirRespuesta(p, nuestra, t),
      alertasNuestra: alertasDe(p, nuestra),
      usar: valorDeRespuesta(p, suya),
    });
  }
  // Lo que respondió a preguntas que este formulario ya no tiene.
  for (const g of version.respuestas) {
    if (preguntas.some((p) => p.codigo === g.codigo)) continue;
    filas.push({
      codigo: g.codigo,
      pregunta: g.pregunta,
      suya: describirRespuesta(
        { tipo: g.tipo, unidad: g.unidad, opciones: [] },
        respuestaDeGuardada(g),
        t,
        g.etiquetas,
      ),
      alertasSuya: version.alertasMedicas.filter((a) => a.codigo === g.codigo).map((a) => a.texto),
      nuestra: t.noEstaEnFormulario,
      alertasNuestra: [],
      usar: null,
    });
  }
  const conAlerta = (f: FilaDiferencia) =>
    f.alertasSuya.length || f.alertasNuestra.length ? 0 : 1;
  return filas.sort((a, b) => conAlerta(a) - conAlerta(b));
}

function Alertas({ textos }: { textos: string[] }) {
  if (!textos.length) return null;
  return (
    <span className="w-chips">
      {textos.map((a) => (
        <Chip key={a} tono="atencion" icono="alerta">
          {a}
        </Chip>
      ))}
    </span>
  );
}

/**
 * Después de un 409 por versión: qué guardó la otra persona y qué tiene este formulario, por
 * pregunta. Para volver a guardar hay que revisarlas (y se puede tomar la respuesta de la otra
 * versión en cada una).
 */
export function DiferenciasAnamnesis({
  version,
  filas,
  revisado,
  error,
  idRevisado,
  onRevisado,
  onUsar,
}: {
  version: Anamnesis;
  filas: FilaDiferencia[];
  revisado: boolean;
  error: string | undefined;
  idRevisado: string;
  onRevisado: (r: boolean) => void;
  onUsar: (codigo: string, valor: ValorPregunta) => void;
}) {
  const t = useTextos().pacientes.formularioAnamnesis;
  const quien = version.registradaPor ?? t.otraPersonaGenerica;
  return (
    <section className="w-tarjeta w-anam-diferencias" aria-labelledby={`${idRevisado}-titulo`}>
      <div className="w-aviso-atencion" role="status">
        <Icono nombre="alerta" tamano={22} />
        <div className="w-aviso-atencion__cuerpo">
          <h2 id={`${idRevisado}-titulo`} className="w-aviso-atencion__titulo">
            {t.diferenciasTitulo(version.version, quien)}
          </h2>
          <p className="w-aviso-atencion__texto">
            {filas.length ? t.diferenciasTexto(version.version) : t.sinDiferencias(version.version)}
          </p>
        </div>
      </div>
      {filas.length ? (
        <ul className="w-anam-diferencias__lista">
          {filas.map((f) => (
            <li key={f.codigo} className="w-anam-diferencia">
              <p className="w-anam-diferencia__pregunta">{f.pregunta}</p>
              <dl className="w-anam-diferencia__lados">
                <div>
                  <dt>{t.enVersion(version.version)}</dt>
                  <dd>
                    {f.suya} <Alertas textos={f.alertasSuya} />
                  </dd>
                </div>
                <div>
                  <dt>{t.enFormulario}</dt>
                  <dd>
                    {f.nuestra} <Alertas textos={f.alertasNuestra} />
                  </dd>
                </div>
              </dl>
              {f.usar ? (
                <div>
                  <Boton
                    variante="secundario"
                    aria-label={t.usarVersionDe(version.version, f.pregunta)}
                    onClick={() => f.usar && onUsar(f.codigo, f.usar)}
                  >
                    {t.usarVersion(version.version)}
                  </Boton>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {filas.length ? (
        <div id={idRevisado} tabIndex={-1}>
          <CasillaVerificacion
            etiqueta={t.revisado(version.version)}
            marcada={revisado}
            onCambio={onRevisado}
          />
          {error ? (
            <p className="w-error-campo w-anam-error">
              <Icono nombre="alerta" tamano={18} />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
