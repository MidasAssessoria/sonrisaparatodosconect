import type { InvitacionPublica } from '@conecta/shared';
import { Boton, Campo, EstadoVacio } from '@conecta/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { ErrorConecta } from '../../api/errores.js';
import { ErrorAuth } from '../../auth/servicioAuth.js';
import { AvisoPersistente, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { mensajeAuth, RE_CORREO } from '../acceso/textosError.js';
import { MarcoAcceso } from '../acceso/MarcoAcceso.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { escribirEnSesion, leerDeSesion } from '../../sesion/preferencias.js';
import { coincideConMascara, fecha, mensajeRechazo } from './consultas.js';
import { T } from './textos.js';
import './personal.css';

/*
 * Aceptar una invitación (`/invitacion?token=…`). Solo la acepta quien controla el correo
 * invitado: `POST /invitaciones/aceptar` va SIEMPRE con `Authorization` (contrato/personal.ts).
 *
 * Mientras la persona está acá sin haber aceptado, `ProveedorSesion` no carga la sesión de la app
 * (`GET /sesion`): con cuenta de Supabase la deja en la fase `invitacion`, y recién después de
 * aceptar (`terminarInvitacion`) entra a la clínica nueva. Así sirve también para una cuenta sin
 * ninguna clínica activa.
 *
 * Según `siguientePaso` y si hay cuenta de Supabase abierta:
 *   - `revisa_tu_correo`, sin sesión: le mandamos el correo de Supabase; no hay formulario.
 *   - `revisa_tu_correo`, con sesión (volvió desde ese correo): elige su contraseña dos veces
 *     (`cambiarClave` → `updateUser`) y acepta.
 *   - `cuenta_existente`, sin sesión: ingresa acá (con su segundo factor, si lo tiene, que el
 *     proveedor pide primero) y al volver con sesión se acepta solo, una vez.
 *   - `cuenta_existente`, con sesión: un botón para unirse.
 *   - Sesión con otro correo: aviso y cerrar sesión.
 *
 * `invitacion.ingreso` (sessionStorage, atado al token) marca que la persona ingresó desde acá
 * para aceptar: la página se vuelve a montar al cambiar de fase.
 */
const MARCA_INGRESO = 'invitacion.ingreso';

const MIN_CLAVE = 10;
const MAX_CLAVE = 72;

function tokenValido(token: string | null): token is string {
  return !!token && token.length >= 20 && token.length <= 200;
}

/** ¿El error dice que el enlace no sirve (inválido, vencido o usado)? */
function enlaceSinValor(e: unknown): boolean {
  return (
    e instanceof ErrorConecta && (e.codigo === 'no_encontrado' || e.codigo === 'datos_invalidos')
  );
}

/**
 * Supabase vuelve con `#error=…&error_code=otp_expired…` cuando el enlace de su correo venció o ya
 * se usó (y entonces no hay sesión).
 */
function errorDelCorreo(hash: string): boolean {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  return p.has('error') || p.has('error_code') || p.has('error_description');
}

function Marco({ children }: { children: ReactNode }) {
  return <MarcoAcceso titulo={T.aceptar.titulo}>{children}</MarcoAcceso>;
}

/** Un solo mensaje amable, sin detalles de por qué. */
function MensajeUnico({
  titulo,
  texto,
  conSesion,
}: {
  titulo: string;
  texto: string;
  conSesion: boolean;
}) {
  const navegar = useNavigate();
  return (
    <Marco>
      <EstadoVacio
        titulo={titulo}
        texto={texto}
        accion={
          conSesion ? undefined : (
            <Boton variante="secundario" onClick={() => void navegar('/acceso')}>
              {T.aceptar.irAIngresar}
            </Boton>
          )
        }
      />
    </Marco>
  );
}

function DatosInvitacion({ inv }: { inv: InvitacionPublica }) {
  return (
    <>
      <p className="w-acceso__texto">{T.aceptar.teInvitan(inv.clinica)}</p>
      <dl className="w-datos w-invitacion-datos">
        <div>
          <dt>{T.aceptar.clinica}</dt>
          <dd>{inv.clinica}</dd>
        </div>
        <div>
          <dt>{T.aceptar.rol}</dt>
          <dd>{inv.rol}</dd>
        </div>
        <div>
          <dt>{T.aceptar.nombre}</dt>
          <dd>{inv.nombre}</dd>
        </div>
        <div>
          <dt>{T.aceptar.correo}</dt>
          <dd>{inv.emailEnmascarado}</dd>
        </div>
        <div>
          <dt>{T.aceptar.vence}</dt>
          <dd>{fecha(inv.venceEn)}</dd>
        </div>
      </dl>
    </>
  );
}

/** Cuenta nueva sin sesión: el correo de Supabase es el único camino. */
function RevisaTuCorreo({ inv }: { inv: InvitacionPublica }) {
  return (
    <>
      <AvisoPersistente
        titulo={T.aceptar.revisaTuCorreoTitulo}
        texto={T.aceptar.revisaTuCorreo(inv.emailEnmascarado)}
      />
      <p className="w-nota">{T.aceptar.revisaTuCorreoAyuda}</p>
    </>
  );
}

/** Cuenta nueva, de vuelta desde el correo con sesión: elegir contraseña y aceptar. */
function ElegirClaveYAceptar({
  token,
  onInvalido,
  onAceptada,
}: {
  token: string;
  onInvalido: () => void;
  onAceptada: (clinicaId: string) => void;
}) {
  const t = useTextos();
  const { auth, api } = useSesion();
  const unaVez = useEnvioUnico();
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errores, setErrores] = useState<{ clave?: string; repetida?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const nuevos: typeof errores = {};
    if (!clave) nuevos.clave = T.aceptar.faltaClave;
    else if (clave.length < MIN_CLAVE) nuevos.clave = T.aceptar.claveCorta;
    else if (clave.length > MAX_CLAVE) nuevos.clave = T.aceptar.claveLarga;
    if (!nuevos.clave && repetida !== clave) nuevos.repetida = T.aceptar.noCoinciden;
    setErrores(nuevos);
    setError(null);
    if (nuevos.clave || nuevos.repetida) return;
    void unaVez(async () => {
      setEnviando(true);
      try {
        await auth.cambiarClave(clave);
      } catch (err) {
        // Ya la había guardado (p. ej. recargó la página después de elegirla): sigue igual.
        if (!(err instanceof ErrorAuth && err.tipo === 'clave_repetida')) {
          setEnviando(false);
          setErrores({ clave: mensajeAuth(err, t) });
          return;
        }
      }
      let clinicaId: string;
      try {
        clinicaId = (await api.invitaciones.aceptar(token)).clinicaId;
      } catch (err) {
        setEnviando(false);
        if (enlaceSinValor(err)) onInvalido();
        else setError(mensajeRechazo(err));
        return;
      }
      onAceptada(clinicaId);
    });
  }

  return (
    <form className="w-formulario" onSubmit={enviar} noValidate>
      <p className="w-acceso__texto">{T.aceptar.crearClave}</p>
      <Campo
        etiqueta={T.aceptar.clave}
        tipo="password"
        autoComplete="new-password"
        maxLength={MAX_CLAVE}
        ayuda={T.aceptar.claveAyuda}
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        error={errores.clave}
      />
      <Campo
        etiqueta={T.aceptar.repetir}
        tipo="password"
        autoComplete="new-password"
        maxLength={MAX_CLAVE}
        value={repetida}
        onChange={(e) => setRepetida(e.target.value)}
        error={errores.repetida}
      />
      {error ? <MensajeError texto={error} /> : null}
      <Boton type="submit" variante="primario" tamano="lg" bloque cargando={enviando}>
        {T.aceptar.crearYEntrar}
      </Boton>
    </form>
  );
}

