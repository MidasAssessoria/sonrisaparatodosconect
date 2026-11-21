import type { CrearTratamiento, EditarTratamiento, Tratamiento } from '@conecta/shared';
import {
  AvisoExito,
  Boton,
  Campo,
  Chip,
  EncabezadoPagina,
  EstadoVacio,
  HojaInferior,
  TablaLista,
  formatoGs,
  type Columna,
} from '@conecta/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { claves, useTratamientos } from './consultas.js';
import { TEXTO_IVA, textoMinutos } from './formato.js';
import { datosTratamiento, FormularioTratamiento } from './FormularioTratamiento.js';
import { EstadoActivo } from './ListaProfesionales.js';
import './catalogos.css';

type FiltroEstado = 'activos' | 'inactivos' | 'todos';
/** '' = todas; SIN_CATEGORIA = los que no tienen. */
const SIN_CATEGORIA = '\u0000sin';

export function filtrarTratamientos(
  lista: Tratamiento[],
  categoria: string,
  estado: FiltroEstado,
): Tratamiento[] {
  return lista.filter(
    (t) =>
      (estado === 'todos' || t.activo === (estado === 'activos')) &&
      (categoria === '' ||
        (categoria === SIN_CATEGORIA ? t.categoria === null : t.categoria === categoria)),
  );
}

/** Edición: categoría vacía borra el dato (`null`). */
function aEdicion(d: CrearTratamiento): EditarTratamiento {
  return { ...d, categoria: d.categoria ?? null };
}

