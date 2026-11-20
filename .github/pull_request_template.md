## Qué cambia

<!-- Sprint y objetivo, en dos o tres líneas. -->

## Cómo se verificó

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` en verde
- [ ] Migraciones aplicadas en el entorno de desarrollo
- [ ] Probado en el navegador (qué flujo)

## Datos y seguridad

- [ ] Toda tabla nueva tiene `clinica_id`, RLS forzado y auditoría
- [ ] Ningún endpoint nuevo responde sin chequear permiso (módulo + acción + sede)
- [ ] Nada clínico ni personal en logs

## Qué queda fuera o sin verificar
