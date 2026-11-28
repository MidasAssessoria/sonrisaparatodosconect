import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirmaManuscrita } from '../index.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** jsdom no dibuja: un contexto 2D que acepta todo y un `toDataURL` que devuelve un PNG fijo. */
function simularLienzo(png = PNG) {
  const ctx = new Proxy(
    {},
    {
      get: (o: Record<string, unknown>, k: string) => (k in o ? o[k] : (o[k] = vi.fn())),
      set: (o: Record<string, unknown>, k: string, v: unknown) => ((o[k] = v), true),
    },
  );
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockImplementation(() => ctx as unknown as CanvasRenderingContext2D);
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(png);
  return { getContext, toDataURL, ctx: ctx as Record<string, ReturnType<typeof vi.fn>> };
}

function trazar(lienzo: Element, pointerType = 'touch') {
  fireEvent.pointerDown(lienzo, { pointerId: 1, pointerType, clientX: 20, clientY: 40, button: 0 });
  fireEvent.pointerMove(lienzo, { pointerId: 1, pointerType, clientX: 60, clientY: 50 });
  fireEvent.pointerMove(lienzo, { pointerId: 1, pointerType, clientX: 120, clientY: 45 });
  fireEvent.pointerUp(lienzo, { pointerId: 1, pointerType, clientX: 120, clientY: 45 });
}

describe('FirmaManuscrita', () => {
  beforeEach(() => {
    simularLienzo();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('empieza vacía, con rótulo, instrucción y estado escrito', () => {
    render(<FirmaManuscrita etiqueta="Firma del paciente" onCambio={() => {}} />);
    const grupo = screen.getByRole('group', { name: 'Firma del paciente' });
    expect(grupo).toHaveAccessibleDescription(/Firmá con el dedo.*Todavía no hay firma/);
    expect(screen.getByRole('img', { name: 'Recuadro para firmar: Todavía no hay firma' })).toBe(
      grupo.querySelector('canvas'),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Todavía no hay firma');
    expect(screen.getByRole('button', { name: 'Borrar' })).toBeDisabled();
  });

  it('dibujar un trazo entrega el PNG; «Borrar» lo vacía y avisa con null', () => {
    const onCambio = vi.fn();
    render(<FirmaManuscrita etiqueta="Firma" onCambio={onCambio} />);
    const lienzo = screen.getByRole('img');
    trazar(lienzo, 'pen');
    expect(onCambio).toHaveBeenLastCalledWith(PNG);
    expect(screen.getByRole('status')).toHaveTextContent('Firma lista');
    expect(lienzo).toHaveAccessibleName('Recuadro para firmar: Firma lista');

    fireEvent.click(screen.getByRole('button', { name: 'Borrar' }));
    expect(onCambio).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('status')).toHaveTextContent('Todavía no hay firma');
    expect(screen.getByRole('button', { name: 'Borrar' })).toBeDisabled();
  });

  it('el toque que empieza en el lienzo no mueve la página', () => {
    render(<FirmaManuscrita etiqueta="Firma" onCambio={() => {}} />);
    const lienzo = screen.getByRole('img');
    const toque = new Event('touchmove', { bubbles: true, cancelable: true });
    lienzo.dispatchEvent(toque);
    expect(toque.defaultPrevented).toBe(true);
    // El puntero también cancela el comportamiento por defecto (selección, arrastre).
    const bajar = fireEvent.pointerDown(lienzo, { pointerId: 3, pointerType: 'touch', button: 0 });
    expect(bajar).toBe(false);
  });

  it('el botón derecho del mouse no dibuja y otro dedo no corta el trazo', () => {
    const onCambio = vi.fn();
    render(<FirmaManuscrita etiqueta="Firma" onCambio={onCambio} />);
    const lienzo = screen.getByRole('img');
    fireEvent.pointerDown(lienzo, { pointerId: 1, pointerType: 'mouse', button: 2 });
    fireEvent.pointerUp(lienzo, { pointerId: 1, pointerType: 'mouse' });
    expect(onCambio).not.toHaveBeenCalled();
    fireEvent.pointerDown(lienzo, { pointerId: 1, pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(lienzo, { pointerId: 2, pointerType: 'touch' });
    expect(onCambio).not.toHaveBeenCalled();
    fireEvent.pointerUp(lienzo, { pointerId: 1, pointerType: 'touch' });
    expect(onCambio).toHaveBeenCalledWith(PNG);
  });

  it('alternativa de teclado: el nombre escrito sale como firma', () => {
    const onCambio = vi.fn();
    render(<FirmaManuscrita etiqueta="Firma" onCambio={onCambio} nombreSugerido="Ana Giménez" />);
    fireEvent.click(screen.getByRole('button', { name: 'Firmar con el teclado' }));
    const nombre = screen.getByLabelText('Escribí el nombre completo de quien firma');
    expect(nombre).toHaveValue('Ana Giménez');
    expect(nombre).toHaveFocus();
    fireEvent.change(nombre, { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Usar como firma' }));
    expect(screen.getByText('Escribí el nombre para usarlo como firma.')).toBeInTheDocument();
    expect(onCambio).not.toHaveBeenCalled();
    fireEvent.change(nombre, { target: { value: 'Ana Giménez' } });
    fireEvent.click(screen.getByRole('button', { name: 'Usar como firma' }));
    expect(onCambio).toHaveBeenCalledWith(PNG);
    expect(screen.getByRole('status')).toHaveTextContent('Firma lista');
  });

  it('un PNG que pasa el máximo se rehace más chico', () => {
    vi.restoreAllMocks();
    const { toDataURL } = simularLienzo();
    toDataURL.mockReturnValueOnce(`data:image/png;base64,${'A'.repeat(500)}`);
    const onCambio = vi.fn();
    render(<FirmaManuscrita etiqueta="Firma" onCambio={onCambio} maxCaracteres={100} />);
    trazar(screen.getByRole('img'));
    expect(toDataURL).toHaveBeenCalledTimes(2);
    expect(onCambio).toHaveBeenLastCalledWith(PNG);
  });

  it('`valor` null desde afuera borra el lienzo sin volver a avisar', () => {
    const onCambio = vi.fn();
    function Formulario() {
      const [firma, setFirma] = useState<string | null>(null);
      return (
        <>
          <FirmaManuscrita
            etiqueta="Firma"
            valor={firma}
            onCambio={(p) => {
              onCambio(p);
              setFirma(p);
            }}
          />
          <button type="button" onClick={() => setFirma(null)}>
            Reiniciar
          </button>
        </>
      );
    }
    render(<Formulario />);
    trazar(screen.getByRole('img'));
    expect(screen.getByRole('status')).toHaveTextContent('Firma lista');
    fireEvent.click(screen.getByRole('button', { name: 'Reiniciar' }));
    expect(screen.getByRole('status')).toHaveTextContent('Todavía no hay firma');
    expect(onCambio).toHaveBeenCalledTimes(1);
  });

  it('error asociado al grupo y sin lienzo avisa la alternativa', () => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    render(<FirmaManuscrita etiqueta="Firma" onCambio={() => {}} error="Falta la firma." />);
    expect(screen.getByRole('group', { name: 'Firma' })).toHaveAccessibleDescription(
      /Falta la firma\./,
    );
    expect(screen.getByRole('note')).toHaveTextContent(/no permite dibujar la firma/);
  });
});
