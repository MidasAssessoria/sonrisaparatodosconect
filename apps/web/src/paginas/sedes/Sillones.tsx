import { crearSillonSchema, type Sillon } from '@conecta/shared';
import { AvisoExito, Boton, Campo, Chip, EstadoVacio } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';

function validarNombre(nombre: string): string | null {
  const r = crearSillonSchema.safeParse({ nombre });
  if (r.success) return null;
  return nombre.trim()
    ? 'El nombre puede tener hasta 40 caracteres.'
    : 'Poné el nombre del sillón.';
}

function FilaSillon({
  sillon,
  editable,
  onCambio,
}: {
  sillon: Sillon;
  editable: boolean;
  onCambio: () => Promise<void>;
}) {
  const { api } = useSesionLista();
  const [renombrando, setRenombrando] = useState(false);
  const [nombre, setNombre] = useState(sillon.nombre);
  const [errorNombre, setErrorNombre] = useState<string | null>(null);
  const unaVez = useEnvioUnico();
  const editar = useMutation({
    mutationFn: (datos: { nombre?: string; activo?: boolean }) =>
      api.sedes.editarSillon(sillon.id, datos),
    onSuccess: async () => {
      setRenombrando(false);
      await onCambio();
    },
  });

  function cambiar(datos: { nombre?: string; activo?: boolean }) {
    void unaVez(() => editar.mutateAsync(datos).catch(() => undefined));
  }

  function guardarNombre(e: FormEvent) {
    e.preventDefault();
    const err = validarNombre(nombre);
    setErrorNombre(err);
    if (!err) cambiar({ nombre: nombre.trim() });
  }

  return (
    <li className="w-sillon">
      {renombrando ? (
        <form className="w-sillon__renombrar" onSubmit={guardarNombre} noValidate>
          <Campo
            etiqueta={`Nombre nuevo de «${sillon.nombre}»`}
            value={nombre}
            maxLength={40}
            onChange={(e) => setNombre(e.target.value)}
            error={errorNombre}
            autoFocus
          />
          <div className="w-botonera">
            <Boton type="submit" variante="primario" cargando={editar.isPending}>
              Guardar nombre
            </Boton>
            <Boton
              variante="fantasma"
              onClick={() => {
                setRenombrando(false);
                setNombre(sillon.nombre);
                setErrorNombre(null);
              }}
            >
              Cancelar
            </Boton>
          </div>
        </form>
      ) : (
        <div className="w-sillon__fila">
          <span className="w-sillon__nombre">{sillon.nombre}</span>
          {sillon.activo ? (
            <Chip tono="exito" icono="check">
              Activo
            </Chip>
          ) : (
            <Chip tono="neutro" icono="cerrar">
              Inactivo
            </Chip>
          )}
          {editable ? (
            <div className="w-sillon__acciones">
              <Boton
                variante="fantasma"
                onClick={() => setRenombrando(true)}
                aria-label={`Renombrar ${sillon.nombre}`}
              >
                Renombrar
              </Boton>
              <Boton
                variante="secundario"
                cargando={editar.isPending}
                onClick={() => cambiar({ activo: !sillon.activo })}
                aria-label={`${sillon.activo ? 'Desactivar' : 'Activar'} ${sillon.nombre}`}
              >
                {sillon.activo ? 'Desactivar' : 'Activar'}
              </Boton>
            </div>
          ) : null}
        </div>
      )}
      {editar.isError ? <MensajeError error={editar.error} /> : null}
    </li>
  );
}

export function Sillones({
  sedeId,
  sillones,
  onCambio,
}: {
  sedeId: string;
  sillones: Sillon[];
  onCambio: () => Promise<void>;
}) {
  const { api, puede } = useSesionLista();
  const puedeCrear = puede('sedes', 'crear');
  const puedeEditar = puede('sedes', 'editar');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [agregado, setAgregado] = useState<string | null>(null);
  const unaVezAlta = useEnvioUnico();

  const crear = useMutation({
    mutationFn: (n: string) => api.sedes.crearSillon(sedeId, { nombre: n }),
    onSuccess: async (s) => {
      setNombre('');
      setAgregado(s.nombre);
      await onCambio();
    },
  });

  function agregar(e: FormEvent) {
    e.preventDefault();
    const err = validarNombre(nombre);
    setError(err);
    setAgregado(null);
    if (!err) void unaVezAlta(() => crear.mutateAsync(nombre.trim()).catch(() => undefined));
  }

  return (
    <div className="w-sillones">
      {sillones.length === 0 ? (
        <EstadoVacio
          ilustracion={false}
          titulo="Esta sede todavía no tiene sillones."
          texto={puedeCrear ? 'Agregá el primero con el formulario de abajo.' : undefined}
        />
      ) : (
        <ul className="w-sillones__lista" aria-label="Sillones">
          {sillones.map((s) => (
            <FilaSillon key={s.id} sillon={s} editable={puedeEditar} onCambio={onCambio} />
          ))}
        </ul>
      )}
      {agregado ? (
        <AvisoExito titulo={`Sillón «${agregado}» agregado`} onCerrar={() => setAgregado(null)} />
      ) : null}
      {puedeCrear ? (
        <form className="w-sillones__alta" onSubmit={agregar} noValidate>
          <Campo
            etiqueta="Nombre del sillón nuevo"
            value={nombre}
            maxLength={40}
            onChange={(e) => setNombre(e.target.value)}
            error={error}
          />
          <Boton type="submit" icono="mas" cargando={crear.isPending}>
            Agregar sillón
          </Boton>
          {crear.isError ? <MensajeError error={crear.error} /> : null}
        </form>
      ) : null}
    </div>
  );
}
