import { Boton, Giro, Marca } from '@conecta/ui';
import { MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { MarcoAcceso } from './MarcoAcceso.js';

export function PantallaCarga({ texto }: { texto: string }) {
  return (
    <div className="w-carga" role="status" aria-live="polite">
      <Marca />
      <span className="w-carga__fila">
        <Giro />
        <span>{texto}</span>
      </span>
    </div>
  );
}

export function PantallaErrorSesion({ mensaje }: { mensaje: string }) {
  const t = useTextos();
  const { cerrarSesion, reintentar } = useSesion();
  return (
    <MarcoAcceso titulo={t.armazon.errorSesion}>
      <MensajeError texto={mensaje} onReintentar={reintentar} />
      <Boton variante="fantasma" bloque icono="salir" onClick={() => void cerrarSesion()}>
        {t.armazon.cerrarSesion}
      </Boton>
    </MarcoAcceso>
  );
}

export function PantallaSinConfiguracion() {
  const t = useTextos();
  return (
    <MarcoAcceso titulo={t.acceso.titulo}>
      <MensajeError texto={t.acceso.sinConfiguracion} />
    </MarcoAcceso>
  );
}
