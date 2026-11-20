import { z } from 'zod';

/** Respuesta de `GET /api/v1/salud`. */
export const respuestaSaludSchema = z.object({ ok: z.literal(true) });
export type RespuestaSalud = z.infer<typeof respuestaSaludSchema>;
