import { Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Archivo, UrlArchivo } from '@conecta/shared';
import type { Request, Response } from 'express';
import { ipDe } from '../comun/pedido.js';
import { PermisoDeArchivo, Publica } from '../contexto/acceso.js';
import { AccesoArchivo, type AccesoPorCategoria } from '../contexto/acceso-archivo.js';
import { IdDeRuta } from '../errores/validacion.js';
import { ArchivosService } from './archivos.service.js';
import { disposicionAdjunto } from './contenido.js';

@Controller('archivos')
export class ArchivosController {
  constructor(private readonly archivos: ArchivosService) {}

  /** `multipart/form-data`: `categoria` y después `archivo`. Permiso `<modulo>:crear`. */
  @Post()
  @HttpCode(201)
  @PermisoDeArchivo()
  subir(@AccesoArchivo() acceso: AccesoPorCategoria, @Req() req: Request): Promise<Archivo> {
    return this.archivos.subir(acceso, req);
  }

  /**
   * Descarga del almacén local con la URL firmada (`?t=`). Pública: la autorización viaja en el
   * token, que vence en 5 minutos. Siempre como adjunto; nunca en línea (tampoco un SVG).
   */
  @Get('descarga')
  @Publica()
  async descargar(
    @Query('t') token: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const descarga = await this.archivos.descargar(token, ipDe(req));
    res.status(200);
    res.setHeader('Content-Type', descarga.tipo);
    res.setHeader('Content-Length', String(descarga.contenido.length));
    res.setHeader('Content-Disposition', disposicionAdjunto(descarga.nombre));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end(descarga.contenido);
  }

  /** URL firmada (vence en 5 minutos). Permiso `<modulo>:ver` y sede; queda `ver` en auditoría. */
  @Get(':id/url')
  @PermisoDeArchivo()
  url(
    @AccesoArchivo() acceso: AccesoPorCategoria,
    @Param('id', IdDeRuta) id: string,
  ): Promise<UrlArchivo> {
    return this.archivos.url(acceso, id);
  }
}
