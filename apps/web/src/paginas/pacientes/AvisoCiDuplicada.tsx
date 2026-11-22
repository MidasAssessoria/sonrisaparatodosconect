import { formatoCi, type PacienteResumen } from '@conecta/shared';
import { Boton } from '@conecta/ui';
import { AvisoPersistente } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { metaPaciente, nombreCompleto } from './formato.js';

/**
 * La CI ya la tiene otro paciente de la clínica: no bloquea. Se ofrece abrir esa ficha (si es la
 * misma persona) o guardar igual (reenvía con `confirmarCiDuplicada: true`).
 */
export function AvisoCiDuplicada({
  existente,
  onAbrir,
  onGuardarIgual,
  guardando,
}: {
  existente: PacienteResumen;
  onAbrir: () => void;
  onGuardarIgual: () => void;
  guardando: boolean;
}) {
  const t = useTextos().pacientes;
  const nombre = nombreCompleto(existente);
  return (
    <AvisoPersistente
      titulo={t.ciDuplicada.titulo(existente.ci ? formatoCi(existente.ci) : '')}
      texto={
        <>
          {t.ciDuplicada.texto(nombre)}
          <span className="w-ci-duplicada__paciente">
            <strong>{nombre}</strong> · {metaPaciente(t, existente)}
          </span>
        </>
      }
      accion={
        <span className="w-botonera">
          <Boton variante="secundario" icono="pacientes" onClick={onAbrir}>
            {t.ciDuplicada.abrir}
          </Boton>
          <Boton variante="primario" cargando={guardando} onClick={onGuardarIgual}>
            {t.ciDuplicada.guardarIgual}
          </Boton>
        </span>
      }
    />
  );
}
