import type { Bloqueo, Permiso, Persona, Profesional, TramoDisponibilidad } from '@conecta/shared';
import { COLORES } from '@conecta/ui';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  IDS,
  IDS_CATALOGO,
  montar,
  personaDe as personaBase,
  profesionalDe,
  sedeDe,
  uuid,
} from '../../test/fabricas.js';

/** Gloria, asistente sin profesional asociado. */
function personaDe(parcial: Partial<Persona> = {}): Persona {
  return personaBase({
    membresiaId: IDS_CATALOGO.membresiaGloria,
    usuarioId: uuid(541),
    nombre: 'Gloria Páez',
    email: 'gloria@ejemplo.test',
    rol: { id: IDS.rol, codigo: 'asistente', nombre: 'Asistente' },
    ultimoAcceso: null,
    ...parcial,
  });
}
import { validarDisponibilidad, type SedeDisponible } from './disponibilidad.js';
import { instanteLocal, resumenDias } from './formato.js';

const SILLON = {
  id: IDS_CATALOGO.sillonCentro,
  sedeId: IDS.sedeCentro,
  nombre: 'Sillón 1',
  activo: true,
};

/** Centro atiende el lunes de 8 a 12 y de 14 a 18; Norte el lunes de 8 a 20. */
const SEDES = [
  sedeDe({
    horarios: [
      { diaSemana: 1, horaInicio: '08:00', horaFin: '12:00', intervaloMin: 30 },
      { diaSemana: 1, horaInicio: '14:00', horaFin: '18:00', intervaloMin: 30 },
    ],
    sillones: [SILLON],
  }),
  sedeDe({
    id: IDS.sedeNorte,
    nombre: 'Norte',
    horarios: [{ diaSemana: 1, horaInicio: '08:00', horaFin: '20:00', intervaloMin: 30 }],
  }),
];

const TRAMO_CENTRO: TramoDisponibilidad = {
  sedeId: IDS.sedeCentro,
  diaSemana: 1,
  horaInicio: '08:00',
  horaFin: '12:00',
  sillonId: null,
};
/** Tramo en una sede que la persona no ve: tiene que volver igual en el PUT. */
const TRAMO_AJENO: TramoDisponibilidad = {
  sedeId: IDS_CATALOGO.sedeAjena,
  diaSemana: 2,
  horaInicio: '09:00',
  horaFin: '11:00',
  sillonId: null,
};

function rutasDetalle(p: Profesional, extra: Parameters<typeof montar>[0] = {}) {
  return {
    'GET /profesionales/:id': { cuerpo: p },
    'GET /sedes': { cuerpo: SEDES },
    'GET /personal': { cuerpo: [personaDe()] },
    ...extra,
  };
}

