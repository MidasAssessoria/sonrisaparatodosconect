import {
  aceptarInvitacionSchema,
  bajaSchema,
  consultarInvitacionSchema,
  crearBloqueoSchema,
  crearInvitacionSchema,
  crearProfesionalSchema,
  crearRolSchema,
  crearSedeSchema,
  crearSillonSchema,
  crearTratamientoSchema,
  editarPersonaSchema,
  editarProfesionalSchema,
  editarRolSchema,
  editarSedeSchema,
  editarSillonSchema,
  editarTratamientoSchema,
  guardarAgendaConfigSchema,
  reemplazarDisponibilidadSchema,
  reemplazarHorariosSchema,
  subirArchivoCamposSchema,
  type Sesion,
} from '@conecta/shared';
import { z } from 'zod';

/*
 * Qué cuerpo acepta cada ruta del contrato (`RUTAS_API`). El `fetch` falso de las pruebas valida
 * cada pedido contra esta tabla: un cuerpo que la API real rechazaría hace fallar la prueba en vez
 * de pasar callado. Una ruta nueva en el contrato sin fila acá también hace fallar
 * (`fabricas.test.ts`).
 *
 * `null` = el pedido no lleva cuerpo. `multipart` = `POST /archivos`.
 */
export type EntradaRuta = z.ZodType | null | 'multipart';

export const ENTRADA_POR_RUTA: Record<string, EntradaRuta> = {
  'GET /salud': null,
  'GET /sesion': null,
  'POST /sesion/cerrar': null,
  'DELETE /sesion/mfa': null,
  'GET /sedes': null,
  'POST /sedes': crearSedeSchema,
  'GET /sedes/:id': null,
  'PATCH /sedes/:id': editarSedeSchema,
  'DELETE /sedes/:id': bajaSchema,
  'PUT /sedes/:id/horarios': reemplazarHorariosSchema,
  'POST /sedes/:id/sillones': crearSillonSchema,
  'PATCH /sillones/:id': editarSillonSchema,
  'GET /auditoria': null,

  'GET /personal': null,
  'PATCH /personal/:id': editarPersonaSchema,
  'POST /personal/:id/desactivar': bajaSchema,
  'POST /personal/:id/reactivar': null,
  'POST /invitaciones': crearInvitacionSchema,
  'POST /invitaciones/:id/reenviar': null,
  'DELETE /invitaciones/:id': bajaSchema,
  'POST /invitaciones/consultar': consultarInvitacionSchema,
  'POST /invitaciones/aceptar': aceptarInvitacionSchema,

  'GET /roles': null,
  'POST /roles': crearRolSchema,
  'PATCH /roles/:id': editarRolSchema,
  'DELETE /roles/:id': bajaSchema,

  'GET /profesionales': null,
  'POST /profesionales': crearProfesionalSchema,
  'GET /profesionales/:id': null,
  'PATCH /profesionales/:id': editarProfesionalSchema,
  'PUT /profesionales/:id/disponibilidad': reemplazarDisponibilidadSchema,
  'POST /profesionales/:id/bloqueos': crearBloqueoSchema,
  'DELETE /bloqueos/:id': bajaSchema,

  'GET /tratamientos': null,
  'POST /tratamientos': crearTratamientoSchema,
  'PATCH /tratamientos/:id': editarTratamientoSchema,
  'GET /sedes/:id/agenda': null,
  'PUT /sedes/:id/agenda': guardarAgendaConfigSchema,

  'POST /archivos': 'multipart',
  'GET /archivos/:id/url': null,
  'GET /archivos/descarga': null,
};

/** Rutas públicas que igual exigen `Authorization` (contrato/personal.ts). */
const EXIGEN_TOKEN = new Set(['POST /invitaciones/aceptar']);

const patrones = Object.keys(ENTRADA_POR_RUTA)
  .map((patron) => ({
    patron,
    re: new RegExp(`^${patron.replace(/:[a-zA-Z]+/g, '[^/]+')}$`),
    parametros: (patron.match(/:/g) ?? []).length,
  }))
  // Lo literal antes que lo parametrizado: `/invitaciones/consultar` no es `/invitaciones/:id`.
  .sort((a, b) => a.parametros - b.parametros);

