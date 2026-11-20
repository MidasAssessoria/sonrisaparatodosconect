import type { CrearSede, HorarioSede } from '@conecta/shared';
import { AvisoExito, Boton, Chip, EncabezadoPagina, HojaInferior } from '@conecta/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { claveSede, useActualizarSede, useSede } from './consultas.js';
import { DarDeBaja } from './DarDeBaja.js';
import { EditorHorarios } from './EditorHorarios.js';
import { infoEstadoSede, COLORES_SEDE } from './estadoSede.js';
import { datosIniciales, FormularioSede } from './FormularioSede.js';
import { Sillones } from './Sillones.js';
import type { EstadoNavegacionSedes } from './ListaSedes.js';

export function DetalleSede() {
  const { id = '' } = useParams();
  const { api, puede, sesion } = useSesionLista();
  // Tras la baja, el detalle no vuelve a pedir la sede (respondería «no encontrada») aunque
  // siga montado un instante mientras se navega a la lista.
  const [dadaDeBaja, setDadaDeBaja] = useState(false);
  const consulta = useSede(id, !dadaDeBaja);
  const actualizar = useActualizarSede();
  const consultas = useQueryClient();
  const navegar = useNavigate();
  const idForm = useId();
  const [editando, setEditando] = useState(false);
  const [bajaAbierta, setBajaAbierta] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const unaVez = useEnvioUnico();

  const editar = useMutation({
    mutationFn: (datos: CrearSede) =>
      api.sedes.editar(id, {
        ...datos,
        // Lo que el formulario deja vacío se borra: cadena vacía en los textos, `null` en el color
        // («Sin color»). Sin esto, omitir el campo dejaba el valor anterior.
        direccion: datos.direccion ?? '',
        telefono: datos.telefono ?? '',
        color: datos.color ?? null,
      }),
    onSuccess: async (sede) => {
      setEditando(false);
      setAviso('Datos de la sede guardados');
      await actualizar(sede);
    },
  });

  const horarios = useMutation({
    mutationFn: (h: HorarioSede[]) => api.sedes.reemplazarHorarios(id, { horarios: h }),
    onSuccess: async (sede) => {
      await actualizar(sede);
    },
  });

  const baja = useMutation({
    mutationFn: (motivo: string) => api.sedes.darDeBaja(id, { motivo }),
    onSuccess: async () => {
      // Primero se sale del detalle; recién después se limpia el caché. Al revés, el detalle
      // (todavía montado) volvía a pedir la sede dada de baja y mostraba «No encontramos esa
      // sede» por un instante.
      setDadaDeBaja(true);
      const estado: EstadoNavegacionSedes = { aviso: 'La sede quedó dada de baja.' };
      void navegar('/sedes', { state: estado, replace: true });
      await Promise.resolve();
      consultas.removeQueries({ queryKey: claveSede(sesion.clinica.id, id), exact: true });
      await actualizar();
    },
  });

  if (consulta.isPending) return <Esqueleto filas={5} etiqueta="Cargando la sede" />;
  if (consulta.isError) {
    return (
      <>
        <EncabezadoPagina titulo="Sede" />
        <MensajeError error={consulta.error} onReintentar={() => void consulta.refetch()} />
        <Boton variante="fantasma" onClick={() => void navegar('/sedes')}>
          Volver a sedes
        </Boton>
      </>
    );
  }

  const sede = consulta.data;
  const estado = infoEstadoSede(sede.estado);
  const nombreColor = COLORES_SEDE.find(
    (c) => c.valor.toLowerCase() === sede.color?.toLowerCase(),
  )?.nombre;
  const puedeEditar = puede('sedes', 'editar');
  const puedeAnular = puede('sedes', 'anular');

  return (
    <>
      <EncabezadoPagina
        titulo={sede.nombre}
        acciones={
          <>
            {puedeEditar ? (
              <Boton
                variante="secundario"
                onClick={() => {
                  editar.reset();
                  setEditando(true);
                }}
              >
                Editar datos
              </Boton>
            ) : null}
            {puedeAnular ? (
              <Boton
                variante="peligro"
                onClick={() => {
                  baja.reset();
                  setBajaAbierta(true);
                }}
              >
                Dar de baja
              </Boton>
            ) : null}
          </>
        }
      />
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}

      <section className="w-tarjeta" aria-label="Datos de la sede">
        <dl className="w-datos">
          <div>
            <dt>Estado</dt>
            <dd>
              <Chip tono={estado.tono} icono={estado.icono}>
                {estado.texto}
              </Chip>
            </dd>
          </div>
          <div>
            <dt>Dirección</dt>
            <dd>{sede.direccion || '—'}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{sede.telefono || '—'}</dd>
          </div>
          <div>
            <dt>Color en la agenda</dt>
            <dd className="w-datos__sede">
              {sede.color ? (
                <>
                  <span
                    className="w-punto-color"
                    style={{ background: sede.color }}
                    aria-hidden="true"
                  />
                  <span>{nombreColor ?? sede.color}</span>
                </>
              ) : (
                'Sin color'
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="w-seccion" aria-labelledby="w-sede-horarios">
        <h2 id="w-sede-horarios" className="w-seccion__titulo">
          Horarios
        </h2>
        <div className="w-tarjeta">
          <EditorHorarios
            key={sede.id}
            horarios={sede.horarios}
            editable={puedeEditar}
            guardando={horarios.isPending}
            error={horarios.error}
            onGuardar={async (h) => {
              await horarios.mutateAsync(h);
            }}
          />
        </div>
      </section>

      <section className="w-seccion" aria-labelledby="w-sede-sillones">
        <h2 id="w-sede-sillones" className="w-seccion__titulo">
          Sillones
        </h2>
        <div className="w-tarjeta">
          <Sillones
            sedeId={sede.id}
            sillones={sede.sillones}
            onCambio={async () => {
              await consultas.invalidateQueries({ queryKey: claveSede(sesion.clinica.id, id) });
              await actualizar();
            }}
          />
        </div>
      </section>

      {puedeEditar ? (
        <HojaInferior
          abierta={editando}
          titulo="Editar datos de la sede"
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
            <FormularioSede
              id={idForm}
              inicial={datosIniciales(sede)}
              onGuardar={(d) => void unaVez(() => editar.mutateAsync(d).catch(() => undefined))}
              error={editar.error}
            />
          ) : null}
        </HojaInferior>
      ) : null}

      {puedeAnular ? (
        <DarDeBaja
          abierta={bajaAbierta}
          nombre={sede.nombre}
          onCerrar={() => setBajaAbierta(false)}
          onConfirmar={(m) => void unaVez(() => baja.mutateAsync(m).catch(() => undefined))}
          enviando={baja.isPending}
          error={baja.error}
        />
      ) : null}
    </>
  );
}
