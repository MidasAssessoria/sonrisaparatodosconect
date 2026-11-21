import type { InvitacionPublica } from '@conecta/shared';
import { Boton, Campo, EncabezadoPagina, EstadoVacio } from '@conecta/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { ErrorConecta } from '../../api/errores.js';
import { AvisoPersistente, MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { mensajeAuth, RE_CORREO } from '../acceso/textosError.js';
import { MarcoAcceso } from '../acceso/MarcoAcceso.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { escribirEnSesion, leerDeSesion } from '../../sesion/preferencias.js';
import { coincideConMascara, fecha, useApiPersonal } from './consultas.js';
import { T } from './textos.js';
import './personal.css';

/*
 * Aceptar una invitación (`/invitacion?token=…`). La ruta existe sin sesión y con sesión, y la
 * página pasa de una a otra mientras se ingresa: el estado que tiene que sobrevivir a ese cambio
 * va en sessionStorage, atado al token.
 *   - `invitacion.aceptada`: la cuenta nueva ya aceptó; al llegar con sesión se va al inicio.
 *   - `invitacion.ingreso`: la persona ingresó desde acá para aceptar; al llegar con sesión se
 *     acepta sola (una vez).
 */
const MARCA_ACEPTADA = 'invitacion.aceptada';
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

function Marco({ conSesion, children }: { conSesion: boolean; children: ReactNode }) {
  if (conSesion) {
    return (
      <>
        <EncabezadoPagina titulo={T.aceptar.titulo} />
        <div className="w-tarjeta">{children}</div>
      </>
    );
  }
  return <MarcoAcceso titulo={T.aceptar.titulo}>{children}</MarcoAcceso>;
}

function EnlaceInvalido({ conSesion }: { conSesion: boolean }) {
  const navegar = useNavigate();
  return (
    <Marco conSesion={conSesion}>
      <EstadoVacio
        titulo={T.aceptar.invalidoTitulo}
        texto={T.aceptar.invalidoTexto}
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

/** Correo sin cuenta: elegir contraseña, aceptar e ingresar. */
function CuentaNueva({ token, onInvalido }: { token: string; onInvalido: () => void }) {
  const t = useTextos();
  const { ingresar } = useSesion();
  const api = useApiPersonal();
  const navegar = useNavigate();
  const unaVez = useEnvioUnico();
  const [clave, setClave] = useState('');
  const [repetida, setRepetida] = useState('');
  const [errores, setErrores] = useState<{ clave?: string; repetida?: string }>({});
  const [error, setError] = useState<unknown>(null);
  const [sinIngreso, setSinIngreso] = useState<string | null>(null);
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
      let email: string;
      try {
        email = (await api.invitaciones.aceptar({ token, clave }, false)).email;
      } catch (err) {
        setEnviando(false);
        if (enlaceSinValor(err) && !(err instanceof ErrorConecta && err.detalles.length)) {
          onInvalido();
          return;
        }
        const campo =
          err instanceof ErrorConecta ? err.detalles.find((d) => d.campo === 'clave') : undefined;
        if (campo) setErrores({ clave: campo.mensaje });
        else setError(err);
        return;
      }
      // Al ingresar, la página se vuelve a montar con sesión: que vaya directo al inicio.
      escribirEnSesion(MARCA_ACEPTADA, token);
      try {
        await ingresar(email, clave);
      } catch (err) {
        escribirEnSesion(MARCA_ACEPTADA, null);
        setEnviando(false);
        setSinIngreso(T.aceptar.cuentaCreadaSinIngreso(mensajeAuth(err, t)));
      }
    });
  }

  if (sinIngreso) {
    return (
      <>
        <MensajeError texto={sinIngreso} />
        <Boton variante="primario" bloque onClick={() => void navegar('/acceso')}>
          {T.aceptar.irAIngresar}
        </Boton>
      </>
    );
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
      {error ? <MensajeError error={error} /> : null}
      <Boton type="submit" variante="primario" tamano="lg" bloque cargando={enviando}>
        {T.aceptar.crearYEntrar}
      </Boton>
    </form>
  );
}

