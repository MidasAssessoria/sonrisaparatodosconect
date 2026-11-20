import type { ReactElement } from 'react';
import type { TonoColor } from '../tipos.js';
import { cx, hash, iniciales } from '../utilidades.js';

const TONOS_AVATAR: TonoColor[] = ['turquesa', 'cielo', 'uva', 'rosa', 'sol', 'coral'];

export interface AvatarProps {
  nombre: string;
  tamano?: 'sm' | 'md' | 'lg' | undefined;
  tono?: TonoColor | undefined;
  /** true cuando el nombre ya está escrito al lado. */
  decorativo?: boolean | undefined;
  className?: string | undefined;
}

/** Iniciales en círculo (nunca fotos de pacientes). */
export function Avatar({
  nombre,
  tamano = 'md',
  tono,
  decorativo,
  className,
}: AvatarProps): ReactElement {
  const n = nombre || '';
  const t = tono ?? TONOS_AVATAR[hash(n) % TONOS_AVATAR.length] ?? 'turquesa';
  return (
    <span
      className={cx('cn-avatar', `cn-avatar--${t}`, `cn-avatar--${tamano}`, className)}
      role={decorativo ? undefined : 'img'}
      aria-label={decorativo ? undefined : n}
      aria-hidden={decorativo ? true : undefined}
    >
      {iniciales(n)}
    </span>
  );
}
