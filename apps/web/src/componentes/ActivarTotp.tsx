import { Boton } from '@conecta/ui';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { InscripcionTotp } from '../auth/servicioAuth.js';
import { useTextos } from '../i18n/idioma.js';
import { mensajeAuth, RE_CODIGO } from '../paginas/acceso/textosError.js';
import { useSesion } from '../sesion/ProveedorSesion.js';
import { CampoCodigo } from './CampoCodigo.js';
import { MensajeError } from './estados.js';
import { useEnvioUnico } from './useEnvioUnico.js';

/**
 * Activación del doble factor: botón para empezar, QR, clave manual y verificación del primer
 * código. La usan Seguridad (opcional) y la pantalla obligatoria de activación.
 */
export function ActivarTotp({
  onActivado,
  cancelable = true,
  iniciarSolo = false,
}: {
  /** Se llama con el factor ya verificado (la sesión de Supabase pasó a aal2). */
  onActivado: () => Promise<void> | void;
  /** En la pantalla obligatoria no hay «Cancelar»: se sale activándolo o cerrando sesión. */
  cancelable?: boolean;
  /**
   * Genera el QR al montar, sin esperar el clic en «Activar». Lo usa la pantalla obligatoria: ahí
   * no hay otra salida, así que el botón era un paso de más (y en la primera prueba real nadie lo
   * tocó). Si falla, queda el botón para reintentar.
   */
  iniciarSolo?: boolean;
}) {
  const t = useTextos();
  const { auth } = useSesion();
  const unaVez = useEnvioUnico();
  const [inscripcion, setInscripcion] = useState<InscripcionTotp | null>(null);
  const [codigo, setCodigo] = useState('');
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  function empezar() {
    void unaVez(async () => {
      setError(null);
      setOcupado(true);
      try {
        setInscripcion(await auth.inscribirTotp(t.seguridad.nombreFactor));
        setCodigo('');
      } catch (e) {
        setError(mensajeAuth(e, t));
      } finally {
        setOcupado(false);
      }
    });
  }

  function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!inscripcion) return;
    if (!RE_CODIGO.test(codigo)) {
      setErrorCodigo(t.segundoFactor.formato);
      return;
    }
    setErrorCodigo(null);
    void unaVez(async () => {
      setError(null);
      setOcupado(true);
      try {
        await auth.verificarCodigo(inscripcion.factorId, codigo);
      } catch (ex) {
        setError(mensajeAuth(ex, t));
        setCodigo('');
        setOcupado(false);
        return;
      }
      setInscripcion(null);
      setOcupado(false);
      try {
        await onActivado();
      } catch {
        setError(t.comun.errorGenerico);
      }
    });
  }

  const yaIniciado = useRef(false);
  useEffect(() => {
    if (!iniciarSolo || yaIniciado.current) return;
    yaIniciado.current = true;
    empezar();
    // empezar se recrea en cada render; solo importa la primera vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iniciarSolo]);

  if (!inscripcion) {
    return (
      <>
        {error ? <MensajeError texto={error} /> : null}
        <Boton variante="primario" icono="candado" cargando={ocupado} onClick={empezar}>
          {t.seguridad.activar}
        </Boton>
      </>
    );
  }

  return (
    <form className="w-formulario w-inscripcion" onSubmit={confirmar} noValidate>
      <ol className="w-pasos">
        <li>
          <p>{t.seguridad.paso1}</p>
          <img
            className="w-qr"
            src={inscripcion.qr}
            alt="Código QR para la app de autenticación"
            width={200}
            height={200}
          />
          <p className="w-secundario">{t.seguridad.claveManual}</p>
          <code className="w-clave-manual">{inscripcion.secreto}</code>
        </li>
        <li>
          <p>{t.seguridad.paso2}</p>
          <CampoCodigo valor={codigo} onCambio={setCodigo} error={errorCodigo} />
        </li>
      </ol>
      {error ? <MensajeError texto={error} /> : null}
      <div className="w-botonera">
        <Boton type="submit" variante="primario" cargando={ocupado}>
          {t.seguridad.confirmar}
        </Boton>
        {cancelable ? (
          <Boton variante="fantasma" onClick={() => setInscripcion(null)}>
            {t.comun.cancelar}
          </Boton>
        ) : null}
      </div>
    </form>
  );
}
