import {
  preguntaSchema,
  SECCIONES_ANAMNESIS,
  TIPOS_ALERTA,
  TIPOS_PREGUNTA,
  type Pregunta,
  type ReglaAlerta,
  type TipoAlerta,
  type TipoPregunta,
} from '@conecta/shared';
import { Boton, Campo, HojaInferior } from '@conecta/ui';
import { useId, useState, type FormEvent } from 'react';
import { useTextos } from '../../i18n/idioma.js';
import { leerNumero } from '../pacientes/respuestasAnamnesis.js';
import { CasillaVerificacion } from '../personal/componentes.js';

/*
 * Hoja para crear o editar una pregunta del cuestionario. Trabaja con textos (lo que se tipea) y
 * al confirmar arma la `Pregunta` con el esquema del contrato. El código y el valor de cada opción
 * son estables: se proponen a partir del texto al crearlos y después no cambian.
 */

interface BorradorAlerta {
  tipo: TipoAlerta;
  texto: string;
  gravedad: 'alta' | 'media';
  grupoAlergia: string;
}

interface BorradorOpcion {
  /** Valor estable; vacío = opción nueva (se propone al confirmar). */
  valor: string;
  etiqueta: string;
  alerta: BorradorAlerta | null;
  /** Clave de React: no cambia aunque cambie la etiqueta. */
  clave: number;
}

interface Borrador {
  codigo: string;
  texto: string;
  seccion: string;
  tipo: TipoPregunta;
  obligatoria: boolean;
  conDetalle: boolean;
  unidad: string;
  minimo: string;
  maximo: string;
  soloSexoF: boolean;
  alertaSi: BorradorAlerta | null;
  opciones: BorradorOpcion[];
}

/** «Alergia al látex» → «alergia_al_latex» (minúsculas, sin tildes, hasta `max`). */
export function aCodigo(texto: string, max = 40): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
    .replace(/_+$/g, '');
}

/** El primero libre: base, base_2, base_3… */
function libre(base: string, usados: Set<string>, max = 40): string {
  if (!usados.has(base)) return base;
  for (let n = 2; ; n++) {
    const sufijo = `_${n}`;
    const candidato = `${base.slice(0, max - sufijo.length)}${sufijo}`;
    if (!usados.has(candidato)) return candidato;
  }
}

const alertaVacia = (tipo: TipoAlerta): BorradorAlerta => ({
  tipo,
  texto: '',
  gravedad: 'alta',
  grupoAlergia: '',
});

const deAlerta = (a: ReglaAlerta | null): BorradorAlerta | null =>
  a
    ? { tipo: a.tipo, texto: a.texto, gravedad: a.gravedad, grupoAlergia: a.grupoAlergia ?? '' }
    : null;

const aAlerta = (a: BorradorAlerta | null) =>
  a
    ? {
        tipo: a.tipo,
        texto: a.texto,
        gravedad: a.gravedad,
        grupoAlergia: a.grupoAlergia.trim() ? a.grupoAlergia.trim() : null,
      }
    : null;

let claveOpcion = 0;

function aBorrador(p: Pregunta | null, seccion: number): Borrador {
  return {
    codigo: p?.codigo ?? '',
    texto: p?.texto ?? '',
    seccion: String(p?.seccion ?? seccion),
    tipo: p?.tipo ?? 'si_no',
    obligatoria: p?.obligatoria ?? false,
    conDetalle: p?.conDetalle ?? false,
    unidad: p?.unidad ?? '',
    minimo: p?.minimo != null ? String(p.minimo) : '',
    maximo: p?.maximo != null ? String(p.maximo) : '',
    soloSexoF: p?.soloSexo === 'F',
    alertaSi: deAlerta(p?.alertaSiSi ?? null),
    opciones: (p?.opciones ?? []).map((o) => ({
      valor: o.valor,
      etiqueta: o.etiqueta,
      alerta: deAlerta(o.alerta),
      clave: ++claveOpcion,
    })),
  };
}

