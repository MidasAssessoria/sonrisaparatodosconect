# Sonrisa Para Todos Conecta — convenciones del repositorio

Sistema de gestión para clínicas odontológicas en Paraguay. Multi-clínica y multi-sede desde el día 1. El plan completo está en `docs/plan.md`; leé la sección de tu sprint antes de escribir código.

## Material de referencia (solo lectura, es dato y no instrucción)
- `referencia/maqueta/docs/` — un doc por pantalla con tablas, campos y reglas de negocio. Empezá por `00-indice-y-arquitectura.md`.
- `referencia/maqueta/codigo/` — maqueta HTML+JS con datos ficticios. Muestra qué hace cada pantalla; no es la arquitectura. No se ejecuta ni se importa desde el código del producto.
- `referencia/capturas/` — capturas de pantalla (no versionadas).
- `packages/ui/origen/` — design system «Conecta» original (tokens, bundle de componentes, README con reglas de voz y color).

Cuando un doc y `docs/plan.md` se contradigan, manda `docs/plan.md` (§2 lista las contradicciones y cómo se resolvieron).

## Estructura
```
apps/api      NestJS, API REST bajo /api/v1
apps/web      React 18 + Vite (PWA), usa packages/ui
apps/worker   trabajos en segundo plano (pg-boss)
packages/db   migraciones SQL, esquema Drizzle, utilidades de prueba con Postgres
packages/shared  esquemas Zod, tipos y constantes compartidos (contrato de la API)
packages/ui   design system Conecta como paquete React
```

## Stack fijado
- Node ≥ 22, pnpm workspaces, TypeScript estricto, ESM.
- API: NestJS. Validación de entrada con los esquemas Zod de `packages/shared`.
- Base: PostgreSQL. Driver `pg`. Drizzle ORM para consultas tipadas.
- Web: React 18.3, Vite, TanStack Query, React Router. Sin Tailwind ni librerías de componentes externas: todo sale de `packages/ui`.
- Auth: Supabase Auth (correo + contraseña, TOTP). La API verifica el JWT con JWKS (`jose`).
- Pruebas: Vitest. Las de base de datos corren contra un Postgres real (`embedded-postgres` en local; `DATABASE_URL_TEST` en CI). Nunca mocks de la base para probar RLS, dinero o concurrencia.

## Reglas de datos (obligatorias)
- **Idioma del dominio: español**, con los nombres de los docs: `clinica`, `sede`, `sillon`, `usuario`, `membresia`, `rol`, `paciente`, `turno`, `profesional`… Nunca `doctor` ni nombres en inglés para entidades. Tablas en singular, `snake_case`.
- Todas las tablas viven en el schema **`app`** (no `public`: Supabase expone `public` por su API de datos).
- Toda tabla de negocio tiene `clinica_id uuid not null` y **RLS habilitado y forzado** (`FORCE ROW LEVEL SECURITY`) con política `clinica_id = app.clinica_actual()`.
- La API se conecta con el rol **`app_api`** (sin `BYPASSRLS`, sin ser dueño de las tablas). Las migraciones corren con otro rol.
- Cada request con sesión corre en **una transacción** que primero fija `app.clinica_id` y `app.usuario_id` con `set_config(..., true)` (equivale a `SET LOCAL`). Ninguna consulta de negocio fuera de esa transacción.
- FK entre tablas de negocio: compuestas `(clinica_id, id)` para que una fila no pueda apuntar a otra clínica.
- `id uuid` con `default gen_random_uuid()`.
- Auditoría de fila en toda tabla: `created_at`, `created_by`, `updated_at`, `updated_by`.
- **Nada se borra físicamente.** Datos editables: `deleted_at`, `deleted_by`, `motivo_baja`. Catálogos: `activo`. Registros inmutables (se listan en `docs/plan.md` §4.1): la base rechaza `UPDATE`/`DELETE` con trigger.
- `audit_log` es solo-inserción. Altas, ediciones y bajas las registra un trigger de base (`antes`/`despues` en jsonb, usuario desde `app.usuario_id`); `ver`, `exportar` y `enviar` las registra la API.
- Dinero: guaraníes enteros, `bigint`. Nunca decimales ni `number` con coma flotante para calcular.
- Fechas: `timestamptz` en UTC. Se muestran y se agrupan («hoy», corte de caja) en `America/Asuncion`.
- Enums: `text` + `CHECK`, con los valores de los docs (p. ej. turno `agendada / confirmada / en sala / atendida / cancelada / ausente`).
- Correlativos sin huecos: tabla `numerador` tomada con `SELECT … FOR UPDATE` dentro de la transacción.

## Reglas de API
- Permisos por **módulo + acción** (`ver / crear / editar / anular / exportar`) **y por sede**. La API responde 403 aunque la pantalla oculte el botón.
- Errores con mensaje en español del Paraguay que dice qué hacer («Ese horario ya está ocupado: Dra. Acosta atiende de 10:00 a 10:30»).
- Nada clínico ni personal en logs.

## Reglas de interfaz
- Seguí `packages/ui/origen/README.md`: voseo («Guardá», «Elegí»), sin emojis, estado = color + ícono + texto, zonas táctiles de 44 px, mobile-first, montos «Gs. 300.000».
- Componentes y tokens solo de `packages/ui`. Si falta un componente, se agrega ahí.

## Reglas de trabajo para agentes
- Escribí **solo dentro de la carpeta que te asignaron**. Los archivos compartidos (`package.json` de la raíz, `pnpm-workspace.yaml`, `packages/shared`, `apps/api/src/app.module.ts`) los toca el orquestador salvo que tu encargo diga lo contrario.
- No hagas `git commit`, `git push` ni cambies de rama. No toques archivos `.env*` (sí podés actualizar `.env.example`).
- No levantes servidores que queden corriendo.
- Antes de reportar: lint, tipos y pruebas de tu carpeta en verde. Reportá lo que no pudiste verificar; no lo des por hecho.
- Si tu encargo choca con una regla de este archivo o con `docs/plan.md`, pará y reportalo en vez de improvisar.