describe('validación de la disponibilidad', () => {
  const sedes: SedeDisponible[] = SEDES.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    horarios: s.horarios,
    sillones: s.sillones,
  }));
  const base = { clave: 'a', sillonId: null, diaSemana: 1 };

  it('rechaza superposiciones el mismo día aunque sea en otra sede', () => {
    const r = validarDisponibilidad(
      [
        { ...base, clave: 'a', sedeId: IDS.sedeCentro, horaInicio: '08:00', horaFin: '12:00' },
        { ...base, clave: 'b', sedeId: IDS.sedeNorte, horaInicio: '11:00', horaFin: '13:00' },
      ],
      { sedes, ajenos: [], guardados: new Set() },
    );
    expect(r).toEqual({
      ok: false,
      errores: {
        b: 'Se superpone con el tramo de 8:00 a 12:00 en «Centro»: no puede estar en dos sedes a la vez.',
      },
    });
  });

  it('tocarse en un extremo está bien; un tramo ajeno también cuenta para superponer', () => {
    const ok = validarDisponibilidad(
      [
        { ...base, clave: 'a', sedeId: IDS.sedeNorte, horaInicio: '08:00', horaFin: '12:00' },
        { ...base, clave: 'b', sedeId: IDS.sedeNorte, horaInicio: '12:00', horaFin: '16:00' },
      ],
      { sedes, ajenos: [], guardados: new Set() },
    );
    expect(ok.ok).toBe(true);
    const mal = validarDisponibilidad(
      [{ ...base, diaSemana: 2, sedeId: IDS.sedeNorte, horaInicio: '10:00', horaFin: '12:00' }],
      { sedes: [{ ...sedes[1]!, horarios: null }], ajenos: [TRAMO_AJENO], guardados: new Set() },
    );
    expect(mal).toEqual({
      ok: false,
      errores: {
        a: 'Se superpone con el tramo de 9:00 a 11:00 en otra sede: no puede estar en dos sedes a la vez.',
      },
    });
  });

  it('fuera del horario de la sede (franjas unidas) y día sin atención', () => {
    const fuera = validarDisponibilidad(
      [{ ...base, sedeId: IDS.sedeCentro, horaInicio: '11:00', horaFin: '15:00' }],
      { sedes, ajenos: [], guardados: new Set() },
    );
    expect(fuera).toEqual({
      ok: false,
      errores: {
        a: 'El lunes la sede «Centro» atiende de 8:00 a 12:00 y de 14:00 a 18:00: este tramo queda fuera de ese horario.',
      },
    });
    const cerrado = validarDisponibilidad(
      [{ ...base, diaSemana: 3, sedeId: IDS.sedeCentro, horaInicio: '08:00', horaFin: '10:00' }],
      { sedes, ajenos: [], guardados: new Set() },
    );
    expect(cerrado.ok).toBe(false);
    // Un tramo ya guardado no se vuelve a medir contra el horario (como la API).
    const guardado = validarDisponibilidad(
      [{ ...base, diaSemana: 3, sedeId: IDS.sedeCentro, horaInicio: '08:00', horaFin: '10:00' }],
      { sedes, ajenos: [], guardados: new Set([`${IDS.sedeCentro}|3|08:00|10:00|`]) },
    );
    expect(guardado.ok).toBe(true);
  });

  it('fin posterior al inicio y horas completas', () => {
    const r = validarDisponibilidad(
      [{ ...base, sedeId: IDS.sedeNorte, horaInicio: '12:00', horaFin: '09:00' }],
      { sedes, ajenos: [], guardados: new Set() },
    );
    expect(r).toEqual({
      ok: false,
      errores: { a: 'La hora de fin tiene que ser posterior a la de inicio.' },
    });
    expect(
      validarDisponibilidad(
        [{ ...base, sedeId: IDS.sedeNorte, horaInicio: '', horaFin: '09:00' }],
        {
          sedes,
          ajenos: [],
          guardados: new Set(),
        },
      ).ok,
    ).toBe(false);
  });

  it('resumen de días y hora local de la clínica', () => {
    expect(resumenDias([{ diaSemana: 3 }, { diaSemana: 1 }, { diaSemana: 0 }])).toBe(
      'Lun, Mié, Dom',
    );
    expect(resumenDias([])).toBe('Sin días cargados');
    expect(instanteLocal('2026-12-20', '10:00', 'America/Asuncion')).toBe(
      '2026-12-20T10:00:00-03:00',
    );
  });
});

