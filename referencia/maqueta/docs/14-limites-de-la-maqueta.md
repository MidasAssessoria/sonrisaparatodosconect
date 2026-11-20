# Lo que la maqueta simplifica (resolver en la app real)

La maqueta muestra cómo funciona cada pantalla; estos puntos son atajos de demo, no reglas.

1. **Dos almacenamientos separados**: gestión (`sptc-gestion-v1`) y odontograma 3D (`odonto3d-sonrisa-v3`). En la app real, una sola base; el botón «Abrir odontograma 3D» debe abrir el paciente de la ficha.
2. **Odontograma 2D** guarda una marca por diente (caries, extracción, perio); el 3D tiene 14 tipos. Unificar en una tabla `odontograma_marca` (diente, cara, tipo, fecha, estado).
3. **Dentición pediátrica**: la ficha usa «menor de 12»; el 3D se elige a mano. Definir una sola regla (por edad, con opción manual).
4. **Presupuesto**: siempre toma el primer profesional, y el ítem no guarda diente/cara. Guardar profesional elegido y diente/cara para no perder el plan del odontograma.
5. **Turno cancelado se borra**: en la real, estados `cancelado` y `ausente` con motivo (sirve para reportes de inasistencia).
6. **Anamnesis de menores**: debe firmar el tutor (igual que el consentimiento).
7. **Filtro «con alerta clínica»** mira solo alertas manuales; incluir las que salen de la anamnesis (alergias, enfermedades).
8. **Reportes** miden cobros, no producción clínica; agregar producción por tratamiento realizado y por profesional.
9. **IVA débito** sale de los cobros; en la real sale de las facturas emitidas. Egreso de caja con IVA fijo 10 %: permitir 10/5/exento.
10. **SIFEN simulado**: numeración global, punto 001-001 fijo, CDC aleatorio y aprobación simulada. En la real: timbrado y punto por sede, CDC calculado y envío/aprobación con la SET.
11. **Recordatorios WhatsApp**: estados de demo fijos y «Enviar todos/Reenviar» solo muestran aviso; saludo de cumpleaños sin lógica; nombre de la clínica fijo en la plantilla. En la real: cola de envíos con estado por mensaje y plantillas por clínica.
12. **Archivos**: foto de lesión es solo una marca y las radiografías se guardan dentro del navegador. En la real: almacenamiento privado con URL firmada (ver doc 07).
13. **Evoluciones de lesiones** se pueden editar; en la real, el registro clínico no se edita: se agrega una evolución nueva.
14. **Signos vitales** (presión, pulso, peso) son texto libre; usar campos numéricos.
15. Reserva online, sedes y fotos tienen sus propias notas en 06, 07 y 08.
