import { bajaSchema } from '@conecta/shared';
import { Boton, Campo, HojaInferior } from '@conecta/ui';
import { useId, useState, type FormEvent } from 'react';
import { MensajeError } from '../../componentes/estados.js';

/** Confirmación de baja lógica con motivo obligatorio. */
export function DarDeBaja({
  abierta,
  nombre,
  onCerrar,
  onConfirmar,
  enviando,
  error,
}: {
  abierta: boolean;
  nombre: string;
  onCerrar: () => void;
  onConfirmar: (motivo: string) => void;
  enviando: boolean;
  error?: unknown;
}) {
  const idForm = useId();
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = bajaSchema.safeParse({ motivo });
    if (!r.success) {
      setErrorMotivo(r.error.issues[0]?.message ?? 'Contanos el motivo de la baja.');
      return;
    }
    setErrorMotivo(null);
    onConfirmar(r.data.motivo);
  }

  return (
    <HojaInferior
      abierta={abierta}
      titulo={`Dar de baja «${nombre}»`}
      onCerrar={onCerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" form={idForm} variante="peligro" cargando={enviando}>
            Confirmar baja
          </Boton>
        </>
      }
    >
      <form id={idForm} className="w-formulario" onSubmit={enviar} noValidate>
        <p>
          La sede deja de aparecer para elegir y en la agenda. No se borra: sus datos y su historial
          quedan guardados.
        </p>
        <Campo
          etiqueta="Motivo de la baja"
          tipo="textarea"
          requerido
          maxLength={300}
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          error={errorMotivo}
        />
        {error ? <MensajeError error={error} /> : null}
      </form>
    </HojaInferior>
  );
}
