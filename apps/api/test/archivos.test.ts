/**
 * Archivos privados con el almacén local: matriz de permisos por categoría y sede, aislamiento,
 * URL firmada (token, vencimiento, cabeceras de la descarga), validación del contenido, multipart,
 * compensación, auditoría `ver` (también de cada descarga, que vuelve a comprobar el permiso) y
 * encolado con `app.encolar` en la misma transacción. SVG no se acepta en ninguna categoría.
 */
import { createHash, randomUUID } from 'node:crypto';
import { archivoSchema, urlArchivoSchema, type Archivo } from '@conecta/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearArchivoDePrueba, crearRolDePrueba, crearUsuarioDePrueba } from '@conecta/db/pruebas';
import { firmarToken } from '../src/archivos/firma.js';
import {
  comoSistema,
  crearClinica,
  crearPersona,
  crearPrueba,
  esperarError,
  otorgarPermiso,
  segun,
  type Clinica,
  type Persona,
  type Prueba,
} from './ayudas.js';
import {
  archivosEnDisco,
  configLocal,
  escribirEnDisco,
  jpeg,
  PDF,
  png,
  SECRETO_PRUEBA,
  SVG_LIMPIO,
  subir,
  trabajosDe,
  trabajosDeClinica,
  webp,
} from './archivos-ayudas.js';

let prueba: Prueba;
let directorio: string;
let borrarDirectorio: () => Promise<void>;
let A: Clinica;
let B: Clinica;
let adminA: Persona;
let recepcionA: Persona;

beforeAll(async () => {
  const local = await configLocal();
  directorio = local.archivos.directorio;
  borrarDirectorio = local.borrar;
  prueba = await crearPrueba({ config: { archivos: local.archivos } });
  [A, B] = await Promise.all([
    crearClinica(prueba, { sedes: 2 }),
    crearClinica(prueba, { sedes: 1 }),
  ]);
  adminA = await crearPersona(prueba, A.clinicaId, { rol: 'administracion' });
  recepcionA = await crearPersona(prueba, A.clinicaId, { rol: 'recepcion' });
});

afterAll(async () => {
  await prueba.cerrar();
  await borrarDirectorio();
});

async function subida(
  persona: Persona,
  categoria: string,
  contenido: Buffer,
  nombre = 'firma.png',
) {
  const respuesta = await subir(prueba, await persona.token(), categoria, contenido, { nombre });
  expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(201);
  return segun(archivoSchema, respuesta.body);
}

async function pedirUrl(persona: Persona, id: string) {
  return prueba.pedir('get', `/archivos/${id}/url`, { token: await persona.token() });
}

/** La URL es absoluta (contrato): `<API_ORIGEN_PUBLICO>/api/v1/archivos/descarga?t=…`. */
function rutaDe(url: string): string {
  const u = new URL(url);
  expect(u.origin).toBe(prueba.config.apiOrigenPublico);
  expect(u.pathname).toBe('/api/v1/archivos/descarga');
  return `/archivos/descarga${u.search}`;
}

async function descargar(url: string) {
  const ruta = rutaDe(url);
  return prueba
    .pedir('get', ruta)
    .buffer(true)
    .parse((res, listo) => {
      const partes: Buffer[] = [];
      res.on('data', (trozo: Buffer) => partes.push(trozo));
      res.on('end', () => listo(null, Buffer.concat(partes)));
    });
}

