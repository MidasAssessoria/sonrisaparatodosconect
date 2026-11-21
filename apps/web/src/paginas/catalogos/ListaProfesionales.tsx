import type { Profesional } from '@conecta/shared';
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
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { claves, useApiCatalogos } from './api.js';
import { usePersonal, useProfesionales } from './consultas.js';
import { resumenDias } from './formato.js';
import { datosProfesional, FormularioProfesional } from './FormularioProfesional.js';
import './catalogos.css';

export function EstadoActivo({ activo }: { activo: boolean }) {
  return activo ? (
    <Chip tono="exito" icono="check">
      Activo
    </Chip>
  ) : (
    <Chip tono="neutro" icono="cerrar">
      Inactivo
    </Chip>
  );
}

const COLUMNAS: Columna<Profesional>[] = [
  {
    clave: 'nombre',
    titulo: 'Profesional',
    render: (p) => (
      <Link className="w-enlace-fila" to={`/profesionales/${p.id}`}>
        <span className="w-punto-color" style={{ background: p.color }} aria-hidden="true" />
        <span>{p.nombre}</span>
      </Link>
    ),
  },
  { clave: 'especialidad', titulo: 'Especialidad', render: (p) => p.especialidad || '—' },
  { clave: 'registro', titulo: 'Registro profesional', render: (p) => p.registroProf || '—' },
  { clave: 'dias', titulo: 'Días de atención', render: (p) => resumenDias(p.disponibilidad) },
  { clave: 'estado', titulo: 'Estado', render: (p) => <EstadoActivo activo={p.activo} /> },
];

/** Activos primero. La API ya los manda así (y por nombre); se asegura sin tocar el resto del orden. */
export function ordenarProfesionales(lista: Profesional[]): Profesional[] {
  return [...lista].sort((a, b) => Number(b.activo) - Number(a.activo));
}

export function ListaProfesionales() {
  const { puede, sesion } = useSesionLista();
  const api = useApiCatalogos();
  const profesionales = useProfesionales();
  const puedeCrear = puede('personal', 'crear');
  const personal = usePersonal();
  const consultas = useQueryClient();
  const navegar = useNavigate();
  const idForm = useId();
  const unaVez = useEnvioUnico();
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [creado, setCreado] = useState<Profesional | null>(null);

  const crear = useMutation({
    mutationFn: (datos: Parameters<typeof api.profesionales.crear>[0]) =>
      api.profesionales.crear(datos),
    onSuccess: async (p) => {
      setHojaAbierta(false);
      setCreado(p);
      consultas.setQueryData(claves.profesional(sesion.clinica.id, p.id), p);
      await consultas.invalidateQueries({
        queryKey: claves.profesionales(sesion.clinica.id),
        exact: true,
      });
      await consultas.invalidateQueries({ queryKey: claves.personal(sesion.clinica.id) });
    },
  });

  const abrirAlta = () => {
    crear.reset();
    setCreado(null);
    setHojaAbierta(true);
  };

  return (
    <>
      <EncabezadoPagina
        titulo="Profesionales"
        acciones={
          puedeCrear ? (
            <Boton variante="primario" icono="mas" onClick={abrirAlta}>
              Nuevo profesional
            </Boton>
          ) : null
        }
      />

      {creado ? (
        <AvisoExito
          titulo={`Profesional «${creado.nombre}» agregado`}
          texto="Ahora cargá sus días y horarios de atención."
          accion={
            <Boton
              variante="secundario"
              onClick={() => void navegar(`/profesionales/${creado.id}`)}
            >
              Cargar disponibilidad
            </Boton>
          }
          onCerrar={() => setCreado(null)}
        />
      ) : null}

      {profesionales.isPending ? <Esqueleto filas={4} etiqueta="Cargando profesionales" /> : null}
      {profesionales.isError ? (
        <MensajeError
          error={profesionales.error}
          onReintentar={() => void profesionales.refetch()}
        />
      ) : null}
      {profesionales.isSuccess && profesionales.data.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay profesionales."
          texto={puedeCrear ? 'Agregá a quien atiende para poder darle turnos.' : undefined}
          accion={
            puedeCrear ? (
              <Boton variante="primario" icono="mas" onClick={abrirAlta}>
                Agregar el primer profesional
              </Boton>
            ) : undefined
          }
        />
      ) : null}
      {profesionales.isSuccess && profesionales.data.length > 0 ? (
        <TablaLista<Profesional>
          titulo="Profesionales de la clínica"
          columnas={COLUMNAS}
          filas={ordenarProfesionales(profesionales.data)}
        />
      ) : null}

      {puedeCrear ? (
        <HojaInferior
          abierta={hojaAbierta}
          titulo="Nuevo profesional"
          onCerrar={() => setHojaAbierta(false)}
          acciones={
            <>
              <Boton variante="secundario" onClick={() => setHojaAbierta(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" form={idForm} variante="primario" cargando={crear.isPending}>
                Guardar profesional
              </Boton>
            </>
          }
        >
          {hojaAbierta ? (
            <FormularioProfesional
              id={idForm}
              modo="crear"
              inicial={datosProfesional()}
              personas={personal.isSuccess ? personal.data : null}
              onGuardar={(envio) => {
                if (envio.modo !== 'crear') return;
                void unaVez(() => crear.mutateAsync(envio.datos).catch(() => undefined));
              }}
              error={crear.error}
            />
          ) : null}
        </HojaInferior>
      ) : null}
    </>
  );
}
