import {
  crearRelacionSchema,
  TIPOS_RELACION,
  type CrearRelacion,
  type Paciente,
  type PacienteResumen,
  type Relacion,
  type TipoRelacion,
} from '@conecta/shared';
import { Avatar, Boton, Buscador, Campo, Chip, HojaInferior } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { mensajeDeError } from '../../api/errores.js';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { CasillaVerificacion, HojaConfirmar } from '../personal/componentes.js';
import { useActualizarPacientes, useBuscarPacientes } from './consultas.js';
import { metaPaciente, nombreCompleto, resultadoBuscador } from './formato.js';

/*
 * Vínculos del grupo familiar, vistos desde la ficha abierta (P). `tipo` dice qué es el familiar
 * (F) de P: en la ficha de Ana, Mateo figura como «Hijo/a». Tutor legal y responsable de pago van
 * al revés: «P es tutor legal de F», «P paga por F» (contrato/pacientes.ts y la migración de
 * `paciente_relacion`). La API crea el vínculo inverso en la ficha de F, sin esas marcas.
 */

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

  const [texto, setTexto] = useState('');
  const [familiar, setFamiliar] = useState<PacienteResumen | null>(null);
  const [tipo, setTipo] = useState<TipoRelacion | ''>('');
  const [tutor, setTutor] = useState(false);
  const [responsable, setResponsable] = useState(false);
  const [errores, setErrores] = useState<{
    familiar?: string | undefined;
    tipo?: string | undefined;
  }>({});
  const busqueda = useBuscarPacientes(texto, abierta && !familiar);

  // Ni el mismo paciente ni quien ya está vinculado.
  const vinculados = new Set([paciente.id, ...paciente.relaciones.map((r) => r.familiar.id)]);
  const candidatos = busqueda.resultados?.filter((p) => !vinculados.has(p.id));

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
    const r = crearRelacionSchema.safeParse({
      familiarId: familiar.id,
      tipo,
      esTutorLegal: tutor,
      esResponsablePago: responsable,
    });
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
              <Boton
                variante="fantasma"
                onClick={() => {
                  setFamiliar(null);
                  setTexto('');
                }}
              >
                {t.familia.cambiar}
              </Boton>
            </div>
          </div>
        ) : (
          <div className="w-campo-buscador">
            <span className="cn-campo__etiqueta" aria-hidden="true">
              {t.familia.buscar}
            </span>
            <Buscador
              valor={texto}
              onCambio={setTexto}
              etiqueta={t.familia.buscar}
              resultados={candidatos?.map((p) => resultadoBuscador(t, p))}
              onElegir={(r) => {
                const elegido = candidatos?.find((p) => p.id === r.id);
                if (elegido) {
                  setFamiliar(elegido);
                  setErrores((e) => ({ ...e, familiar: undefined }));
                }
              }}
            />
            {errores.familiar ? (
              <p className="w-error-campo" role="alert">
                {errores.familiar}
              </p>
            ) : (
              <p className="w-secundario">
                {busqueda.buscando ? t.buscando : t.familia.buscarAyuda}
              </p>
            )}
          </div>
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
        <CasillaVerificacion
          etiqueta={t.familia.tutor(nombre, nombreFamiliar || t.familia.elegido.toLowerCase())}
          marcada={tutor}
          onCambio={setTutor}
        />
        <CasillaVerificacion
          etiqueta={t.familia.responsable(
            nombre,
            nombreFamiliar || t.familia.elegido.toLowerCase(),
          )}
          marcada={responsable}
          onCambio={setResponsable}
        />
        {crear.isError ? <MensajeError texto={mensajeDeError(crear.error)} /> : null}
      </form>
    </HojaInferior>
  );
}

function FilaVinculo({
  paciente,
  relacion,
  onQuitar,
}: {
  paciente: Paciente;
  relacion: Relacion;
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
              {t.familia.tutorChip(paciente.nombres)}
            </Chip>
          ) : null}
          {relacion.esResponsablePago ? (
            <Chip tono="familia" icono="caja">
              {t.familia.responsableChip(paciente.nombres)}
            </Chip>
          ) : null}
        </span>
      </div>
      {onQuitar ? (
        <Boton
          variante="fantasma"
          aria-label={t.familia.quitarDe(nombreFamiliar)}
          onClick={onQuitar}
        >
          {t.familia.quitar}
        </Boton>
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
