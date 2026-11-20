import { Campo } from '@conecta/ui';
import { useTextos } from '../i18n/idioma.js';

/** Campo para el código TOTP de 6 dígitos (teclado numérico, autocompletado de un solo uso). */
export function CampoCodigo({
  valor,
  onCambio,
  error,
  autoFocus,
}: {
  valor: string;
  onCambio: (v: string) => void;
  error?: string | null | undefined;
  autoFocus?: boolean;
}) {
  const t = useTextos();
  return (
    <Campo
      etiqueta={t.segundoFactor.codigo}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      autoFocus={autoFocus}
      className="w-campo-codigo"
      value={valor}
      onChange={(e) => onCambio(e.target.value.replace(/\D/g, '').slice(0, 6))}
      error={error}
    />
  );
}
