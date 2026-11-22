/**
 * Almacén de Supabase contra un FALSO de la API REST de Storage (servidor HTTP local). Verifica lo
 * que manda la API (rutas, cabeceras con la clave, sin upsert, vencimiento de la firma, download) y
 * cómo reacciona (503 sin clave o con Storage caído, compensación).
 *
 * Queda sin verificar contra un Supabase real: que el bucket exista y sea privado, el formato real
 * de `signedURL`, la clave nueva `sb_secret_…` en `apikey`/`Authorization`, que `download` fuerce el
 * adjunto y que la URL deje de servir al vencer.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { archivoSchema, urlArchivoSchema } from '@conecta/shared';
import { crearArchivoDePrueba } from '@conecta/db/pruebas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  comoSistema,
  crearClinica,
  crearPrueba,
  esperarError,
  segun,
  type Clinica,
  type Prueba,
} from './ayudas.js';
import { BUCKET_PRUEBA, png, SECRETO_PRUEBA, subir, trabajosDeClinica } from './archivos-ayudas.js';

const CLAVE = `sb_secret_${'k'.repeat(40)}`;

interface Pedido {
  metodo: string;
  ruta: string;
  cabeceras: IncomingMessage['headers'];
  cuerpo: Buffer;
}

class StorageFalso {
  readonly pedidos: Pedido[] = [];
  readonly objetos = new Map<string, { contenido: Buffer; tipo: string }>();
  fallarSubidas = false;
  private servidor: Server | undefined;
  url = '';

  async iniciar(): Promise<void> {
    this.servidor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (t: Buffer) => partes.push(t));
      req.on('end', () => {
        const cuerpo = Buffer.concat(partes);
        const ruta = decodeURIComponent((req.url ?? '').split('?')[0] ?? '');
        this.pedidos.push({ metodo: req.method ?? '', ruta, cabeceras: req.headers, cuerpo });
        const json = (estado: number, valor: unknown) => {
          res.writeHead(estado, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(valor));
        };
        if (req.headers.apikey !== CLAVE || req.headers.authorization !== `Bearer ${CLAVE}`) {
          return json(403, { message: 'sin clave' });
        }
        const prefijo = '/storage/v1/object/';
        if (!ruta.startsWith(prefijo)) return json(404, {});
        const resto = ruta.slice(prefijo.length);
        if (req.method === 'POST' && resto.startsWith('sign/')) {
          const clave = resto.slice('sign/'.length);
          if (!this.objetos.has(clave)) return json(404, {});
          return json(200, { signedURL: `/object/sign/${clave}?token=firmado-${randomUUID()}` });
        }
        if (req.method === 'GET' && resto.startsWith('authenticated/')) {
          const objeto = this.objetos.get(resto.slice('authenticated/'.length));
          if (!objeto) return json(404, {});
          res.writeHead(200, { 'Content-Type': objeto.tipo });
          return res.end(objeto.contenido);
        }
        if (req.method === 'POST') {
          if (this.fallarSubidas) return json(500, { message: 'caído' });
          if (this.objetos.has(resto)) return json(409, { message: 'existe' });
          this.objetos.set(resto, { contenido: cuerpo, tipo: req.headers['content-type'] ?? '' });
          return json(200, { Key: resto });
        }
        if (req.method === 'DELETE') {
          const { prefixes } = JSON.parse(cuerpo.toString('utf8')) as { prefixes: string[] };
          for (const p of prefixes) this.objetos.delete(`${resto}/${p}`);
          return json(200, []);
        }
        return json(404, {});
      });
    });
    await new Promise<void>((listo) => this.servidor?.listen(0, '127.0.0.1', listo));
    this.url = `http://127.0.0.1:${String((this.servidor?.address() as AddressInfo).port)}`;
  }

  cerrar(): Promise<void> {
    return new Promise((listo) => this.servidor?.close(() => listo()) ?? listo());
  }
}

const storage = new StorageFalso();
let prueba: Prueba;
let sinClave: Prueba;
let A: Clinica;

function archivosConfig(): Prueba['config']['archivos'] {
  return {
    almacen: 'supabase',
    directorio: '../../.no-se-usa',
    bucket: BUCKET_PRUEBA,
    secretoFirma: SECRETO_PRUEBA,
  };
}

beforeAll(async () => {
  await storage.iniciar();
  prueba = await crearPrueba({
    config: { archivos: archivosConfig(), supabaseUrl: storage.url, supabaseSecretKey: CLAVE },
  });
  sinClave = await crearPrueba({
    config: { archivos: archivosConfig(), supabaseUrl: storage.url, supabaseSecretKey: undefined },
  });
  A = await crearClinica(prueba, { sedes: 1 });
});

afterAll(async () => {
  await prueba.cerrar();
  await sinClave.cerrar();
  await storage.cerrar();
});

async function cantidadArchivos(clinicaId: string): Promise<number> {
  const { rows } = await comoSistema<{ n: number }>(
    prueba.admin,
    clinicaId,
    'select count(*)::int as n from app.archivo',
  );
  return rows[0]?.n ?? 0;
}

describe('almacén supabase (falso)', () => {
  it('sube al bucket privado en <clinica>/<id>, con la clave y sin pisar nada', async () => {
    const contenido = png(10, 10);
    const r = await subir(prueba, await A.dueno.token(), 'logo_clinica', contenido, {
      nombre: 'logo.png',
    });
    expect(r.status).toBe(201);
    const archivo = segun(archivoSchema, r.body);
    const clave = `${BUCKET_PRUEBA}/${A.clinicaId}/${archivo.id}`;
    expect(
      Buffer.compare(storage.objetos.get(clave)?.contenido ?? Buffer.alloc(0), contenido),
    ).toBe(0);
    const subida = storage.pedidos.find((p) => p.metodo === 'POST' && p.ruta.endsWith(archivo.id));
    expect(subida?.cabeceras).toMatchObject({ 'content-type': 'image/png', 'x-upsert': 'false' });
    expect(JSON.stringify(r.body)).not.toContain(CLAVE);
    const { rows } = await comoSistema<{ almacen: string; bucket: string; ruta: string }>(
      prueba.admin,
      A.clinicaId,
      'select almacen, bucket, ruta from app.archivo where id = $1',
      [archivo.id],
    );
    expect(rows[0]).toEqual({
      almacen: 'supabase',
      bucket: BUCKET_PRUEBA,
      ruta: `${A.clinicaId}/${archivo.id}`,
    });
  });

  it('la URL es la firmada por Storage, vence en 5 minutos como máximo y descarga como adjunto', async () => {
    const r = await subir(prueba, await A.dueno.token(), 'logo_clinica', png(4, 4), {
      nombre: 'Logo Clínica.png',
    });
    const archivo = segun(archivoSchema, r.body);
    const respuesta = await prueba.pedir('get', `/archivos/${archivo.id}/url`, {
      token: await A.dueno.token(),
    });
    const url = segun(urlArchivoSchema, respuesta.body);
    expect(url.url).toMatch(
      new RegExp(
        `^${storage.url}/storage/v1/object/sign/${BUCKET_PRUEBA}/${A.clinicaId}/${archivo.id}\\?token=firmado-[0-9a-f-]+&download=Logo%20Cl%C3%ADnica\\.png$`,
      ),
    );
    const firma = storage.pedidos.filter((p) => p.ruta.includes('/object/sign/')).at(-1);
    const { expiresIn } = JSON.parse(firma?.cuerpo.toString('utf8') ?? '{}') as {
      expiresIn: number;
    };
    expect(expiresIn).toBeGreaterThanOrEqual(290);
    expect(expiresIn).toBeLessThanOrEqual(300);
    expect(new Date(url.venceEn).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    // La descarga propia de la API no existe con este almacén.
    await esperarError(prueba.pedir('get', '/archivos/descarga?t=x.y'), 404, 'no_encontrado');
  });

  it('Storage caído al subir: 503, sin fila ni trabajo', async () => {
    const antes = await cantidadArchivos(A.clinicaId);
    const trabajos = (await trabajosDeClinica(prueba.admin, A.clinicaId)).length;
    storage.fallarSubidas = true;
    try {
      await esperarError(
        subir(prueba, await A.dueno.token(), 'logo_clinica', png(4, 4)),
        503,
        'servicio_no_disponible',
      );
    } finally {
      storage.fallarSubidas = false;
    }
    expect(await cantidadArchivos(A.clinicaId)).toBe(antes);
    expect(await trabajosDeClinica(prueba.admin, A.clinicaId)).toHaveLength(trabajos);
  });

  it('si la base falla después de subir, se borra el objeto de Storage', async () => {
    const objetosAntes = new Set(storage.objetos.keys());
    await prueba.admin.query(`
      create or replace function app.falla_de_prueba_sb() returns trigger language plpgsql
        set search_path = pg_catalog, pg_temp as $$
      begin raise exception 'falla de prueba'; end $$;
      create trigger archivo_falla_de_prueba_sb before insert on app.archivo for each row
        when (new.clinica_id = '${A.clinicaId}' and new.nombre_original = 'falla.png')
        execute function app.falla_de_prueba_sb();`);
    try {
      await esperarError(
        subir(prueba, await A.dueno.token(), 'logo_clinica', png(4, 4), { nombre: 'falla.png' }),
        500,
        'error_interno',
      );
    } finally {
      await prueba.admin.query(`
        drop trigger archivo_falla_de_prueba_sb on app.archivo;
        drop function app.falla_de_prueba_sb();`);
    }
    expect(new Set(storage.objetos.keys())).toEqual(objetosAntes);
    const borrado = storage.pedidos.filter((p) => p.metodo === 'DELETE').at(-1);
    expect(borrado?.ruta).toBe(`/storage/v1/object/${BUCKET_PRUEBA}`);
    expect(JSON.parse(borrado?.cuerpo.toString('utf8') ?? '{}')).toEqual({
      prefixes: [expect.stringMatching(new RegExp(`^${A.clinicaId}/[0-9a-f-]{36}$`))],
    });
  });

  it('un archivo guardado en otro almacén: 503 (no se firma nada)', async () => {
    const local = await crearArchivoDePrueba(prueba.admin, { clinicaId: A.clinicaId });
    await esperarError(
      prueba.pedir('get', `/archivos/${local.archivoId}/url`, { token: await A.dueno.token() }),
      503,
      'servicio_no_disponible',
    );
  });

  it('sin clave secreta: 503 al subir y al pedir la URL, sin hablar con Storage', async () => {
    const pedidosAntes = storage.pedidos.length;
    const B = await crearClinica(sinClave, { sedes: 1 });
    await esperarError(
      subir(sinClave, await B.dueno.token(), 'logo_clinica', png(4, 4)),
      503,
      'servicio_no_disponible',
    );
    const { rows } = await comoSistema<{ id: string }>(
      sinClave.admin,
      B.clinicaId,
      `insert into app.archivo (clinica_id, categoria, almacen, bucket, ruta, nombre_original, tipo,
                                bytes, sha256)
       values ($1::uuid, 'logo_clinica', 'supabase', $2, $1::text || '/' || gen_random_uuid(), 'x.png',
               'image/png', 10, repeat('a', 64)) returning id`,
      [B.clinicaId, BUCKET_PRUEBA],
    );
    await esperarError(
      sinClave.pedir('get', `/archivos/${rows[0]!.id}/url`, { token: await B.dueno.token() }),
      503,
      'servicio_no_disponible',
    );
    expect(storage.pedidos.length).toBe(pedidosAntes);
    expect(await cantidadArchivos(B.clinicaId)).toBe(1);
  });
});
