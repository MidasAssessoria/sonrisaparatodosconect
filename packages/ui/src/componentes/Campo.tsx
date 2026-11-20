import {
  forwardRef,
  useId,
  useState,
  type ChangeEventHandler,
  type FocusEventHandler,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { cx } from '../utilidades.js';
import { Icono } from './Icono.js';

type ElementoCampo = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export interface CampoProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'onChange' | 'onBlur' | 'onFocus'
> {
  etiqueta: ReactNode;
  tipo?:
    | 'text'
    | 'email'
    | 'tel'
    | 'number'
    | 'date'
    | 'time'
    | 'password'
    | 'select'
    | 'textarea'
    | undefined;
  opciones?: (string | { valor: string; texto: string })[] | undefined;
  ayuda?: ReactNode;
  error?: ReactNode;
  requerido?: boolean | undefined;
  rows?: number | undefined;
  onChange?: ChangeEventHandler<ElementoCampo> | undefined;
  onBlur?: FocusEventHandler<ElementoCampo> | undefined;
  onFocus?: FocusEventHandler<ElementoCampo> | undefined;
}

/** Campo con etiqueta real, ayuda y error asociados por aria-describedby. */
export const Campo = forwardRef<ElementoCampo, CampoProps>(function Campo(
  { etiqueta, tipo = 'text', opciones, ayuda, error, requerido, rows, className, id, ...resto },
  ref,
) {
  const idAuto = useId();
  const idControl = id ?? idAuto;
  const [ver, setVer] = useState(false);
  const idAyuda = `${idControl}-ayuda`;
  const idError = `${idControl}-error`;
  const hayError = error != null && error !== false && error !== '';
  const hayAyuda = ayuda != null && ayuda !== false && ayuda !== '';
  // El error reemplaza a la ayuda: solo se referencia lo que está en pantalla.
  const describe = hayError ? idError : hayAyuda ? idAyuda : undefined;
  const comunes = {
    id: idControl,
    className: 'cn-campo__control',
    required: requerido || resto.required || undefined,
    'aria-invalid': hayError ? true : undefined,
    'aria-describedby': cx(resto['aria-describedby'], describe) || undefined,
  };

  let control: ReactNode;
  if (tipo === 'select') {
    const { onChange, value, defaultValue, disabled, name, onBlur, onFocus, autoFocus } = resto;
    control = (
      <div className="cn-campo__select">
        <select
          ref={ref as Ref<HTMLSelectElement>}
          {...comunes}
          onChange={onChange}
          value={value}
          defaultValue={defaultValue}
          disabled={disabled}
          name={name}
          onBlur={onBlur}
          onFocus={onFocus}
          autoFocus={autoFocus}
        >
          {(opciones ?? []).map((o) => {
            const v = typeof o === 'string' ? o : o.valor;
            return (
              <option key={v} value={v}>
                {typeof o === 'string' ? o : o.texto}
              </option>
            );
          })}
        </select>
        <Icono nombre="chevron-abajo" tamano={20} className="cn-campo__flecha" />
      </div>
    );
  } else if (tipo === 'textarea') {
    const {
      onChange,
      value,
      defaultValue,
      disabled,
      name,
      placeholder,
      maxLength,
      onBlur,
      onFocus,
      readOnly,
      autoFocus,
    } = resto;
    control = (
      <textarea
        ref={ref as Ref<HTMLTextAreaElement>}
        {...comunes}
        rows={rows ?? 3}
        onChange={onChange}
        value={value}
        defaultValue={defaultValue}
        disabled={disabled}
        name={name}
        placeholder={placeholder}
        maxLength={maxLength}
        readOnly={readOnly}
        onBlur={onBlur}
        onFocus={onFocus}
        autoFocus={autoFocus}
      />
    );
  } else if (tipo === 'password') {
    control = (
      <div className="cn-campo__clave">
        <input
          ref={ref as Ref<HTMLInputElement>}
          {...resto}
          {...comunes}
          type={ver ? 'text' : 'password'}
        />
        <button
          type="button"
          className="cn-campo__ver"
          aria-pressed={ver}
          aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          aria-controls={idControl}
          onClick={() => setVer(!ver)}
        >
          <Icono nombre={ver ? 'ojo-cerrado' : 'ojo'} tamano={20} />
        </button>
      </div>
    );
  } else {
    control = <input ref={ref as Ref<HTMLInputElement>} {...resto} {...comunes} type={tipo} />;
  }

  return (
    <div className={cx('cn-campo', hayError && 'is-error', className)}>
      <label htmlFor={idControl} className="cn-campo__etiqueta">
        {etiqueta}
        {requerido ? <span className="cn-campo__requerido"> · obligatorio</span> : null}
      </label>
      {control}
      {hayAyuda && !hayError ? (
        <p id={idAyuda} className="cn-campo__ayuda">
          {ayuda}
        </p>
      ) : null}
      {hayError ? (
        <p id={idError} className="cn-campo__error">
          <Icono nombre="alerta" tamano={18} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
});
