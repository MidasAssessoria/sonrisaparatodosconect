import { describe, expect, it } from 'vitest';

import {
  bajaSchema,
  consultaAuditoriaSchema,
  crearSedeSchema,
  horarioSedeSchema,
  horaSchema,
} from '../index.js';

describe('contrato de la API', () => {
  it('acepta horas de 24 h y rechaza las inválidas', () => {
    expect(horaSchema.safeParse('08:00').success).toBe(true);
    expect(horaSchema.safeParse('23:59').success).toBe(true);
    expect(horaSchema.safeParse('24:00').success).toBe(false);
    expect(horaSchema.safeParse('8:00').success).toBe(false);
  });

  it('rechaza un horario que cierra antes de abrir', () => {
    const r = horarioSedeSchema.safeParse({ diaSemana: 1, horaInicio: '18:00', horaFin: '08:00' });
    expect(r.success).toBe(false);
  });

  it('pone 30 minutos de intervalo por defecto', () => {
    const r = horarioSedeSchema.parse({ diaSemana: 6, horaInicio: '08:00', horaFin: '12:00' });
    expect(r.intervaloMin).toBe(30);
  });

  it('una sede nueva nace abierta y exige nombre', () => {
    expect(crearSedeSchema.parse({ nombre: 'San Lorenzo' }).estado).toBe('abierta');
    expect(crearSedeSchema.safeParse({ nombre: ' ' }).success).toBe(false);
    expect(crearSedeSchema.safeParse({ nombre: 'Luque', color: 'rojo' }).success).toBe(false);
  });

  it('toda baja pide un motivo', () => {
    expect(bajaSchema.safeParse({ motivo: '' }).success).toBe(false);
    expect(bajaSchema.safeParse({ motivo: 'Se mudó la sede' }).success).toBe(true);
  });

  it('la consulta de auditoría limita el tamaño de página', () => {
    expect(consultaAuditoriaSchema.parse({}).limite).toBe(50);
    expect(consultaAuditoriaSchema.safeParse({ limite: '500' }).success).toBe(false);
    expect(consultaAuditoriaSchema.parse({ limite: '20' }).limite).toBe(20);
  });
});

describe('contrato del Sprint 2', () => {
  it('la sede por defecto de una invitación tiene que estar entre sus sedes', async () => {
    const { crearInvitacionSchema } = await import('../index.js');
    const base = {
      nombre: 'Lorena Fretes',
      email: 'Lorena@Ejemplo.com',
      rolId: '00000000-0000-4000-8000-000000000001',
    };
    const sede = '00000000-0000-4000-8000-0000000000a1';
    expect(crearInvitacionSchema.parse(base).email).toBe('lorena@ejemplo.com');
    expect(crearInvitacionSchema.safeParse({ ...base, sedeDefectoId: sede }).success).toBe(false);
    expect(
      crearInvitacionSchema.safeParse({ ...base, sedeIds: [sede], sedeDefectoId: sede }).success,
    ).toBe(true);
  });

  it('los montos son guaraníes enteros', async () => {
    const { montoSchema } = await import('../index.js');
    expect(montoSchema.safeParse(150000).success).toBe(true);
    expect(montoSchema.safeParse(1500.5).success).toBe(false);
    expect(montoSchema.safeParse(-1).success).toBe(false);
  });

  it('la tabla de rutas no repite ninguna ruta', async () => {
    const { RUTAS_API } = await import('../index.js');
    const claves = RUTAS_API.map((r) => r.split(' ').slice(0, 2).join(' '));
    expect(new Set(claves).size).toBe(claves.length);
  });
});