/** «POST /personal/123/desactivar» → «POST /personal/:id/desactivar», o `null` si no es del contrato. */
export function rutaDelContrato(clave: string): string | null {
  return patrones.find((p) => p.re.test(clave))?.patron ?? null;
}

function textoIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(cuerpo)'}: ${i.message}`).join('; ');
}

/** Claves del cuerpo que el esquema no conoce (la API las descartaría: es un error de la web). */
function clavesDesconocidas(esquema: z.ZodType, cuerpo: unknown): string[] {
  if (!(esquema instanceof z.ZodObject) || typeof cuerpo !== 'object' || cuerpo === null) return [];
  const conocidas = new Set(Object.keys(esquema.shape));
  return Object.keys(cuerpo).filter((k) => !conocidas.has(k));
}

/**
 * Sedes que manda el pedido y que quien pide no ve: la API las rechaza (`sede_no_permitida`).
 * Se mira con la última sesión que respondió el `fetch` falso.
 */
function sedesAjenas(cuerpo: unknown, sesion: Sesion | null): string[] {
  if (!sesion || typeof cuerpo !== 'object' || cuerpo === null) return [];
  const visibles = new Set(sesion.sedes.map((s) => s.id));
  const c = cuerpo as { sedeIds?: unknown; sedeDefectoId?: unknown };
  const lista: unknown[] = Array.isArray(c.sedeIds) ? (c.sedeIds as unknown[]) : [];
  const pedidas = [...lista, c.sedeDefectoId].filter((s): s is string => typeof s === 'string');
  return [...new Set(pedidas.filter((s) => !visibles.has(s)))];
}

/**
 * Problemas de un pedido frente al contrato, o lista vacía si cumple. `cuerpo` es el JSON ya
 * leído o el `FormData` tal cual.
 */
export function problemasDelPedido(pedido: {
  clave: string;
  cuerpo: unknown;
  cabeceras: Headers;
  sesion: Sesion | null;
}): string[] {
  const ruta = rutaDelContrato(pedido.clave);
  if (!ruta) return [`${pedido.clave} no está en el contrato (RUTAS_API)`];
  const entrada = ENTRADA_POR_RUTA[ruta] ?? null;
  const problemas: string[] = [];

  if (EXIGEN_TOKEN.has(ruta) && !pedido.cabeceras.get('authorization')) {
    problemas.push(`${ruta} exige Authorization`);
  }

  if (entrada === null) {
    if (pedido.cuerpo !== undefined) problemas.push(`${ruta} no lleva cuerpo`);
    return problemas;
  }

  if (entrada === 'multipart') {
    if (!(pedido.cuerpo instanceof FormData)) {
      problemas.push(`${ruta} va como multipart/form-data`);
      return problemas;
    }
    if (pedido.cabeceras.has('content-type')) {
      problemas.push(`${ruta}: el Content-Type lo pone el navegador (con el boundary)`);
    }
    const campos = [...pedido.cuerpo.keys()];
    if (campos.join(',') !== 'categoria,archivo') {
      problemas.push(
        `${ruta}: los campos van en orden categoria, archivo (llegó ${campos.join(', ')})`,
      );
    }
    const r = subirArchivoCamposSchema.safeParse({ categoria: pedido.cuerpo.get('categoria') });
    if (!r.success) problemas.push(`${ruta}: ${textoIssues(r.error)}`);
    if (!(pedido.cuerpo.get('archivo') instanceof Blob))
      problemas.push(`${ruta}: falta el archivo`);
    return problemas;
  }

  if (pedido.cuerpo === undefined) {
    problemas.push(`${ruta} necesita cuerpo`);
    return problemas;
  }
  const r = entrada.safeParse(pedido.cuerpo);
  if (!r.success) problemas.push(`${ruta}: ${textoIssues(r.error)}`);
  const sobran = clavesDesconocidas(entrada, pedido.cuerpo);
  if (sobran.length)
    problemas.push(`${ruta}: campos que el contrato no tiene: ${sobran.join(', ')}`);
  const ajenas = sedesAjenas(pedido.cuerpo, pedido.sesion);
  if (ajenas.length) {
    problemas.push(
      `${ruta}: sedes que quien pide no ve (la API responde 403): ${ajenas.join(', ')}`,
    );
  }
  return problemas;
}
