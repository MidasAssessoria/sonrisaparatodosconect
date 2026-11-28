import type { Anamnesis, Paciente, Pregunta } from '@conecta/shared';
import { AvisoExito, Boton, Campo, Chip, EstadoVacio, Icono } from '@conecta/ui';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ErrorConecta } from '../../api/errores.js';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFecha } from '../../utilidades/fechas.js';
import { usePreguntas, useVersionAnamnesis, useVersionesAnamnesis } from './consultasAnamnesis.js';
import { FormularioAnamnesis } from './FormularioAnamnesis.js';
import { VistaAnamnesis } from './VistaAnamnesis.js';
import './anamnesis.css';

/**
 * Carga lo que necesita el formulario (catálogo y versión vigente) y lo congela: si después se
 * vuelven a pedir las versiones (un conflicto al guardar), el formulario no se desarma ni pierde
 * lo escrito.
 */
function EditorAnamnesis({
  paciente,
  vigente,
  requiereTutor,
  onGuardada,
  onCancelar,
}: {
  paciente: Paciente;
  vigente: number | null;
  requiereTutor: boolean;
  onGuardada: (a: Anamnesis) => void;
  onCancelar: () => void;
}) {
  const t = useTextos().pacientes.formularioAnamnesis;
  const preguntas = usePreguntas();
  // La vigente al abrir: si cambia después (conflicto), no se vuelve a pedir ni a precargar.
  const [base] = useState(vigente);
  const version = useVersionAnamnesis(paciente.id, base);
  const [datos, setDatos] = useState<{ catalogo: Pregunta[]; vigente: Anamnesis | null } | null>(
    null,
  );
  const listo = preguntas.data && (base === null || version.data);
  // Se congela en el primer render con todo cargado (estado derivado, sin efecto).
  if (!datos && listo && preguntas.data) {
    setDatos({ catalogo: preguntas.data.preguntas, vigente: version.data ?? null });
  }

  if (datos) {
    return (
      <FormularioAnamnesis
        paciente={paciente}
        catalogo={datos.catalogo}
        vigente={datos.vigente}
        requiereTutor={requiereTutor}
        onGuardada={onGuardada}
        onCancelar={onCancelar}
      />
    );
  }
  const error = preguntas.error ?? version.error;
  if (error) {
    return (
      <>
        <MensajeError
          error={error}
          onReintentar={() => {
            if (preguntas.isError) void preguntas.refetch();
            if (version.isError) void version.refetch();
          }}
        />
        <Boton variante="secundario" onClick={onCancelar}>
          {t.cancelar}
        </Boton>
      </>
    );
  }
  return <Esqueleto filas={6} etiqueta={t.cargando} />;
}