describe('subida y URL: matriz de permisos por categoría', () => {
  it('firma_profesional (personal): administración sube y ve; recepción no sube ni ve', async () => {
    const contenido = png(30, 20);
    const archivo = await subida(adminA, 'firma_profesional', contenido, 'Firma Dra. Núñez.png');
    expect(archivo).toMatchObject({
      categoria: 'firma_profesional',
      nombreOriginal: 'Firma Dra. Núñez.png',
      tipo: 'image/png',
      bytes: contenido.length,
      ancho: 30,
      alto: 20,
      sha256: createHash('sha256').update(contenido).digest('hex'),
    });

    const url = segun(urlArchivoSchema, (await pedirUrl(adminA, archivo.id)).body);
    expect(url.url).toMatch(
      /^http:\/\/api\.prueba\.localhost\/api\/v1\/archivos\/descarga\?t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
    const vence = new Date(url.venceEn).getTime() - Date.now();
    expect(vence).toBeGreaterThan(250_000);
    expect(vence).toBeLessThanOrEqual(300_000);

    const r = await esperarError(
      subir(prueba, await recepcionA.token(), 'firma_profesional', png(5, 5)),
      403,
      'sin_permiso',
    );
    expect((r.body as { mensaje: string }).mensaje).toContain('crear en Personal');
    await esperarError(
      prueba.pedir('get', `/archivos/${archivo.id}/url`, { token: await recepcionA.token() }),
      403,
      'sin_permiso',
    );
  });

  it('logo_clinica (configuracion): el dueño y administración suben y ven; recepción nada', async () => {
    const archivo = await subida(A.dueno, 'logo_clinica', jpeg(120, 80), 'logo.jpg');
    expect(archivo).toMatchObject({ tipo: 'image/jpeg', ancho: 120, alto: 80 });
    expect((await pedirUrl(A.dueno, archivo.id)).status).toBe(200);
    expect((await pedirUrl(adminA, archivo.id)).status).toBe(200);
    // Administración tiene configuracion:crear desde la migración 0015.
    await subida(adminA, 'logo_clinica', png(5, 5), 'logo.png');
    await esperarError(
      subir(prueba, await recepcionA.token(), 'logo_clinica', png(5, 5)),
      403,
      'sin_permiso',
    );
    await esperarError(
      prueba.pedir('get', `/archivos/${archivo.id}/url`, { token: await recepcionA.token() }),
      403,
      'sin_permiso',
    );
  });

  it('sin permiso, el archivo no se guarda ni se encola', async () => {
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const trabajosAntes = (await trabajosDeClinica(prueba.admin, A.clinicaId)).length;
    await esperarError(
      subir(prueba, await recepcionA.token(), 'logo_clinica', png(5, 5)),
      403,
      'sin_permiso',
    );
    expect(await archivosEnDisco(directorio, A.clinicaId)).toEqual(antes);
    expect(await trabajosDeClinica(prueba.admin, A.clinicaId)).toHaveLength(trabajosAntes);
  });

  it('sede: con el permiso, solo la URL de archivos de sus sedes', async () => {
    const C = await crearClinica(prueba, { sedes: 2 });
    const [sede1, sede2] = C.sedes.map((s) => s.sedeId) as [string, string];
    const persona = await crearPersona(prueba, C.clinicaId, {
      rol: 'recepcion',
      sedes: [sede1],
      sedeDefectoId: sede1,
    });
    const { rows } = await comoSistema<{ rol_id: string }>(
      prueba.admin,
      C.clinicaId,
      'select rol_id from app.membresia where id = $1',
      [persona.membresiaId],
    );
    await otorgarPermiso(prueba, C.clinicaId, rows[0]!.rol_id, 'personal', 'ver');

    const enSede1 = await crearArchivoDePrueba(prueba.admin, {
      clinicaId: C.clinicaId,
      categoria: 'firma_profesional',
      sedeId: sede1,
    });
    const enSede2 = await crearArchivoDePrueba(prueba.admin, {
      clinicaId: C.clinicaId,
      categoria: 'firma_profesional',
      sedeId: sede2,
    });
    const sinSede = await crearArchivoDePrueba(prueba.admin, {
      clinicaId: C.clinicaId,
      categoria: 'firma_profesional',
    });
    expect((await pedirUrl(persona, enSede1.archivoId)).status).toBe(200);
    expect((await pedirUrl(persona, sinSede.archivoId)).status).toBe(200);
    await esperarError(
      prueba.pedir('get', `/archivos/${enSede2.archivoId}/url`, { token: await persona.token() }),
      403,
      'sede_no_permitida',
    );
    // El dueño ve todas las sedes.
    expect((await pedirUrl(C.dueno, enSede2.archivoId)).status).toBe(200);
  });
});

describe('aislamiento y bajas', () => {
  it('un archivo de otra clínica, inexistente o dado de baja no existe (404)', async () => {
    const deB = await crearArchivoDePrueba(prueba.admin, { clinicaId: B.clinicaId });
    await esperarError(
      prueba.pedir('get', `/archivos/${deB.archivoId}/url`, { token: await A.dueno.token() }),
      404,
      'no_encontrado',
    );
    await esperarError(
      prueba.pedir('get', `/archivos/${randomUUID()}/url`, { token: await A.dueno.token() }),
      404,
      'no_encontrado',
    );
    await esperarError(
      prueba.pedir('get', `/archivos/${'no-es-un-id'}/url`, { token: await A.dueno.token() }),
      404,
      'no_encontrado',
    );

    const deA = await crearArchivoDePrueba(prueba.admin, { clinicaId: A.clinicaId });
    expect((await pedirUrl(A.dueno, deA.archivoId)).status).toBe(200);
    await comoSistema(
      prueba.admin,
      A.clinicaId,
      "update app.archivo set deleted_at = now(), motivo_baja = 'prueba' where id = $1",
      [deA.archivoId],
    );
    await esperarError(
      prueba.pedir('get', `/archivos/${deA.archivoId}/url`, { token: await A.dueno.token() }),
      404,
      'no_encontrado',
    );
  });

  it('el token de un archivo no sirve para otro archivo ni para otra clínica', async () => {
    const propio = await subida(A.dueno, 'logo_clinica', png(8, 8), 'propio.png');
    const otro = await subida(A.dueno, 'logo_clinica', png(9, 9), 'otro.png');
    const deB = await subida(B.dueno, 'logo_clinica', png(7, 7), 'de-b.png');
    const url = segun(urlArchivoSchema, (await pedirUrl(A.dueno, propio.id)).body).url;
    const token = new URL(url, 'http://x').searchParams.get('t') ?? '';
    const [parte, firma] = token.split('.') as [string, string];
    const contenido = JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;

    // Cambiar el archivo o la clínica rompe la firma.
    for (const cambio of [{ a: otro.id }, { a: deB.id, c: B.clinicaId }, { c: B.clinicaId }]) {
      const alterada = Buffer.from(JSON.stringify({ ...contenido, ...cambio })).toString(
        'base64url',
      );
      await esperarError(
        prueba.pedir('get', `/archivos/descarga?t=${alterada}.${firma}`),
        403,
        'sin_permiso',
      );
    }

    // Aun bien firmado (con el secreto): otra clínica con un usuario de A no pasa la membresía,
    // y un archivo de B con la clínica de A no existe para A.
    const vence = Math.floor(Date.now() / 1000) + 60;
    const conClinicaB = firmarToken(SECRETO_PRUEBA, {
      archivoId: deB.id,
      clinicaId: B.clinicaId,
      usuarioId: A.dueno.usuarioId,
      venceEn: vence,
    });
    await esperarError(
      prueba.pedir('get', `/archivos/descarga?t=${conClinicaB}`),
      403,
      'sin_membresia',
    );
    const conClinicaA = firmarToken(SECRETO_PRUEBA, {
      archivoId: deB.id,
      clinicaId: A.clinicaId,
      usuarioId: A.dueno.usuarioId,
      venceEn: vence,
    });
    await esperarError(
      prueba.pedir('get', `/archivos/descarga?t=${conClinicaA}`),
      404,
      'no_encontrado',
    );
  });
});

describe('descarga con la URL firmada', () => {
  let archivo: Archivo;
  let contenido: Buffer;

  beforeAll(async () => {
    contenido = png(16, 16);
    archivo = await subida(adminA, 'firma_profesional', contenido, 'firma "rara"‮;\r\nx.png');
  });

  it('dentro de los 5 minutos descarga, como adjunto y sin caché', async () => {
    const url = segun(urlArchivoSchema, (await pedirUrl(adminA, archivo.id)).body).url;
    const r = await descargar(url);
    expect(r.status).toBe(200);
    expect(Buffer.compare(r.body as Buffer, contenido)).toBe(0);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    const disposicion = r.headers['content-disposition'] as string;
    expect(disposicion).toMatch(/^attachment; filename="[A-Za-z0-9._ -]+"; filename\*=UTF-8''/);
    expect(disposicion).not.toMatch(/[\r\n]/);
    expect(archivo.nombreOriginal).not.toContain('‮');
  });

  it('cada descarga queda en auditoría (ver, medio descarga) con quien pidió la URL', async () => {
    const url = segun(urlArchivoSchema, (await pedirUrl(adminA, archivo.id)).body).url;
    const contar = async () => {
      const { rows } = await comoSistema<{ n: number; usuario: string | null; modulo: string }>(
        prueba.admin,
        A.clinicaId,
        `select count(*)::int as n, max(usuario_id::text) as usuario, max(modulo) as modulo
         from app.audit_log
         where entidad = 'archivo' and accion = 'ver' and entidad_id = $1
           and despues ->> 'medio' = 'descarga'`,
        [archivo.id],
      );
      return rows[0]!;
    };
    const antes = (await contar()).n;
    expect((await descargar(url)).status).toBe(200);
    expect((await descargar(url)).status).toBe(200);
    const despues = await contar();
    expect(despues.n).toBe(antes + 2);
    expect(despues.usuario).toBe(adminA.usuarioId);
    expect(despues.modulo).toBe('personal');
  });

  it('si le quitan el permiso (o la sede) después de pedir la URL, la URL ya no descarga', async () => {
    const C = await crearClinica(prueba, { sedes: 2 });
    const [sede1] = C.sedes.map((s) => s.sedeId) as [string, string];
    const { rolId } = await crearRolDePrueba(prueba.admin, {
      clinicaId: C.clinicaId,
      permisos: ['personal:ver'],
    });
    const creado = await crearUsuarioDePrueba(prueba.admin, {
      clinicaId: C.clinicaId,
      rolId,
      sedeIds: [sede1],
    });
    const token = await prueba.token({ sub: creado.usuarioId, email: creado.email });
    const enSede1 = await crearArchivoDePrueba(prueba.admin, {
      clinicaId: C.clinicaId,
      categoria: 'firma_profesional',
      sedeId: sede1,
    });
    await escribirEnDisco(directorio, enSede1);
    const urlDe = async () =>
      segun(
        urlArchivoSchema,
        (await prueba.pedir('get', `/archivos/${enSede1.archivoId}/url`, { token })).body,
      ).url;

    // Sin el permiso.
    const url = await urlDe();
    expect((await descargar(url)).status).toBe(200);
    await comoSistema(
      prueba.admin,
      C.clinicaId,
      'update app.rol_permiso set activo = false where rol_id = $1',
      [rolId],
    );
    await esperarError(prueba.pedir('get', rutaDe(url)), 403, 'sin_permiso');
    await comoSistema(
      prueba.admin,
      C.clinicaId,
      'update app.rol_permiso set activo = true where rol_id = $1',
      [rolId],
    );

    // Sin la sede.
    const otra = await urlDe();
    expect((await descargar(otra)).status).toBe(200);
    await comoSistema(
      prueba.admin,
      C.clinicaId,
      'update app.usuario_sede set activo = false where membresia_id = $1',
      [creado.membresiaId],
    );
    await esperarError(prueba.pedir('get', rutaDe(otra)), 403, 'sede_no_permitida');
  });

  it('vencido, alterado, de otro secreto, demasiado largo o ausente: rechazado', async () => {
    const base = {
      archivoId: archivo.id,
      clinicaId: A.clinicaId,
      usuarioId: adminA.usuarioId,
    };
    const ahora = Math.floor(Date.now() / 1000);
    const vencido = firmarToken(SECRETO_PRUEBA, { ...base, venceEn: ahora - 1 });
    const muyLejos = firmarToken(SECRETO_PRUEBA, { ...base, venceEn: ahora + 3600 });
    const otroSecreto = firmarToken('otro-secreto-de-pruebas-0123456789abcdef', {
      ...base,
      venceEn: ahora + 60,
    });
    const bueno = firmarToken(SECRETO_PRUEBA, { ...base, venceEn: ahora + 60 });
    const alterado = `${bueno.slice(0, -2)}${bueno.endsWith('AA') ? 'BB' : 'AA'}`;
    for (const t of [
      vencido,
      muyLejos,
      otroSecreto,
      alterado,
      'x',
      `${bueno}.x`,
      'a'.repeat(700),
    ]) {
      await esperarError(prueba.pedir('get', `/archivos/descarga?t=${t}`), 403, 'sin_permiso');
    }
    await esperarError(prueba.pedir('get', '/archivos/descarga'), 403, 'sin_permiso');
    // Y el bueno, armado igual, funciona: lo de arriba falla por lo que se cambió.
    expect((await prueba.pedir('get', `/archivos/descarga?t=${bueno}`)).status).toBe(200);
  });

  it('si quien pidió la URL ya no es miembro activo, no descarga', async () => {
    const persona = await crearPersona(prueba, A.clinicaId, { rol: 'administracion' });
    const url = segun(urlArchivoSchema, (await pedirUrl(persona, archivo.id)).body).url;
    await comoSistema(
      prueba.admin,
      A.clinicaId,
      "update app.membresia set estado = 'inactivo' where id = $1",
      [persona.membresiaId],
    );
    await esperarError(prueba.pedir('get', rutaDe(url)), 403, 'sin_membresia');
  });

  it('si el archivo falta en el almacén, 404', async () => {
    const sinArchivo = await crearArchivoDePrueba(prueba.admin, { clinicaId: A.clinicaId });
    const url = segun(urlArchivoSchema, (await pedirUrl(A.dueno, sinArchivo.archivoId)).body).url;
    await esperarError(prueba.pedir('get', rutaDe(url)), 404, 'no_encontrado');
  });
});

describe('contenido y formulario', () => {
  it('el tipo sale del contenido, no de lo que declara el navegador', async () => {
    const r = await subir(prueba, await A.dueno.token(), 'logo_clinica', webp(300, 100), {
      nombre: 'logo.png',
      tipoDeclarado: 'image/png',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ tipo: 'image/webp', ancho: 300, alto: 100 });

    // Un PDF o un texto que dicen ser PNG: tipo no permitido.
    for (const contenido of [PDF, Buffer.from('hola, no soy una imagen')]) {
      const e = await esperarError(
        subir(prueba, await A.dueno.token(), 'logo_clinica', contenido, {
          tipoDeclarado: 'image/png',
        }),
        415,
        'datos_invalidos',
      );
      expect((e.body as { mensaje: string }).mensaje).toContain('PNG, JPEG o WebP');
    }
    // Un PNG roto (sin IHDR).
    const roto = Buffer.concat([
      png(4, 4).subarray(0, 8),
      Buffer.from('basura de más de 25 bytes....'),
    ]);
    await esperarError(
      subir(prueba, await A.dueno.token(), 'logo_clinica', roto),
      400,
      'datos_invalidos',
    );
  });

  it('SVG: rechazado en todas las categorías, aun el más inofensivo, sin guardar nada', async () => {
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const svgs = [
      SVG_LIMPIO,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    ];
    for (const categoria of ['logo_clinica', 'firma_profesional']) {
      for (const contenido of svgs) {
        const e = await esperarError(
          subir(prueba, await A.dueno.token(), categoria, contenido, {
            nombre: 'logo.svg',
            tipoDeclarado: 'image/svg+xml',
          }),
          415,
          'datos_invalidos',
        );
        expect((e.body as { mensaje: string }).mensaje).toContain('PNG, JPEG o WebP');
      }
    }
    expect(await archivosEnDisco(directorio, A.clinicaId)).toEqual(antes);
  });

  it('más grande que el máximo de la categoría: 413 y no se guarda nada', async () => {
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const grande = png(10, 10, 2 * 1024 * 1024);
    const r = await esperarError(
      subir(prueba, await A.dueno.token(), 'logo_clinica', grande),
      413,
      'datos_invalidos',
    );
    expect((r.body as { mensaje: string }).mensaje).toContain('2 MB');
    expect(await archivosEnDisco(directorio, A.clinicaId)).toEqual(antes);
  });

  it('formulario mal armado: sin archivo, dos archivos, orden, campos de más, vacío, no multipart', async () => {
    const token = await A.dueno.token();
    await esperarError(subir(prueba, token, 'logo_clinica', null), 400, 'datos_invalidos');
    await esperarError(subir(prueba, token, null, png(4, 4)), 400, 'datos_invalidos');
    await esperarError(subir(prueba, token, 'no_existe', png(4, 4)), 400, 'datos_invalidos');
    await esperarError(
      subir(prueba, token, 'logo_clinica', Buffer.alloc(0)),
      400,
      'datos_invalidos',
    );
    await esperarError(
      subir(prueba, token, 'logo_clinica', png(4, 4)).attach('archivo', png(5, 5), 'otro.png'),
      400,
      'datos_invalidos',
    );
    // Archivo antes que la categoría.
    await esperarError(
      prueba
        .pedir('post', '/archivos', { token })
        .attach('archivo', png(4, 4), 'a.png')
        .field('categoria', 'logo_clinica'),
      400,
      'datos_invalidos',
    );
    await esperarError(
      subir(prueba, token, 'logo_clinica', png(4, 4)).field('sedeId', randomUUID()),
      400,
      'datos_invalidos',
    );
    await esperarError(
      prueba.pedir('post', '/archivos', { token, cuerpo: { categoria: 'logo_clinica' } }),
      400,
      'datos_invalidos',
    );
    // Sin sesión: 401 antes de leer nada.
    await esperarError(
      prueba
        .pedir('post', '/archivos')
        .field('categoria', 'logo_clinica')
        .attach('archivo', png(4, 4), 'a.png'),
      401,
      'no_autenticado',
    );
  });
});

describe('compensación, auditoría y cola', () => {
  it('si la base falla después de escribir el archivo, se borra y no queda trabajo', async () => {
    const antes = await archivosEnDisco(directorio, A.clinicaId);
    const trabajosAntes = (await trabajosDeClinica(prueba.admin, A.clinicaId)).length;
    // Falla provocada en la base, solo para esta clínica y este nombre.
    await prueba.admin.query(`
      create or replace function app.falla_de_prueba() returns trigger language plpgsql
        set search_path = pg_catalog, pg_temp as $$
      begin raise exception 'falla de prueba'; end $$;
      create trigger archivo_falla_de_prueba before insert on app.archivo for each row
        when (new.clinica_id = '${A.clinicaId}' and new.nombre_original = 'falla.png')
        execute function app.falla_de_prueba();`);
    try {
      await esperarError(
        subir(prueba, await A.dueno.token(), 'logo_clinica', png(6, 6), { nombre: 'falla.png' }),
        500,
        'error_interno',
      );
    } finally {
      await prueba.admin.query(`
        drop trigger archivo_falla_de_prueba on app.archivo;
        drop function app.falla_de_prueba();`);
    }
    expect(await archivosEnDisco(directorio, A.clinicaId)).toEqual(antes);
    expect(await trabajosDeClinica(prueba.admin, A.clinicaId)).toHaveLength(trabajosAntes);
  });

  it('la subida de una imagen encola archivo.verificar con app.encolar: solo los ids y la clínica del contexto', async () => {
    const archivo = await subida(A.dueno, 'logo_clinica', png(12, 12), 'logo.png');
    const trabajos = await trabajosDe(prueba.admin, archivo.id);
    expect(trabajos.map(({ state, data }) => ({ state, data }))).toEqual([
      { state: 'created', data: { clinicaId: A.clinicaId, archivoId: archivo.id } },
    ]);
    // La fila y el archivo en disco existen.
    expect(await archivosEnDisco(directorio, A.clinicaId)).toContain(archivo.id);
  });

  it('la URL registra ver en la auditoría con el módulo de la categoría', async () => {
    const firma = await subida(adminA, 'firma_profesional', png(3, 3));
    const logo = await subida(A.dueno, 'logo_clinica', png(3, 3), 'logo.png');
    await pedirUrl(adminA, firma.id);
    await pedirUrl(A.dueno, logo.id);
    const { rows } = await comoSistema<{ entidad_id: string; modulo: string; usuario_id: string }>(
      prueba.admin,
      A.clinicaId,
      `select entidad_id, modulo, usuario_id from app.audit_log
       where entidad = 'archivo' and accion = 'ver' and entidad_id = any($1::uuid[])
       order by modulo`,
      [[firma.id, logo.id]],
    );
    expect(rows).toEqual([
      { entidad_id: logo.id, modulo: 'configuracion', usuario_id: A.dueno.usuarioId },
      { entidad_id: firma.id, modulo: 'personal', usuario_id: adminA.usuarioId },
    ]);
    // Un pedido rechazado no deja `ver`.
    await pedirUrl(recepcionA, firma.id);
    const { rows: despues } = await comoSistema<{ n: number }>(
      prueba.admin,
      A.clinicaId,
      `select count(*)::int as n from app.audit_log
       where entidad = 'archivo' and accion = 'ver' and entidad_id = $1`,
      [firma.id],
    );
    expect(despues[0]?.n).toBe(1);
  });
});