/** Cuenta existente sin sesión: ingresar acá; al volver con sesión se acepta solo. */
function IngresarParaAceptar({ token, inv }: { token: string; inv: InvitacionPublica }) {
  const t = useTextos();
  const { ingresar } = useSesion();
  const unaVez = useEnvioUnico();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [errores, setErrores] = useState<{ email?: string; clave?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const correo = email.trim();
    const nuevos: typeof errores = {};
    if (!correo) nuevos.email = T.aceptar.faltaCorreo;
    else if (!RE_CORREO.test(correo)) nuevos.email = T.aceptar.correoInvalido;
    else if (!coincideConMascara(correo, inv.emailEnmascarado))
      nuevos.email = T.aceptar.otroCorreoEscrito(inv.emailEnmascarado);
    if (!clave) nuevos.clave = t.acceso.faltaClave;
    setErrores(nuevos);
    setErrorGeneral(null);
    if (nuevos.email || nuevos.clave) return;
    void unaVez(async () => {
      setEnviando(true);
      escribirEnSesion(MARCA_INGRESO, token);
      try {
        // El proveedor pide el segundo factor (si lo tiene) y vuelve a esta página con sesión.
        await ingresar(correo, clave);
      } catch (err) {
        escribirEnSesion(MARCA_INGRESO, null);
        setErrorGeneral(mensajeAuth(err, t));
        setEnviando(false);
      }
    });
  }

  return (
    <form className="w-formulario" onSubmit={enviar} noValidate>
      <p className="w-acceso__texto">{T.aceptar.yaTenesCuenta}</p>
      <Campo
        etiqueta={T.aceptar.correo}
        tipo="email"
        inputMode="email"
        autoComplete="username"
        ayuda={T.aceptar.correoAyuda(inv.emailEnmascarado)}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errores.email}
      />
      <Campo
        etiqueta={T.aceptar.clave}
        tipo="password"
        autoComplete="current-password"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        error={errores.clave}
      />
      {errorGeneral ? <MensajeError texto={errorGeneral} /> : null}
      <Boton type="submit" variante="primario" tamano="lg" bloque cargando={enviando}>
        {T.aceptar.ingresarYAceptar}
      </Boton>
    </form>
  );
}

