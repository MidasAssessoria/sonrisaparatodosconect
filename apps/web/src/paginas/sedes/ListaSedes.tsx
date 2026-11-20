import type { CrearSede, Sede } from '@conecta/shared';
import {
  AvisoExito,
  Boton,
  Chip,
  EncabezadoPagina,
  EstadoVacio,
  HojaInferior,
  TablaLista,
  type Columna,
} from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { useActualizarSede, useSedes } from './consultas.js';
import { infoEstadoSede } from './estadoSede.js';
import { datosIniciales, FormularioSede } from './FormularioSede.js';

export interface EstadoNavegacionSedes {
  aviso?: string;
}

function textoSillones(sede: Sede): string {
  const activos = sede.sillones.filter((s) => s.activo).length;
  if (sede.sillones.length === 0) return 'Sin sillones';
  return activos === 1 ? '1 activo' : `${activos} activos`;
}

const COLUMNAS: Columna<Sede>[] = [
  {
    clave: 'nombre',
    titulo: 'Sede',
    render: (s) => (
      <Link className="w-enlace-fila" to={`/sedes/${s.id}`}>
        <span
          className="w-punto-color"
          style={{ background: s.color ?? 'var(--fondo-suave)' }}
          aria-hidden="true"
        />
        <span>{s.nombre}</span>
      </Link>
    ),
  },
  {
    clave: 'estado',
    titulo: 'Estado',
    render: (s) => {
      const e = infoEstadoSede(s.estado);
      return (
        <Chip tono={e.tono} icono={e.icono}>
          {e.texto}
        </Chip>
      );
    },
  },
  { clave: 'direccion', titulo: 'Dirección', render: (s) => s.direccion || '—' },
  { clave: 'telefono', titulo: 'Teléfono', render: (s) => s.telefono || '—' },
  { clave: 'sillones', titulo: 'Sillones', render: textoSillones },
];

export function ListaSedes() {
  const { api, puede } = useSesionLista();
  const sedes = useSedes();
  const actualizar = useActualizarSede();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  const idForm = useId();
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [creada, setCreada] = useState<Sede | null>(null);
  const [avisoNavegacion, setAvisoNavegacion] = useState<string | null>(
    (ubicacion.state as EstadoNavegacionSedes | null)?.aviso ?? null,
  );

  const crear = useMutation({
    mutationFn: (datos: CrearSede) => api.sedes.crear(datos),
    onSuccess: async (sede) => {
      setHojaAbierta(false);
      setCreada(sede);
      await actualizar(sede);
    },
  });

  const puedeCrear = puede('sedes', 'crear');
  const abrirAlta = () => {
    crear.reset();
    setCreada(null);
    setHojaAbierta(true);
  };
  const botonNueva = puedeCrear ? (
    <Boton variante="primario" icono="mas" onClick={abrirAlta}>
      Nueva sede
    </Boton>
  ) : null;

  return (
    <>
      <EncabezadoPagina titulo="Sedes" acciones={botonNueva} />

      {creada ? (
        <AvisoExito
          titulo={`Sede «${creada.nombre}» creada`}
          texto="Ahora podés cargar sus horarios y sillones."
          accion={
            <Boton variante="secundario" onClick={() => void navegar(`/sedes/${creada.id}`)}>
              Cargar horarios y sillones
            </Boton>
          }
          onCerrar={() => setCreada(null)}
        />
      ) : null}
      {avisoNavegacion ? (
        <AvisoExito titulo={avisoNavegacion} onCerrar={() => setAvisoNavegacion(null)} />
      ) : null}

      {sedes.isPending ? <Esqueleto filas={4} etiqueta="Cargando sedes" /> : null}
      {sedes.isError ? (
        <MensajeError error={sedes.error} onReintentar={() => void sedes.refetch()} />
      ) : null}
      {sedes.isSuccess && sedes.data.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay sedes."
          texto={puedeCrear ? 'Agregá la primera para empezar a organizar la clínica.' : undefined}
          accion={
            puedeCrear ? (
              <Boton variante="primario" icono="mas" onClick={abrirAlta}>
                Agregar la primera sede
              </Boton>
            ) : undefined
          }
        />
      ) : null}
      {sedes.isSuccess && sedes.data.length > 0 ? (
        <TablaLista<Sede> titulo="Sedes de la clínica" columnas={COLUMNAS} filas={sedes.data} />
      ) : null}

      {puedeCrear ? (
        <HojaInferior
          abierta={hojaAbierta}
          titulo="Nueva sede"
          onCerrar={() => setHojaAbierta(false)}
          acciones={
            <>
              <Boton variante="secundario" onClick={() => setHojaAbierta(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" form={idForm} variante="primario" cargando={crear.isPending}>
                Guardar sede
              </Boton>
            </>
          }
        >
          {hojaAbierta ? (
            <FormularioSede
              id={idForm}
              inicial={datosIniciales()}
              onGuardar={(d) => crear.mutate(d)}
              error={crear.error}
            />
          ) : null}
        </HojaInferior>
      ) : null}
    </>
  );
}
