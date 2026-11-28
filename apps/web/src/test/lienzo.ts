import { fireEvent } from '@testing-library/react';

/** PNG que devuelve el lienzo falso de las pruebas (`setup.ts`). */
export const PNG_FIRMA = 'data:image/png;base64,iVBORw0KGgo=';

/** Un trazo con el dedo sobre el lienzo de la firma. */
export function firmar(lienzo: Element) {
  const p = { pointerId: 1, pointerType: 'touch', button: 0 };
  fireEvent.pointerDown(lienzo, { ...p, clientX: 20, clientY: 40 });
  fireEvent.pointerMove(lienzo, { ...p, clientX: 80, clientY: 60 });
  fireEvent.pointerUp(lienzo, { ...p, clientX: 140, clientY: 50 });
}
