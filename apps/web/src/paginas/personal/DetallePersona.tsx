import type { EditarPersona, InvitacionCreada, Persona, Rol } from '@conecta/shared';
import { AvisoExito, Boton, Campo, Chip, EncabezadoPagina, HojaInferior } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { useAccionesInvitacion } from './AccionesInvitacion.js';
import { ChipEstadoPersona, ElegirSedes, EnlaceUnaVez, HojaConMotivo } from './componentes.js';
import {
  mensajeRechazo,
  personaAlAlcance,
  rolesAsignables,
  useActualizarEquipo,
  usePersonal,
  useRoles,
} from './consultas.js';
import { textoAcceso, textoSedes } from './formato.js';
import { T } from './textos.js';

function FormularioEditarPersona({
  id,
  persona,
  roles,
  sedes,
  onGuardar,
  error,
}: {
  id: string;
  persona: Persona;
  roles: Rol[];
  sedes: { id: string; nombre: string }[];
  onGuardar: (datos: EditarPersona) => void;
  error?: unknown;
}) {
  const visibles = new Set(sedes.map((s) => s.id));
  const ocultas = persona.sedeIds.filter((s) => !visibles.has(s));
  const [rolId, setRolId] = useState(persona.rol.id);
  const [elegidas, setElegidas] = useState(persona.sedeIds.filter((s) => visibles.has(s)));
  const [defecto, setDefecto] = useState(
    persona.sedeDefectoId && visibles.has(persona.sedeDefectoId) ? persona.sedeDefectoId : '',
  );
  // El rol actual siempre aparece, aunque quien edita no pueda asignarlo.
  const opciones = roles.some((r) => r.id === persona.rol.id)
    ? roles
    : [{ id: persona.rol.id, nombre: persona.rol.nombre } as Rol, ...roles];
  // La sede por defecto actual es una que quien edita no ve: no se toca (no se manda).
  const defectoOculto = !!persona.sedeDefectoId && !visibles.has(persona.sedeDefectoId);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const datos: EditarPersona = {
      // Solo las sedes que quien edita ve: las otras las conserva la API, y mandarlas da 403.
      sedeIds: elegidas,
    };
    if (rolId !== persona.rol.id) datos.rolId = rolId;
    if (defecto) datos.sedeDefectoId = defecto;
    else if (!defectoOculto) datos.sedeDefectoId = null;
    onGuardar(datos);
  }

  return (
    <form id={id} className="w-formulario" onSubmit={enviar} noValidate>
      <Campo
        etiqueta={T.persona.rol}
        tipo="select"
        value={rolId}
        opciones={opciones.map((r) => ({ valor: r.id, texto: r.nombre }))}
        onChange={(e) => setRolId(e.target.value)}
      />
      <ElegirSedes
        sedes={sedes}
        elegidas={elegidas}
        defecto={defecto}
        onCambio={(s, d) => {
          setElegidas(s);
          setDefecto(d);
        }}
      />
      {ocultas.length > 0 ? <p className="w-secundario">{T.persona.sedesOcultas}</p> : null}
      {error ? <MensajeError texto={mensajeRechazo(error)} /> : null}
    </form>
  );
}

