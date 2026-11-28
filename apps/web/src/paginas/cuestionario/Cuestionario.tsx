import { reemplazarPreguntasSchema, SECCIONES_ANAMNESIS, type Pregunta } from '@conecta/shared';
import { AvisoExito, Boton, Chip, EncabezadoPagina } from '@conecta/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { AvisoPersistente, Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { clavesAnamnesis, useCatalogoCompleto } from '../pacientes/consultasAnamnesis.js';
import { EditorPregunta } from './EditorPregunta.js';
import './cuestionario.css';

/** Cuántas alertas puede dejar una pregunta (la de «sí» o una por opción). */
function alertasDe(p: Pregunta): number {
  if (p.tipo === 'si_no') return p.alertaSiSi ? 1 : 0;
  if (p.tipo === 'multiple') return p.opciones.filter((o) => o.alerta).length;
  return 0;
}

/** Orden por sección y orden; al guardar, `orden` se renumera de a 5 dentro de cada sección. */
function ordenar(lista: Pregunta[]): Pregunta[] {
  return [...lista].sort((a, b) => a.seccion - b.seccion || a.orden - b.orden);
}

function renumerar(lista: Pregunta[]): Pregunta[] {
  const salida: Pregunta[] = [];
  for (const s of SECCIONES_ANAMNESIS) {
    ordenar(lista)
      .filter((p) => p.seccion === s.numero)
      .forEach((p, i) => salida.push({ ...p, orden: Math.min(i * 5, 999) }));
  }
  return salida;
}

function FilaPregunta({
  pregunta: p,
  primera,
  ultima,
  onSubir,
  onBajar,
  onEditar,
  onActivar,
}: {
  pregunta: Pregunta;
  primera: boolean;
  ultima: boolean;
  onSubir: () => void;
  onBajar: () => void;
  onEditar: () => void;
  onActivar: (activa: boolean) => void;
}) {
  const t = useTextos().cuestionario;
  const alertas = alertasDe(p);
  return (
    <li className={`w-cuest-fila${p.activa ? '' : ' w-cuest-fila--inactiva'}`}>
      <div className="w-cuest-fila__cuerpo">
        <p className="w-cuest-fila__texto">{p.texto}</p>
        <span className="w-chips">
          <Chip tono="categoria">{t.tipos[p.tipo]}</Chip>
          {p.activa ? (
            <Chip tono="exito" icono="check">
              {t.activa}
            </Chip>
          ) : (
            <Chip tono="neutro" icono="cerrar">
              {t.inactiva}
            </Chip>
          )}
          {p.obligatoria ? <Chip tono="info">{t.obligatoria}</Chip> : null}
          {p.soloSexo === 'F' ? <Chip tono="neutro">{t.soloSexoF}</Chip> : null}
          {alertas ? (
            <Chip tono="atencion" icono="alerta">
              {t.conAlerta(alertas)}
            </Chip>
          ) : null}
        </span>
        {p.tipo === 'multiple' ? (
          <p className="w-secundario">{p.opciones.map((o) => o.etiqueta).join(' · ')}</p>
        ) : null}
      </div>
      <div className="w-cuest-fila__acciones">
        <Boton
          variante="fantasma"
          icono="sube"
          aria-label={t.subirDe(p.texto)}
          disabled={primera}
          onClick={onSubir}
        >
          {t.subir}
        </Boton>
        <Boton
          variante="fantasma"
          icono="baja"
          aria-label={t.bajarDe(p.texto)}
          disabled={ultima}
          onClick={onBajar}
        >
          {t.bajar}
        </Boton>
        <Boton variante="secundario" aria-label={t.editarDe(p.texto)} onClick={onEditar}>
          {t.editar}
        </Boton>
        <Boton
          variante="fantasma"
          aria-label={p.activa ? t.desactivarDe(p.texto) : t.activarDe(p.texto)}
          onClick={() => onActivar(!p.activa)}
        >
          {p.activa ? t.desactivar : t.activar}
        </Boton>
      </div>
    </li>
  );
}

