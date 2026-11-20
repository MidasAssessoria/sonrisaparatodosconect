import { AvisoExito, Boton, Campo } from '@conecta/ui';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { RUTA_NUEVA_CLAVE, useSesion } from '../../sesion/ProveedorSesion.js';
import { MarcoAcceso } from './MarcoAcceso.js';
import { mensajeAuth, RE_CORREO } from './textosError.js';

export function Recuperar() {
  const t = useTextos();
  const { auth } = useSesion();
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const correo = email.trim();
    const err = !correo
      ? t.acceso.faltaCorreo
      : !RE_CORREO.test(correo)
        ? t.acceso.correoInvalido
        : null;
    setError(err);
    setErrorGeneral(null);
    if (err) return;
    setEnviando(true);
    try {
      await auth.enviarRecuperacion(correo, `${window.location.origin}${RUTA_NUEVA_CLAVE}`);
      setEnviado(true);
    } catch (ex) {
      setErrorGeneral(mensajeAuth(ex, t));
    } finally {
      setEnviando(false);
    }
  }

  const volver = (
    <Boton variante="fantasma" bloque onClick={() => void navegar('/acceso')}>
      {t.recuperar.volverAcceso}
    </Boton>
  );

  return (
    <MarcoAcceso titulo={t.recuperar.titulo}>
      {enviado ? (
        <div className="w-formulario">
          <AvisoExito titulo={t.recuperar.enviado} texto={t.recuperar.enviadoTexto} />
          {volver}
        </div>
      ) : (
        <form className="w-formulario" onSubmit={(e) => void enviar(e)} noValidate>
          <p className="w-acceso__texto">{t.recuperar.texto}</p>
          <Campo
            etiqueta={t.acceso.correo}
            tipo="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error}
          />
          {errorGeneral ? <MensajeError texto={errorGeneral} /> : null}
          <Boton type="submit" variante="primario" tamano="lg" bloque cargando={enviando}>
            {t.recuperar.enviar}
          </Boton>
          {volver}
        </form>
      )}
    </MarcoAcceso>
  );
}
