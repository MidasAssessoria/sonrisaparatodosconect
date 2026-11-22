import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AlertaClinica,
  Avatar,
  AvisoConexion,
  AvisoExito,
  BarraInferior,
  BarraLateral,
  BarraSuperior,
  Boton,
  Buscador,
  Campo,
  Chip,
  EncabezadoPagina,
  EstadoVacio,
  GraficoBarras,
  HojaInferior,
  Icono,
  LeyendaOdontograma,
  MarcoApp,
  MarcoVisor3D,
  MenuExportar,
  NOMBRES_ICONOS,
  PieMaqueta,
  SelectorIdioma,
  TablaLista,
  TarjetaMetrica,
  TarjetaPaciente,
} from '../index.js';

describe('Icono', () => {
  it('tiene los 36 íconos del bundle más «salir»', () => {
    expect(NOMBRES_ICONOS).toHaveLength(37);
    expect(Icono.nombres).toBe(NOMBRES_ICONOS);
  });
  it('es decorativo sin título y se anuncia con título', () => {
    const { container } = render(<Icono nombre="agenda" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('stroke-width', '2');
    expect(svg).toHaveClass('cn-icono');
    render(<Icono nombre="alerta" titulo="Atención" tamano={16} />);
    expect(screen.getByRole('img', { name: 'Atención' })).toHaveAttribute('width', '16');
  });
  it('cada ícono dibuja algo', () => {
    for (const n of NOMBRES_ICONOS) {
      const { container, unmount } = render(<Icono nombre={n} />);
      expect(container.querySelector('svg')?.childElementCount, n).toBeGreaterThan(0);
      unmount();
    }
  });
});

describe('Boton', () => {
  it('secundario md por defecto, type="button"', () => {
    render(<Boton>Nuevo turno</Boton>);
    const b = screen.getByRole('button', { name: 'Nuevo turno' });
    expect(b).toHaveClass('cn-boton', 'cn-boton--secundario', 'cn-boton--md');
    expect(b).toHaveAttribute('type', 'button');
  });
  it('variantes, tamaño, bloque e ícono', () => {
    render(
      <>
        <Boton variante="primario" tamano="lg" bloque icono="mas">
          Nuevo paciente
        </Boton>
        <Boton variante="fantasma">Ver todo</Boton>
        <Boton variante="peligro">Anular pago</Boton>
        <Boton icono="cerrar" aria-label="Cerrar" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Nuevo paciente' })).toHaveClass(
      'cn-boton--primario',
      'cn-boton--lg',
      'cn-boton--bloque',
    );
    expect(screen.getByRole('button', { name: 'Ver todo' })).toHaveClass('cn-boton--fantasma');
    expect(screen.getByRole('button', { name: 'Anular pago' })).toHaveClass('cn-boton--peligro');
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveClass('cn-boton--icono');
  });
  it('cargando bloquea y marca aria-busy', () => {
    const onClick = vi.fn();
    render(
      <Boton cargando onClick={onClick}>
        Cobrar
      </Boton>,
    );
    const b = screen.getByRole('button', { name: 'Cobrar' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    expect(b.querySelector('.cn-giro')).not.toBeNull();
  });
});

describe('MenuExportar (render)', () => {
  it('cerrado por defecto; soloIcono con aria-label', () => {
    render(<MenuExportar soloIcono />);
    const b = screen.getByRole('button', { name: 'Exportar' });
    expect(b).toHaveAttribute('aria-expanded', 'false');
    expect(b).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('estados preparando, listo y error con texto', () => {
    const { rerender } = render(<MenuExportar estado="preparando" />);
    expect(screen.getByRole('status')).toHaveTextContent('Preparando archivo…');
    rerender(<MenuExportar estado="listo" />);
    expect(screen.getByRole('status')).toHaveTextContent('Listo · ya podés descargarlo');
    rerender(<MenuExportar estado="error" />);
    expect(screen.getByRole('status')).toHaveTextContent('No se pudo preparar. Probá de nuevo.');
  });
  it('abierto al montar', () => {
    render(<MenuExportar abierto />);
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'PDF',
      'Excel / CSV',
      'Imprimir',
    ]);
  });
});

describe('Navegación (render)', () => {
  it('BarraLateral con los 9 módulos por defecto, la marca y el pie', () => {
    render(<BarraLateral activo="agenda" />);
    const nav = screen.getByRole('navigation', { name: 'Módulos' });
    expect(within(nav).getAllByRole('link')).toHaveLength(9);
    expect(within(nav).getByText('Conecta')).toBeInTheDocument();
    expect(within(nav).getByText('Un proyecto de Sonrisa Para Todos')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Agenda' })).toHaveAttribute('href', '#agenda');
  });
  it('BarraLateral con logo y rutas', () => {
    render(<BarraLateral logo={<span>Sello</span>} rutas={{ caja: '/caja' }} />);
    expect(screen.getByText('Sello')).toBeInTheDocument();
    expect(screen.queryByText('Conecta')).toBeNull();
    expect(screen.getByRole('link', { name: 'Caja' })).toHaveAttribute('href', '/caja');
  });
  it('BarraInferior: Inicio, Agenda, Pacientes, Caja y Más', () => {
    render(<BarraInferior activo="agenda" fija />);
    const nav = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(nav).toHaveClass('cn-inferior--fija');
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Inicio', 'Agenda', 'Pacientes', 'Caja']);
    expect(within(nav).getByRole('button', { name: 'Más' })).toBeInTheDocument();
  });
  it('SelectorIdioma: grupo de radio ES · GN', () => {
    render(<SelectorIdioma valor="gn" />);
    expect(screen.getByRole('radiogroup', { name: 'Idioma de la interfaz' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Guaraní' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Español' })).toHaveAttribute('aria-checked', 'false');
  });
  it('BarraSuperior mínima y con datos', () => {
    const { rerender } = render(<BarraSuperior />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeInTheDocument();
    rerender(
      <BarraSuperior
        conMarca
        sede="Sede Centro"
        notificaciones={3}
        usuario={{ nombre: 'Lorena Fretes', rol: 'Recepción' }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Notificaciones: 3 sin leer' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sede: Sede Centro' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Perfil de Lorena Fretes' })).toBeInTheDocument();
    expect(screen.getByText('Conecta')).toBeInTheDocument();
  });
});

describe('Pacientes y estado (render)', () => {
  it('Avatar: iniciales sin «Dra.», tono estable, decorativo', () => {
    const { rerender } = render(<Avatar nombre="Dra. Marta Acosta" />);
    const a = screen.getByRole('img', { name: 'Dra. Marta Acosta' });
    expect(a).toHaveTextContent('MA');
    const tono = [...a.classList].find((c) =>
      /cn-avatar--(turquesa|cielo|uva|rosa|sol|coral)/.test(c),
    );
    rerender(<Avatar nombre="Dra. Marta Acosta" />);
    expect(screen.getByRole('img')).toHaveClass(tono ?? 'x');
    rerender(<Avatar nombre="Ana Giménez" tamano="lg" tono="rosa" decorativo />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('AG')).toHaveClass('cn-avatar--lg', 'cn-avatar--rosa');
  });
  it('Chip: ícono por tono, sin ícono con null', () => {
    const { container, rerender } = render(<Chip tono="exito">Confirmado</Chip>);
    expect(screen.getByText('Confirmado').parentElement).toHaveClass('cn-chip--exito');
    expect(container.querySelector('svg')).not.toBeNull();
    rerender(<Chip>Ausente</Chip>);
    expect(screen.getByText('Ausente').parentElement).toHaveClass('cn-chip--neutro');
    expect(container.querySelector('svg')).toBeNull();
    rerender(
      <Chip tono="atencion" icono={null}>
        Pendiente
      </Chip>,
    );
    expect(container.querySelector('svg')).toBeNull();
  });
  it('TarjetaPaciente mínima, completa y desactivada', () => {
    const onAbrir = vi.fn();
    const { rerender } = render(<TarjetaPaciente nombre="Lucía Benítez" />);
    expect(screen.getByRole('button', { name: /Lucía Benítez/ })).toBeInTheDocument();
    rerender(
      <TarjetaPaciente
        nombre="Ana Giménez"
        edad={34}
        telefono="0981 000 001"
        proximoTurno="jue 14 de nov, 9:00"
        chips={[{ tono: 'atencion', texto: 'Alergia a la penicilina' }]}
        desactivado
        onAbrir={onAbrir}
      />,
    );
    expect(screen.getByText('34 años · 0981 000 001')).toBeInTheDocument();
    expect(screen.getByText(/Próximo turno: jue 14 de nov, 9:00/)).toBeInTheDocument();
    expect(screen.getByRole('article')).toHaveClass('is-desactivado');
    fireEvent.click(screen.getByRole('button'));
    expect(onAbrir).toHaveBeenCalledOnce();
  });
  it('TarjetaPaciente con documento y edades en singular', () => {
    const { rerender } = render(
      <TarjetaPaciente
        nombre="Ana Giménez"
        edad={34}
        documento="CI 4.123.456"
        telefono="0981 123 456"
      />,
    );
    expect(screen.getByText('34 años · CI 4.123.456 · 0981 123 456')).toBeInTheDocument();
    rerender(<TarjetaPaciente nombre="Mateo Giménez" edad={1} />);
    expect(screen.getByText('1 año')).toBeInTheDocument();
    rerender(<TarjetaPaciente nombre="Mateo Giménez" edad={0} />);
    expect(screen.getByText('Menos de 1 año')).toBeInTheDocument();
  });
  it('BarraSuperior sin buscador (conBuscador={false})', () => {
    const { rerender } = render(<BarraSuperior />);
    expect(screen.getByRole('combobox', { name: 'Buscar paciente' })).toBeInTheDocument();
    rerender(<BarraSuperior conBuscador={false} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('search')).toBeNull();
  });
  it('AlertaClinica: vacía, completa y compacta', () => {
    const { rerender } = render(<AlertaClinica alertas={[]} />);
    expect(screen.getByText('Sin alertas clínicas registradas')).toBeInTheDocument();
    rerender(
      <AlertaClinica
        alertas={[
          { tipo: 'alergia', texto: 'Alergia a la penicilina' },
          { tipo: 'condicion', texto: 'Hipertensión' },
        ]}
      />,
    );
    const region = screen.getByRole('region', { name: 'Alertas clínicas' });
    expect(within(region).getByText('Alergia a la penicilina').parentElement).toHaveClass(
      'cn-alerta--alergia',
    );
    expect(within(region).getByText('Hipertensión').parentElement).toHaveClass(
      'cn-alerta--condicion',
    );
    rerender(<AlertaClinica compacta alertas={[{ tipo: 'alergia', texto: 'Látex' }]} />);
    expect(screen.queryByText('Alertas clínicas')).toBeNull();
  });
  it('AvisoExito con acción y cierre', () => {
    const onCerrar = vi.fn();
    render(
      <AvisoExito
        titulo="Cobro registrado"
        texto="Gs. 300.000 · Ana Giménez"
        accion={<Boton variante="fantasma">Imprimir comprobante</Boton>}
        onCerrar={onCerrar}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Cobro registrado');
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(onCerrar).toHaveBeenCalledOnce();
  });
  it('AvisoExito flotante sin acción se cierra solo a los 6 s', () => {
    vi.useFakeTimers();
    const onCerrar = vi.fn();
    render(<AvisoExito titulo="Atención guardada" flotante onCerrar={onCerrar} />);
    vi.advanceTimersByTime(5999);
    expect(onCerrar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCerrar).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
  it('AvisoConexion: tres estados y pendientes', () => {
    const { rerender } = render(<AvisoConexion pendientes={2} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sin conexión · se guardará y sincronizará2 registros pendientes',
    );
    rerender(<AvisoConexion estado="sincronizando" pendientes={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('Sincronizando…1 registro pendiente');
    rerender(<AvisoConexion estado="sincronizado" />);
    expect(screen.getByRole('status')).toHaveClass('cn-conexion--sincronizado');
  });
  it('EstadoVacio con y sin ilustración', () => {
    const { container, rerender } = render(
      <EstadoVacio
        titulo="Todavía no hay pacientes"
        texto="Agregá el primero"
        accion={<Boton variante="primario">Nuevo paciente</Boton>}
      />,
    );
    expect(container.querySelector('.cn-vacio__ilustracion')).not.toBeNull();
    rerender(<EstadoVacio titulo="Sin resultados" ilustracion={false} />);
    expect(container.querySelector('svg')).toBeNull();
  });
  it('PieMaqueta', () => {
    render(<PieMaqueta />);
    expect(screen.getByText('Maqueta de concepto · los datos son un ejemplo')).toBeInTheDocument();
  });
});

describe('Formularios y contenedores (render)', () => {
  it('Campo: tipos text, select, textarea y password', () => {
    render(
      <>
        <Campo etiqueta="Nombre" requerido />
        <Campo
          etiqueta="Idioma del paciente"
          tipo="select"
          opciones={['Español', { valor: 'gn', texto: 'Guaraní' }]}
        />
        <Campo etiqueta="Notas" tipo="textarea" rows={5} />
        <Campo etiqueta="Contraseña" tipo="password" />
      </>,
    );
    expect(screen.getByLabelText(/Nombre/)).toBeRequired();
    expect(screen.getByText('· obligatorio')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Idioma del paciente' })).toHaveValue('Español');
    expect(screen.getByRole('option', { name: 'Guaraní' })).toHaveValue('gn');
    expect(screen.getByRole('textbox', { name: 'Notas' })).toHaveAttribute('rows', '5');
    const clave = screen.getByLabelText('Contraseña');
    expect(clave).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
    expect(clave).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('HojaInferior cerrada no renderiza; en línea sin aria-modal', () => {
    const { rerender } = render(<HojaInferior abierta={false} titulo="Nuevo turno" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(
      <HojaInferior abierta enLinea titulo="Nuevo turno" acciones={<Boton>Guardar turno</Boton>}>
        <p>Contenido</p>
      </HojaInferior>,
    );
    const d = screen.getByRole('dialog', { name: 'Nuevo turno' });
    expect(d).not.toHaveAttribute('aria-modal');
    expect(screen.queryByRole('button', { name: 'Cerrar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Guardar turno' })).toBeInTheDocument();
  });
  it('TablaLista: tabla y tarjetas con los mismos datos', () => {
    const filas = [
      { id: 1, nombre: 'Ana Giménez', monto: 'Gs. 300.000' },
      { id: 2, nombre: 'Carlos Ayala', monto: 'Gs. 150.000' },
    ];
    render(
      <TablaLista
        titulo="Movimientos"
        columnas={[
          { clave: 'nombre', titulo: 'Paciente' },
          { clave: 'monto', titulo: 'Monto', alinear: 'fin' },
          { clave: 'estado', titulo: 'Estado', render: () => <Chip tono="exito">Pagado</Chip> },
        ]}
        filas={filas}
      />,
    );
    const tabla = screen.getByRole('table', { name: 'Movimientos' });
    expect(within(tabla).getAllByRole('row')).toHaveLength(3);
    expect(within(tabla).getByRole('rowheader', { name: 'Ana Giménez' })).toBeInTheDocument();
    expect(within(tabla).getByRole('columnheader', { name: 'Monto' })).toHaveClass('is-fin');
    const lista = screen.getByRole('list', { name: 'Movimientos' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(2);
    expect(within(lista).getAllByText('Pagado')).toHaveLength(2);
  });
});

describe('Datos y odontología (render)', () => {
  it('TarjetaMetrica mínima y con cambio', () => {
    const { container, rerender } = render(<TarjetaMetrica etiqueta="Turnos de hoy" valor={12} />);
    expect(screen.getByText('12')).toHaveClass('cn-metrica__valor');
    expect(container.querySelector('.cn-metrica__cambio')).toBeNull();
    rerender(
      <TarjetaMetrica
        etiqueta="Ausencias"
        valor={4}
        cambio="+2"
        tendencia="sube"
        tono="atencion"
        nota="vs. semana pasada"
        icono="pacientes"
      />,
    );
    expect(container.querySelector('.cn-metrica__cambio--atencion')).toHaveTextContent(
      '+2 vs. semana pasada',
    );
  });
  it('GraficoBarras alterna a tabla', () => {
    render(
      <GraficoBarras
        titulo="Guantes"
        datos={[
          { etiqueta: 'Nitrilo M', valor: 40 },
          { etiqueta: 'Látex S', valor: 4, tono: 'coral', nota: 'Nivel bajo' },
        ]}
        formato={(v) => `${v} cajas`}
      />,
    );
    expect(screen.getByText('40 cajas')).toBeInTheDocument();
    expect(screen.getByText('Nivel bajo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver como tabla' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Látex S' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver gráfico' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('LeyendaOdontograma: herramientas y solo leyenda', () => {
    const onElegir = vi.fn();
    const { rerender } = render(<LeyendaOdontograma vertical onElegir={onElegir} />);
    expect(screen.getByRole('toolbar', { name: 'Marcar en el odontograma' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caries' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Extracción' }));
    expect(onElegir).toHaveBeenCalledWith('extraccion');
    expect(screen.getByRole('button', { name: 'Extracción' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    rerender(<LeyendaOdontograma soloLeyenda />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Periodontal')).toBeInTheDocument();
  });
  it('MarcoVisor3D: marcador, cargando, dentición y children', () => {
    const onDenticion = vi.fn();
    const { rerender } = render(<MarcoVisor3D onDenticion={onDenticion} />);
    expect(screen.getByText('Numeración FDI 11–48')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Pediátrico 51–85' }));
    expect(onDenticion).toHaveBeenCalledWith('pediatrico');
    expect(screen.getByText('Numeración FDI 51–85')).toBeInTheDocument();
    rerender(<MarcoVisor3D cargando />);
    expect(screen.getByText('Cargando visor…')).toBeInTheDocument();
    rerender(
      <MarcoVisor3D>
        <canvas data-testid="visor" />
      </MarcoVisor3D>,
    );
    expect(screen.getByTestId('visor')).toBeInTheDocument();
  });
});

describe('MarcoApp y EncabezadoPagina (render)', () => {
  it('EncabezadoPagina con h1 y acciones', () => {
    render(<EncabezadoPagina titulo="Pacientes" acciones={<MenuExportar />} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Pacientes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument();
  });
  it('MarcoApp arma lateral, superior, contenido e inferior', () => {
    render(
      <MarcoApp
        items={[
          { id: 'inicio', nombre: 'Inicio', icono: 'inicio', ruta: '/' },
          { id: 'turnos', nombre: 'Turnos', icono: 'agenda', ruta: '/turnos' },
        ]}
        activo="turnos"
        usuario={{ nombre: 'Lorena Fretes', rol: 'Recepción' }}
        accionMovil={<Boton variante="primario">Nuevo turno</Boton>}
      >
        <p>Hola</p>
      </MarcoApp>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('Hola');
    expect(screen.getByRole('link', { name: 'Ir al contenido' })).toHaveAttribute(
      'href',
      `#${screen.getByRole('main').id}`,
    );
    const lateral = screen.getByRole('navigation', { name: 'Módulos' });
    expect(within(lateral).getByRole('link', { name: 'Turnos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const inferior = screen.getByRole('navigation', { name: 'Navegación principal' });
    expect(
      within(inferior)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(['Inicio', 'Turnos']);
    // «Más» sigue, porque lleva el selector de idioma.
    expect(within(inferior).getByRole('button', { name: 'Más' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo turno' })).toBeInTheDocument();
  });
});

describe('Buscador (render)', () => {
  it('etiqueta accesible y placeholder por defecto', () => {
    render(<Buscador />);
    const campo = screen.getByRole('combobox', { name: 'Buscar paciente' });
    expect(campo).toHaveAttribute('placeholder', 'Buscar paciente: nombre, CI o teléfono');
    expect(campo).toHaveAttribute('aria-expanded', 'false');
  });
});