describe('Profesionales: lista y alta', () => {
  it('lista con activos primero, color, especialidad, registro y días de atención', async () => {
    montar(
      {
        'GET /profesionales': {
          cuerpo: [
            profesionalDe({ id: uuid(502), nombre: 'Dr. Abel Inactivo', activo: false }),
            profesionalDe({
              id: IDS_CATALOGO.rojas,
              nombre: 'Dr. Esteban Rojas',
              especialidad: null,
              registroProf: null,
            }),
            profesionalDe({
              disponibilidad: [TRAMO_CENTRO, { ...TRAMO_CENTRO, diaSemana: 3 }],
            }),
          ],
        },
        'GET /personal': { cuerpo: [] },
      },
      '/profesionales',
    );
    const tabla = within((await screen.findAllByRole('table'))[0]!);
    const enlaces = tabla.getAllByRole('link').map((a) => a.textContent);
    // Activos primero; entre ellos, el orden de la API.
    expect(enlaces).toEqual(['Dr. Esteban Rojas', 'Dra. Marta Acosta', 'Dr. Abel Inactivo']);
    expect(tabla.getAllByRole('link')[1]).toHaveAttribute(
      'href',
      `/profesionales/${IDS_CATALOGO.acosta}`,
    );
    expect(tabla.getByText('Lun, Mié')).toBeInTheDocument();
    expect(tabla.getAllByText('RP 1234')).toHaveLength(2);
    expect(tabla.getAllByText('Ortodoncia').length).toBeGreaterThan(0);
    const inactivo = tabla.getByText('Inactivo').closest('.cn-chip');
    expect(inactivo?.querySelector('svg')).not.toBeNull();
  });

  it('alta: valida el nombre, manda un solo POST con doble clic y asocia la persona', async () => {
    let lista: Profesional[] = [];
    const f = montar(
      {
        'GET /profesionales': () => ({ cuerpo: lista }),
        'GET /personal': {
          cuerpo: [
            personaDe(),
            personaDe({
              membresiaId: uuid(542),
              nombre: 'Ya Profesional',
              profesionalId: IDS_CATALOGO.acosta,
            }),
          ],
        },
        'POST /profesionales': ({ cuerpo }) => {
          const nuevo = profesionalDe({ id: IDS_CATALOGO.rojas, ...(cuerpo as object) });
          lista = [nuevo];
          return { estado: 201, cuerpo: nuevo };
        },
      },
      '/profesionales',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Agregar el primer profesional' }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Nuevo profesional' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar profesional' }));
    expect(await hoja.findByText('Poné el nombre.')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(hoja.getByLabelText(/^Nombre/), { target: { value: 'Dr. Esteban Rojas' } });
    fireEvent.change(hoja.getByLabelText('Especialidad'), { target: { value: 'Endodoncia' } });
    fireEvent.click(hoja.getByRole('radio', { name: 'Uva' }));
    const persona = hoja.getByLabelText('Persona del equipo');
    // Quien ya es profesional no se ofrece.
    expect(within(persona).queryByText(/Ya Profesional/)).toBeNull();
    fireEvent.change(persona, { target: { value: IDS_CATALOGO.membresiaGloria } });
    const guardar = hoja.getByRole('button', { name: 'Guardar profesional' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);

    expect(await screen.findByText('Profesional «Dr. Esteban Rojas» agregado')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    expect(f.pedidos.find((p) => p.metodo === 'POST')?.cuerpo).toEqual({
      nombre: 'Dr. Esteban Rojas',
      especialidad: 'Endodoncia',
      color: COLORES.uva,
      membresiaId: IDS_CATALOGO.membresiaGloria,
    });
    expect(
      (await screen.findAllByRole('link', { name: 'Dr. Esteban Rojas' })).length,
    ).toBeGreaterThan(0);
  });

  it('editar: vaciar la especialidad la borra (null) y se puede desactivar', async () => {
    const f = montar(
      rutasDetalle(profesionalDe(), {
        'PATCH /profesionales/:id': ({ cuerpo }) => ({
          cuerpo: profesionalDe(cuerpo as Partial<Profesional>),
        }),
      }),
      `/profesionales/${IDS_CATALOGO.acosta}`,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Editar datos' }));
    const hoja = within(
      await screen.findByRole('dialog', { name: 'Editar datos del profesional' }),
    );
    fireEvent.change(hoja.getByLabelText('Especialidad'), { target: { value: '' } });
    const activo = hoja.getByRole('switch', { name: /Activo/ });
    expect(activo).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(activo);
    fireEvent.click(hoja.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Datos del profesional guardados')).toBeInTheDocument();
    expect(f.pedidos.find((p) => p.metodo === 'PATCH')?.cuerpo).toEqual({
      nombre: 'Dra. Marta Acosta',
      color: '#2e9bec',
      especialidad: null,
      registroProf: 'RP 1234',
      membresiaId: null,
      activo: false,
    });
  });
});

describe('Profesionales: permisos', () => {
  it('con solo `personal:ver` no aparecen alta, edición, disponibilidad ni bloqueos', async () => {
    const permisos: Permiso[] = [
      { modulo: 'inicio', accion: 'ver' },
      { modulo: 'personal', accion: 'ver' },
    ];
    const bloqueo: Bloqueo = {
      id: IDS_CATALOGO.bloqueo,
      desde: '2026-12-20T13:00:00.000Z',
      hasta: '2026-12-31T21:00:00.000Z',
      motivo: 'Vacaciones',
    };
    const f = montar(
      {
        'GET /profesionales': { cuerpo: [profesionalDe()] },
        'GET /profesionales/:id': {
          cuerpo: profesionalDe({ disponibilidad: [TRAMO_CENTRO], bloqueos: [bloqueo] }),
        },
        'GET /personal': { cuerpo: [] },
      },
      '/profesionales',
      { permisos },
    );
    fireEvent.click((await screen.findAllByRole('link', { name: 'Dra. Marta Acosta' }))[0]!);
    expect(
      await screen.findByRole('heading', { name: 'Dra. Marta Acosta', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('8:00 a 12:00 en Centro')).toBeInTheDocument();
    expect(screen.getByText('Vacaciones')).toBeInTheDocument();
    for (const nombre of [
      'Nuevo profesional',
      'Editar datos',
      'Guardar disponibilidad',
      'Agregar bloqueo',
    ]) {
      expect(screen.queryByRole('button', { name: nombre })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /Quitar/ })).toBeNull();
    // Sin `sedes:ver` no se piden las sedes.
    expect(f.pedidos.some((p) => p.url.pathname === '/api/v1/sedes')).toBe(false);
  });
});

describe('Profesionales: disponibilidad semanal', () => {
  it('superposición en otra sede, fuera de horario y reemplazo completo al guardar', async () => {
    const f = montar(
      rutasDetalle(profesionalDe({ disponibilidad: [TRAMO_CENTRO, TRAMO_AJENO] }), {
        'PUT /profesionales/:id/disponibilidad': ({ cuerpo }) => ({
          cuerpo: profesionalDe({
            disponibilidad: (cuerpo as { tramos: TramoDisponibilidad[] }).tramos,
          }),
        }),
      }),
      `/profesionales/${IDS_CATALOGO.acosta}`,
    );
    const lunes = within(await screen.findByRole('group', { name: 'Lunes' }));
    expect(
      within(screen.getByRole('group', { name: 'Martes' })).getByText(/en una sede que no ves/),
    ).toBeInTheDocument();
    // La sede que no ve no se ofrece.
    expect(
      within(lunes.getByLabelText('Sede (tramo 1)'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Centro', 'Norte']);

    fireEvent.click(lunes.getByRole('button', { name: 'Agregar otro tramo' }));
    fireEvent.change(lunes.getByLabelText('Sede (tramo 2)'), {
      target: { value: IDS.sedeNorte },
    });
    fireEvent.change(lunes.getByLabelText('Desde (tramo 2)'), { target: { value: '10:00' } });
    fireEvent.change(lunes.getByLabelText('Hasta (tramo 2)'), { target: { value: '14:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar disponibilidad' }));
    expect(
      await lunes.findByText(
        'Se superpone con el tramo de 8:00 a 12:00 en «Centro»: no puede estar en dos sedes a la vez.',
      ),
    ).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'PUT')).toBe(false);

    fireEvent.change(lunes.getByLabelText('Sede (tramo 2)'), {
      target: { value: IDS.sedeCentro },
    });
    fireEvent.change(lunes.getByLabelText('Desde (tramo 2)'), { target: { value: '12:30' } });
    fireEvent.change(lunes.getByLabelText('Hasta (tramo 2)'), { target: { value: '15:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar disponibilidad' }));
    expect(
      await lunes.findByText(
        'El lunes la sede «Centro» atiende de 8:00 a 12:00 y de 14:00 a 18:00: este tramo queda fuera de ese horario.',
      ),
    ).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'PUT')).toBe(false);

    fireEvent.change(lunes.getByLabelText('Desde (tramo 2)'), { target: { value: '14:00' } });
    fireEvent.change(lunes.getByLabelText('Hasta (tramo 2)'), { target: { value: '18:00' } });
    fireEvent.change(lunes.getByLabelText('Sillón (tramo 2)'), {
      target: { value: IDS_CATALOGO.sillonCentro },
    });
    const guardar = screen.getByRole('button', { name: 'Guardar disponibilidad' });
    fireEvent.click(guardar);
    fireEvent.click(guardar);
    expect(await screen.findByText('Disponibilidad guardada')).toBeInTheDocument();
    const puts = f.pedidos.filter((p) => p.metodo === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.url.pathname).toBe(
      `/api/v1/profesionales/${IDS_CATALOGO.acosta}/disponibilidad`,
    );
    expect(puts[0]?.cuerpo).toEqual({
      tramos: [
        TRAMO_CENTRO,
        {
          sedeId: IDS.sedeCentro,
          diaSemana: 1,
          horaInicio: '14:00',
          horaFin: '18:00',
          sillonId: IDS_CATALOGO.sillonCentro,
        },
        TRAMO_AJENO,
      ],
    });
  });

  it('si la API igual rechaza, muestra su mensaje y lo ubica en el tramo', async () => {
    montar(
      rutasDetalle(profesionalDe({ disponibilidad: [TRAMO_CENTRO] }), {
        'PUT /profesionales/:id/disponibilidad': {
          estado: 400,
          cuerpo: {
            codigo: 'datos_invalidos',
            mensaje: 'Revisá los tramos: hay uno que no se puede guardar.',
            detalles: [
              {
                campo: 'tramos.1.sillonId',
                mensaje: 'El sillón «Sillón 1» está ocupado por otra persona ese día.',
              },
            ],
          },
        },
      }),
      `/profesionales/${IDS_CATALOGO.acosta}`,
    );
    const lunes = within(await screen.findByRole('group', { name: 'Lunes' }));
    fireEvent.click(lunes.getByRole('button', { name: 'Agregar otro tramo' }));
    fireEvent.change(lunes.getByLabelText('Desde (tramo 2)'), { target: { value: '14:00' } });
    fireEvent.change(lunes.getByLabelText('Hasta (tramo 2)'), { target: { value: '16:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar disponibilidad' }));
    expect(
      await screen.findByText('Revisá los tramos: hay uno que no se puede guardar.'),
    ).toBeInTheDocument();
    expect(
      lunes.getByText('El sillón «Sillón 1» está ocupado por otra persona ese día.'),
    ).toBeInTheDocument();
  });
});

describe('Profesionales: bloqueos', () => {
  it('no deja un fin anterior al inicio y manda las fechas en la zona de la clínica', async () => {
    let bloqueos: Bloqueo[] = [];
    const f = montar(
      rutasDetalle(profesionalDe(), {
        'GET /profesionales/:id': () => ({ cuerpo: profesionalDe({ bloqueos }) }),
        'POST /profesionales/:id/bloqueos': ({ cuerpo }) => {
          const b = { id: IDS_CATALOGO.bloqueo, ...(cuerpo as Omit<Bloqueo, 'id'>) };
          bloqueos = [
            {
              ...b,
              desde: new Date(b.desde).toISOString(),
              hasta: new Date(b.hasta).toISOString(),
            },
          ];
          return { estado: 201, cuerpo: bloqueos[0] };
        },
      }),
      `/profesionales/${IDS_CATALOGO.acosta}`,
    );
    expect(await screen.findByText('No hay bloqueos por delante.')).toBeInTheDocument();
    const form = within(screen.getByRole('form', { name: 'Nuevo bloqueo' }));
    fireEvent.change(form.getByLabelText('Desde (fecha)'), { target: { value: '2026-12-20' } });
    fireEvent.change(form.getByLabelText('Desde (hora)'), { target: { value: '10:00' } });
    fireEvent.change(form.getByLabelText('Hasta (fecha)'), { target: { value: '2026-12-20' } });
    fireEvent.change(form.getByLabelText('Hasta (hora)'), { target: { value: '09:00' } });
    fireEvent.change(form.getByLabelText(/^Motivo del bloqueo/), {
      target: { value: 'Congreso' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Agregar bloqueo' }));
    expect(
      await form.findByText('El fin del bloqueo tiene que ser posterior al inicio.'),
    ).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'POST')).toBe(false);

    fireEvent.change(form.getByLabelText('Hasta (fecha)'), { target: { value: '2026-12-31' } });
    fireEvent.change(form.getByLabelText('Hasta (hora)'), { target: { value: '18:00' } });
    const agregar = form.getByRole('button', { name: 'Agregar bloqueo' });
    fireEvent.click(agregar);
    fireEvent.click(agregar);
    expect(await screen.findByText('Bloqueo agregado')).toBeInTheDocument();
    expect(f.pedidos.filter((p) => p.metodo === 'POST')).toHaveLength(1);
    expect(f.pedidos.find((p) => p.metodo === 'POST')?.cuerpo).toEqual({
      desde: '2026-12-20T10:00:00-03:00',
      hasta: '2026-12-31T18:00:00-03:00',
      motivo: 'Congreso',
    });
    // Se ve en la hora de la clínica (13:00 UTC = 10:00 en Asunción).
    expect(
      await screen.findByText(/20 de dic.* · 10:00 a .*31 de dic.* · 18:00/),
    ).toBeInTheDocument();
  });

  it('quitar un bloqueo pide motivo y manda un solo DELETE', async () => {
    const bloqueo: Bloqueo = {
      id: IDS_CATALOGO.bloqueo,
      desde: '2026-12-20T13:00:00.000Z',
      hasta: '2026-12-31T21:00:00.000Z',
      motivo: 'Vacaciones',
    };
    let quitado = false;
    const f = montar(
      rutasDetalle(profesionalDe(), {
        'GET /profesionales/:id': () => ({
          cuerpo: profesionalDe({ bloqueos: quitado ? [] : [bloqueo] }),
        }),
        'DELETE /bloqueos/:id': () => {
          quitado = true;
          return { estado: 204 };
        },
      }),
      `/profesionales/${IDS_CATALOGO.acosta}`,
    );
    fireEvent.click(await screen.findByRole('button', { name: /^Quitar el bloqueo/ }));
    const hoja = within(await screen.findByRole('dialog', { name: 'Quitar bloqueo' }));
    fireEvent.click(hoja.getByRole('button', { name: 'Confirmar' }));
    expect(await hoja.findByText('Contanos el motivo de la baja.')).toBeInTheDocument();
    expect(f.pedidos.some((p) => p.metodo === 'DELETE')).toBe(false);

    fireEvent.change(hoja.getByLabelText(/^Motivo de la baja/), {
      target: { value: 'Suspendió el viaje' },
    });
    const confirmar = hoja.getByRole('button', { name: 'Confirmar' });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);
    expect(await screen.findByText('Bloqueo quitado')).toBeInTheDocument();
    const bajas = f.pedidos.filter((p) => p.metodo === 'DELETE');
    expect(bajas).toHaveLength(1);
    expect(bajas[0]?.url.pathname).toBe(`/api/v1/bloqueos/${IDS_CATALOGO.bloqueo}`);
    expect(bajas[0]?.cuerpo).toEqual({ motivo: 'Suspendió el viaje' });
    await waitFor(() => expect(screen.queryByText('Vacaciones')).toBeNull());
  });
});
