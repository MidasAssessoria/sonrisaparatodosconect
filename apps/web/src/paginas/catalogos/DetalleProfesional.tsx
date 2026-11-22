import type { EditarProfesional } from '@conecta/shared';
import { AvisoExito, Boton, EncabezadoPagina, HojaInferior } from '@conecta/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { COLORES_SEDE } from '../sedes/estadoSede.js';
import { claves } from './consultas.js';
import { Bloqueos } from './Bloqueos.js';
import { usePersonal, useProfesional, useSedesDetalle } from './consultas.js';
import type { SedeDisponible } from './disponibilidad.js';
import { EditorDisponibilidad } from './EditorDisponibilidad.js';
import { datosProfesional, FormularioProfesional } from './FormularioProfesional.js';
import { EstadoActivo } from './ListaProfesionales.js';
import './catalogos.css';

export function DetalleProfesional() {
  const { id = '' } = useParams();
  const { api, puede, sesion } = useSesionLista();
  const consulta = useProfesional(id);
  const sedesDetalle = useSedesDetalle();
  const personal = usePersonal();
  const consultas = useQueryClient();
  const navegar = useNavigate();
  const idForm = useId();
  const unaVez = useEnvioUnico();
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const puedeEditar = puede('personal', 'editar');

  const editar = useMutation({
    mutationFn: (datos: EditarProfesional) => api.profesionales.editar(id, datos),
    onSuccess: async (p) => {
      setEditando(false);
      setAviso('Datos del profesional guardados');
      consultas.setQueryData(claves.profesional(sesion.clinica.id, p.id), p);
      await consultas.invalidateQueries({
        queryKey: claves.profesionales(sesion.clinica.id),
        exact: true,
      });
      await consultas.invalidateQueries({ queryKey: claves.personal(sesion.clinica.id) });
    },
  });

  if (consulta.isPending) return <Esqueleto filas={5} etiqueta="Cargando el profesional" />;
  if (consulta.isError) {
    return (
      <>
        <EncabezadoPagina titulo="Profesional" />
        <MensajeError error={consulta.error} onReintentar={() => void consulta.refetch()} />
        <Boton variante="fantasma" onClick={() => void navegar('/profesionales')}>
          Volver a profesionales
        </Boton>
      </>
    );
  }

  const p = consulta.data;
  // Solo las sedes que la persona puede ver; horario y sillones si los puede consultar.
  const detalle = sedesDetalle.isSuccess ? sedesDetalle.data : null;
  const sedes: SedeDisponible[] = sesion.sedes.map((s) => {
    const d = detalle?.find((x) => x.id === s.id);
    return {
      id: s.id,
      nombre: s.nombre,
      horarios: d?.horarios ?? null,
      sillones: d?.sillones ?? null,
    };
  });
  const persona = personal.data?.find((x) => x.membresiaId === p.membresiaId);
  const nombreColor = COLORES_SEDE.find(
    (c) => c.valor.toLowerCase() === p.color.toLowerCase(),
  )?.nombre;

  return (
    <>
      <EncabezadoPagina
        titulo={p.nombre}
        acciones={
          puedeEditar ? (
            <Boton
              variante="secundario"
              onClick={() => {
                editar.reset();
                setEditando(true);
              }}
            >
              Editar datos
            </Boton>
          ) : null
        }
      />
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}

      <section className="w-tarjeta" aria-label="Datos del profesional">
        <dl className="w-datos">
          <div>
            <dt>Estado</dt>
            <dd>
              <EstadoActivo activo={p.activo} />
            </dd>
          </div>
          <div>
            <dt>Especialidad</dt>
            <dd>{p.especialidad || '—'}</dd>
          </div>
          <div>
            <dt>Registro profesional</dt>
            <dd>{p.registroProf || '—'}</dd>
          </div>
          <div>
            <dt>Color en la agenda</dt>
            <dd className="w-datos__sede">
              <span className="w-punto-color" style={{ background: p.color }} aria-hidden="true" />
              <span>{nombreColor ?? p.color}</span>
            </dd>
          </div>
          <div>
            <dt>Persona del equipo</dt>
            <dd>
              {p.membresiaId === null
                ? 'Sin persona asociada'
                : (persona?.nombre ?? 'Asociado a una persona del equipo')}
            </dd>
          </div>
        </dl>
      </section>

      <section className="w-seccion" aria-labelledby="w-prof-disponibilidad">
        <h2 id="w-prof-disponibilidad" className="w-seccion__titulo">
          Disponibilidad semanal
        </h2>
        <div className="w-tarjeta">
          {sedesDetalle.isError ? (
            <MensajeError
              texto="No pudimos traer los horarios de las sedes: la API igual revisa que los tramos entren en el horario."
              onReintentar={() => void sedesDetalle.refetch()}
            />
          ) : null}
          {sedesDetalle.isLoading ? (
            <Esqueleto filas={3} etiqueta="Cargando los horarios de las sedes" />
          ) : (
            <EditorDisponibilidad
              key={`${p.id}-${detalle ? 'con' : 'sin'}-horarios`}
              profesional={p}
              sedes={sedes}
              editable={puedeEditar}
            />
          )}
        </div>
      </section>

      <section className="w-seccion" aria-labelledby="w-prof-bloqueos">
        <h2 id="w-prof-bloqueos" className="w-seccion__titulo">
          Bloqueos
        </h2>
        <div className="w-tarjeta">
          <Bloqueos profesionalId={p.id} bloqueos={p.bloqueos} editable={puedeEditar} />
        </div>
      </section>

      {puedeEditar ? (
        <HojaInferior
          abierta={editando}
          titulo="Editar datos del profesional"
          onCerrar={() => setEditando(false)}
          acciones={
            <>
              <Boton variante="secundario" onClick={() => setEditando(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" form={idForm} variante="primario" cargando={editar.isPending}>
                Guardar cambios
              </Boton>
            </>
          }
        >
          {editando ? (
            <FormularioProfesional
              id={idForm}
              modo="editar"
              inicial={datosProfesional(p)}
              personas={personal.isSuccess ? personal.data : null}
              onGuardar={(envio) => {
                if (envio.modo !== 'editar') return;
                void unaVez(() => editar.mutateAsync(envio.datos).catch(() => undefined));
              }}
              error={editar.error}
            />
          ) : null}
        </HojaInferior>
      ) : null}
    </>
  );
}
