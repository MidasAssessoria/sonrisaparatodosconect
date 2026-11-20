# Varias sedes

Selector «Todas las sedes / una sede» arriba, agenda filtrada por sede y página «Sedes» (gestión interna). Código de la maqueta: `gestion/sedes.js` (+ filtros en la agenda de `app.js`).

## Principio
**Una sola base para todas las sedes.** El paciente es uno: ficha, odontograma, anamnesis, presupuestos y saldo lo siguen en cualquier sede. Lo que es **por sede**: agenda (sillones), caja, punto de expedición SIFEN, horario, inventario.

## Tablas
**sede**: id, nombre, direccion, telefono, horario (ver agenda_config), sillones, estado (abierta / proxima / cerrada), color, punto_expedicion_sifen, timbrado_id.

**sede_profesional**: sede_id, doctor_id, dias_semana[], hora_inicio, hora_fin. Un profesional puede atender en varias sedes en días distintos (ej. Dr. Rojas: lun/mié/vie Centro, mar/jue San Lorenzo).

**sillon**: id, sede_id, nombre.

**Campo `sede_id` en**: turno, pago/cobro, caja (apertura/cierre), factura (por el punto de expedición), movimiento de inventario, usuario (sede por defecto).

## Reglas
1. El selector de sede filtra agenda, caja, inventario y reportes; «Todas» muestra el consolidado. Recepción entra con su sede por defecto.
2. Turno nuevo guarda la sede activa; si está en «Todas», la sede sale de dónde atiende el profesional ese día.
3. Disponibilidad (agenda y reserva online) = horario de la sede ∩ días del profesional en esa sede ∩ sillones libres.
4. Cada sede tiene su caja: apertura, cierre y arqueo por separado. La factura usa el punto de expedición SIFEN de la sede.
5. Permisos: usuario puede ver una sede, varias o todas (dueño/administración).
6. Sede «próxima apertura» no muestra horarios ni recibe turnos hasta que se abre.

## Conecta con
Agenda, reserva online (el paciente elige sede en el paso 1), caja, facturación SIFEN, inventario, reportes (por sede y consolidado), usuarios/permisos.
