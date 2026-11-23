import {
  crearRelacionSchema,
  TIPOS_RELACION,
  type CrearRelacion,
  type EditarRelacion,
  type Paciente,
  type PacienteResumen,
  type Relacion,
  type TipoRelacion,
} from '@conecta/shared';
import { Avatar, Boton, Campo, Chip, HojaInferior } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { mensajeDeError } from '../../api/errores.js';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { CasillaVerificacion, HojaConfirmar } from '../personal/componentes.js';
import { MINIMO_BUSCADOR, useActualizarPacientes, useBuscarFamiliar } from './consultas.js';
import { metaPaciente, nombreCompleto } from './formato.js';

/*
 * Vínculos del grupo familiar, vistos desde la ficha abierta (P). `tipo` dice qué es el familiar
 * (F) de P: en la ficha de Ana, Mateo figura como «Hijo/a». Las marcas se ven desde los dos lados
 * (contrato/pacientes.ts): `esTutorLegal`/`esResponsablePago` = «P es tutor legal de F», «P paga
 * por F»; `familiarEsTutorLegal`/`familiarEsResponsablePago` = lo mismo al revés. Se marcan al
 * crear el vínculo y se editan después desde cualquiera de las dos fichas.
 */

type Marcas = Record<
  'esTutorLegal' | 'esResponsablePago' | 'familiarEsTutorLegal' | 'familiarEsResponsablePago',
  boolean
>;

const SIN_MARCAS: Marcas = {
  esTutorLegal: false,
  esResponsablePago: false,
  familiarEsTutorLegal: false,
  familiarEsResponsablePago: false,
};

/** Las cuatro casillas con los nombres de los dos lados: «Ana es tutora legal de Mateo». */
function CasillasMarcas({
  paciente,
  familiar,
  marcas,
  onCambio,
}: {
  paciente: Pick<Paciente, 'nombres' | 'sexo'>;
  familiar: { nombre: string; sexo: 'F' | 'M' | null };
  marcas: Marcas;
  onCambio: (m: Marcas) => void;
}) {
  const t = useTextos().pacientes;
  const p = paciente.nombres;
  const f = familiar.nombre;
  const casilla = (clave: keyof Marcas, etiqueta: string) => (
    <CasillaVerificacion
      etiqueta={etiqueta}
      marcada={marcas[clave]}
      onCambio={(v) => onCambio({ ...marcas, [clave]: v })}
    />
  );
  return (
    <fieldset className="w-marcas">
      <legend className="cn-campo__etiqueta">{t.familia.marcas}</legend>
      <p className="w-secundario">{t.familia.marcasAyuda}</p>
      {casilla('esTutorLegal', t.familia.tutor(p, f, paciente.sexo))}
      {casilla('esResponsablePago', t.familia.responsable(p, f))}
      {casilla('familiarEsTutorLegal', t.familia.tutor(f, p, familiar.sexo))}
      {casilla('familiarEsResponsablePago', t.familia.responsable(f, p))}
    </fieldset>
  );
}

/**
 * Selector de familiar: `GET /pacientes?q=…` con «Cargar más». Sin la propia ficha ni los ya
 * vinculados; «Sin resultados» solo cuando no queda nada más por traer.
 */
