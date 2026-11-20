# Presupuestos, caja y pagos

Pantallas: «Presupuestos» (lista, nuevo, detalle), «Caja» y, dentro de la ficha, pestañas «Presupuestos» y «Pagos». Código de la maqueta: `gestion/app2.js` (presupuestos, caja, `openPay`), `gestion/app.js` (pestañas de la ficha) y los cálculos de `gestion/data.js` (`bTotal`, `bPaid`, `bBal`, `cashExpected`).

## Qué hace
- **Presupuesto**: elegir paciente → tocar tratamientos del catálogo (cada toque suma 1; − / + cambia la cantidad, en 0 se quita) → descuento % → **Guardar borrador** o **Guardar y aprobar**. Muestra subtotal, descuento, IVA incluido (10 % y 5 %) y total.
- **Detalle**: avance en 5 pasos (Borrador, Aprobado, Cobro en curso, Pagado, Facturado), barra de lo pagado, saldo a cobrar, botón **Cobrar ahora**, lista de pagos del presupuesto con **Facturar** o etiqueta «Facturado».
- **Cobro** (modal «Registrar pago»): paciente, presupuesto a cobrar (o «Cobro particular»), monto, forma de pago (efectivo / tarjeta / transferencia / QR). Al terminar ofrece **Emitir factura SIFEN** (09).
- **Caja del día**: abrir con fondo inicial, registrar cobros y egresos, ver movimientos de hoy (ingresos y egresos mezclados por hora), ingresos por forma de pago y **cerrar con arqueo** (efectivo esperado vs. contado).
- Ficha → **Pagos**: historial del paciente con forma de pago y enlace a la factura; **Presupuestos**: lista con total y saldo.

## Tablas
**tratamiento** (catálogo de precios)
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, nombre | | ej. Limpieza dental (profilaxis) |
| precio | bigint | guaraníes, **IVA incluido** |
| iva | enum 10 / 5 / 0 | 0 = exento |
| duracion_min | int | la usa la agenda (01) |
| categoria, activo | | no se borra, se desactiva; cambiar el precio no toca presupuestos viejos |

**presupuesto**
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, sede_id, paciente_id | | |
| profesional_id | FK | responsable (la maqueta fija el primero: error de demo) |
| numero | text | correlativo por clínica, ej. P-1001 |
| estado | enum borrador / aprobado (+ anulado) | los 5 pasos de la pantalla son **derivados**, no se guardan |
| fecha, aprobado_en, aprobado_por | | `aprobado_en` también mide la antigüedad de la deuda (09) |
| descuento_pct | numeric | 0 a 50 en la maqueta (tope configurable) |
| nota, created_*, updated_* | | |

**presupuesto_item**: presupuesto_id, tratamiento_id, **nombre, precio, iva** (copia al momento), cantidad, pieza (opcional, FDI) y caras. La maqueta no guarda pieza: en la real conviene, para enlazar con el odontograma (12), y un estado por ítem (pendiente / realizado).

**caja_sesion**: id, clinica_id, sede_id, fecha, abierta_en, abierta_por, fondo_inicial, cerrada_en, cerrada_por, esperado, contado, diferencia, nota_diferencia.

**pago**
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, sede_id, caja_sesion_id | FK | un pago siempre cuelga de una sesión abierta |
| paciente_id, presupuesto_id (nullable) | FK | nulo = cobro particular |
| profesional_id, tratamiento_id | FK | para reportes (10); la maqueta guarda el nombre como texto |
| monto | bigint | entero, > 0 |
| forma | enum efectivo / tarjeta / transferencia / qr | |
| concepto | text | |
| base_10, base_5, exento | bigint | cuánto del monto va a cada tasa; suman `monto` |
| fecha_hora | timestamptz | |
| anulado, motivo_anulacion, anulado_por | | los pagos no se borran ni editan |
| created_by | | auditoría |

**egreso**: id, clinica_id, sede_id, caja_sesion_id, fecha_hora, concepto, categoria (Insumos, Laboratorio, Servicios, Mantenimiento, Marketing, Otros; en la maqueta además Alquiler, Sueldos y Proveedores), monto, forma (efectivo / transferencia / tarjeta), iva (10 / 5 / 0), proveedor_id (opcional), comprobante (nº y timbrado del proveedor), anulado.

## Reglas
1. Totales: `subtotal = Σ precio × cantidad`; `descuento = redondeo(subtotal × %)`; `total = redondeo(subtotal × (1 − %))`. **El descuento se reparte proporcional** entre las tasas.
2. **IVA incluido**: el precio ya lo trae. IVA 10 % = base ÷ 11; IVA 5 % = base ÷ 21 (redondeo al guaraní); exento no tiene IVA. Se calcula sobre la parte de cada tasa, después del descuento.
3. El ítem copia nombre, precio e IVA del catálogo al agregarlo; si el catálogo cambia después, el presupuesto no cambia.
4. **Borrador** no genera deuda. **Aprobar** convierte el total en **saldo a cobrar**: `saldo = total − Σ pagos`; para borrador es 0. Saldo del paciente = Σ saldos de sus presupuestos aprobados.
5. Paso derivado del presupuesto: Borrador → Aprobado (sin pagos) → Cobro en curso (pagado > 0 y saldo > 0) → Pagado (saldo 0) → Facturado (todos sus pagos tienen factura).
6. **Cobro**: exige **caja abierta** (si no, manda a abrirla); paciente obligatorio; monto entero > 0; si es contra un presupuesto, **no puede superar su saldo**. Al elegir presupuesto el monto se sugiere con el saldo completo.
7. **Reparto de IVA del pago**: contra presupuesto, el monto se reparte entre 10 % / 5 % / exento según el peso de cada ítem; la diferencia por redondeo se suma a la tasa del 10 %. Cobro particular: concepto libre y una sola tasa elegida (10 %, 5 % o exento).
8. Cada pago guarda fecha, hora, sesión de caja, profesional y forma; concepto automático «Pago a cuenta · Presupuesto P-xxxx».
9. **Caja**: una sesión abierta por sede a la vez; se abre con fondo inicial (valor sugerido, editable). **Efectivo esperado = fondo + cobros en efectivo de la sesión − egresos en efectivo de la sesión**; tarjeta, transferencia y QR no entran al arqueo.
10. **Cierre**: obliga a ingresar el efectivo contado; `diferencia = contado − esperado` (0 «cuadrada», positiva «sobrante», negativa «faltante»). Cerrada la sesión no se registran más cobros ni egresos en ella. La real exige nota cuando hay diferencia y deja el cierre en `audit_log`.
11. Egreso: concepto y monto obligatorios, exige caja abierta; la maqueta fija IVA 10 % (la real lo elige por comprobante).
12. «Ingresos del día» y movimientos se arman por fecha de cobro y por sede; el resumen por forma de pago suma solo ingresos.
13. Anular un pago crea un contraasiento (no edita ni borra), baja el pagado del presupuesto, y si tenía factura obliga a cancelarla o emitir nota de crédito (09). No hay anulación en la maqueta.
14. La maqueta no tiene pagos en varias formas a la vez, cuotas, adelantos sin presupuesto ni devoluciones: definir con la clínica antes de construirlos.

## Conecta con
Agenda (cobrar al atender), facturación SIFEN (cada pago se factura 1 a 1), contabilidad (libro, cuentas por cobrar, IVA), reportes (cobranza por profesional, tratamiento y forma), odontograma (plan sugerido → presupuesto, ver 12), sedes (caja por sede, 08), inventario (egresos de insumos).
