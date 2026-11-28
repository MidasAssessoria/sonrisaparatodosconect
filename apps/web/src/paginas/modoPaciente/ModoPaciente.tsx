import { Boton, Campo, HojaInferior, Icono } from '@conecta/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ErrorAuth } from '../../auth/servicioAuth.js';
import { CampoCodigo } from '../../componentes/CampoCodigo.js';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { fijarModoPaciente, type ModoPaciente } from '../../sesion/modoPaciente.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { useInactividad } from '../../sesion/useInactividad.js';
import { mensajeAuth, RE_CODIGO } from '../acceso/textosError.js';
import { claves, usePaciente } from '../pacientes/consultas.js';
import { useVersionesAnamnesis } from '../pacientes/consultasAnamnesis.js';
import { nombreCompleto } from '../pacientes/formato.js';
import { EditorAnamnesis } from '../pacientes/PestanaAnamnesis.js';
import '../pacientes/pacientes.css';
import './modoPaciente.css';

/** Intentos de desbloqueo fallidos antes de cerrar la sesión. */
export const INTENTOS_DESBLOQUEO = 5;

/** El formulario de anamnesis en pantalla completa, para el paciente. */
function FormularioDelPaciente({
  pacienteId,
  onTerminar,
}: {
  pacienteId: string;
  onTerminar: (guardada: boolean) => void;
}) {
  const t = useTextos().modoPaciente;
  const paciente = usePaciente(pacienteId);
  const versiones = useVersionesAnamnesis(pacienteId);

  if (paciente.data && versiones.data) {
    const p = paciente.data;
    return (
      <>
        <header className="w-modo-paciente__cabecera">
          <h1 className="w-modo-paciente__titulo">{t.titulo}</h1>
          <p className="w-secundario">{t.para(nombreCompleto(p))}</p>
        </header>
        <EditorAnamnesis
          paciente={p}
          vigente={versiones.data.versiones[0]?.version ?? null}
          requiereTutor={versiones.data.requiereTutor}
          modoPaciente
          onGuardada={() => onTerminar(true)}
          onCancelar={() => onTerminar(false)}
        />
      </>
    );
  }
  const error = paciente.error ?? versiones.error;
  if (error) {
    return (
      <>
        <MensajeError texto={t.noSePudo} />
        <Boton variante="secundario" onClick={() => onTerminar(false)}>
          {t.terminar}
        </Boton>
      </>
    );
  }
  return <Esqueleto filas={6} etiqueta={t.cargando} />;
}

type Metodo = { tipo: 'codigo'; factorId: string } | { tipo: 'clave' };

/**
 * «Devolvé la tablet a la clínica». Se sale solo con una credencial de quien tiene la sesión
 * abierta, sin bajar el nivel de la sesión:
 *   - con doble factor verificado, el código TOTP (`challengeAndVerify` deja la sesión en aal2);
 *   - sin doble factor, la contraseña (la sesión nueva es aal1, la misma que ya tenía).
 * Nunca se pide la contraseña a alguien con doble factor: el ingreso nuevo sería aal1 y la sesión
 * quedaría degradada. Tras varios intentos fallidos se cierra la sesión.
 */
