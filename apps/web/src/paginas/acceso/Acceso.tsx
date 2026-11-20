import { Boton, Campo } from '@conecta/ui';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { MensajeError } from '../../componentes/estados.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { MarcoAcceso } from './MarcoAcceso.js';
import { mensajeAuth, RE_CORREO } from './textosError.js';

export function Acceso() {
  const t = useTextos();
  const { ingresar, estado } = useSesion();
  const navegar = useNavigate();
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [errores, setErrores] = useState<{ email?: string; clave?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const unaVez = useEnvioUnico();

  const motivo = estado.fase === 'sin_sesion' ? estado.motivo : null;
  const avisoCierre =
    motivo?.tipo === 'inactividad'
      ? t.acceso.cerradaInactividad(motivo.minutos)
      : motivo?.tipo === 'vencida'
        ? t.acceso.cerradaVencida
        : motivo?.tipo === 'sin_membresia'
          ? t.acceso.cerradaSinMembresia
          : null;

  function enviar(e: FormEvent) {
    e.preventDefault();
    const nuevos: { email?: string; clave?: string } = {};
    const correo = email.trim();
    if (!correo) nuevos.email = t.acceso.faltaCorreo;
    else if (!RE_CORREO.test(correo)) nuevos.email = t.acceso.correoInvalido;
    if (!clave) nuevos.clave = t.acceso.faltaClave;
    setErrores(nuevos);
    setErrorGeneral(null);
    if (nuevos.email || nuevos.clave) return;
    void unaVez(async () => {
      setEnviando(true);
      try {
        await ingresar(correo, clave);
      } catch (error) {
        setErrorGeneral(mensajeAuth(error, t));
        setEnviando(false);
      }
    });
  }

  return (
    <MarcoAcceso titulo={t.acceso.titulo}>
      <p className="w-acceso__texto">{t.acceso.subtitulo}</p>
      {avisoCierre && !errorGeneral ? (
        <p className="w-nota" role="status">
          {avisoCierre}
        </p>
      ) : null}
      <form className="w-formulario" onSubmit={enviar} noValidate>
        <Campo
          etiqueta={t.acceso.correo}
          tipo="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errores.email}
        />
        <Campo
          etiqueta={t.acceso.clave}
          tipo="password"
          autoComplete="current-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          error={errores.clave}
        />
        {errorGeneral ? <MensajeError texto={errorGeneral} /> : null}
        <Boton type="submit" variante="primario" tamano="lg" bloque cargando={enviando}>
          {t.acceso.ingresar}
        </Boton>
        <Boton variante="fantasma" bloque onClick={() => void navegar('/acceso/recuperar')}>
          {t.acceso.olvide}
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
