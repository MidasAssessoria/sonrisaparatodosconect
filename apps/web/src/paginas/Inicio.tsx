import { useQuery } from '@tanstack/react-query';
import { consultarSalud } from '../api.js';

/** Página provisional: confirma que la web llega a la API. */
export function Inicio() {
  const salud = useQuery({ queryKey: ['salud'], queryFn: consultarSalud, retry: false });

  let estado = 'Consultando la API…';
  if (salud.isSuccess) estado = 'API en línea';
  if (salud.isError) estado = 'No pudimos conectar con la API. Revisá que esté levantada.';

  return (
    <main>
      <h1>Conecta</h1>
      <p role="status">{estado}</p>
    </main>
  );
}