function Seccion({
  numero,
  titulo,
  preguntas,
  onMover,
  onEditar,
  onActivar,
  onAgregar,
}: {
  numero: number;
  titulo: string;
  preguntas: Pregunta[];
  onMover: (codigo: string, delta: -1 | 1) => void;
  onEditar: (p: Pregunta) => void;
  onActivar: (codigo: string, activa: boolean) => void;
  onAgregar: () => void;
}) {
  const t = useTextos().cuestionario;
  const id = useId();
  return (
    <section className="w-tarjeta w-cuest-seccion" aria-labelledby={id}>
      <div className="w-tarjeta__cabecera">
        <h2 id={id} className="w-seccion-ficha__titulo">
          {t.seccion(numero, titulo)}
        </h2>
        <Boton
          variante="secundario"
          icono="mas"
          aria-label={t.agregarEn(titulo)}
          onClick={onAgregar}
        >
          {t.agregar}
        </Boton>
      </div>
      {preguntas.length ? (
        <ol className="w-cuest-lista">
          {preguntas.map((p, i) => (
            <FilaPregunta
              key={p.codigo}
              pregunta={p}
              primera={i === 0}
              ultima={i === preguntas.length - 1}
              onSubir={() => onMover(p.codigo, -1)}
              onBajar={() => onMover(p.codigo, 1)}
              onEditar={() => onEditar(p)}
              onActivar={(a) => onActivar(p.codigo, a)}
            />
          ))}
        </ol>
      ) : (
        <p className="w-secundario">{t.vacioSeccion}</p>
      )}
    </section>
  );
}

/**
 * Catálogo de preguntas de la anamnesis (`configuracion:editar`). Se edita una copia local y se
 * guarda entero (`PUT /anamnesis/preguntas`): agregar, reordenar, desactivar, opciones y alertas.
 */