function Bloqueo({ modo, guardada }: { modo: ModoPaciente; guardada: boolean }) {
  const textos = useTextos();
  const t = textos.modoPaciente;
  const { auth, sesion, cerrarSesion } = useSesionLista();
  const consultas = useQueryClient();
  const navegar = useNavigate();
  const unaVez = useEnvioUnico();
  const [metodo, setMetodo] = useState<Metodo | null>(null);
  const [errorMetodo, setErrorMetodo] = useState<unknown>(null);
  const [intento, setIntento] = useState(0);
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const fallidos = useRef(0);

  useEffect(() => {
    let vigente = true;
    auth
      .factoresTotp()
      .then((f) => {
        if (!vigente) return;
        const verificado = f.find((x) => x.verificado);
        setMetodo(verificado ? { tipo: 'codigo', factorId: verificado.id } : { tipo: 'clave' });
        setErrorMetodo(null);
      })
      .catch((e: unknown) => {
        if (vigente) setErrorMetodo(e);
      });
    return () => {
      vigente = false;
    };
  }, [auth, intento]);

  async function desbloquear() {
    if (!metodo) return;
    if (metodo.tipo === 'codigo' && !RE_CODIGO.test(valor)) {
      setError(t.faltaCodigo);
      return;
    }
    if (metodo.tipo === 'clave' && !valor) {
      setError(t.faltaClave);
      return;
    }
    setEnviando(true);
    setError(null);
    try {
      if (metodo.tipo === 'codigo') {
        await auth.verificarCodigo(metodo.factorId, valor);
      } else {
        const u = await auth.iniciarSesion(sesion.usuario.email, valor);
        if (u.usuarioId !== sesion.usuario.id) {
          setError(t.otraCuenta);
          await cerrarSesion();
          return;
        }
      }
      fijarModoPaciente(null);
      // Lo que el paciente guardó: la ficha y la anamnesis se vuelven a pedir al abrirlas.
      if (modo.pacienteId) {
        void consultas.invalidateQueries({
          queryKey: claves.anamnesis(sesion.clinica.id, modo.pacienteId),
        });
        void consultas.invalidateQueries({
          queryKey: claves.ficha(sesion.clinica.id, modo.pacienteId),
        });
      }
      void navegar(modo.pacienteId ? `/pacientes/${modo.pacienteId}/anamnesis` : '/', {
        replace: true,
      });
    } catch (e) {
      const deCredencial =
        e instanceof ErrorAuth && (e.tipo === 'codigo_invalido' || e.tipo === 'credenciales');
      if (deCredencial) fallidos.current += 1;
      const restan = INTENTOS_DESBLOQUEO - fallidos.current;
      if (restan <= 0) {
        setError(t.demasiados);
        await cerrarSesion();
        return;
      }
      setValor('');
      setError(
        deCredencial ? `${mensajeAuth(e, textos)} ${t.restan(restan)}` : mensajeAuth(e, textos),
      );
    } finally {
      setEnviando(false);
    }
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    void unaVez(desbloquear);
  }

  return (
    <div className="w-bloqueo">
      <section className="w-bloqueo__mensaje" aria-labelledby="w-bloqueo-titulo">
        <span className="w-bloqueo__icono" aria-hidden="true">
          <Icono nombre="candado" tamano={40} />
        </span>
        <h1 id="w-bloqueo-titulo" className="w-bloqueo__titulo">
          {t.bloqueoTitulo}
        </h1>
        {guardada ? <p className="w-bloqueo__texto">{t.bloqueoGuardada}</p> : null}
        <p className="w-bloqueo__texto">{t.bloqueoTexto}</p>
      </section>

      <section className="w-tarjeta w-bloqueo__equipo" aria-labelledby="w-bloqueo-equipo">
        <h2 id="w-bloqueo-equipo" className="w-seccion-ficha__titulo">
          {t.equipo}
        </h2>
        <p className="w-secundario">{t.equipoTexto(sesion.usuario.nombre)}</p>
        {errorMetodo ? (
          <MensajeError error={errorMetodo} onReintentar={() => setIntento((n) => n + 1)} />
        ) : !metodo ? (
          <Esqueleto filas={2} etiqueta={t.cargandoMetodo} />
        ) : (
          <form className="w-formulario" onSubmit={enviar} noValidate>
            {metodo.tipo === 'codigo' ? (
              <CampoCodigo
                valor={valor}
                onCambio={(v) => {
                  setValor(v);
                  setError(null);
                }}
                error={error}
              />
            ) : (
              <Campo
                etiqueta={t.clave}
                tipo="password"
                autoComplete="current-password"
                value={valor}
                onChange={(e) => {
                  setValor(e.target.value);
                  setError(null);
                }}
                error={error}
              />
            )}
            <div className="w-botonera">
              <Boton type="submit" variante="primario" icono="candado" cargando={enviando}>
                {t.desbloquear}
              </Boton>
            </div>
          </form>
        )}
        <p className="w-secundario">{t.cerrarSesionAyuda}</p>
        <div>
          <Boton variante="fantasma" icono="salir" onClick={() => void cerrarSesion()}>
            {t.cerrarSesion}
          </Boton>
        </div>
      </section>
    </div>
  );
}

/**
 * Pantalla completa del modo paciente: reemplaza al armazón entero (sin menú, buscador, barra
 * superior ni rutas). La sesión sigue cerrándose por inactividad, como en el resto de la app.
 */
export function PantallaModoPaciente({ modo }: { modo: ModoPaciente }) {
  const textos = useTextos();
  const { sesion, cerrarSesion, mantenerSesion } = useSesionLista();
  const [guardada, setGuardada] = useState(false);
  const { aviso, seguir } = useInactividad({
    minutos: sesion.inactividadMin,
    activo: true,
    alCerrar: () => void cerrarSesion({ tipo: 'inactividad', minutos: sesion.inactividadMin }),
    alAvisarApi: () => void mantenerSesion(),
  });

  return (
    <main className="w-modo-paciente">
      {modo.fase === 'formulario' && modo.pacienteId ? (
        <FormularioDelPaciente
          pacienteId={modo.pacienteId}
          onTerminar={(g) => {
            setGuardada(g);
            fijarModoPaciente({ ...modo, fase: 'bloqueado' });
            window.scrollTo?.({ top: 0 });
          }}
        />
      ) : (
        <Bloqueo modo={modo} guardada={guardada} />
      )}
      <HojaInferior
        abierta={aviso}
        titulo={textos.inactividad.titulo}
        onCerrar={seguir}
        acciones={
          <Boton variante="primario" bloque onClick={seguir}>
            {textos.inactividad.seguir}
          </Boton>
        }
      >
        <p>{textos.inactividad.texto}</p>
      </HojaInferior>
    </main>
  );
}
