import type { Accion, Modulo } from '@conecta/shared';
import { Boton } from '@conecta/ui';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Candado } from '../componentes/estados.js';
import { useTextos } from '../i18n/idioma.js';
import { useSesionLista } from '../sesion/ProveedorSesion.js';

/** Muestra `children` solo si el rol tiene el permiso; si no, el candado. */
export function RutaModulo({
  modulo,
  accion = 'ver',
  children,
}: {
  modulo: Modulo;
  accion?: Accion;
  children: ReactNode;
}) {
  const { puede } = useSesionLista();
  const t = useTextos();
  const navegar = useNavigate();
  if (!puede(modulo, accion)) {
    return (
      <Candado
        accion={
          <Boton variante="secundario" icono="inicio" onClick={() => void navegar('/')}>
            {t.comun.irAlInicio}
          </Boton>
        }
      />
    );
  }
  return <>{children}</>;
}
