import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  BarraInferior,
  BarraLateral,
  BarraSuperior,
  Boton,
  Buscador,
  Campo,
  HojaInferior,
  MenuExportar,
  SelectorIdioma,
  type ItemNavegacion,
  type PacienteResultado,
  type RenderEnlace,
} from '../index.js';

const PACIENTES: PacienteResultado[] = [
  { nombre: 'Ana Giménez', documento: 'CI 0.000.001', telefono: '0981 000 001', alerta: 'Alergia' },
  { nombre: 'Mateo Giménez', documento: 'CI 0.000.002', telefono: '0981 000 001' },
  { nombre: 'Lucía Benítez', documento: 'CI 0.000.003', telefono: '0982 000 003' },
];

describe('MenuExportar', () => {
  it('abre, enfoca el primer formato, llama onElegir y cierra devolviendo el foco', () => {
    const onElegir = vi.fn();
    render(<MenuExportar onElegir={onElegir} />);
    const boton = screen.getByRole('button', { name: 'Exportar' });
    fireEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(boton).toHaveAttribute('aria-controls', menu.id);
    expect(within(menu).getByRole('menuitem', { name: 'PDF' })).toHaveFocus();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Excel / CSV' }));
    expect(onElegir).toHaveBeenCalledWith('excel');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(boton).toHaveFocus();
  });

  it('flechas recorren, Escape cierra; clic afuera y segundo clic también', () => {
    render(
      <>
        <MenuExportar />
        <p>Afuera</p>
      </>,
    );
    const boton = screen.getByRole('button', { name: 'Exportar' });
    fireEvent.keyDown(boton, { key: 'ArrowUp' });
    expect(screen.getByRole('menuitem', { name: 'Imprimir' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Imprimir' }), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'PDF' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'PDF' }), { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'Imprimir' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Imprimir' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(boton).toHaveFocus();

    fireEvent.click(boton);
    fireEvent.mouseDown(screen.getByText('Afuera'));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('Buscador', () => {
  it('filtra solo por nombre, CI o teléfono', () => {
    render(<Buscador resultados={PACIENTES} />);
    const campo = screen.getByRole('combobox', { name: 'Buscar paciente' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.change(campo, { target: { value: 'gim' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      expect.stringContaining('Ana Giménez'),
      expect.stringContaining('Mateo Giménez'),
    ]);
    expect(campo).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(campo, { target: { value: '0982' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.change(campo, { target: { value: 'zzz' } });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sin resultados para «zzz». Revisá cómo está escrito o buscá por CI.',
    );
  });

  it('elige con flechas y Enter; Escape cierra la lista', () => {
    const onElegir = vi.fn();
    render(<Buscador resultados={PACIENTES} onElegir={onElegir} />);
    const campo = screen.getByRole('combobox');
    fireEvent.change(campo, { target: { value: 'gim' } });
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    const opciones = screen.getAllByRole('option');
    expect(opciones[0]).toHaveAttribute('aria-selected', 'true');
    expect(campo).toHaveAttribute('aria-activedescendant', opciones[0]?.id);
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(campo, { key: 'ArrowUp' });
    fireEvent.keyDown(campo, { key: 'Enter' });
    expect(onElegir).toHaveBeenCalledWith(PACIENTES[1]);
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(campo, { target: { value: 'luc' } });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(campo, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.keyDown(campo, { key: 'ArrowDown' });
    expect(screen.getByRole('option')).toHaveAttribute('aria-selected', 'true');
  });

  it('elige con clic y muestra el chip de alerta', () => {
    const onElegir = vi.fn();
    render(<Buscador resultados={PACIENTES} onElegir={onElegir} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ana' } });
    expect(screen.getByText('Alergia')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option'));
    expect(onElegir).toHaveBeenCalledWith(PACIENTES[0]);
  });

  it('controlado: no filtra, avisa con onCambio', () => {
    function Controlado() {
      const [v, setV] = useState('x');
      return <Buscador valor={v} onCambio={setV} resultados={PACIENTES} />;
    }
    render(<Controlado />);
    expect(screen.getAllByRole('option')).toHaveLength(3);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ana' } });
    expect(screen.getByRole('combobox')).toHaveValue('ana');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});

describe('HojaInferior', () => {
  function ConBoton() {
    const [abierta, setAbierta] = useState(false);
    return (
      <>
        <Boton onClick={() => setAbierta(true)}>Nuevo turno</Boton>
        <HojaInferior
          abierta={abierta}
          titulo="Nuevo turno"
          onCerrar={() => setAbierta(false)}
          acciones={<Boton variante="primario">Guardar turno</Boton>}
        >
          <Campo etiqueta="Paciente" />
        </HojaInferior>
      </>
    );
  }

  it('toma el foco, cierra con Escape y devuelve el foco al botón', () => {
    render(<ConBoton />);
    const abrir = screen.getByRole('button', { name: 'Nuevo turno' });
    abrir.focus();
    fireEvent.click(abrir);
    const hoja = screen.getByRole('dialog', { name: 'Nuevo turno' });
    expect(hoja).toHaveAttribute('aria-modal', 'true');
    expect(hoja).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(abrir).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('cierra con el botón Cerrar y con el fondo, no con un clic adentro', () => {
    render(<ConBoton />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo turno' }));
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo turno' }));
    const fondo = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(fondo);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab queda adentro de la hoja', () => {
    render(<ConBoton />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo turno' }));
    const guardar = screen.getByRole('button', { name: 'Guardar turno' });
    const cerrar = screen.getByRole('button', { name: 'Cerrar' });
    guardar.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cerrar).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(guardar).toHaveFocus();
  });
});

describe('Campo', () => {
  it('asocia etiqueta y ayuda', () => {
    render(<Campo etiqueta="CI" ayuda="Sin puntos" />);
    const campo = screen.getByLabelText('CI');
    expect(campo).toHaveAccessibleDescription('Sin puntos');
    expect(campo).not.toHaveAttribute('aria-invalid');
  });

  it('con error: aria-invalid, describe el error y oculta la ayuda', () => {
    render(<Campo etiqueta="CI" ayuda="Sin puntos" error="Ingresá el CI sin puntos" />);
    const campo = screen.getByLabelText('CI');
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription('Ingresá el CI sin puntos');
    expect(screen.queryByText('Sin puntos')).toBeNull();
    expect(campo.closest('.cn-campo')).toHaveClass('is-error');
  });

  it('respeta id propio, select y textarea con error', () => {
    const onChange = vi.fn();
    render(
      <>
        <Campo id="tel" etiqueta="Teléfono" tipo="tel" onChange={onChange} />
        <Campo
          etiqueta="Sede"
          tipo="select"
          opciones={['Centro', 'Lambaré']}
          error="Elegí una sede"
        />
        <Campo etiqueta="Notas" tipo="textarea" ayuda="Opcional" />
      </>,
    );
    const tel = screen.getByLabelText('Teléfono');
    expect(tel).toHaveAttribute('id', 'tel');
    fireEvent.change(tel, { target: { value: '0981' } });
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Sede')).toHaveAccessibleDescription('Elegí una sede');
    expect(screen.getByLabelText('Notas')).toHaveAccessibleDescription('Opcional');
  });
});

const ITEMS: ItemNavegacion<'inicio' | 'turnos' | 'pacientes' | 'caja' | 'reportes' | 'ajustes'>[] =
  [
    { id: 'inicio', nombre: 'Inicio', icono: 'inicio', ruta: '/' },
    { id: 'turnos', nombre: 'Turnos', icono: 'agenda', ruta: '/turnos' },
    { id: 'pacientes', nombre: 'Pacientes', icono: 'pacientes', ruta: '/pacientes' },
    { id: 'caja', nombre: 'Caja', icono: 'caja', ruta: '/caja' },
    { id: 'reportes', nombre: 'Reportes', icono: 'estadisticas', ruta: '/reportes' },
    { id: 'ajustes', nombre: 'Ajustes', icono: 'personal', ruta: '/ajustes' },
  ];

describe('Navegación', () => {
  it('BarraLateral llama onNavegar sin recargar y marca el activo', () => {
    const onNavegar = vi.fn();
    render(<BarraLateral activo="caja" onNavegar={onNavegar} />);
    const caja = screen.getByRole('link', { name: 'Caja' });
    expect(caja).toHaveAttribute('aria-current', 'page');
    expect(caja).toHaveClass('is-activo');
    expect(screen.getByRole('link', { name: 'Inicio' })).not.toHaveAttribute('aria-current');
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      screen.getByRole('link', { name: 'Agenda' }).dispatchEvent(evento);
    });
    expect(onNavegar).toHaveBeenCalledWith('agenda');
    expect(evento.defaultPrevented).toBe(true);
  });

  it('BarraLateral no muestra módulos que no recibe', () => {
    render(<BarraLateral items={ITEMS.slice(0, 2)} />);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Inicio', 'Turnos']);
    expect(screen.queryByRole('link', { name: 'Caja' })).toBeNull();
  });

  it('BarraLateral filtra por `modulos` (API del bundle)', () => {
    render(<BarraLateral modulos={['inicio', 'agenda', 'pacientes']} />);
    expect(screen.getAllByRole('link')).toHaveLength(3);
    expect(screen.queryByRole('link', { name: 'Caja' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Personal' })).toBeNull();
  });

  it('usa renderEnlace con la ruta del ítem y pasa aria-current', () => {
    const renderEnlace = vi.fn<RenderEnlace<string>>(
      ({ href, item, activo, children, ...resto }) => (
        <a data-router="si" data-id={item.id} data-activo={String(activo)} href={href} {...resto}>
          {children}
        </a>
      ),
    );
    const onNavegar = vi.fn();
    render(
      <BarraLateral
        items={ITEMS}
        activo="turnos"
        renderEnlace={renderEnlace}
        onNavegar={onNavegar}
      />,
    );
    const turnos = screen.getByRole('link', { name: 'Turnos' });
    expect(turnos).toHaveAttribute('data-router', 'si');
    expect(turnos).toHaveAttribute('href', '/turnos');
    expect(turnos).toHaveAttribute('aria-current', 'page');
    expect(turnos).toHaveClass('cn-lateral__item', 'is-activo');
    expect(renderEnlace).toHaveBeenCalledTimes(ITEMS.length);
    // Con renderEnlace, el clic no se cancela (navega el router) pero avisa con onNavegar.
    const evento = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      screen.getByRole('link', { name: 'Caja' }).dispatchEvent(evento);
    });
    expect(onNavegar).toHaveBeenCalledWith('caja');
    expect(evento.defaultPrevented).toBe(false);
  });

  it('Ctrl+clic no se intercepta (abre otra pestaña)', () => {
    const onNavegar = vi.fn();
    render(<BarraLateral onNavegar={onNavegar} />);
    fireEvent.click(screen.getByRole('link', { name: 'Caja' }), { ctrlKey: true });
    expect(onNavegar).not.toHaveBeenCalled();
  });

  it('BarraInferior: principales fijos, resto en «Más» con aria-current y renderEnlace', () => {
    const onNavegar = vi.fn();
    const renderEnlace: RenderEnlace<string> = ({ href, item, activo, children, ...resto }) => (
      <a href={href} data-id={item.id} data-activo={String(activo)} {...resto}>
        {children}
      </a>
    );
    render(
      <BarraInferior
        items={ITEMS}
        principales={['inicio', 'turnos', 'pacientes', 'caja']}
        activo="reportes"
        onNavegar={onNavegar}
        renderEnlace={renderEnlace}
        contenidoMas={<SelectorIdioma />}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Inicio', 'Turnos', 'Pacientes', 'Caja']);
    const mas = within(nav).getByRole('button', { name: 'Más' });
    expect(mas).toHaveClass('is-activo-grupo');
    mas.focus();
    expect(mas).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(mas);
    const hoja = screen.getByRole('dialog', { name: 'Más' });
    expect(within(hoja).getByRole('link', { name: 'Reportes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      within(hoja).getByRole('radiogroup', { name: 'Idioma de la interfaz' }),
    ).toBeInTheDocument();
    fireEvent.click(within(hoja).getByRole('link', { name: 'Ajustes' }));
    expect(onNavegar).toHaveBeenCalledWith('ajustes');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mas).toHaveFocus();
  });

  it('BarraInferior sin resto ni contenido extra no muestra «Más»', () => {
    render(<BarraInferior items={ITEMS.slice(0, 2)} />);
    expect(screen.getAllByRole('link').map((a) => a.textContent)).toEqual(['Inicio', 'Turnos']);
    expect(screen.queryByRole('button', { name: 'Más' })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('BarraInferior con ítems propios completa hasta 4 y manda el resto a «Más»', () => {
    render(<BarraInferior items={ITEMS} />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Inicio', 'Pacientes', 'Caja', 'Turnos']);
    fireEvent.click(within(nav).getByRole('button', { name: 'Más' }));
    expect(
      within(screen.getByRole('dialog'))
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Reportes', 'Ajustes']);
  });

  it('BarraInferior por defecto: el resto de módulos va en «Más»', () => {
    const onNavegar = vi.fn();
    render(<BarraInferior onNavegar={onNavegar} />);
    fireEvent.click(screen.getByRole('button', { name: 'Más' }));
    const hoja = screen.getByRole('dialog', { name: 'Más' });
    expect(
      within(hoja)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Odontología', 'Personal', 'Inventario', 'Sonrisa Comunitaria', 'Estadísticas']);
  });
});

describe('BarraSuperior: sede y usuario', () => {
  const SEDES = [
    { id: 's1', nombre: 'Sede Centro' },
    { id: 's2', nombre: 'Sede Lambaré' },
  ];

  it('selector de sede con «Todas las sedes»', () => {
    const onSede = vi.fn();
    render(<BarraSuperior sedes={SEDES} sedeActiva="s1" onSede={onSede} permitirTodas />);
    const boton = screen.getByRole('button', { name: 'Sede: Sede Centro. Cambiar sede' });
    expect(boton).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(boton);
    const opciones = screen.getAllByRole('menuitemradio');
    expect(opciones.map((o) => o.textContent)).toEqual([
      'Todas las sedes',
      'Sede Centro',
      'Sede Lambaré',
    ]);
    expect(screen.getByRole('menuitemradio', { name: 'Sede Centro' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Todas las sedes' }));
    expect(onSede).toHaveBeenCalledWith(null);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(boton).toHaveFocus();
  });

  it('elegir otra sede llama onSede con su id; la misma no', () => {
    const onSede = vi.fn();
    const { rerender } = render(<BarraSuperior sedes={SEDES} sedeActiva="s1" onSede={onSede} />);
    fireEvent.click(screen.getByRole('button', { name: /Sede: Sede Centro/ }));
    expect(screen.queryByRole('menuitemradio', { name: 'Todas las sedes' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Sede Centro' }));
    expect(onSede).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Sede: Sede Centro/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Sede Lambaré' }));
    expect(onSede).toHaveBeenCalledWith('s2');
    rerender(<BarraSuperior sedes={SEDES} sedeActiva={null} onSede={onSede} permitirTodas />);
    expect(screen.getByRole('button', { name: /Sede: Todas las sedes/ })).toBeInTheDocument();
  });

  it('con una sola sede no hay selector', () => {
    render(<BarraSuperior sedes={[{ id: 's1', nombre: 'Sede Centro' }]} onSede={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Sede/ })).toBeNull();
    expect(screen.getByRole('img', { name: 'Sede: Sede Centro' })).toBeInTheDocument();
  });

  it('menú de usuario con acciones y «Cerrar sesión»', () => {
    const onCerrarSesion = vi.fn();
    const onPerfil = vi.fn();
    render(
      <BarraSuperior
        usuario={{ nombre: 'Lorena Fretes', rol: 'Recepción' }}
        onCerrarSesion={onCerrarSesion}
        accionesUsuario={[{ id: 'perfil', texto: 'Mi perfil', onElegir: onPerfil }]}
      />,
    );
    const perfil = screen.getByRole('button', { name: 'Perfil de Lorena Fretes' });
    fireEvent.click(perfil);
    const menu = screen.getByRole('menu', { name: 'Opciones de Lorena Fretes' });
    expect(within(menu).getByText('Recepción')).toBeInTheDocument();
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Mi perfil' }));
    expect(onPerfil).toHaveBeenCalledOnce();
    fireEvent.click(perfil);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
    expect(onCerrarSesion).toHaveBeenCalledOnce();
  });

  it('el buscador de la barra puede ser controlado', () => {
    const onBusqueda = vi.fn();
    render(<BarraSuperior valorBusqueda="" onBusqueda={onBusqueda} resultados={[]} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ana' } });
    expect(onBusqueda).toHaveBeenCalledWith('ana');
  });
});

describe('SelectorIdioma', () => {
  it('cambia con clic y con flechas', () => {
    const onCambio = vi.fn();
    render(<SelectorIdioma onCambio={onCambio} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Guaraní' }));
    expect(onCambio).toHaveBeenLastCalledWith('gn');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Guaraní' }), { key: 'ArrowLeft' });
    expect(onCambio).toHaveBeenLastCalledWith('es');
    expect(screen.getByRole('radio', { name: 'Español' })).toHaveFocus();
  });
});
