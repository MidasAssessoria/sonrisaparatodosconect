# Facturación electrónica (SIFEN) y contabilidad

Pantallas: «Facturación SIFEN» y «Contabilidad» (5 pestañas). Código de la maqueta: `gestion/app2.js` (facturación y contabilidad) y `gestion/data.js` (`makeInvoice`, `iva10`, `iva5`, `aging`, `qrSvg`). Todo es demostración: RUC, timbrado, CDC y QR son ficticios y la «aprobación» de SIFEN se simula a los 1,6 segundos.

## Qué hace
**Facturación**
- Lista de **cobros sin factura** con botón «Emitir factura»; lista de **facturas emitidas** (12 últimas, «Ver todas»). Tarjetas: facturas del mes (cantidad y total), cobros sin factura, timbrado vigente.
- La factura sale **desde un cobro** (también desde el aviso al registrar el pago y desde el detalle del presupuesto). Se ve como documento: datos del emisor, timbrado y vigencia, número, fecha, condición, cliente, columnas **Exentas / 5 % / 10 %**, total, liquidación del IVA, **CDC**, QR y estado (*Enviando a SIFEN… → Aprobada*).
- Imprimir / guardar PDF y envío por WhatsApp (11).

**Contabilidad** (con exportación CSV de la pestaña activa)
- **Libro de ingresos y egresos**: por mes, filtro todos / ingresos / egresos; fecha, tipo, concepto, forma, comprobante (nº de factura o «Sin factura»; en egresos, la categoría), ingreso, egreso y totales.
- **Cuentas por cobrar**: presupuestos aprobados con saldo, con **antigüedad** (0–30, 31–60, 61–90, +90 días desde la aprobación) y botón «Cobrar».
- **Cuentas por pagar**: proveedor, concepto, vencimiento y estado (*Pagada / Vencida hace N días / Vence en N días / Al día*); «Registrar pago».
- **IVA**: ventas (débito) y compras (crédito) por tasa, y **IVA a pagar = débito − crédito** del mes.
- **Resultado mensual**: ingresos − egresos de los últimos 6 meses con gráfico.

## Tablas
**timbrado** (por sede / punto de expedición, ver 08)
| campo | nota |
|---|---|
| clinica_id, sede_id | |
| ruc_emisor, razon_social, actividad, direccion | datos del emisor |
| numero_timbrado, vigencia_desde, vigencia_hasta | la maqueta: un solo timbrado de ejemplo |
| establecimiento, punto_expedicion | 3 dígitos cada uno (ej. 001-001) |
| numero_desde, numero_hasta, ultimo_numero | rango autorizado y último usado |
| ambiente | pruebas / producción |
| certificado_ref, csc_ref | referencias al almacén de secretos (nunca el valor) |
| activo | |

**factura**
| campo | tipo | nota |
|---|---|---|
| id, clinica_id, sede_id, timbrado_id | | |
| numero | text | est-punto-nro de 7 dígitos, ej. 001-001-0000412; único |
| cdc | text(44) único | código de control, ver regla 5 |
| estado | enum | borrador / enviando / aprobada / aprobada con observación / rechazada / cancelada |
| fecha_emision | timestamptz | |
| condicion | enum contado / credito | la maqueta solo emite contado |
| paciente_id, receptor_nombre, receptor_doc (RUC o CI) | | copia al emitir; permite facturar a nombre de un familiar o empresa |
| total, base_10, iva_10, base_5, iva_5, exento | bigint | |
| pago_id | FK | 1 pago → 1 factura |
| xml_ref, kude_pdf_ref, qr_url | | archivos en almacenamiento privado (00) |
| sifen_codigo, sifen_mensaje, enviado_en, aprobado_en | | respuesta del servicio |
| cancelada_en, cancelada_por, motivo_cancelacion | | |

**factura_item**: factura_id, descripcion, cantidad, precio_unitario, tasa_iva, total. (La maqueta emite una sola línea con el concepto del cobro.)
**nota_credito**: igual que factura + `factura_id` original y motivo (devoluciones, anulaciones). No existe en la maqueta.

