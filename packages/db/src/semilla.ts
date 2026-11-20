/**
 * Clínica de demostración para desarrollo (`pnpm --filter @conecta/db sembrar-dev`).
 * Datos ficticios, los mismos de la maqueta y del design system: dos sedes («Asunción · Centro» y
 * «San Lorenzo») con dos sillones cada una y la Dra. Marta Acosta como dueña.
 * Es idempotente: si la clínica de demostración ya existe, no hace nada.
 */
import type pg from 'pg';
import { conContextoCliente } from './contexto.js';

export const DEMO = {
  clinicaId: '00000000-0000-4000-8000-00000000c001',
  duenoId: '00000000-0000-4000-8000-00000000d001',
  duenoNombre: 'Dra. Marta Acosta',
  duenoEmail: 'marta.acosta@example.com',
  sedes: {
    centro: '00000000-0000-4000-8000-000000005ed1',
    sanLorenzo: '00000000-0000-4000-8000-000000005ed2',
  },
} as const;

export interface OpcionesSemilla {
  /** Id de Auth del dueño (en local, el del usuario creado en Supabase Auth). */
  duenoId?: string | undefined;
  duenoEmail?: string | undefined;
}

export interface ResultadoSemilla {
  clinicaId: string;
  duenoId: string;
  creada: boolean;
}

interface SedeDemo {
  id: string;
  nombre: string;
  direccion: string;
  telefono: string;
  color: string;
  /** [día (0 = domingo), desde, hasta] */
  horario: [number, string, string][];
}

const LUNES_A_VIERNES_8_A_18: [number, string, string][] = [1, 2, 3, 4, 5].map((dia) => [
  dia,
  '08:00',
  '18:00',
]);

const SEDES: SedeDemo[] = [
  {
    id: DEMO.sedes.centro,
    nombre: 'Asunción · Centro',
    direccion: 'Av. Mcal. López 1234',
    telefono: '021 600 100',
    color: '#18BFB0',
    horario: [...LUNES_A_VIERNES_8_A_18, [6, '08:00', '12:00']],
  },
  {
    id: DEMO.sedes.sanLorenzo,
    nombre: 'San Lorenzo',
    direccion: 'Ruta Mcal. Estigarribia km 10',
    telefono: '021 580 200',
    color: '#8B5CF6',
    horario: LUNES_A_VIERNES_8_A_18,
  },
];

/**
 * Da de alta la clínica de demostración. `admin` es un pool del rol de migraciones/administración
 * (dueño de las tablas): las reglas de `app.proteger_acceso()` no se le aplican, por eso puede
 * activar la membresía y asignar las sedes de la dueña en su nombre.
 */
export async function sembrarDemo(
  admin: pg.Pool,
  opciones: OpcionesSemilla = {},
): Promise<ResultadoSemilla> {
  const duenoId = opciones.duenoId ?? DEMO.duenoId;
  const duenoEmail = opciones.duenoEmail ?? DEMO.duenoEmail;
  const contexto = { clinicaId: DEMO.clinicaId, usuarioId: duenoId };

  const sembrar = async (cliente: pg.PoolClient): Promise<ResultadoSemilla> => {
    const existente = await cliente.query('select 1 from app.clinica where id = $1', [
      DEMO.clinicaId,
    ]);
    if (existente.rowCount) return { clinicaId: DEMO.clinicaId, duenoId, creada: false };

    await cliente.query(
      `select app.alta_clinica(
         p_nombre => $1, p_dueno_id => $2, p_dueno_nombre => $3, p_dueno_email => $4,
         p_razon_social => $5, p_clinica_id => $6)`,
      [
        'Sonrisa Para Todos (demostración)',
        duenoId,
        DEMO.duenoNombre,
        duenoEmail,
        'Clínica de demostración (datos ficticios)',
        DEMO.clinicaId,
      ],
    );

    for (const sede of SEDES) {
      await cliente.query(
        `insert into app.sede (id, clinica_id, nombre, direccion, telefono, estado, color)
         values ($1, $2, $3, $4, $5, 'abierta', $6)`,
        [sede.id, DEMO.clinicaId, sede.nombre, sede.direccion, sede.telefono, sede.color],
      );
      for (const [dia, desde, hasta] of sede.horario) {
        await cliente.query(
          `insert into app.sede_horario (clinica_id, sede_id, dia_semana, hora_inicio, hora_fin)
           values ($1, $2, $3, $4, $5)`,
          [DEMO.clinicaId, sede.id, dia, desde, hasta],
        );
      }
      for (const nombre of ['Sillón 1', 'Sillón 2']) {
        await cliente.query(
          'insert into app.sillon (clinica_id, sede_id, nombre) values ($1, $2, $3)',
          [DEMO.clinicaId, sede.id, nombre],
        );
      }
    }

    // La dueña ve las dos sedes y entra por defecto en Asunción · Centro.
    const membresia = await cliente.query<{ id: string }>(
      `update app.membresia set sede_defecto_id = $3
       where clinica_id = $1 and usuario_id = $2 returning id`,
      [DEMO.clinicaId, duenoId, DEMO.sedes.centro],
    );
    const membresiaId = membresia.rows[0]?.id;
    if (!membresiaId) throw new Error('No se encontró la membresía de la dueña recién creada.');
    for (const sede of SEDES) {
      await cliente.query(
        'insert into app.usuario_sede (clinica_id, membresia_id, sede_id) values ($1, $2, $3)',
        [DEMO.clinicaId, membresiaId, sede.id],
      );
    }

    return { clinicaId: DEMO.clinicaId, duenoId, creada: true };
  };

  // Sin comprobar membresía: la clínica (y la membresía de la dueña) todavía no existen.
  return conContextoCliente(admin, contexto, sembrar, { verificarMembresia: false });
}