export function Cuestionario() {
  const t = useTextos().cuestionario;
  const { api, sesion } = useSesionLista();
  const consultas = useQueryClient();
  const unaVez = useEnvioUnico();
  // Catálogo completo, con las inactivas (`configuracion:editar`): se pueden reactivar.
  const catalogo = useCatalogoCompleto();
  const [lista, setLista] = useState<Pregunta[] | null>(null);
  const [cambios, setCambios] = useState(false);
  const [hoja, setHoja] = useState<{ pregunta: Pregunta | null; seccion: number } | null>(null);
  const [aviso, setAviso] = useState(false);
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  // La copia local nace con el catálogo cargado (estado derivado, sin efecto).
  if (lista === null && catalogo.data) setLista(ordenar(catalogo.data.preguntas));

  const guardar = useMutation({
    mutationFn: (preguntas: Pregunta[]) => api.anamnesis.reemplazarPreguntas({ preguntas }),
    onSuccess: (r) => {
      // La respuesta trae también las inactivas: quedan a mano para reactivarlas.
      setLista(ordenar(r.preguntas));
      setCambios(false);
      setAviso(true);
      consultas.setQueryData(clavesAnamnesis.catalogo(sesion.clinica.id), {
        preguntas: ordenar(r.preguntas),
      });
      consultas.setQueryData(clavesAnamnesis.preguntas(sesion.clinica.id), {
        preguntas: ordenar(r.preguntas.filter((p) => p.activa)),
      });
    },
  });

  const encabezado = <EncabezadoPagina titulo={t.titulo} />;
  if (lista === null) {
    if (catalogo.isError) {
      return (
        <>
          {encabezado}
          <MensajeError error={catalogo.error} onReintentar={() => void catalogo.refetch()} />
        </>
      );
    }
    return (
      <>
        {encabezado}
        <Esqueleto filas={6} etiqueta={t.cargando} />
      </>
    );
  }

  const cambiar = (nueva: Pregunta[]) => {
    setLista(nueva);
    setCambios(true);
    setAviso(false);
    setErrorLocal(null);
    guardar.reset();
  };

  function mover(codigo: string, delta: -1 | 1) {
    if (!lista) return;
    const p = lista.find((x) => x.codigo === codigo);
    if (!p) return;
    const seccion = ordenar(lista).filter((x) => x.seccion === p.seccion);
    const i = seccion.findIndex((x) => x.codigo === codigo);
    const j = i + delta;
    const otra = seccion[j];
    if (!otra) return;
    [seccion[i], seccion[j]] = [otra, p];
    const renumeradas = new Map(seccion.map((x, k) => [x.codigo, k * 5]));
    cambiar(
      ordenar(
        lista.map((x) =>
          renumeradas.has(x.codigo) ? { ...x, orden: renumeradas.get(x.codigo) ?? x.orden } : x,
        ),
      ),
    );
  }

  function listo(p: Pregunta) {
    if (!lista || !hoja) return;
    const editada = hoja.pregunta;
    if (editada) {
      // Cambió de sección: va al final de la nueva.
      const orden =
        p.seccion === editada.seccion
          ? editada.orden
          : Math.max(-5, ...lista.filter((x) => x.seccion === p.seccion).map((x) => x.orden)) + 5;
      cambiar(ordenar(lista.map((x) => (x.codigo === editada.codigo ? { ...p, orden } : x))));
    } else {
      const orden =
        Math.max(-5, ...lista.filter((x) => x.seccion === p.seccion).map((x) => x.orden)) + 5;
      cambiar(ordenar([...lista, { ...p, orden: Math.min(orden, 999) }]));
    }
    setHoja(null);
  }

  function enviar() {
    if (!lista) return;
    const preguntas = renumerar(lista);
    const r = reemplazarPreguntasSchema.safeParse({ preguntas });
    if (!r.success) {
      setErrorLocal(t.errorGuardar);
      return;
    }
    setErrorLocal(null);
    void unaVez(() => guardar.mutateAsync(r.data.preguntas).catch(() => undefined));
  }

  const usados = new Set(
    lista.filter((p) => p.codigo !== hoja?.pregunta?.codigo).map((p) => p.codigo),
  );

  return (
    <div className="w-cuestionario">
      {encabezado}
      <p className="w-secundario w-cuestionario__texto">{t.texto}</p>
      {aviso ? (
        <AvisoExito titulo={t.guardado} texto={t.guardadoTexto} onCerrar={() => setAviso(false)} />
      ) : null}
      {SECCIONES_ANAMNESIS.map((s) => (
        <Seccion
          key={s.numero}
          numero={s.numero}
          titulo={s.titulo}
          preguntas={lista.filter((p) => p.seccion === s.numero)}
          onMover={mover}
          onEditar={(p) => setHoja({ pregunta: p, seccion: p.seccion })}
          onActivar={(codigo, activa) =>
            cambiar(lista.map((x) => (x.codigo === codigo ? { ...x, activa } : x)))
          }
          onAgregar={() => setHoja({ pregunta: null, seccion: s.numero })}
        />
      ))}

      <div className="w-cuestionario__pie">
        {cambios ? <AvisoPersistente titulo={t.sinGuardar} /> : null}
        {errorLocal ? <MensajeError texto={errorLocal} /> : null}
        {guardar.isError ? <MensajeError error={guardar.error} /> : null}
        <div className="w-botonera">
          {cambios ? (
            <Boton
              variante="secundario"
              onClick={() => {
                setLista(catalogo.data ? ordenar(catalogo.data.preguntas) : lista);
                setCambios(false);
                setErrorLocal(null);
                guardar.reset();
              }}
            >
              {t.descartar}
            </Boton>
          ) : null}
          <Boton
            variante="primario"
            disabled={!cambios}
            cargando={guardar.isPending}
            onClick={enviar}
          >
            {t.guardar}
          </Boton>
        </div>
      </div>

      {hoja ? (
        <EditorPregunta
          pregunta={hoja.pregunta}
          seccion={hoja.seccion}
          codigosUsados={usados}
          onListo={listo}
          onCerrar={() => setHoja(null)}
        />
      ) : null}
    </div>
  );
}
