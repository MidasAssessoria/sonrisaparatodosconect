import type { CrearInvitacion, EstadoMembresia, InvitacionCreada, Persona } from '@conecta/shared';
import {
  AvisoExito,
  Boton,
  EncabezadoPagina,
  EstadoVacio,
  HojaInferior,
  TablaLista,
  type Columna,
} from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { useAccionesInvitacion } from './AccionesInvitacion.js';
import { ChipEstadoPersona, EnlaceUnaVez, Segmento } from './componentes.js';
import { textoAcceso, textoSedes } from './formato.js';
import {
  personaAlAlcance,
  rolesAsignables,
  useActualizarEquipo,
  usePersonal,
  useRoles,
} from './consultas.js';
import { FormularioInvitacion } from './FormularioInvitacion.js';
import { T, TEXTO_ESTADO_PERSONA } from './textos.js';

type Filtro = 'todos' | EstadoMembresia;

export function ListaPersonal() {
  const { api, sesion, puede } = useSesionLista();
  const navegar = useNavigate();
  const personal = usePersonal();
  const actualizar = useActualizarEquipo();
  const unaVez = useEnvioUnico();
  const idForm = useId();
  const zona = sesion.clinica.zonaHoraria;
  const puedeCrear = puede('personal', 'crear');
  const puedeAnular = puede('personal', 'anular');

  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [enlace, setEnlace] = useState<{ inv: InvitacionCreada; reenvio: boolean } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const roles = useRoles(puedeCrear && hojaAbierta);

  const invitar = useMutation({
    mutationFn: (datos: CrearInvitacion) => api.invitaciones.crear(datos),
    onSuccess: async (inv) => {
      setHojaAbierta(false);
      setAviso(null);
      setEnlace({ inv, reenvio: false });
      await actualizar(inv.persona);
    },
  });

  const acciones = useAccionesInvitacion({
    onEnlace: (inv) => {
      setAviso(null);
      setEnlace({ inv, reenvio: true });
    },
    onAnulada: (p) => setAviso(T.anular.hecho(p.nombre)),
  });

  const abrirInvitar = () => {
    invitar.reset();
    setHojaAbierta(true);
  };

  const columnas: Columna<Persona>[] = [
    {
      clave: 'nombre',
      titulo: 'Nombre',
      render: (p) => (
        <span className="w-persona-nombre">
          <Link className="w-enlace-fila" to={`/personal/${p.membresiaId}`}>
            {p.nombre}
          </Link>
          <span className="w-secundario">{p.email}</span>
        </span>
      ),
    },
    { clave: 'rol', titulo: 'Rol', render: (p) => p.rol.nombre },
    { clave: 'estado', titulo: 'Estado', render: (p) => <ChipEstadoPersona estado={p.estado} /> },
    { clave: 'sedes', titulo: 'Sedes', render: (p) => textoSedes(p.sedeIds, sesion.sedes) },
    { clave: 'acceso', titulo: 'Último acceso', render: (p) => textoAcceso(p, zona) },
  ];
  if (puedeCrear || puedeAnular) {
    columnas.push({
      clave: 'acciones',
      titulo: 'Acciones',
      render: (p) =>
        p.estado === 'pendiente' && personaAlAlcance(p, sesion) ? (
          <span className="w-acciones-fila">
            {puedeCrear ? (
              <Boton
                variante="secundario"
                icono="sincronizar"
                aria-label={`${T.equipo.reenviar} la invitación de ${p.nombre}`}
                onClick={() => acciones.abrirReenviar(p)}
              >
                {T.equipo.reenviar}
              </Boton>
            ) : null}
            {puedeAnular ? (
              <Boton
                variante="fantasma"
                icono="cerrar"
                aria-label={`${T.equipo.anular} la invitación de ${p.nombre}`}
                onClick={() => acciones.abrirAnular(p)}
              >
                {T.equipo.anular}
              </Boton>
            ) : null}
          </span>
        ) : (
          '—'
        ),
    });
  }

  const visibles = personal.data?.filter((p) => filtro === 'todos' || p.estado === filtro) ?? [];
  const cuenta = (e: EstadoMembresia) => personal.data?.filter((p) => p.estado === e).length ?? 0;

  return (
    <>
      <EncabezadoPagina
        titulo={T.equipo.titulo}
        acciones={
          <>
            <Boton variante="secundario" icono="candado" onClick={() => void navegar('/roles')}>
              {T.equipo.roles}
            </Boton>
            {puedeCrear ? (
              <Boton variante="primario" icono="mas" onClick={abrirInvitar}>
                {T.equipo.invitar}
              </Boton>
            ) : null}
          </>
        }
      />

      {enlace ? (
        <EnlaceUnaVez
          invitacion={enlace.inv}
          reenvio={enlace.reenvio}
          clinica={sesion.clinica.nombre}
          zona={zona}
          onCerrar={() => setEnlace(null)}
        />
      ) : null}
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}

      {personal.isPending ? <Esqueleto filas={4} etiqueta={T.equipo.cargando} /> : null}
      {personal.isError ? (
        <MensajeError error={personal.error} onReintentar={() => void personal.refetch()} />
      ) : null}
      {personal.isSuccess ? (
        <>
          <Segmento<Filtro>
            etiqueta={T.equipo.filtro}
            valor={filtro}
            onCambio={setFiltro}
            opciones={[
              { valor: 'todos', texto: `${T.equipo.todos} (${personal.data.length})` },
              ...(['activo', 'pendiente', 'inactivo'] as const).map((e) => ({
                valor: e,
                texto: `${TEXTO_ESTADO_PERSONA[e]} (${cuenta(e)})`,
              })),
            ]}
          />
          {visibles.length === 0 ? (
            <EstadoVacio
              titulo={filtro === 'todos' ? T.equipo.vacio : T.equipo.vacioFiltro}
              texto={filtro === 'todos' && puedeCrear ? T.equipo.vacioTexto : undefined}
            />
          ) : (
            <TablaLista<Persona>
              titulo={T.equipo.tituloTabla}
              columnas={columnas}
              filas={visibles}
              claveFila={(p) => p.membresiaId}
            />
          )}
        </>
      ) : null}

      {puedeCrear ? (
        <HojaInferior
          abierta={hojaAbierta}
          titulo={T.invitar.titulo}
          onCerrar={() => setHojaAbierta(false)}
          acciones={
            <>
              <Boton variante="secundario" onClick={() => setHojaAbierta(false)}>
                {T.invitar.cancelar}
              </Boton>
              <Boton
                type="submit"
                form={idForm}
                variante="primario"
                cargando={invitar.isPending}
                disabled={!roles.isSuccess}
              >
                {T.invitar.enviar}
              </Boton>
            </>
          }
        >
          {hojaAbierta && roles.isPending ? <p role="status">{T.invitar.cargandoRoles}</p> : null}
          {hojaAbierta && roles.isError ? (
            <MensajeError error={roles.error} onReintentar={() => void roles.refetch()} />
          ) : null}
          {hojaAbierta && roles.isSuccess ? (
            <FormularioInvitacion
              id={idForm}
              roles={rolesAsignables(roles.data, sesion)}
              sedes={sesion.sedes}
              onEnviar={(d) => void unaVez(() => invitar.mutateAsync(d).catch(() => undefined))}
              error={invitar.error}
            />
          ) : null}
        </HojaInferior>
      ) : null}

      {acciones.hojas}
    </>
  );
}