export function DetallePersona() {
  const { id = '' } = useParams();
  const { api, sesion, puede } = useSesionLista();
  const personal = usePersonal();
  const actualizar = useActualizarEquipo();
  const navegar = useNavigate();
  const unaVez = useEnvioUnico();
  const idForm = useId();
  const zona = sesion.clinica.zonaHoraria;

  const [editando, setEditando] = useState(false);
  const [desactivando, setDesactivando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enlace, setEnlace] = useState<InvitacionCreada | null>(null);

  const puedeEditar = puede('personal', 'editar');
  const puedeAnular = puede('personal', 'anular');
  const roles = useRoles(puedeEditar && editando);

  const editar = useMutation({
    mutationFn: (d: EditarPersona) => api.personal.editar(id, d),
    onSuccess: async (p) => {
      setEditando(false);
      setAviso(T.persona.guardado);
      await actualizar(p);
    },
  });
  const desactivar = useMutation({
    mutationFn: (motivo: string) => api.personal.desactivar(id, { motivo }),
    onSuccess: async (p) => {
      setDesactivando(false);
      setAviso(T.persona.desactivada);
      await actualizar(p);
    },
  });
  const reactivar = useMutation({
    mutationFn: () => api.personal.reactivar(id),
    onSuccess: async (p) => {
      setAviso(T.persona.reactivada);
      await actualizar(p);
    },
  });
  const acciones = useAccionesInvitacion({
    onEnlace: (inv) => {
      setAviso(null);
      setEnlace(inv);
    },
    onAnulada: (p) => setAviso(T.anular.hecho(p.nombre)),
  });

  if (personal.isPending) return <Esqueleto filas={5} etiqueta={T.persona.cargando} />;
  const persona = personal.data?.find((p) => p.membresiaId === id);
  if (personal.isError || !persona) {
    return (
      <>
        <EncabezadoPagina titulo={T.equipo.titulo} />
        {personal.isError ? (
          <MensajeError error={personal.error} onReintentar={() => void personal.refetch()} />
        ) : (
          <MensajeError texto={T.persona.noEncontrada} />
        )}
        <Boton variante="fantasma" onClick={() => void navegar('/personal')}>
          {T.persona.volver}
        </Boton>
      </>
    );
  }

  const esPropia = persona.usuarioId !== null && persona.usuarioId === sesion.usuario.id;
  // Una persona con sedes que quien mira no ve: sin acciones (la API las rechazaría).
  const alAlcance = personaAlAlcance(persona, sesion);
  const nombreSede = (sid: string | null) =>
    sid ? (sesion.sedes.find((s) => s.id === sid)?.nombre ?? T.equipo.sedeOculta(1)) : '—';

  const botones =
    esPropia || !alAlcance ? null : (
      <>
        {puedeEditar && persona.estado !== 'inactivo' ? (
          <Boton
            variante="secundario"
            onClick={() => {
              editar.reset();
              setEditando(true);
            }}
          >
            {T.persona.editar}
          </Boton>
        ) : null}
        {persona.estado === 'pendiente' && puede('personal', 'crear') ? (
          <Boton
            variante="secundario"
            icono="sincronizar"
            onClick={() => acciones.abrirReenviar(persona)}
          >
            {T.equipo.reenviar}
          </Boton>
        ) : null}
        {persona.estado === 'pendiente' && puedeAnular ? (
          <Boton variante="peligro" onClick={() => acciones.abrirAnular(persona)}>
            {T.equipo.anular}
          </Boton>
        ) : null}
        {persona.estado === 'activo' && puedeAnular ? (
          <Boton
            variante="peligro"
            onClick={() => {
              desactivar.reset();
              setDesactivando(true);
            }}
          >
            {T.persona.desactivar}
          </Boton>
        ) : null}
        {persona.estado === 'inactivo' && persona.usuarioId && puedeEditar ? (
          <Boton
            variante="primario"
            cargando={reactivar.isPending}
            onClick={() => void unaVez(() => reactivar.mutateAsync().catch(() => undefined))}
          >
            {T.persona.reactivar}
          </Boton>
        ) : null}
      </>
    );

  return (
    <>
      <EncabezadoPagina titulo={persona.nombre} acciones={botones} />
      {enlace ? (
        <EnlaceUnaVez
          invitacion={enlace}
          reenvio
          clinica={sesion.clinica.nombre}
          zona={zona}
          onCerrar={() => setEnlace(null)}
        />
      ) : null}
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}
      {reactivar.isError ? <MensajeError texto={mensajeRechazo(reactivar.error)} /> : null}
      {esPropia ? (
        <p className="w-nota" role="note">
          {T.persona.propia}
        </p>
      ) : null}
      {!esPropia && !alAlcance && (puedeEditar || puedeAnular) ? (
        <p className="w-nota" role="note">
          {T.persona.fueraDeAlcance}
        </p>
      ) : null}
      {persona.estado === 'inactivo' && !persona.usuarioId ? (
        <p className="w-nota" role="note">
          {T.persona.anuladaSinUsuario}
        </p>
      ) : null}

      <section className="w-tarjeta" aria-label={T.persona.datos}>
        <dl className="w-datos">
          <div>
            <dt>{T.persona.estado}</dt>
            <dd>
              <ChipEstadoPersona estado={persona.estado} />
            </dd>
          </div>
          <div>
            <dt>{T.persona.correo}</dt>
            <dd>{persona.email}</dd>
          </div>
          <div>
            <dt>{T.persona.telefono}</dt>
            <dd>{persona.telefono || '—'}</dd>
          </div>
          <div>
            <dt>{T.persona.rol}</dt>
            <dd>{persona.rol.nombre}</dd>
          </div>
          <div>
            <dt>{T.persona.sedes}</dt>
            <dd>{textoSedes(persona.sedeIds, sesion.sedes)}</dd>
          </div>
          <div>
            <dt>{T.persona.sedeDefecto}</dt>
            <dd>{nombreSede(persona.sedeDefectoId)}</dd>
          </div>
          <div>
            <dt>{T.persona.ultimoAcceso}</dt>
            <dd>{textoAcceso(persona, zona)}</dd>
          </div>
          <div>
            <dt>{T.persona.dobleFactor}</dt>
            <dd>
              {persona.mfaActivo ? (
                <Chip tono="exito" icono="check">
                  {T.persona.conDobleFactor}
                </Chip>
              ) : (
                <Chip tono="neutro" icono="cerrar">
                  {T.persona.sinDobleFactor}
                </Chip>
              )}
            </dd>
          </div>
          {persona.profesionalId ? (
            <div>
              <dt>{T.persona.profesional}</dt>
              <dd>
                <Link className="w-enlace-fila" to={`/profesionales/${persona.profesionalId}`}>
                  {T.persona.verProfesional}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      {puedeEditar && !esPropia && alAlcance ? (
        <HojaInferior
          abierta={editando}
          titulo={T.persona.tituloEditar}
          onCerrar={() => setEditando(false)}
          acciones={
            <>
              <Boton variante="secundario" onClick={() => setEditando(false)}>
                {T.invitar.cancelar}
              </Boton>
              <Boton
                type="submit"
                form={idForm}
                variante="primario"
                cargando={editar.isPending}
                disabled={!roles.isSuccess}
              >
                {T.persona.guardar}
              </Boton>
            </>
          }
        >
          {editando && roles.isPending ? <p role="status">{T.invitar.cargandoRoles}</p> : null}
          {editando && roles.isError ? (
            <MensajeError error={roles.error} onReintentar={() => void roles.refetch()} />
          ) : null}
          {editando && roles.isSuccess ? (
            <FormularioEditarPersona
              id={idForm}
              persona={persona}
              roles={rolesAsignables(roles.data, sesion)}
              sedes={sesion.sedes}
              onGuardar={(d) => void unaVez(() => editar.mutateAsync(d).catch(() => undefined))}
              error={editar.error}
            />
          ) : null}
        </HojaInferior>
      ) : null}

      {puedeAnular && desactivando && alAlcance ? (
        <HojaConMotivo
          abierta
          titulo={T.persona.tituloDesactivar(persona.nombre)}
          texto={T.persona.textoDesactivar}
          confirmar={T.persona.confirmarDesactivar}
          onCerrar={() => setDesactivando(false)}
          onConfirmar={(m) => void unaVez(() => desactivar.mutateAsync(m).catch(() => undefined))}
          enviando={desactivar.isPending}
          error={desactivar.error}
        />
      ) : null}

      {acciones.hojas}
    </>
  );
}
