import { Boton } from '@conecta/ui';
import { useState, type FormEvent } from 'react';
import { CampoCodigo } from '../../componentes/CampoCodigo.js';
import { MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { MarcoAcceso } from './MarcoAcceso.js';
import { mensajeAuth, RE_CODIGO } from './textosError.js';

/** Paso del segundo factor: la sesión está en aal1 y el usuario tiene un TOTP verificado. */
export function SegundoFactor() {
  const t = useTextos();
  const { verificarSegundoFactor, cerrarSesion } = useSesion();
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErrorGeneral(null);
    if (!RE_CODIGO.test(codigo)) {
      setError(t.segundoFactor.formato);
      return;
    }
    setError(null);
    setEnviando(true);
    try {
      await verificarSegundoFactor(codigo);
    } catch (ex) {
      setErrorGeneral(mensajeAuth(ex, t));
      setCodigo('');
      setEnviando(false);
    }
  }

  return (
    <MarcoAcceso titulo={t.segundoFactor.titulo}>
      <p className="w-acceso__texto">{t.segundoFactor.texto}</p>
      <form className="w-formulario" onSubmit={(e) => void enviar(e)} noValidate>
        <CampoCodigo valor={codigo} onCambio={setCodigo} error={error} autoFocus />
        {errorGeneral ? <MensajeError texto={errorGeneral} /> : null}
        <Boton type="submit" variante="primario" tamano="lg" bloque cargando={enviando}>
          {t.segundoFactor.verificar}
        </Boton>
        <Boton variante="fantasma" bloque onClick={() => void cerrarSesion()}>
          {t.segundoFactor.usarOtraCuenta}
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
