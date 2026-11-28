/**
 * Clínica de demostración para desarrollo (`pnpm --filter @conecta/db sembrar-dev`).
 * Datos ficticios, los mismos de la maqueta y del design system: dos sedes («Asunción · Centro» y
 * «San Lorenzo») con dos sillones cada una, la Dra. Marta Acosta como dueña, tres profesionales con
 * sus tramos en las dos sedes, un catálogo de 12 tratamientos y seis pacientes (los personajes del
 * README del design system): Ana Giménez (34) y su hijo Mateo (7), vinculados como madre e hijo
 * con Ana como tutora legal y responsable de pago, Lucía Benítez, Carlos Ayala, Rosa Duarte y Tomás
 * Villalba. Desde el Sprint 4, dos anamnesis firmadas: la de Ana (alérgica a la penicilina, con el
 * detalle «urticaria con amoxicilina»: su ficha muestra la alerta médica) y la de Mateo, firmada por
 * Ana como tutora. Las firmas son solo metadatos de archivo (`firma_paciente`, bucket
 * `conecta-privado`, ruta `<clinica>/<id>`): el contenido (el PNG de `DEMO.firmaPngBase64`) no se
 * escribe en ningún almacenamiento, así que la URL de la firma de la demostración no descarga nada
 * hasta que alguien copie ese PNG a la ruta del almacén local.
 *
 * Es idempotente y completa: si la clínica no existe, la crea entera; si existe (también una creada
 * por una versión anterior de esta semilla, sin profesionales ni catálogo), agrega solo lo que falta,
 * con ids fijos y `ON CONFLICT DO NOTHING` (no duplica nada ni pisa lo que alguien haya cambiado).
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { conContextoCliente } from './contexto.js';

/** Ids fijos de la demostración (no son secretos: datos ficticios). */
export const DEMO = {
  clinicaId: '00000000-0000-4000-8000-00000000c001',
  duenoId: '00000000-0000-4000-8000-00000000d001',
  duenoNombre: 'Dra. Marta Acosta',
  duenoEmail: 'marta.acosta@example.com',
  sedes: {
    centro: '00000000-0000-4000-8000-000000005ed1',
    sanLorenzo: '00000000-0000-4000-8000-000000005ed2',
  },
  profesionales: {
    acosta: '00000000-0000-4000-8000-0000000f0001',
    rojas: '00000000-0000-4000-8000-0000000f0002',
    duarte: '00000000-0000-4000-8000-0000000f0003',
  },
  pacientes: {
    ana: '00000000-0000-4000-8000-0000000a0001',
    mateo: '00000000-0000-4000-8000-0000000a0002',
    lucia: '00000000-0000-4000-8000-0000000a0003',
    carlos: '00000000-0000-4000-8000-0000000a0004',
    rosa: '00000000-0000-4000-8000-0000000a0005',
    tomas: '00000000-0000-4000-8000-0000000a0006',
  },
  /** Ana es la madre de Mateo (fila vista desde Ana: Mateo es su hijo). */
  relacionAnaMateo: '00000000-0000-4000-8000-0000000b0001',
  /** Archivos firma_paciente de las anamnesis de Ana y de Mateo (Sprint 4). */
  firmas: {
    ana: '00000000-0000-4000-8000-0000000f1001',
    mateo: '00000000-0000-4000-8000-0000000f1002',
  },
  /** PNG de 1×1 transparente: el «trazo» de las firmas de la demostración. */
  firmaPngBase64:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
} as const;

export interface OpcionesSemilla {
  /** Id de Auth del dueño (en local, el del usuario creado en Supabase Auth). */
  duenoId?: string | undefined;
  duenoEmail?: string | undefined;
}