/** Correo con cuenta y sin sesión: ingresar acá; al volver con sesión se acepta solo. */
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

/** Con sesión abierta y el mismo correo: aceptar con el token de la sesión y pasar a esa clínica. */
function AceptarConSesion({
  token,
  inv,
  onInvalido,
}: {
  token: string;
  inv: InvitacionPublica;
  onInvalido: () => void;
}) {
  const { elegirClinica } = useSesion();
  const api = useApiPersonal();
  const navegar = useNavigate();
  const unaVez = useEnvioUnico();
  const aceptar = useMutation({
    mutationFn: () => api.invitaciones.aceptar({ token }, true),
    onSuccess: async (r) => {
      void navegar('/', { replace: true });
      // Recarga la sesión ya en la clínica nueva.
      await elegirClinica(r.clinicaId);
    },
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
      {aceptar.isError ? <MensajeError error={aceptar.error} /> : null}
      {aceptar.isPending ? (
        <p className="w-nota" role="status">
          {T.aceptar.uniendo}
        </p>
      ) : null}
      <Boton variante="primario" tamano="lg" cargando={aceptar.isPending} onClick={enviar}>
        {T.aceptar.unirme(inv.clinica)}
      </Boton>
    </>
  );
}

export function AceptarInvitacion() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const { estado, sesion, cerrarSesion } = useSesion();
  const api = useApiPersonal();
  const conSesion = estado.fase === 'lista';
  const [invalido, setInvalido] = useState(false);
  const [yaAceptada] = useState(() => tokenValido(token) && leerDeSesion(MARCA_ACEPTADA) === token);
  const [cerrando, setCerrando] = useState(false);

  useEffect(() => {
    if (yaAceptada) escribirEnSesion(MARCA_ACEPTADA, null);
  }, [yaAceptada]);

  const consulta = useQuery({
    queryKey: ['invitacion', token],
    queryFn: () => api.invitaciones.consultar(token ?? ''),
    enabled: tokenValido(token) && !yaAceptada,
    retry: false,
    staleTime: 0,
  });

  if (yaAceptada) return <Navigate to="/" replace />;
  if (!tokenValido(token) || invalido || (consulta.isError && enlaceSinValor(consulta.error))) {
    return <EnlaceInvalido conSesion={conSesion} />;
  }
  if (consulta.isPending) {
    return (
      <Marco conSesion={conSesion}>
        <p className="w-nota" role="status">
          {T.aceptar.cargando}
        </p>
      </Marco>
    );
  }
  if (consulta.isError) {
    return (
      <Marco conSesion={conSesion}>
        <MensajeError error={consulta.error} onReintentar={() => void consulta.refetch()} />
      </Marco>
    );
  }

  const inv = consulta.data;
  let cuerpo: ReactNode;
  if (conSesion && sesion) {
    const mismoCorreo =
      inv.requiereIngreso && coincideConMascara(sesion.usuario.email, inv.emailEnmascarado);
    cuerpo = mismoCorreo ? (
      <AceptarConSesion token={token} inv={inv} onInvalido={() => setInvalido(true)} />
    ) : (
      <AvisoPersistente
        titulo={T.aceptar.otraCuentaTitulo}
        texto={T.aceptar.otraCuentaTexto(sesion.usuario.email, inv.emailEnmascarado)}
        accion={
          <Boton
            variante="primario"
            icono="salir"
            cargando={cerrando}
            onClick={() => {
              setCerrando(true);
              void cerrarSesion();
            }}
          >
            {T.aceptar.cerrarYSeguir}
          </Boton>
        }
      />
    );
  } else if (inv.requiereIngreso) {
    cuerpo = <IngresarParaAceptar token={token} inv={inv} />;
  } else {
    cuerpo = <CuentaNueva token={token} onInvalido={() => setInvalido(true)} />;
  }

  return (
    <Marco conSesion={conSesion}>
      <DatosInvitacion inv={inv} />
      {cuerpo}
    </Marco>
  );
}
