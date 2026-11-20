import type { NestApplicationOptions } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { CONFIG, type Config } from './config.js';
import { limitePedidos } from './comun/limite-pedidos.js';
import { asignarIdPedido } from './comun/pedido.js';
import { REGISTRO, type Registro } from './comun/registro.js';
import { errores } from './errores/error-api.js';
import { FiltroErrores, manejadorErroresExpress } from './errores/filtro-errores.js';

export const PREFIJO_API = 'api/v1';

/** Tamaño máximo del cuerpo JSON. Nada del Sprint 1 se acerca. */
export const LIMITE_CUERPO = '64kb';

/**
 * Opciones para `NestFactory.create` y `createNestApplication`: el parser del cuerpo lo registra
 * `configurarApp` (solo JSON, con límite y con errores en el formato del contrato).
 */
export const OPCIONES_APP: NestApplicationOptions = { bodyParser: false };

const CABECERAS_PERMITIDAS = ['Authorization', 'Content-Type', 'X-Clinica-Id', 'X-Request-Id'];

/**
 * Registro de acceso: método, ruta como patrón (`/api/v1/sedes/:id`, nunca la URL real con su
 * consulta), estado y duración. Sin usuario, correo, cuerpo ni cabeceras.
 */
function registroDeAcceso(registro: Registro) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = asignarIdPedido(req);
    res.setHeader('X-Request-Id', id);
    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      const patron = (req.route as { path?: unknown } | undefined)?.path;
      // Sin ruta propia (404, o el comodín del manejador de «no encontrado» de Nest).
      const conocida = typeof patron === 'string' && !patron.includes('*');
      registro.info('pedido', {
        pedido: id,
        metodo: req.method,
        ruta: conocida ? `${req.baseUrl}${patron}` : '(sin ruta)',
        estado: res.statusCode,
        ms: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
      });
    });
    next();
  };
}

/** Respuestas con datos de salud: que nadie las guarde en caché. */
function sinCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Todo lo que no está bajo `/api/v1` es 404 con la forma del contrato (no la página de Express). */
function fueraDelPrefijo(req: Request, res: Response, next: NextFunction): void {
  if (req.path === `/${PREFIJO_API}` || req.path.startsWith(`/${PREFIJO_API}/`)) {
    next();
    return;
  }
  res
    .status(404)
    .json(errores.noEncontrado('Esa dirección no existe en la API. Revisá la ruta.').cuerpo());
}

/** Configuración común a `main.ts` y a las pruebas. Crear la app con `OPCIONES_APP`. */
export function configurarApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<Config>(CONFIG);
  const registro = app.get<Registro>(REGISTRO);

  // X-Forwarded-For solo se cree si TRUST_PROXY lo habilita.
  app.set('trust proxy', config.trustProxy);
  app.use(registroDeAcceso(registro));
  app.use(helmet());
  app.use(sinCache);
  app.enableCors({
    origin: config.webOrigenes,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: CABECERAS_PERMITIDAS,
    // Retry-After: la web (en otro origen) lo lee para saber cuándo reintentar tras un 429.
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    credentials: false,
    maxAge: 600,
  });
  app.use(
    limitePedidos({
      porMinuto: config.limitePedidosPorMinuto,
      excluir: (req) => req.path === `/${PREFIJO_API}/salud`,
    }),
  );
  app.use(fueraDelPrefijo);
  app.useBodyParser('json', { limit: LIMITE_CUERPO, strict: true });
  app.use(manejadorErroresExpress(registro));

  app.setGlobalPrefix(PREFIJO_API);
  app.useGlobalFilters(new FiltroErrores(registro));
  app.enableShutdownHooks();
  return app;
}
