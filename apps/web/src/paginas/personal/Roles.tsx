import {
  ACCIONES,
  MODULOS,
  crearRolSchema,
  type Accion,
  type CrearRol,
  type Modulo,
  type Rol,
} from '@conecta/shared';
import {
  AvisoExito,
  Boton,
  Campo,
  Chip,
  EncabezadoPagina,
  EstadoVacio,
  Icono,
  TablaLista,
  type Columna,
} from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { CasillaVerificacion } from './componentes.js';
import { useActualizarEquipo, useApiPersonal, useRoles } from './consultas.js';
import { NOMBRE_ACCION, NOMBRE_MODULO, T } from './textos.js';

type Clave = `${Modulo}:${Accion}`;
const clave = (m: Modulo, a: Accion): Clave => `${m}:${a}`;

/** Matriz completa en el orden del contrato (módulo, después acción). */
export function matrizDe(marcadas: Set<string>): { modulo: Modulo; accion: Accion }[] {
  return MODULOS.flatMap((modulo) =>
    ACCIONES.filter((accion) => marcadas.has(clave(modulo, accion))).map((accion) => ({
      modulo,
      accion,
    })),
  );
}

/** Tabla módulo × acción en escritorio; en el celular, una fila por módulo con las acciones. */
function MatrizPermisos({
  marcadas,
  onCambio,
}: {
  marcadas: Set<string>;
  onCambio?: (m: Modulo, a: Accion, valor: boolean) => void;
}) {
  return (
    <table className="w-matriz">
      <caption className="cn-oculto">{T.roles.permisos}</caption>
      <thead>
        <tr>
          <th scope="col">Módulo</th>
          {ACCIONES.map((a) => (
            <th key={a} scope="col">
              {NOMBRE_ACCION[a]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {MODULOS.map((m) => (
          <tr key={m}>
            <th scope="row">{NOMBRE_MODULO[m]}</th>
            {ACCIONES.map((a) => {
              const si = marcadas.has(clave(m, a));
              return (
                <td key={a}>
                  {onCambio ? (
                    <CasillaVerificacion
                      etiqueta={<span className="w-matriz__accion">{NOMBRE_ACCION[a]}</span>}
                      etiquetaAccesible={`${NOMBRE_MODULO[m]}: ${NOMBRE_ACCION[a]}`}
                      marcada={si}
                      onCambio={(v) => onCambio(m, a, v)}
                    />
                  ) : (
                    <span className={`w-permiso ${si ? 'w-permiso--si' : 'w-permiso--no'}`}>
                      <Icono nombre={si ? 'check' : 'cerrar'} tamano={18} />
                      <span className="w-matriz__accion">{NOMBRE_ACCION[a]}</span>
                      <span className="cn-oculto">
                        {`${NOMBRE_MODULO[m]}, ${NOMBRE_ACCION[a]}: ${si ? T.roles.permitido : T.roles.noPermitido}`}
                      </span>
                    </span>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Propiedades({ rol }: { rol: Rol }) {
  return (
    <ul className="w-rol-propiedades">
      <li>
        <Chip tono={rol.todasLasSedes ? 'info' : 'neutro'} icono="sede">
          {rol.todasLasSedes ? T.roles.todasLasSedes : T.roles.soloSusSedes}
        </Chip>
      </li>
      <li>
        <Chip tono={rol.exigeMfa ? 'exito' : 'neutro'} icono={rol.exigeMfa ? 'check' : 'cerrar'}>
          {rol.exigeMfa ? T.roles.exigeMfa : T.roles.noExigeMfa}
        </Chip>
      </li>
      <li>
        <Chip tono="neutro" icono="reloj">
          {T.roles.inactividad(rol.inactividadMin)}
        </Chip>
      </li>
    </ul>
  );
}

interface DatosRol {
  nombre: string;
  todasLasSedes: boolean;
  exigeMfa: boolean;
  inactividadMin: string;
  marcadas: Set<string>;
}

function FormularioRol({
  inicial,
  esSistema,
  textoGuardar,
  guardando,
  error,
  onGuardar,
  onCancelar,
}: {
  inicial: DatosRol;
  esSistema: boolean;
  textoGuardar: string;
  guardando: boolean;
  error?: unknown;
  onGuardar: (datos: CrearRol) => void;
  onCancelar: () => void;
}) {
  const [d, setD] = useState(inicial);
  const [errores, setErrores] = useState<{ nombre?: string; inactividadMin?: string }>({});

  function enviar(e: FormEvent) {
    e.preventDefault();
    const minutos = Number(d.inactividadMin);
    const r = crearRolSchema.safeParse({
      nombre: d.nombre,
      todasLasSedes: d.todasLasSedes,
      exigeMfa: d.exigeMfa,
      inactividadMin: d.inactividadMin.trim() === '' ? NaN : minutos,
      permisos: matrizDe(d.marcadas),
    });
    if (!r.success) {
      const nuevos: typeof errores = {};
      for (const i of r.error.issues) {
        if (i.path[0] === 'nombre') nuevos.nombre ??= 'Poné el nombre del rol (de 2 a 60 letras).';
        if (i.path[0] === 'inactividadMin') nuevos.inactividadMin ??= T.roles.inactividadError;
      }
      setErrores(nuevos);
      return;
    }
    setErrores({});
    onGuardar(r.data);
  }

  return (
    <form className="w-formulario" onSubmit={enviar} noValidate>
      <Campo
        etiqueta={T.roles.nombre}
        requerido
        maxLength={60}
        value={d.nombre}
        disabled={esSistema}
        ayuda={esSistema ? T.roles.sistemaNoRenombra : undefined}
        onChange={(e) => setD({ ...d, nombre: e.target.value })}
        error={errores.nombre}
      />
      <CasillaVerificacion
        etiqueta={T.roles.campoTodasLasSedes}
        marcada={d.todasLasSedes}
        onCambio={(v) => setD({ ...d, todasLasSedes: v })}
      />
      <CasillaVerificacion
        etiqueta={T.roles.campoExigeMfa}
        marcada={d.exigeMfa}
        onCambio={(v) => setD({ ...d, exigeMfa: v })}
      />
      <Campo
        etiqueta={T.roles.campoInactividad}
        tipo="number"
        inputMode="numeric"
        min={5}
        max={240}
        value={d.inactividadMin}
        ayuda={T.roles.inactividadAyuda}
        onChange={(e) => setD({ ...d, inactividadMin: e.target.value })}
        error={errores.inactividadMin}
      />
      <h3 className="w-seccion__titulo">{T.roles.permisos}</h3>
      <MatrizPermisos
        marcadas={d.marcadas}
        onCambio={(m, a, v) => {
          const nuevas = new Set(d.marcadas);
          if (v) nuevas.add(clave(m, a));
          else nuevas.delete(clave(m, a));
          setD({ ...d, marcadas: nuevas });
        }}
      />
      {error ? <MensajeError error={error} /> : null}
      <div className="w-botonera">
        <Boton type="submit" variante="primario" cargando={guardando}>
          {textoGuardar}
        </Boton>
        <Boton variante="secundario" onClick={onCancelar}>
          {T.roles.cancelar}
        </Boton>
      </div>
    </form>
  );
}

function datosDe(rol?: Rol): DatosRol {
  return {
    nombre: rol?.nombre ?? '',
    todasLasSedes: rol?.todasLasSedes ?? false,
    exigeMfa: rol?.exigeMfa ?? false,
    inactividadMin: String(rol?.inactividadMin ?? 30),
    marcadas: new Set((rol?.permisos ?? []).map((p) => clave(p.modulo, p.accion))),
  };
}

export function Roles() {
  const { sesion, puede } = useSesionLista();
  const api = useApiPersonal();
  const roles = useRoles();
  const actualizar = useActualizarEquipo();
  const unaVez = useEnvioUnico();
  const idDetalle = useId();
  const [params, setParams] = useSearchParams();
  const [modo, setModo] = useState<'ver' | 'editar' | 'crear'>('ver');
  const [aviso, setAviso] = useState<string | null>(null);

  const puedeEditar = puede('configuracion', 'editar');
  const puedeCrear = puede('configuracion', 'crear');
  const elegidoId = params.get('rol');
  const elegido = roles.data?.find((r) => r.id === elegidoId) ?? null;

  const elegir = (id: string | null) => {
    setModo('ver');
    setParams(id ? { rol: id } : {});
  };

  const editar = useMutation({
    mutationFn: ({ rol, datos }: { rol: Rol; datos: CrearRol }) =>
      api.roles.editar(rol.id, {
        // Los roles de sistema no se renombran: el nombre no viaja.
        ...(rol.esSistema ? {} : { nombre: datos.nombre }),
        todasLasSedes: datos.todasLasSedes,
        exigeMfa: datos.exigeMfa,
        inactividadMin: datos.inactividadMin,
        // La matriz completa: lo que falta se revoca.
        permisos: datos.permisos,
      }),
    onSuccess: async (rol) => {
      setModo('ver');
      setAviso(T.roles.guardado(rol.nombre));
      await actualizar();
    },
  });
  const crear = useMutation({
    mutationFn: (datos: CrearRol) => api.roles.crear(datos),
    onSuccess: async (rol) => {
      setAviso(T.roles.creado(rol.nombre));
      await actualizar();
      elegir(rol.id);
    },
  });

  const columnas: Columna<Rol>[] = [
    {
      clave: 'nombre',
      titulo: 'Rol',
      render: (r) => (
        <button
          type="button"
          className="w-boton-enlace"
          aria-label={T.roles.ver(r.nombre)}
          aria-controls={idDetalle}
          onClick={() => elegir(r.id)}
        >
          {r.nombre}
        </button>
      ),
    },
    { clave: 'personas', titulo: 'Personas', render: (r) => T.roles.personas(r.personas) },
    {
      clave: 'tipo',
      titulo: 'Tipo',
      render: (r) => (r.esSistema ? T.roles.sistema : T.roles.propio),
    },
    {
      clave: 'estado',
      titulo: 'Estado',
      render: (r) =>
        r.activo ? (
          <Chip tono="exito" icono="check">
            {T.roles.activo}
          </Chip>
        ) : (
          <Chip tono="neutro" icono="cerrar">
            {T.roles.inactivo}
          </Chip>
        ),
    },
  ];

  const esDueno = elegido?.codigo === 'dueno';
  const esPropio = elegido?.id === sesion.rol.id;
  const editable = !!elegido && puedeEditar && !esDueno && !esPropio;

  return (
    <>
      <EncabezadoPagina
        titulo={T.roles.titulo}
        acciones={
          puedeCrear ? (
            <Boton
              variante="primario"
              icono="mas"
              onClick={() => {
                crear.reset();
                setParams({});
                setModo('crear');
              }}
            >
              {T.roles.nuevo}
            </Boton>
          ) : null
        }
      />
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}

      {roles.isPending ? <Esqueleto filas={4} etiqueta={T.roles.cargando} /> : null}
      {roles.isError ? (
        <MensajeError error={roles.error} onReintentar={() => void roles.refetch()} />
      ) : null}
      {roles.isSuccess && roles.data.length === 0 ? <EstadoVacio titulo={T.roles.vacio} /> : null}
      {roles.isSuccess && roles.data.length > 0 ? (
        <TablaLista<Rol> titulo={T.roles.tituloTabla} columnas={columnas} filas={roles.data} />
      ) : null}

      <div id={idDetalle}>
        {modo === 'crear' && puedeCrear ? (
          <section className="w-tarjeta w-seccion" aria-label={T.roles.nuevo}>
            <h2 className="w-seccion__titulo">{T.roles.nuevo}</h2>
            <FormularioRol
              inicial={datosDe()}
              esSistema={false}
              textoGuardar={T.roles.crear}
              guardando={crear.isPending}
              error={crear.error}
              onGuardar={(d) => void unaVez(() => crear.mutateAsync(d).catch(() => undefined))}
              onCancelar={() => setModo('ver')}
            />
          </section>
        ) : null}

        {elegido && modo !== 'crear' ? (
          <section className="w-tarjeta w-seccion" aria-label={`Rol ${elegido.nombre}`}>
            <div className="w-tarjeta__cabecera">
              <h2 className="w-seccion__titulo">{elegido.nombre}</h2>
              <div className="w-botonera">
                {editable && modo === 'ver' ? (
                  <Boton
                    variante="secundario"
                    onClick={() => {
                      editar.reset();
                      setModo('editar');
                    }}
                  >
                    {T.roles.editar}
                  </Boton>
                ) : null}
                <Boton variante="fantasma" icono="cerrar" onClick={() => elegir(null)}>
                  {T.roles.cerrar}
                </Boton>
              </div>
            </div>
            {esDueno ? (
              <p className="w-nota" role="note">
                {T.roles.duenoSoloLectura}
              </p>
            ) : esPropio && puedeEditar ? (
              <p className="w-nota" role="note">
                {T.roles.propioSoloLectura}
              </p>
            ) : null}
            {modo === 'editar' && editable ? (
              <FormularioRol
                key={elegido.id}
                inicial={datosDe(elegido)}
                esSistema={elegido.esSistema}
                textoGuardar={T.roles.guardar}
                guardando={editar.isPending}
                error={editar.error}
                onGuardar={(datos) =>
                  void unaVez(() =>
                    editar.mutateAsync({ rol: elegido, datos }).catch(() => undefined),
                  )
                }
                onCancelar={() => setModo('ver')}
              />
            ) : (
              <>
                <Propiedades rol={elegido} />
                <h3 className="w-seccion__titulo">{T.roles.permisos}</h3>
                <MatrizPermisos marcadas={datosDe(elegido).marcadas} />
              </>
            )}
          </section>
        ) : null}
      </div>
    </>
  );
}