export function Tratamientos() {
  const { api, puede, sesion } = useSesionLista();
  const tratamientos = useTratamientos();
  const consultas = useQueryClient();
  const idForm = useId();
  const unaVez = useEnvioUnico();
  const unaVezEstado = useEnvioUnico();
  const puedeCrear = puede('configuracion', 'crear');
  const puedeEditar = puede('configuracion', 'editar');
  const [categoria, setCategoria] = useState('');
  const [estado, setEstado] = useState<FiltroEstado>('activos');
  /** `null` = hoja cerrada; `'nuevo'` = alta; si no, el tratamiento que se edita. */
  const [hoja, setHoja] = useState<Tratamiento | 'nuevo' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const actualizar = async (t: Tratamiento) => {
    consultas.setQueryData<Tratamiento[]>(claves.tratamientos(sesion.clinica.id), (previa) =>
      previa
        ? previa.some((x) => x.id === t.id)
          ? previa.map((x) => (x.id === t.id ? t : x))
          : [...previa, t]
        : previa,
    );
    await consultas.invalidateQueries({ queryKey: claves.tratamientos(sesion.clinica.id) });
  };

  const guardar = useMutation({
    mutationFn: ({ datos, id }: { datos: CrearTratamiento; id: string | null }) =>
      id === null ? api.tratamientos.crear(datos) : api.tratamientos.editar(id, aEdicion(datos)),
    onSuccess: async (t, { id }) => {
      setHoja(null);
      setAviso(id === null ? `Tratamiento «${t.nombre}» agregado` : `«${t.nombre}» guardado`);
      await actualizar(t);
    },
  });

  const cambiarEstado = useMutation({
    mutationFn: (t: Tratamiento) => api.tratamientos.editar(t.id, { activo: !t.activo }),
    onSuccess: async (t) => {
      setAviso(t.activo ? `«${t.nombre}» está activo de nuevo` : `«${t.nombre}» quedó inactivo`);
      await actualizar(t);
    },
  });

  const abrir = (h: Tratamiento | 'nuevo') => {
    guardar.reset();
    setAviso(null);
    setHoja(h);
  };

  const columnas: Columna<Tratamiento>[] = [
    { clave: 'nombre', titulo: 'Tratamiento', render: (t) => t.nombre },
    {
      clave: 'categoria',
      titulo: 'Categoría',
      render: (t) => (t.categoria ? <Chip tono="categoria">{t.categoria}</Chip> : '—'),
    },
    {
      clave: 'precio',
      titulo: 'Precio',
      alinear: 'fin',
      render: (t) => <span className="w-monto">{formatoGs(t.precio)}</span>,
    },
    { clave: 'iva', titulo: 'IVA', render: (t) => TEXTO_IVA[t.iva] },
    { clave: 'duracion', titulo: 'Duración', render: (t) => textoMinutos(t.duracionMin) },
    { clave: 'estado', titulo: 'Estado', render: (t) => <EstadoActivo activo={t.activo} /> },
    ...(puedeEditar
      ? [
          {
            clave: 'acciones',
            titulo: 'Acciones',
            render: (t: Tratamiento) => (
              <div className="w-acciones-fila">
                <Boton
                  variante="fantasma"
                  onClick={() => abrir(t)}
                  aria-label={`Editar ${t.nombre}`}
                >
                  Editar
                </Boton>
                <Boton
                  variante="secundario"
                  cargando={cambiarEstado.isPending && cambiarEstado.variables?.id === t.id}
                  onClick={() =>
                    void unaVezEstado(() => cambiarEstado.mutateAsync(t).catch(() => undefined))
                  }
                  aria-label={`${t.activo ? 'Desactivar' : 'Activar'} ${t.nombre}`}
                >
                  {t.activo ? 'Desactivar' : 'Activar'}
                </Boton>
              </div>
            ),
          },
        ]
      : []),
  ];

  const lista = tratamientos.data ?? [];
  const categorias = [
    ...new Set(lista.map((t) => t.categoria).filter((c): c is string => c !== null)),
  ].sort((a, b) => a.localeCompare(b, 'es'));
  const filtrados = filtrarTratamientos(lista, categoria, estado);
  const editando = hoja !== null && hoja !== 'nuevo' ? hoja : null;

  return (
    <>
      <EncabezadoPagina
        titulo="Tratamientos"
        acciones={
          puedeCrear ? (
            <Boton variante="primario" icono="mas" onClick={() => abrir('nuevo')}>
              Nuevo tratamiento
            </Boton>
          ) : null
        }
      />
      {aviso ? <AvisoExito titulo={aviso} onCerrar={() => setAviso(null)} /> : null}
      {cambiarEstado.isError ? <MensajeError error={cambiarEstado.error} /> : null}

      {tratamientos.isPending ? <Esqueleto filas={4} etiqueta="Cargando tratamientos" /> : null}
      {tratamientos.isError ? (
        <MensajeError error={tratamientos.error} onReintentar={() => void tratamientos.refetch()} />
      ) : null}
      {tratamientos.isSuccess && lista.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay tratamientos."
          texto={
            puedeCrear ? 'Agregá el primero con su precio para usarlo en presupuestos.' : undefined
          }
          accion={
            puedeCrear ? (
              <Boton variante="primario" icono="mas" onClick={() => abrir('nuevo')}>
                Agregar el primer tratamiento
              </Boton>
            ) : undefined
          }
        />
      ) : null}
      {tratamientos.isSuccess && lista.length > 0 ? (
        <>
          <div className="w-filtros-simples" role="search" aria-label="Filtrar tratamientos">
            <Campo
              etiqueta="Categoría"
              tipo="select"
              value={categoria}
              opciones={[
                { valor: '', texto: 'Todas las categorías' },
                ...categorias.map((c) => ({ valor: c, texto: c })),
                ...(lista.some((t) => t.categoria === null)
                  ? [{ valor: SIN_CATEGORIA, texto: 'Sin categoría' }]
                  : []),
              ]}
              onChange={(e) => setCategoria(e.target.value)}
            />
            <Campo
              etiqueta="Mostrar"
              tipo="select"
              value={estado}
              opciones={[
                { valor: 'activos', texto: 'Solo activos' },
                { valor: 'inactivos', texto: 'Solo inactivos' },
                { valor: 'todos', texto: 'Activos e inactivos' },
              ]}
              onChange={(e) => setEstado(e.target.value as FiltroEstado)}
            />
          </div>
          {filtrados.length === 0 ? (
            <EstadoVacio
              ilustracion={false}
              titulo="Ningún tratamiento coincide con el filtro."
              texto="Probá con otra categoría o mostrá también los inactivos."
            />
          ) : (
            <TablaLista<Tratamiento> titulo="Tratamientos" columnas={columnas} filas={filtrados} />
          )}
        </>
      ) : null}

      {puedeCrear || puedeEditar ? (
        <HojaInferior
          abierta={hoja !== null}
          titulo={editando ? `Editar «${editando.nombre}»` : 'Nuevo tratamiento'}
          onCerrar={() => setHoja(null)}
          acciones={
            <>
              <Boton variante="secundario" onClick={() => setHoja(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" form={idForm} variante="primario" cargando={guardar.isPending}>
                Guardar tratamiento
              </Boton>
            </>
          }
        >
          {hoja !== null ? (
            <FormularioTratamiento
              key={editando?.id ?? 'nuevo'}
              id={idForm}
              inicial={datosTratamiento(editando ?? undefined)}
              categorias={categorias}
              onGuardar={(datos) =>
                void unaVez(() =>
                  guardar.mutateAsync({ datos, id: editando?.id ?? null }).catch(() => undefined),
                )
              }
              error={guardar.error}
            />
          ) : null}
        </HojaInferior>
      ) : null}
    </>
  );
}