export interface ResultadoSemilla {
  clinicaId: string;
  duenoId: string;
  /** true si la clínica no existía y se creó ahora. */
  creada: boolean;
  /** Lo que se agregó en esta corrida (0 en una corrida que no tenía nada que completar). */
  agregados: {
    profesionales: number;
    tramos: number;
    tratamientos: number;
    pacientes: number;
    /** Vínculos creados en esta corrida (cada uno con su espejo, que no se cuenta). */
    relaciones: number;
    /** Anamnesis firmadas creadas en esta corrida (Ana y Mateo). */
    anamnesis: number;
  };
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

interface ProfesionalDemo {
  id: string;
  nombre: string;
  especialidad: string;
  color: string;
  /** Asociado a la membresía de la dueña. */
  esLaDuena: boolean;
  /** [sede, día (0 = domingo), desde, hasta]: sin superposición y dentro del horario de la sede. */
  tramos: [string, number, string, string][];
}

const { centro, sanLorenzo } = DEMO.sedes;

const PROFESIONALES: ProfesionalDemo[] = [
  {
    id: DEMO.profesionales.acosta,
    nombre: 'Dra. Marta Acosta',
    especialidad: 'Endodoncia y cirugía',
    color: '#18BFB0',
    esLaDuena: true,
    tramos: [
      [centro, 1, '08:00', '13:00'],
      [centro, 3, '08:00', '13:00'],
      [centro, 5, '08:00', '13:00'],
      [sanLorenzo, 2, '14:00', '18:00'],
      [sanLorenzo, 4, '14:00', '18:00'],
    ],
  },
  {
    id: DEMO.profesionales.rojas,
    nombre: 'Dr. Esteban Rojas',
    especialidad: 'Implantes',
    color: '#2E9BEC',
    esLaDuena: false,
    tramos: [
      [sanLorenzo, 1, '14:00', '18:00'],
      [sanLorenzo, 3, '14:00', '18:00'],
      [centro, 2, '08:00', '13:00'],
      [centro, 4, '08:00', '13:00'],
      [centro, 6, '08:00', '12:00'],
    ],
  },
  {
    id: DEMO.profesionales.duarte,
    nombre: 'Dra. Rosa Duarte',
    especialidad: 'Ortodoncia',
    color: '#8B5CF6',
    esLaDuena: false,
    tramos: [
      [centro, 1, '14:00', '18:00'],
      [centro, 3, '14:00', '18:00'],
      [centro, 5, '14:00', '18:00'],
      [sanLorenzo, 2, '08:00', '12:00'],
      [sanLorenzo, 4, '08:00', '12:00'],
    ],
  },
];

/** [nombre, precio en guaraníes con IVA, IVA, minutos] — de la maqueta (referencia/maqueta). */
const TRATAMIENTOS: [string, number, 10 | 5 | 0, number][] = [
  ['Consulta y diagnóstico', 120_000, 10, 30],
  ['Limpieza dental (profilaxis)', 250_000, 10, 30],
  ['Resina compuesta · 1 cara', 280_000, 10, 45],
  ['Resina compuesta · 2 caras', 380_000, 10, 60],
  ['Endodoncia unirradicular', 900_000, 10, 60],
  ['Extracción simple', 200_000, 10, 30],
  ['Extracción de tercer molar', 600_000, 10, 60],
  ['Blanqueamiento dental', 1_100_000, 10, 60],
  ['Control de ortodoncia', 250_000, 10, 30],
  ['Implante dental', 4_500_000, 10, 90],
  ['Kit de higiene bucal', 45_000, 5, 30],
  ['Atención social de jornada (exenta)', 80_000, 0, 30],
];

interface PacienteDemo {
  id: string;
  nombres: string;
  apellidos: string;
  ci: string | null;
  telefono: string | null;
  fechaNac: string;
  sexo: 'F' | 'M';
  ciudad: string;
  idioma: 'es' | 'gn';
  aceptaWhatsapp: boolean;
}

/** Datos ficticios. Edades a noviembre de 2026: Ana 34, Mateo 7, Tomás 11 (pediátrico). */
const PACIENTES: PacienteDemo[] = [
  {
    id: DEMO.pacientes.ana,
    nombres: 'Ana',
    apellidos: 'Giménez',
    ci: '4123456',
    telefono: '0981 123 456',
    fechaNac: '1992-05-14',
    sexo: 'F',
    ciudad: 'Asunción',
    idioma: 'es',
    aceptaWhatsapp: true,
  },
  {
    id: DEMO.pacientes.mateo,
    nombres: 'Mateo',
    apellidos: 'Giménez',
    ci: null,
    telefono: null,
    fechaNac: '2019-03-08',
    sexo: 'M',
    ciudad: 'Asunción',
    idioma: 'es',
    aceptaWhatsapp: false,
  },
  {
    id: DEMO.pacientes.lucia,
    nombres: 'Lucía',
    apellidos: 'Benítez',
    ci: '3456789',
    telefono: '0971 234 567',
    fechaNac: '1988-09-21',
    sexo: 'F',
    ciudad: 'San Lorenzo',
    idioma: 'es',
    aceptaWhatsapp: true,
  },
  {
    id: DEMO.pacientes.carlos,
    nombres: 'Carlos',
    apellidos: 'Ayala',
    ci: '2345678',
    telefono: '0961 345 678',
    fechaNac: '1975-02-03',
    sexo: 'M',
    ciudad: 'Luque',
    idioma: 'gn',
    aceptaWhatsapp: true,
  },
  {
    id: DEMO.pacientes.rosa,
    nombres: 'Rosa',
    apellidos: 'Duarte',
    ci: '1234567',
    telefono: '0991 456 789',
    fechaNac: '1960-12-01',
    sexo: 'F',
    ciudad: 'Fernando de la Mora',
    idioma: 'gn',
    aceptaWhatsapp: false,
  },
  {
    id: DEMO.pacientes.tomas,
    nombres: 'Tomás',
    apellidos: 'Villalba',
    ci: null,
    telefono: '0982 567 890',
    fechaNac: '2015-07-19',
    sexo: 'M',
    ciudad: 'San Lorenzo',
    idioma: 'es',
    aceptaWhatsapp: true,
  },
];

/** Id fijo de un registro de la demostración: prefijo de 4 hex + número de orden. */
function idDemo(prefijo: string, numero: number): string {
  return `00000000-0000-4000-8000-${prefijo}${numero.toString(16).padStart(8, '0')}`;
}

/** Alta de la clínica, sus sedes, horarios, sillones y la membresía completa de la dueña. */
async function crearClinica(cliente: pg.PoolClient, duenoId: string, duenoEmail: string) {
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
}

/**
 * Agrega lo que falte de profesionales, tramos y catálogo. Como alta del sistema (sin usuario en el
 * contexto: created_by NULL), así no depende de que exista el usuario dueño que se pase.
 */
async function completar(
  cliente: pg.PoolClient,
  duenoId: string,
): Promise<ResultadoSemilla['agregados']> {
  await cliente.query("select set_config('app.usuario_id', '', true)");
  const agregados = {
    profesionales: 0,
    tramos: 0,
    tratamientos: 0,
    pacientes: 0,
    relaciones: 0,
    anamnesis: 0,
  };

  // Membresía de la dueña: la del usuario dado; si no, la del primer dueño activo.
  const duena = await cliente.query<{ id: string }>(
    `select m.id from app.membresia m
     join app.rol r on r.clinica_id = m.clinica_id and r.id = m.rol_id
     where m.clinica_id = $1 and m.estado = 'activo' and r.es_sistema and r.codigo = 'dueno'
     order by (m.usuario_id = $2) desc, m.created_at
     limit 1`,
    [DEMO.clinicaId, duenoId],
  );
  const membresiaDuena = duena.rows[0]?.id ?? null;

  for (const p of PROFESIONALES) {
    const alta = await cliente.query(
      `insert into app.profesional (id, clinica_id, membresia_id, nombre, especialidad, color)
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [
        p.id,
        DEMO.clinicaId,
        p.esLaDuena ? membresiaDuena : null,
        p.nombre,
        p.especialidad,
        p.color,
      ],
    );
    agregados.profesionales += alta.rowCount ?? 0;
    // Si no se pudo crear con este id (p. ej. la dueña ya tiene otro profesional), sin tramos.
    const existe = await cliente.query('select 1 from app.profesional where id = $1', [p.id]);
    if (!existe.rowCount) continue;
    const numeroProfesional = PROFESIONALES.indexOf(p) + 1;
    for (const [i, [sedeId, dia, desde, hasta]] of p.tramos.entries()) {
      const tramo = await cliente.query(
        `insert into app.profesional_disponibilidad
           (id, clinica_id, profesional_id, sede_id, dia_semana, hora_inicio, hora_fin)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing`,
        [
          idDemo('0d00', numeroProfesional * 100 + i + 1),
          DEMO.clinicaId,
          p.id,
          sedeId,
          dia,
          desde,
          hasta,
        ],
      );
      agregados.tramos += tramo.rowCount ?? 0;
    }
  }

  for (const [i, [nombre, precio, iva, minutos]] of TRATAMIENTOS.entries()) {
    // Sin conflicto por id ni por nombre activo (si alguien ya cargó uno con ese nombre, queda el suyo).
    const alta = await cliente.query(
      `insert into app.tratamiento (id, clinica_id, nombre, precio, iva, duracion_min)
       values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [idDemo('0e00', i + 1), DEMO.clinicaId, nombre, precio, iva, minutos],
    );
    agregados.tratamientos += alta.rowCount ?? 0;
  }

  for (const p of PACIENTES) {
    const alta = await cliente.query(
      `insert into app.paciente (id, clinica_id, nombres, apellidos, ci, telefono, fecha_nac, sexo,
                                 ciudad, idioma, acepta_whatsapp)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict do nothing`,
      [
        p.id,
        DEMO.clinicaId,
        p.nombres,
        p.apellidos,
        p.ci,
        p.telefono,
        p.fechaNac,
        p.sexo,
        p.ciudad,
        p.idioma,
        p.aceptaWhatsapp,
      ],
    );
    agregados.pacientes += alta.rowCount ?? 0;
  }
  // Mateo es hijo de Ana; la base crea el espejo (Ana es madre de Mateo). Sin conflicto por id ni
  // por par activo (si alguien ya los vinculó, queda lo suyo).
  const vinculo = await cliente.query(
    `insert into app.paciente_relacion
       (id, clinica_id, paciente_id, familiar_id, tipo, es_tutor_legal, es_responsable_pago)
     select $1, $2, $3, $4, 'hijo', true, true
     where exists (select 1 from app.paciente where id = $3 and activo)
       and exists (select 1 from app.paciente where id = $4 and activo)
       and not exists (select 1 from app.paciente_relacion r
                       where r.deleted_at is null
                         and ((r.paciente_id = $3 and r.familiar_id = $4)
                              or (r.paciente_id = $4 and r.familiar_id = $3)))
     on conflict do nothing`,
    [DEMO.relacionAnaMateo, DEMO.clinicaId, DEMO.pacientes.ana, DEMO.pacientes.mateo],
  );
  agregados.relaciones += vinculo.rowCount ?? 0;
  for (const anamnesis of ANAMNESIS) {
    agregados.anamnesis += await sembrarAnamnesis(cliente, anamnesis);
  }
  return agregados;
}

interface AnamnesisDemo {
  pacienteId: string;
  firmaId: string;
  respuestas: Record<string, unknown>[];
  firmante: { nombre: string; ci: string | null; esTutor: boolean };
  signos: [number | null, number | null, number | null, number | null];
}

/** Ana, alérgica a la penicilina; Mateo (7), firmado por Ana como tutora. */
const ANAMNESIS: AnamnesisDemo[] = [
  {
    pacienteId: DEMO.pacientes.ana,
    firmaId: DEMO.firmas.ana,
    respuestas: [
      { codigo: 'motivo', texto: 'Control y limpieza' },
      { codigo: 'ultima_consulta', texto: 'Hace un año' },
      { codigo: 'enfermedades', opciones: [] },
      { codigo: 'medicacion', opciones: [] },
      { codigo: 'alergias', opciones: ['penicilina'], detalle: 'urticaria con amoxicilina' },
      { codigo: 'embarazo', si: false },
    ],
    firmante: { nombre: 'Ana Giménez', ci: '4123456', esTutor: false },
    signos: [120, 80, 72, 62],
  },
  {
    pacienteId: DEMO.pacientes.mateo,
    firmaId: DEMO.firmas.mateo,
    respuestas: [
      { codigo: 'motivo', texto: 'Dolor en una muela de abajo' },
      { codigo: 'desencadenantes', opciones: ['frio', 'dulce'] },
      { codigo: 'alergias', opciones: [] },
    ],
    firmante: { nombre: 'Ana Giménez', ci: '4123456', esTutor: true },
    signos: [null, null, 90, 24],
  },
];

/**
 * Anamnesis firmada de la demostración, si el paciente existe, está activo, no tiene ninguna y el
 * cuestionario tiene las preguntas que usa. Pasa por app.guardar_anamnesis (validaciones, copia de
 * textos y alerta médica). Devuelve 1 si la creó.
 */
async function sembrarAnamnesis(cliente: pg.PoolClient, a: AnamnesisDemo): Promise<number> {
  const listo = await cliente.query<{ ok: boolean }>(
    `select exists (select 1 from app.paciente where id = $1 and activo)
        and not exists (select 1 from app.anamnesis where clinica_id = $2 and paciente_id = $1)
        and (select count(*) from app.anamnesis_pregunta q
             where q.clinica_id = $2 and q.activa and q.codigo = any ($3::text[]))
            = cardinality($3::text[]) as ok`,
    [a.pacienteId, DEMO.clinicaId, a.respuestas.map((r) => String(r['codigo']))],
  );
  if (!listo.rows[0]?.ok) return 0;
  const png = Buffer.from(DEMO.firmaPngBase64, 'base64');
  await cliente.query(
    `insert into app.archivo (id, clinica_id, categoria, paciente_id, almacen, bucket, ruta,
                              nombre_original, tipo, bytes, ancho, alto, sha256)
     values ($1, $2, 'firma_paciente', $3, 'local', 'conecta-privado', $4,
             'firma.png', 'image/png', $5, 1, 1, $6)
     on conflict do nothing`,
    [
      a.firmaId,
      DEMO.clinicaId,
      a.pacienteId,
      `${DEMO.clinicaId}/${a.firmaId}`,
      png.length,
      createHash('sha256').update(png).digest('hex'),
    ],
  );
  const [sistolica, diastolica, pulso, peso] = a.signos;
  await cliente.query(
    `select app.guardar_anamnesis($1, null, app.huella_catalogo(), $2::jsonb, $3, $4, $5, $6, true,
                                  $7, $8, $9, $10)`,
    [
      a.pacienteId,
      JSON.stringify(a.respuestas),
      a.firmante.nombre,
      a.firmante.ci,
      a.firmante.esTutor,
      a.firmaId,
      sistolica,
      diastolica,
      pulso,
      peso,
    ],
  );
  return 1;
}

/**
 * Da de alta (o completa) la clínica de demostración. `admin` es un pool del rol de
 * migraciones/administración (dueño de las tablas): las reglas de `app.proteger_acceso()` no se le
 * aplican, por eso puede activar la membresía y asignar las sedes de la dueña en su nombre.
 */
export async function sembrarDemo(
  admin: pg.Pool,
  opciones: OpcionesSemilla = {},
): Promise<ResultadoSemilla> {
  const duenoId = opciones.duenoId ?? DEMO.duenoId;
  const duenoEmail = opciones.duenoEmail ?? DEMO.duenoEmail;
  const contexto = { clinicaId: DEMO.clinicaId, usuarioId: duenoId };

  const sembrar = async (cliente: pg.PoolClient): Promise<ResultadoSemilla> => {
    // Dos corridas a la vez: la segunda espera a la primera.
    await cliente.query(
      "select pg_advisory_xact_lock(hashtextextended('conecta:sembrar-demo', 0))",
    );
    const existente = await cliente.query('select 1 from app.clinica where id = $1', [
      DEMO.clinicaId,
    ]);
    const creada = !existente.rowCount;
    if (creada) await crearClinica(cliente, duenoId, duenoEmail);
    const agregados = await completar(cliente, duenoId);
    return { clinicaId: DEMO.clinicaId, duenoId, creada, agregados };
  };

  // Sin comprobar membresía: la clínica (y la membresía de la dueña) pueden no existir todavía.
  return conContextoCliente(admin, contexto, sembrar, { verificarMembresia: false });
}