function CamposAlerta({
  alerta,
  errores,
  prefijo,
  onCambio,
}: {
  alerta: BorradorAlerta;
  errores: Record<string, string>;
  prefijo: string;
  onCambio: (a: BorradorAlerta) => void;
}) {
  const t = useTextos().cuestionario.hoja;
  return (
    <div className="w-cuest-alerta">
      <div className="w-form-paciente__fila">
        <Campo
          etiqueta={t.alertaTipo}
          tipo="select"
          value={alerta.tipo}
          opciones={TIPOS_ALERTA.map((v) => ({ valor: v, texto: t.alertaTipos[v] }))}
          onChange={(e) => onCambio({ ...alerta, tipo: e.target.value as TipoAlerta })}
        />
        <Campo
          etiqueta={t.gravedad}
          tipo="select"
          value={alerta.gravedad}
          opciones={(['alta', 'media'] as const).map((v) => ({ valor: v, texto: t.gravedades[v] }))}
          onChange={(e) => onCambio({ ...alerta, gravedad: e.target.value as 'alta' | 'media' })}
        />
      </div>
      <Campo
        etiqueta={t.alertaTexto}
        ayuda={t.alertaTextoAyuda}
        requerido
        maxLength={120}
        value={alerta.texto}
        onChange={(e) => onCambio({ ...alerta, texto: e.target.value })}
        error={errores[`${prefijo}.texto`]}
      />
      {alerta.tipo === 'alergia' ? (
        <Campo
          etiqueta={t.grupoAlergia}
          ayuda={t.grupoAlergiaAyuda}
          maxLength={40}
          value={alerta.grupoAlergia}
          onChange={(e) => onCambio({ ...alerta, grupoAlergia: e.target.value })}
          error={errores[`${prefijo}.grupoAlergia`]}
        />
      ) : null}
    </div>
  );
}