/** Pestaña «Anamnesis»: versión vigente (o la elegida, de solo lectura) y «Actualizar». */
export function PestanaAnamnesis({ paciente }: { paciente: Paciente }) {
  const textos = useTextos().pacientes;
  const t = textos.anamnesis;
  const { puede, sesion } = useSesionLista();
  const zona = sesion.clinica.zonaHoraria;
  const [parametros, setParametros] = useSearchParams();
  const versiones = useVersionesAnamnesis(paciente.id);
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState<{ titulo: string; texto: string } | null>(null);

  const lista = versiones.data?.versiones ?? [];
  const vigente = lista[0]?.version ?? null;
  const pedida = Number(parametros.get('version'));
  const mostrar =
    Number.isInteger(pedida) && pedida > 0 && lista.some((v) => v.version === pedida)
      ? pedida
      : vigente;
  const detalle = useVersionAnamnesis(paciente.id, editando ? null : mostrar);
  const puedeActualizar = puede('ficha_clinica', 'crear') && paciente.activo;

  const verVersion = (v: number | null) =>
    setParametros(
      (p) => {
        const n = new URLSearchParams(p);
        if (v === null || v === vigente) n.delete('version');
        else n.set('version', String(v));
        return n;
      },
      { replace: true },
    );

  if (versiones.isPending) return <Esqueleto filas={5} etiqueta={t.cargando} />;
  if (versiones.isError && !versiones.data) {
    return <MensajeError error={versiones.error} onReintentar={() => void versiones.refetch()} />;
  }

  if (editando) {
    return (
      <EditorAnamnesis
        paciente={paciente}
        vigente={vigente}
        requiereTutor={versiones.data.requiereTutor}
        onCancelar={() => setEditando(false)}
        onGuardada={(a) => {
          setEditando(false);
          verVersion(null);
          setAviso({
            titulo: t.guardada(a.version),
            texto: t.guardadaAlertas(a.alertasMedicas.length),
          });
          window.scrollTo?.({ top: 0 });
        }}
      />
    );
  }

  const exito = aviso ? (
    <AvisoExito titulo={aviso.titulo} texto={aviso.texto} onCerrar={() => setAviso(null)} />
  ) : null;

  if (vigente === null) {
    return (
      <div className="w-anam">
        {exito}
        <EstadoVacio
          titulo={t.vacia}
          texto={puedeActualizar ? t.vaciaTexto : t.vaciaSinPermiso}
          accion={
            puedeActualizar ? (
              <Boton variante="primario" icono="mas" onClick={() => setEditando(true)}>
                {t.completar}
              </Boton>
            ) : undefined
          }
        />
      </div>
    );
  }

  const resumen = lista.find((v) => v.version === mostrar);
  const esVigente = mostrar === vigente;
  const noEsta = detalle.error instanceof ErrorConecta && detalle.error.codigo === 'no_encontrado';

  return (
    <div className="w-anam">
      {exito}
      <section className="w-tarjeta" aria-labelledby="w-anam-titulo">
        <div className="w-tarjeta__cabecera w-anam__cabecera">
          <div className="w-anam__titulo">
            <h2 id="w-anam-titulo" className="w-seccion-ficha__titulo">
              {t.titulo(mostrar ?? vigente)}
            </h2>
            {esVigente ? (
              <Chip tono="exito" icono="check">
                {t.vigente}
              </Chip>
            ) : (
              <Chip tono="neutro" icono="reloj">
                {t.anterior}
              </Chip>
            )}
          </div>
          {puedeActualizar ? (
            <Boton variante="primario" icono="archivo" onClick={() => setEditando(true)}>
              {t.actualizar}
            </Boton>
          ) : null}
        </div>
        {lista.length > 1 ? (
          <Campo
            className="w-anam__selector"
            etiqueta={t.verVersion}
            tipo="select"
            value={String(mostrar)}
            opciones={lista.map((v) => ({
              valor: String(v.version),
              texto: t.opcionVersion(v.version, formatoFecha(v.fecha, zona), v.version === vigente),
            }))}
            onChange={(e) => verVersion(Number(e.target.value))}
          />
        ) : null}
        {!esVigente && resumen ? (
          <div className="w-aviso-atencion w-aviso-neutro" role="status">
            <Icono nombre="info" tamano={22} />
            <div className="w-aviso-atencion__cuerpo">
              <p className="w-aviso-atencion__titulo">{t.soloLectura}</p>
              <p className="w-aviso-atencion__texto">
                {t.avisoAnterior(resumen.version, formatoFecha(resumen.fecha, zona))}
              </p>
            </div>
            <div className="w-aviso-atencion__accion">
              <Boton variante="secundario" onClick={() => verVersion(null)}>
                {t.volverVigente}
              </Boton>
            </div>
          </div>
        ) : null}
        {detalle.data ? (
          <VistaAnamnesis anamnesis={detalle.data} onRecargar={() => void detalle.refetch()} />
        ) : detalle.isError ? (
          noEsta ? (
            <MensajeError texto={t.noEncontrada} />
          ) : (
            <MensajeError error={detalle.error} onReintentar={() => void detalle.refetch()} />
          )
        ) : (
          <Esqueleto filas={5} etiqueta={t.cargando} />
        )}
      </section>
    </div>
  );
}