**proveedor**: id, clinica_id, nombre, ruc, telefono, activo.
**cuenta_por_pagar**: id, clinica_id, proveedor_id, concepto, monto, iva, vencimiento, pagada, pagada_en, egreso_id, comprobante (nº y timbrado), created_*.
**egreso**: ver 03 (comparte tabla con caja).

## Reglas
1. **Un cobro = una factura**, por el monto del cobro. Si el cobro ya tiene factura, «Emitir» abre la existente (nunca duplica).
2. **Numeración**: correlativa por establecimiento y punto de expedición, **sin huecos**, asignada al emitir dentro de una transacción (dos cajas a la vez no pueden tomar el mismo número). Debe estar dentro del rango y la vigencia del timbrado; si faltan pocos números o vence, alerta al administrador. La maqueta usa un contador global y el punto 001-001 fijo; la real toma el punto de la **sede** (08).
3. **Tasas e IVA** (precios con IVA incluido): IVA 10 % = base gravada ÷ 11; IVA 5 % = base gravada ÷ 21; exento sin IVA; **total IVA = IVA 5 % + IVA 10 %**. Las bases salen del reparto del pago (03), no se recalculan.
4. **Estados**: al emitir pasa a *enviando*; con la respuesta de SIFEN queda *aprobada* o *rechazada* (con código y motivo). Una factura rechazada no consume el número en silencio: se corrige y se reenvía según las reglas del servicio. Aprobada o enviada, **no se edita**.
5. **CDC**: lo arma el sistema con los campos de la especificación técnica de SIFEN (tipo de documento, RUC del emisor y DV, establecimiento, punto, número, tipo de contribuyente, fecha, tipo de emisión, código de seguridad y dígito verificador: 44 dígitos). Confirmar composición y validaciones con el manual técnico vigente y con quien provea la firma. La maqueta genera 44 dígitos al azar.
6. **Anular una factura aprobada** no se hace borrando: se cancela por el evento correspondiente dentro del plazo que fije la normativa, o se emite **nota de crédito**. Confirmar plazos con el contador.
7. Cliente: por defecto nombre y RUC / CI del paciente; si no tiene RUC se factura con CI. Permitir cambiar el receptor antes de emitir.
8. El QR y la representación gráfica (KuDE) se generan desde la respuesta de SIFEN; se guarda el PDF y se puede enviar por WhatsApp.
9. **Libro**: ingresos = pagos del mes, egresos = egresos del mes, ordenados del más nuevo al más viejo; «Comprobante» = nº de factura o «Sin factura». Totales respetan el filtro.
10. **Antigüedad** = días entre la aprobación del presupuesto y hoy, en cuatro tramos; el saldo se suma por tramo y el total coincide con «Saldos pendientes» de Inicio.
11. **Cuenta por pagar**: «Registrar pago» marca la cuenta pagada y crea el egreso (categoría Proveedores, por transferencia en la maqueta). Estado: pagada; vencida si `vencimiento < hoy`; «vence en N días» si faltan 7 o menos; si no, al día.
12. **IVA mensual**: débito por tasa = base y IVA de las ventas; crédito = IVA de las compras gravadas (10 % y 5 %). A pagar = débito − crédito. En la maqueta el débito sale de los **cobros** y el crédito de los **egresos con tasa**, y se rotula «cálculo ilustrativo». En la real el débito sale de las **facturas emitidas del mes** (excluyendo canceladas) y el crédito de compras con comprobante legal (RUC del proveedor, timbrado, número); lo declarado lo valida el contador.
13. **Resultado** = ingresos − egresos por mes; el mes en curso se calcula en vivo, los anteriores salen de los mismos movimientos (la maqueta tiene meses históricos fijos de demo). Cerrar un mes bloquea cambios.
14. CSV: separador «;», codificación UTF-8 con BOM, importes en guaraníes sin símbolo; quedan registrados en `audit_log` (exportación).

## Conecta con
Caja y pagos (origen de cada factura y de los egresos, 03), pacientes (RUC y nombre), sedes (punto de expedición y timbrado, 08), WhatsApp (envío del PDF, 11), reportes (10) y alertas de Inicio (pago vencido, 01).
