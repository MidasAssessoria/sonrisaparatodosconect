import { Boton } from '@conecta/ui';
import { ActivarTotp } from '../../componentes/ActivarTotp.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { MarcoAcceso } from './MarcoAcceso.js';

/**
 * Activación obligatoria: la API respondió `mfa_requerido` y no hay ningún factor verificado.
 * Solo se sale activándolo (y entonces se vuelve a pedir `/sesion`) o cerrando sesión.
 */
export function ActivarSegundoFactor() {
  const t = useTextos();
  const { terminarActivacion, cerrarSesion } = useSesion();
  return (
    <MarcoAcceso titulo={t.segundoFactor.activarTitulo}>
      <p className="w-acceso__texto">{t.segundoFactor.activarTexto}</p>
      <div className="w-formulario">
        <ActivarTotp cancelable={false} onActivado={terminarActivacion} />
        <Boton variante="fantasma" bloque icono="salir" onClick={() => void cerrarSesion()}>
          {t.armazon.cerrarSesion}
        </Boton>
      </div>
    </MarcoAcceso>
  );
}