/** Con cuenta abierta y el mismo correo: aceptar con su token y pasar a esa clínica. */
function AceptarConSesion({
  token,
  inv,
  onInvalido,
  onAceptada,
}: {
  token: string;
  inv: InvitacionPublica;
  onInvalido: () => void;
  onAceptada: (clinicaId: string) => void;
}) {
  const { api } = useSesion();
  const unaVez = useEnvioUnico();
  const aceptar = useMutation({
    mutationFn: () => api.invitaciones.aceptar(token),
    onSuccess: (r) => onAceptada(r.clinicaId),
    onError: (e) => {
      if (enlaceSinValor(e)) onInvalido();
    },
  });
  const enviar = () => void unaVez(() => aceptar.mutateAsync().catch(() => undefined));

  // Viene de ingresar en esta misma página: se acepta solo, una vez.
  const automatico = useRef(false);
  useEffect(() => {
    if (automatico.current || leerDeSesion(MARCA_INGRESO) !== token) return;
    automatico.current = true;
    escribirEnSesion(MARCA_INGRESO, null);
    enviar();
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {aceptar.isError && !enlaceSinValor(aceptar.error) ? (
        <MensajeError texto={mensajeRechazo(aceptar.error)} />
      ) : null}
      {aceptar.isPending ? (
        <p className="w-nota" role="status">
          {T.aceptar.uniendo}
        </p>
      ) : null}
      <Boton variante="primario" tamano="lg" bloque cargando={aceptar.isPending} onClick={enviar}>
        {T.aceptar.unirme(inv.clinica)}
      </Boton>
    </>
  );
}

export function AceptarInvitacion() {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const navegar = useNavigate();
  const token = params.get('token');
  const { estado, api, cerrarSesion, terminarInvitacion } = useSesion();
  // Cuenta de Supabase abierta, todavía sin la sesión de la app.
  const usuario = estado.fase === 'invitacion' ? estado.usuario : null;
  const [invalido, setInvalido] = useState(false);
  const [cerrando, setCerrando] = useState(false);

  const consulta = useQuery({
    queryKey: ['invitacion', token],
    queryFn: () => api.invitaciones.consultar(token ?? ''),
    enabled: tokenValido(token),
    retry: false,
    // La página se vuelve a montar al ingresar o al volver del segundo factor: no hace falta
    // volver a consultar.
    staleTime: 60_000,
  });

  const aceptada = (clinicaId: string) => {
    escribirEnSesion(MARCA_INGRESO, null);
    // Primero el proveedor pasa a cargar la sesión en la clínica nueva; después se sale de acá.
    void terminarInvitacion(clinicaId);
    void navegar('/', { replace: true });
  };

  if (!tokenValido(token) || invalido || (consulta.isError && enlaceSinValor(consulta.error))) {
    return (
      <MensajeUnico
        titulo={T.aceptar.invalidoTitulo}
        texto={T.aceptar.invalidoTexto}
        conSesion={!!usuario}
      />
    );
  }
  if (!usuario && errorDelCorreo(hash)) {
    return (
      <MensajeUnico
        titulo={T.aceptar.correoVencidoTitulo}
        texto={T.aceptar.correoVencidoTexto}
        conSesion={false}
      />
    );
  }
  if (consulta.isPending) {
    return (
      <Marco>
        <p className="w-nota" role="status">
          {T.aceptar.cargando}
        </p>
      </Marco>
    );
  }
  if (consulta.isError) {
    return (
      <Marco>
        <MensajeError error={consulta.error} onReintentar={() => void consulta.refetch()} />
      </Marco>
    );
  }

  const inv = consulta.data;
  let cuerpo: ReactNode;
  if (usuario && !coincideConMascara(usuario.email, inv.emailEnmascarado)) {
    cuerpo = (
      <AvisoPersistente
        titulo={T.aceptar.otraCuentaTitulo}
        texto={T.aceptar.otraCuentaTexto(usuario.email, inv.emailEnmascarado)}
        accion={
          <Boton
            variante="primario"
            icono="salir"
            cargando={cerrando}
            onClick={() => {
              setCerrando(true);
              escribirEnSesion(MARCA_INGRESO, null);
              void cerrarSesion().finally(() => setCerrando(false));
            }}
          >
            {T.aceptar.cerrarYSeguir}
          </Boton>
        }
      />
    );
  } else if (usuario && inv.siguientePaso === 'revisa_tu_correo') {
    cuerpo = (
      <ElegirClaveYAceptar
        token={token}
        onInvalido={() => setInvalido(true)}
        onAceptada={aceptada}
      />
    );
  } else if (usuario) {
    cuerpo = (
      <AceptarConSesion
        token={token}
        inv={inv}
        onInvalido={() => setInvalido(true)}
        onAceptada={aceptada}
      />
    );
  } else if (inv.siguientePaso === 'revisa_tu_correo') {
    cuerpo = <RevisaTuCorreo inv={inv} />;
  } else {
    cuerpo = <IngresarParaAceptar token={token} inv={inv} />;
  }

  return (
    <Marco>
      <DatosInvitacion inv={inv} />
      {cuerpo}
    </Marco>
  );
}
