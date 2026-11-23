import { formatoCi } from '@conecta/shared';
import { Boton } from '@conecta/ui';
import type { ErrorCiDuplicada } from '../../api/errores.js';
import { AvisoPersistente } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { metaPaciente, nombreCompleto } from './formato.js';

/**
 * La CI ya la tiene otro paciente de la clínica: no bloquea. Se ofrece abrir esa ficha (si es la
 * misma persona) o guardar igual (reenvía el formulario actual con `confirmarCiDuplicada: true`).
 * Sin `existente` (quien pide no tiene `pacientes:ver`) se muestra solo el mensaje de la API y
 * «Guardar igual».
 */
export function AvisoCiDuplicada({
  error,
  onAbrir,
  onGuardarIgual,
  guardando,
}: {
  error: ErrorCiDuplicada;
  onAbrir: (id: string) => void;
  onGuardarIgual: () => void;
  guardando: boolean;
}) {
  const t = useTextos().pacientes;
  const existente = error.existente;
  const guardarIgual = (
    <Boton variante="primario" cargando={guardando} onClick={onGuardarIgual}>
      {t.ciDuplicada.guardarIgual}
    </Boton>
  );
  if (!existente) {
    return <AvisoPersistente titulo={error.message} accion={guardarIgual} />;
  }
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
          <Boton variante="secundario" icono="pacientes" onClick={() => onAbrir(existente.id)}>
            {t.ciDuplicada.abrir}
          </Boton>
          {guardarIgual}
        </span>
      }
    />
  );
}

/**
 * «Guardar igual» envía el formulario tal como está ahora (no el cuerpo del pedido anterior),
 * confirmando la CI duplicada. `confirmar` lo lee quien recibe `onEnviar` del formulario.
 */
export function enviarConfirmando(idForm: string, confirmar: { current: boolean }) {
  const form = document.getElementById(idForm);
  if (!(form instanceof HTMLFormElement)) return;
  confirmar.current = true;
  try {
    form.requestSubmit();
  } finally {
    // El envío del formulario es sincrónico: si no pasó la validación, no queda confirmado.
    confirmar.current = false;
  }
}