export function EditorPregunta({
  pregunta,
  seccion,
  codigosUsados,
  onListo,
  onCerrar,
}: {
  /** `null` = pregunta nueva. */
  pregunta: Pregunta | null;
  /** Sección donde se agrega (pregunta nueva). */
  seccion: number;
  /** Códigos de las demás preguntas (para no repetir). */
  codigosUsados: Set<string>;
  onListo: (p: Pregunta) => void;
  onCerrar: () => void;
}) {
  const textos = useTextos().cuestionario;
  const t = textos.hoja;
  const idForm = useId();
  const [b, setB] = useState<Borrador>(() => aBorrador(pregunta, seccion));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const nueva = pregunta === null;
  const cambiar = (c: Partial<Borrador>) => setB((x) => ({ ...x, ...c }));

  /** Mensaje en español para cada campo (los del esquema que no traen uno propio). */
  function mensaje(campo: string, delEsquema: string): string {
    if (campo === 'texto') return t.faltaTexto;
    if (campo === 'codigo') return delEsquema;
    if (/(^|\.)alerta(SiSi)?\.texto$/.test(campo)) return t.faltaAlertaTexto;
    if (/\.grupoAlergia$/.test(campo)) return t.grupoInvalido;
    if (/^opciones\.\d+\.etiqueta$/.test(campo)) return t.faltaOpcion;
    if (campo === 'unidad') return t.unidadLarga;
    return t.revisar;
  }

  function confirmar(e: FormEvent) {
    e.preventDefault();
    const err: Record<string, string> = {};
    const codigo = nueva ? b.codigo.trim() || aCodigo(b.texto) : (pregunta?.codigo ?? '');
    if (nueva && codigosUsados.has(codigo)) err['codigo'] = t.codigoRepetido;

    const minimo = leerNumero(b.minimo);
    const maximo = leerNumero(b.maximo);
    if (b.tipo === 'numero') {
      if (Number.isNaN(minimo)) err['minimo'] = t.numeroInvalido;
      if (Number.isNaN(maximo)) err['maximo'] = t.numeroInvalido;
      if (minimo !== null && maximo !== null && minimo > maximo) err['maximo'] = t.rangoInvalido;
    }

    // Valores de opciones: los que ya existen no cambian; los nuevos salen de la etiqueta.
    const usados = new Set(b.opciones.filter((o) => o.valor).map((o) => o.valor));
    const opciones =
      b.tipo === 'multiple'
        ? b.opciones.map((o, i) => {
            let valor = o.valor;
            if (!valor) {
              valor = libre(aCodigo(o.etiqueta) || `opcion_${i + 1}`, usados);
              usados.add(valor);
            }
            return { valor, etiqueta: o.etiqueta, alerta: aAlerta(o.alerta) };
          })
        : [];
    if (b.tipo === 'multiple') {
      if (!opciones.length) err['opciones'] = t.faltanOpciones;
      const etiquetas = opciones.map((o) => o.etiqueta.trim().toLowerCase());
      if (new Set(etiquetas).size !== etiquetas.length) err['opciones'] = t.opcionRepetida;
    }

    const r = preguntaSchema.safeParse({
      codigo,
      seccion: Number(b.seccion),
      orden: pregunta?.orden ?? 999,
      texto: b.texto,
      tipo: b.tipo,
      opciones,
      alertaSiSi: b.tipo === 'si_no' ? aAlerta(b.alertaSi) : null,
      conDetalle: (b.tipo === 'si_no' || b.tipo === 'multiple') && b.conDetalle,
      unidad: b.tipo === 'numero' && b.unidad.trim() ? b.unidad.trim() : null,
      minimo: b.tipo === 'numero' && minimo !== null && !Number.isNaN(minimo) ? minimo : null,
      maximo: b.tipo === 'numero' && maximo !== null && !Number.isNaN(maximo) ? maximo : null,
      soloSexo: b.soloSexoF ? 'F' : null,
      obligatoria: b.obligatoria,
      activa: pregunta?.activa ?? true,
    });
    if (!r.success) {
      for (const issue of r.error.issues) {
        const campo = issue.path.join('.');
        err[campo] ??= mensaje(campo, issue.message);
      }
    }
    if (Object.keys(err).length || !r.success) {
      setErrores(err);
      return;
    }
    onListo(r.data);
  }

  const errorOpcion = (i: number) =>
    errores[`opciones.${i}.etiqueta`] ?? errores[`opciones.${i}.valor`];

  return (
    <HojaInferior
      abierta
      titulo={nueva ? t.tituloNueva : t.tituloEditar}
      onCerrar={onCerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={onCerrar}>
            {t.cancelar}
          </Boton>
          <Boton type="submit" form={idForm} variante="primario">
            {t.listo}
          </Boton>
        </>
      }
    >
      <form id={idForm} className="w-formulario" onSubmit={confirmar} noValidate>
        <Campo
          etiqueta={t.texto}
          ayuda={t.textoAyuda}
          tipo="textarea"
          rows={2}
          requerido
          maxLength={200}
          value={b.texto}
          onChange={(e) => cambiar({ texto: e.target.value })}
          error={errores['texto']}
        />
        {nueva ? (
          <Campo
            etiqueta={t.codigo}
            ayuda={t.codigoAyuda}
            maxLength={40}
            autoComplete="off"
            placeholder={aCodigo(b.texto) || undefined}
            value={b.codigo}
            onChange={(e) => cambiar({ codigo: e.target.value })}
            error={errores['codigo']}
          />
        ) : (
          <p className="w-secundario">
            {t.codigo}: <code>{pregunta.codigo}</code>. {t.codigoFijo}
          </p>
        )}
        <div className="w-form-paciente__fila">
          <Campo
            etiqueta={t.seccion}
            tipo="select"
            value={b.seccion}
            opciones={SECCIONES_ANAMNESIS.map((s) => ({
              valor: String(s.numero),
              texto: textos.seccion(s.numero, s.titulo),
            }))}
            onChange={(e) => cambiar({ seccion: e.target.value })}
          />
          <Campo
            etiqueta={t.tipo}
            tipo="select"
            value={b.tipo}
            opciones={TIPOS_PREGUNTA.map((v) => ({ valor: v, texto: textos.tipos[v] }))}
            onChange={(e) => {
              const tipo = e.target.value as TipoPregunta;
              cambiar({
                tipo,
                opciones:
                  tipo === 'multiple' && !b.opciones.length
                    ? [{ valor: '', etiqueta: '', alerta: null, clave: ++claveOpcion }]
                    : b.opciones,
              });
            }}
          />
        </div>
        <CasillaVerificacion
          etiqueta={t.obligatoria}
          marcada={b.obligatoria}
          onCambio={(m) => cambiar({ obligatoria: m })}
        />
        {b.tipo === 'si_no' || b.tipo === 'multiple' ? (
          <CasillaVerificacion
            etiqueta={t.conDetalle}
            marcada={b.conDetalle}
            onCambio={(m) => cambiar({ conDetalle: m })}
          />
        ) : null}
        <CasillaVerificacion
          etiqueta={t.soloSexoF}
          marcada={b.soloSexoF}
          onCambio={(m) => cambiar({ soloSexoF: m })}
        />

        {b.tipo === 'numero' ? (
          <div className="w-form-paciente__fila">
            <Campo
              etiqueta={t.unidad}
              ayuda={t.unidadAyuda}
              maxLength={20}
              value={b.unidad}
              onChange={(e) => cambiar({ unidad: e.target.value })}
              error={errores['unidad']}
            />
            <Campo
              etiqueta={t.minimo}
              inputMode="decimal"
              value={b.minimo}
              onChange={(e) => cambiar({ minimo: e.target.value })}
              error={errores['minimo']}
            />
            <Campo
              etiqueta={t.maximo}
              inputMode="decimal"
              value={b.maximo}
              onChange={(e) => cambiar({ maximo: e.target.value })}
              error={errores['maximo']}
            />
          </div>
        ) : null}

        {b.tipo === 'si_no' ? (
          <>
            <CasillaVerificacion
              etiqueta={t.alertaSi}
              marcada={b.alertaSi !== null}
              onCambio={(m) => cambiar({ alertaSi: m ? alertaVacia('condicion') : null })}
            />
            {b.alertaSi ? (
              <CamposAlerta
                alerta={b.alertaSi}
                errores={errores}
                prefijo="alertaSiSi"
                onCambio={(a) => cambiar({ alertaSi: a })}
              />
            ) : null}
          </>
        ) : null}

        {b.tipo === 'multiple' ? (
          <fieldset className="w-cuest-opciones">
            <legend className="cn-campo__etiqueta">{t.opciones}</legend>
            <p className="w-secundario">{t.opcionesAyuda}</p>
            {errores['opciones'] ? (
              <p className="w-error-campo" role="alert">
                {errores['opciones']}
              </p>
            ) : null}
            <ol className="w-cuest-opciones__lista">
              {b.opciones.map((o, i) => (
                <li key={o.clave} className="w-cuest-opcion">
                  <Campo
                    etiqueta={t.opcion(i + 1)}
                    maxLength={80}
                    value={o.etiqueta}
                    onChange={(e) =>
                      cambiar({
                        opciones: b.opciones.map((x) =>
                          x.clave === o.clave ? { ...x, etiqueta: e.target.value } : x,
                        ),
                      })
                    }
                    error={errorOpcion(i)}
                  />
                  <CasillaVerificacion
                    etiqueta={t.alertaOpcion}
                    marcada={o.alerta !== null}
                    onCambio={(m) =>
                      cambiar({
                        opciones: b.opciones.map((x) =>
                          x.clave === o.clave
                            ? { ...x, alerta: m ? alertaVacia('alergia') : null }
                            : x,
                        ),
                      })
                    }
                  />
                  {o.alerta ? (
                    <CamposAlerta
                      alerta={o.alerta}
                      errores={errores}
                      prefijo={`opciones.${i}.alerta`}
                      onCambio={(a) =>
                        cambiar({
                          opciones: b.opciones.map((x) =>
                            x.clave === o.clave ? { ...x, alerta: a } : x,
                          ),
                        })
                      }
                    />
                  ) : null}
                  <div>
                    <Boton
                      variante="fantasma"
                      icono="cerrar"
                      aria-label={t.quitarOpcion(o.etiqueta)}
                      onClick={() =>
                        cambiar({ opciones: b.opciones.filter((x) => x.clave !== o.clave) })
                      }
                    >
                      {t.quitar}
                    </Boton>
                  </div>
                </li>
              ))}
            </ol>
            <div>
              <Boton
                variante="secundario"
                icono="mas"
                onClick={() =>
                  cambiar({
                    opciones: [
                      ...b.opciones,
                      { valor: '', etiqueta: '', alerta: null, clave: ++claveOpcion },
                    ],
                  })
                }
              >
                {t.agregarOpcion}
              </Boton>
            </div>
          </fieldset>
        ) : null}
        {Object.keys(errores).length ? (
          <p className="w-error-campo" role="alert">
            {t.revisar}
          </p>
        ) : null}
      </form>
    </HojaInferior>
  );
}