function SelectorFamiliar({
  paciente,
  onElegir,
  error,
}: {
  paciente: Paciente;
  onElegir: (p: PacienteResumen) => void;
  error: string | undefined;
}) {
  const t = useTextos().pacientes;
  const [texto, setTexto] = useState('');
  const busqueda = useBuscarFamiliar(texto);
  const idResultados = useId();

  // Ni el mismo paciente, ni quien ya está vinculado, ni pacientes inactivos.
  const vinculados = new Set([paciente.id, ...paciente.relaciones.map((r) => r.familiar.id)]);
  const candidatos = busqueda.resultados?.filter((p) => p.activo && !vinculados.has(p.id));

  let estado: string;
  if (busqueda.error) estado = mensajeDeError(busqueda.error);
  else if (busqueda.buscando) estado = t.buscando;
  else if (!candidatos) estado = t.familia.buscarAyuda;
  else if (candidatos.length > 0) estado = '';
  else if (busqueda.hayMas) estado = t.familia.yaVinculados;
  else estado = t.familia.sinResultados(busqueda.q);

  return (
    <div className="w-campo-buscador">
      <Campo
        etiqueta={t.familia.buscar}
        value={texto}
        autoComplete="off"
        onChange={(e) => setTexto(e.target.value)}
        error={error}
        aria-controls={candidatos?.length ? idResultados : undefined}
      />
      {estado ? (
        <p className="w-secundario" role="status">
          {estado}
        </p>
      ) : null}
      {candidatos?.length ? (
        <ul id={idResultados} className="w-familiar-resultados" aria-label={t.familia.resultados}>
          {candidatos.map((p) => {
            const nombre = nombreCompleto(p);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  className="w-familiar-opcion"
                  aria-label={t.familia.elegir(nombre)}
                  onClick={() => onElegir(p)}
                >
                  <Avatar nombre={nombre} tamano="sm" decorativo />
                  <span className="w-familiar-elegido__texto">
                    <strong>{nombre}</strong>
                    <span className="w-secundario">{metaPaciente(t, p)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {busqueda.hayMas && texto.trim().length >= MINIMO_BUSCADOR ? (
        <div>
          <Boton variante="secundario" cargando={busqueda.cargandoMas} onClick={busqueda.cargarMas}>
            {t.familia.cargarMas}
          </Boton>
        </div>
      ) : null}
    </div>
  );
}

function HojaAgregarFamiliar({
  paciente,
  abierta,
  onCerrar,
  onAgregado,
}: {
  paciente: Paciente;
  abierta: boolean;
  onCerrar: () => void;
  onAgregado: () => void;
}) {
  const t = useTextos().pacientes;
  const { api } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const idForm = useId();
  const nombre = nombreCompleto(paciente);

  const [familiar, setFamiliar] = useState<PacienteResumen | null>(null);
  const [tipo, setTipo] = useState<TipoRelacion | ''>('');
  const [marcas, setMarcas] = useState<Marcas>(SIN_MARCAS);
  const [errores, setErrores] = useState<{
    familiar?: string | undefined;
    tipo?: string | undefined;
  }>({});

  const crear = useMutation({
    mutationFn: (datos: CrearRelacion) => api.pacientes.crearRelacion(paciente.id, datos),
    onSuccess: (relacion) => {
      actualizar.cambiarFicha(paciente.id, (p) => ({
        ...p,
        relaciones: [...p.relaciones.filter((r) => r.id !== relacion.id), relacion],
      }));
      // La ficha del familiar ganó el vínculo inverso: se vuelve a pedir al abrirla.
      actualizar.olvidarFicha(relacion.familiar.id);
      onAgregado();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const faltan: typeof errores = {};
    if (!familiar) faltan.familiar = t.familia.faltaFamiliar;
    if (!tipo) faltan.tipo = t.familia.faltaVinculo;
    setErrores(faltan);
    if (!familiar || !tipo) return;
    const r = crearRelacionSchema.safeParse({ familiarId: familiar.id, tipo, ...marcas });
    if (!r.success) return;
    void unaVez(() => crear.mutateAsync(r.data).catch(() => undefined));
  }

  const nombreFamiliar = familiar ? nombreCompleto(familiar) : '';

  return (
    <HojaInferior
      abierta={abierta}
      titulo={t.familia.tituloAgregar}
      onCerrar={onCerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={onCerrar}>
            {t.alta.cancelar}
          </Boton>
          <Boton type="submit" form={idForm} variante="primario" cargando={crear.isPending}>
            {t.familia.guardar}
          </Boton>
        </>
      }
    >
      <form id={idForm} className="w-formulario" onSubmit={enviar} noValidate>
        {familiar ? (
          <div className="w-familiar-elegido">
            <span className="w-familiar-elegido__rotulo">{t.familia.elegido}</span>
            <div className="w-familiar-elegido__fila">
              <Avatar nombre={nombreFamiliar} tamano="sm" decorativo />
              <span className="w-familiar-elegido__texto">
                <strong>{nombreFamiliar}</strong>
                <span className="w-secundario">{metaPaciente(t, familiar)}</span>
              </span>
              <Boton variante="fantasma" onClick={() => setFamiliar(null)}>
                {t.familia.cambiar}
              </Boton>
            </div>
          </div>
        ) : (
          <SelectorFamiliar
            paciente={paciente}
            error={errores.familiar}
            onElegir={(p) => {
              setFamiliar(p);
              setErrores((e) => ({ ...e, familiar: undefined }));
            }}
          />
        )}
        <Campo
          etiqueta={
            familiar ? t.familia.vinculo(nombre, nombreFamiliar) : t.familia.vinculoGenerico
          }
          tipo="select"
          value={tipo}
          opciones={[
            { valor: '', texto: t.familia.elegirVinculo },
            ...TIPOS_RELACION.map((v) => ({ valor: v, texto: t.tipos[v] })),
          ]}
          onChange={(e) => {
            setTipo(e.target.value as TipoRelacion | '');
            setErrores((er) => ({ ...er, tipo: undefined }));
          }}
          error={errores.tipo}
          {...(familiar ? { ayuda: t.familia.espejo(nombreFamiliar) } : {})}
        />
        {familiar ? (
          <CasillasMarcas
            paciente={paciente}
            familiar={{ nombre: familiar.nombres, sexo: familiar.sexo }}
            marcas={marcas}
            onCambio={setMarcas}
          />
        ) : null}
        {crear.isError ? <MensajeError texto={mensajeDeError(crear.error)} /> : null}
      </form>
    </HojaInferior>
  );
}

/** Editar las marcas de un vínculo (`PATCH /relaciones/:id`): manda solo lo que cambió. */
function HojaMarcas({
  paciente,
  relacion,
  onCerrar,
  onGuardado,
}: {
  paciente: Paciente;
  relacion: Relacion;
  onCerrar: () => void;
  onGuardado: () => void;
}) {
  const t = useTextos().pacientes;
  const { api } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const idForm = useId();
  const original: Marcas = {
    esTutorLegal: relacion.esTutorLegal,
    esResponsablePago: relacion.esResponsablePago,
    familiarEsTutorLegal: relacion.familiarEsTutorLegal,
    familiarEsResponsablePago: relacion.familiarEsResponsablePago,
  };
  const [marcas, setMarcas] = useState<Marcas>(original);
  const [sinCambios, setSinCambios] = useState(false);

  const guardar = useMutation({
    mutationFn: (datos: EditarRelacion) => api.pacientes.editarRelacion(relacion.id, datos),
    onSuccess: (r) => {
      actualizar.cambiarFicha(paciente.id, (p) => ({
        ...p,
        relaciones: p.relaciones.map((x) => (x.id === relacion.id ? r : x)),
      }));
      // El espejo cambió en la ficha del familiar: se vuelve a pedir al abrirla.
      actualizar.olvidarFicha(r.familiar.id);
      onGuardado();
    },
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const cambios: EditarRelacion = {};
    for (const clave of Object.keys(original) as (keyof Marcas)[]) {
      if (marcas[clave] !== original[clave]) cambios[clave] = marcas[clave];
    }
    if (Object.keys(cambios).length === 0) {
      setSinCambios(true);
      return;
    }
    setSinCambios(false);
    void unaVez(() => guardar.mutateAsync(cambios).catch(() => undefined));
  }

  // El nombre de la relación es el completo; en las casillas alcanza con el primero.
  const nombreFamiliar = relacion.familiar.nombre;
  return (
    <HojaInferior
      abierta
      titulo={t.familia.tituloMarcas(nombreFamiliar)}
      onCerrar={onCerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={onCerrar}>
            {t.alta.cancelar}
          </Boton>
          <Boton type="submit" form={idForm} variante="primario" cargando={guardar.isPending}>
            {t.familia.guardarMarcas}
          </Boton>
        </>
      }
    >
      <form id={idForm} className="w-formulario" onSubmit={enviar} noValidate>
        <CasillasMarcas
          paciente={paciente}
          familiar={{ nombre: nombreFamiliar, sexo: null }}
          marcas={marcas}
          onCambio={(m) => {
            setMarcas(m);
            setSinCambios(false);
          }}
        />
        {sinCambios ? (
          <p className="w-secundario" role="status">
            {t.familia.sinCambios}
          </p>
        ) : null}
        {guardar.isError ? <MensajeError texto={mensajeDeError(guardar.error)} /> : null}
      </form>
    </HojaInferior>
  );
}

function FilaVinculo({
  paciente,
  relacion,
  onEditar,
  onQuitar,
}: {
  paciente: Paciente;
  relacion: Relacion;
  onEditar: (() => void) | null;
  onQuitar: (() => void) | null;
}) {
  const t = useTextos().pacientes;
  const nombreFamiliar = relacion.familiar.nombre;
  return (
    <li className="w-lista-ficha__item">
      <Avatar nombre={nombreFamiliar} tamano="sm" decorativo />
      <div className="w-lista-ficha__cuerpo">
        <p className="w-lista-ficha__texto">
          <Link className="w-enlace-fila" to={`/pacientes/${relacion.familiar.id}`}>
            {nombreFamiliar}
          </Link>
          {relacion.familiar.edad != null ? (
            <span className="w-secundario"> · {t.edad(relacion.familiar.edad)}</span>
          ) : null}
        </p>
        <span className="w-chips">
          <Chip tono="familia" icono="familia">
            {t.tipos[relacion.tipo]}
          </Chip>
          {relacion.esTutorLegal ? (
            <Chip tono="familia" icono="check">
              {t.familia.tutorChip(paciente.nombres, paciente.sexo)}
            </Chip>
          ) : null}
          {relacion.esResponsablePago ? (
            <Chip tono="familia" icono="caja">
              {t.familia.responsableChip(paciente.nombres)}
            </Chip>
          ) : null}
          {relacion.familiarEsTutorLegal ? (
            <Chip tono="familia" icono="check">
              {t.familia.tutorChip(nombreFamiliar)}
            </Chip>
          ) : null}
          {relacion.familiarEsResponsablePago ? (
            <Chip tono="familia" icono="caja">
              {t.familia.responsableChip(nombreFamiliar)}
            </Chip>
          ) : null}
        </span>
      </div>
      {onEditar || onQuitar ? (
        <span className="w-botonera">
          {onEditar ? (
            <Boton
              variante="fantasma"
              aria-label={t.familia.editarMarcasDe(nombreFamiliar)}
              onClick={onEditar}
            >
              {t.familia.editarMarcas}
            </Boton>
          ) : null}
          {onQuitar ? (
            <Boton
              variante="fantasma"
              aria-label={t.familia.quitarDe(nombreFamiliar)}
              onClick={onQuitar}
            >
              {t.familia.quitar}
            </Boton>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

export function GrupoFamiliar({
  paciente,
  avisar,
}: {
  paciente: Paciente;
  avisar: (texto: string) => void;
}) {
  const t = useTextos().pacientes;
  const { api, puede } = useSesionLista();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const idTitulo = useId();
  const [agregando, setAgregando] = useState(false);
  const [editando, setEditando] = useState<Relacion | null>(null);
  const [quitando, setQuitando] = useState<Relacion | null>(null);
  const puedeEditar = puede('pacientes', 'editar') && paciente.activo;

  const quitar = useMutation({
    mutationFn: (r: Relacion) => api.pacientes.quitarRelacion(r.id),
    onSuccess: (_, r) => {
      actualizar.cambiarFicha(paciente.id, (p) => ({
        ...p,
        relaciones: p.relaciones.filter((x) => x.id !== r.id),
      }));
      actualizar.olvidarFicha(r.familiar.id);
      setQuitando(null);
      avisar(t.familia.quitado);
    },
  });

  return (
    <section className="w-tarjeta" aria-labelledby={idTitulo}>
      <div className="w-tarjeta__cabecera">
        <h2 id={idTitulo} className="w-seccion-ficha__titulo">
          {t.familia.titulo}
        </h2>
        {puedeEditar ? (
          <Boton variante="secundario" icono="mas" onClick={() => setAgregando(true)}>
            {t.familia.agregar}
          </Boton>
        ) : null}
      </div>
      {paciente.relaciones.length === 0 ? (
        <p className="w-secundario">{t.familia.vacio}</p>
      ) : (
        <ul className="w-lista-ficha">
          {paciente.relaciones.map((r) => (
            <FilaVinculo
              key={r.id}
              paciente={paciente}
              relacion={r}
              onEditar={puedeEditar ? () => setEditando(r) : null}
              onQuitar={
                puedeEditar
                  ? () => {
                      quitar.reset();
                      setQuitando(r);
                    }
                  : null
              }
            />
          ))}
        </ul>
      )}
      {puedeEditar && agregando ? (
        <HojaAgregarFamiliar
          paciente={paciente}
          abierta
          onCerrar={() => setAgregando(false)}
          onAgregado={() => {
            setAgregando(false);
            avisar(t.familia.agregado);
          }}
        />
      ) : null}
      {puedeEditar && editando ? (
        <HojaMarcas
          paciente={paciente}
          relacion={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            avisar(t.familia.marcasGuardadas);
          }}
        />
      ) : null}
      {quitando ? (
        <HojaConfirmar
          abierta
          titulo={t.familia.tituloQuitar(quitando.familiar.nombre)}
          texto={t.familia.textoQuitar}
          confirmar={t.familia.confirmarQuitar}
          onCerrar={() => setQuitando(null)}
          onConfirmar={() => void unaVez(() => quitar.mutateAsync(quitando).catch(() => undefined))}
          enviando={quitar.isPending}
          error={quitar.error}
        />
      ) : null}
    </section>
  );
}
