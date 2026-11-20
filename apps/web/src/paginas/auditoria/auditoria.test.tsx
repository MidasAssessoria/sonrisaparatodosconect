import type { EventoAuditoria } from '@conecta/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  crearAuthFalso,
  crearFetchFalso,
  IDS,
  renderApp,
  sesionDe,
  uuid,
} from '../../test/fabricas.js';
import { finDelDia, formatoFechaHora, inicioDelDia } from '../../utilidades/fechas.js';
import { camposCambiados } from './diff.js';

function evento(n: number, p: Partial<EventoAuditoria> = {}): EventoAuditoria {
  return {
    id: uuid(500 + n),
    fecha: '2026-11-20T12:05:00Z',
    usuario: { id: IDS.usuario, nombre: 'Lorena Fretes' },
    entidad: 'sede',
    entidadId: IDS.sedeCentro,
    accion: 'editar',
    antes: { nombre: 'Centro', telefono: '021 000 000', updated_at: '1' },
    despues: { nombre: 'Centro', telefono: '021 111 111', updated_at: '2' },
    ip: null,
    ...p,
  };
}

describe('diff y fechas', () => {
  it('solo los campos que cambiaron', () => {
    expect(
      camposCambiados({ a: 1, b: 'x', c: { d: 1 } }, { a: 1, b: 'y', c: { d: 1 }, e: true }),
    ).toEqual([
      { campo: 'b', antes: 'x', despues: 'y' },
      { campo: 'e', antes: undefined, despues: true },
    ]);
    expect(camposCambiados(null, { nombre: 'Norte' })).toEqual([
      { campo: 'nombre', antes: undefined, despues: 'Norte' },
    ]);
  });

  it('fecha en America/Asuncion con el formato del design system', () => {
    const ahora = new Date('2026-11-25T12:00:00Z');
    expect(formatoFechaHora('2026-11-20T12:05:00Z', ahora)).toBe('vie 20 de nov · 9:05');
    expect(formatoFechaHora('2025-01-02T02:30:00Z', ahora)).toBe('mié 1 de ene de 2025 · 23:30');
    expect(inicioDelDia('2026-11-20')).toBe('2026-11-20T00:00:00-03:00');
    expect(finDelDia('2026-11-20')).toBe('2026-11-20T23:59:59.999-03:00');
  });
});

describe('Auditoría', () => {
  it('lista, filtra, carga más con el cursor y muestra el detalle con el diff', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /auditoria': ({ url }) => {
        const q = url.searchParams;
        if (q.get('cursor') === 'pagina-2') {
          return {
            cuerpo: {
              items: [
                evento(3, {
                  accion: 'crear',
                  antes: null,
                  despues: { nombre: 'Norte' },
                  usuario: { id: uuid(2), nombre: 'Marta Acosta' },
                }),
              ],
              siguienteCursor: null,
            },
          };
        }
        return {
          cuerpo: {
            items: [evento(1), evento(2, { fecha: '2026-11-19T20:00:00Z' })],
            siguienteCursor: 'pagina-2',
          },
        };
      },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/auditoria' });
    expect((await screen.findAllByText('vie 20 de nov · 9:05')).length).toBeGreaterThan(0);
    expect(f.pedidos.at(-1)?.url.searchParams.get('limite')).toBe('50');

    // Paginación
    fireEvent.click(screen.getByRole('button', { name: 'Cargar más' }));
    expect((await screen.findAllByText('Marta Acosta')).length).toBeGreaterThan(0);
    expect(f.pedidos.at(-1)?.url.searchParams.get('cursor')).toBe('pagina-2');
    expect(screen.queryByRole('button', { name: 'Cargar más' })).toBeNull();
    expect(screen.getByText('No hay registros más viejos.')).toBeInTheDocument();
    // El usuario visto aparece en el filtro
    expect(
      within(screen.getByLabelText('Usuario')).getByRole('option', { name: 'Marta Acosta' }),
    ).toBeInTheDocument();

    // Detalle: solo lo que cambió
    const tabla = within(screen.getByRole('table'));
    fireEvent.click(tabla.getAllByRole('button', { name: 'Ver detalle' })[0]!);
    const hoja = within(await screen.findByRole('dialog', { name: 'Detalle del registro' }));
    expect(hoja.getByText('Telefono')).toBeInTheDocument();
    expect(hoja.getByText('021 000 000')).toBeInTheDocument();
    expect(hoja.getByText('021 111 111')).toBeInTheDocument();
    expect(hoja.queryByText('Nombre')).toBeNull();
    fireEvent.click(hoja.getByRole('button', { name: 'Cerrar' }));

    // Filtros
    fireEvent.change(screen.getByLabelText('Acción'), { target: { value: 'crear' } });
    fireEvent.change(screen.getByLabelText('Entidad'), { target: { value: 'sillon' } });
    fireEvent.change(screen.getByLabelText('Usuario'), { target: { value: uuid(2) } });
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-20' } });
    await waitFor(() => {
      const q = f.pedidos.at(-1)?.url.searchParams;
      expect(q?.get('accion')).toBe('crear');
      expect(q?.get('entidad')).toBe('sillon');
      expect(q?.get('usuarioId')).toBe(uuid(2));
      expect(q?.get('desde')).toBe('2026-11-01T00:00:00-03:00');
      expect(q?.get('hasta')).toBe('2026-11-20T23:59:59.999-03:00');
      expect(q?.has('cursor')).toBe(false);
    });
  });

  it('rango de fechas al revés: avisa y no consulta', async () => {
    const auth = crearAuthFalso({ conSesion: true });
    const f = crearFetchFalso({
      'GET /sesion': { cuerpo: sesionDe() },
      'GET /auditoria': { cuerpo: { items: [], siguienteCursor: null } },
    });
    renderApp({ auth, fetch: f.fetch, ruta: '/auditoria' });
    expect(await screen.findByText('Todavía no hay registros.')).toBeInTheDocument();
    const antes = f.pedidos.length;
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-20' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-01' } });
    expect(await screen.findByText(/tiene que ser igual o posterior/)).toBeInTheDocument();
    // Solo la consulta con «desde» (antes de poner «hasta»).
    expect(f.pedidos.length - antes).toBeLessThanOrEqual(1);
    expect(
      f.pedidos.every((p) => p.url.searchParams.get('hasta') !== '2026-11-01T23:59:59.999-03:00'),
    ).toBe(true);
  });
});
