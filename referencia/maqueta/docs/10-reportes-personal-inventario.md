# Reportes, personal e inventario

Pantallas: «Reportes», «Personal» e «Inventario» (las dos últimas bajo «Gestión interna»). Código de la maqueta: `gestion/app2.js` (VIEWS.reportes, VIEWS.personal, VIEWS.inventario y acciones `rep-*`, `stf-*`, `inv-*`).

## Qué hace
**Reportes**
- Rango de fechas (Desde / Hasta) con atajos *Hoy, Últimos 7 días, Este mes, Últimos 30 días*.
- Tarjetas: ingresos del período, cobros registrados y cobro promedio.
- **Producción por profesional** (barras), **tratamientos más realizados** (los 6 primeros, con cantidad e importe) e **ingresos por forma de pago** (gráfico de anillo con porcentajes).

**Personal**
- Una tarjeta por persona: nombre, rol, sede, horario, asignación (ej. «Apoya sillón 1 y 2»), interruptor de **activo** y estado (*Activo / Inactivo / Pendiente de activar*). Cabecera con el número de personas activas.
- **Invitar usuario**: nombre y rol (Odontólogo/a, Asistente dental, Recepción y caja, Administración) → queda «Pendiente de activar» con invitación enviada.

**Inventario**
- Tabla de insumos: nombre, categoría, **nivel** (cantidad, unidad, barra y mínimo), proveedor y vencimiento. Aviso de reposición arriba y también en Inicio (01).
- Botones **Entrada** (cantidad recibida) y **−1** (salida).

## Tablas
**usuario**: id, clinica_id, nombre, email, telefono, rol_id, sede_defecto_id, activo, ultimo_acceso, mfa_activo, created_*.
**rol** y **rol_permiso**: rol_id, modulo, acción (ver / crear / editar / anular / exportar). Roles de la maqueta en 00.
**invitacion**: id, email, rol_id, token (guardar solo el hash), vence_en, aceptada_en, invitada_por.
**usuario_sede**: usuario_id, sede_id (08). **profesional** y su disponibilidad: ver 01 y 06; el horario de texto libre de la maqueta («Lun a vie · 08:00 a 16:00») pasa a filas por día y hora.

**insumo**
| campo | nota |
|---|---|
| id, clinica_id, nombre, categoria | Descartables, Restauración, Anestesia, Endodoncia, Instrumental |
| unidad | cajas, jeringas, unidades, frascos, sets |
| stock_minimo | punto de reposición |
| proveedor_id | |
| sede_id | el stock es por sede (08); la maqueta no lo separa |
| activo | |

**lote_insumo**: insumo_id, lote, vencimiento, cantidad_inicial.
**movimiento_insumo**: id, insumo_id, lote_id, sede_id, tipo (entrada / salida / ajuste), cantidad, motivo, turno_id (opcional), costo_unitario (opcional), usuario_id, fecha. **El stock es la suma de movimientos**, no un campo que se pisa.

Reportes no tienen tablas propias: son consultas sobre pago, turno, presupuesto y movimientos (guardar solo reportes programados o exportados).

## Reglas
1. Rango: si «Desde» es posterior a «Hasta», se intercambian. «Este mes» va del día 1 hasta hoy. Todo se corta por **fecha de cobro en la zona de la clínica**.
2. La maqueta mide **cobranza** (dinero cobrado), no producción clínica: «por profesional» suma los cobros según el profesional del pago, y «tratamientos más realizados» cuenta cobros agrupados por el nombre del primer ítem del presupuesto. En la real separar: **cobranza** (por pago) y **producción** (tratamientos realizados × precio, por profesional y por tratamiento real, usando el estado de cada ítem del presupuesto, 03).
3. Ranking de tratamientos: ordena por cantidad y, a igualdad, por importe; muestra los 6 primeros.
4. Cobro promedio = ingresos ÷ cantidad de cobros (0 si no hay).
5. Los reportes respetan el **selector de sede** (08) y los permisos: un profesional ve su propia producción; el consolidado es de administración y dueño.
6. **Personal**: activar o desactivar cambia el acceso inmediatamente; **no se borra a nadie** (sus turnos, pagos y documentos siguen apuntando a él). Al activar una invitación sin horario se asigna uno por defecto, que luego se edita.
7. Invitar exige nombre; el usuario queda inactivo hasta que acepta la invitación (enlace con vencimiento) y crea su contraseña. El rol decide qué módulos ve (00).
8. **Inventario — nivel bajo**: stock ≤ mínimo → «Nivel bajo» (rojo); stock 0 → «Agotado». **Vence pronto**: vencimiento dentro de 30 días o menos. Insumos sin vencimiento se muestran con «—».
9. **Salida** no deja stock negativo (con 0 no hace nada); **entrada** exige cantidad entera ≥ 1. En la real toda salida pide motivo (consumo en turno, descarte, vencido) y la salida por vencimiento descuenta del lote que vence primero.
10. La barra de nivel compara el stock contra 3 veces el mínimo; si el mínimo es 0 hay que evitar la división por cero.
11. Cuando se cargue una compra (cuenta por pagar, 09) se puede generar la entrada de inventario; y un tratamiento puede tener su **consumo estándar** de insumos que descuenta al marcarse atendido (opcional, no está en la maqueta).

## Conecta con
Pagos y turnos (origen de reportes), presupuestos (producción), sedes (stock y reportes por sede), contabilidad (compras y proveedores, 09), usuarios y permisos (00), Inicio (alerta de stock bajo, 01).
