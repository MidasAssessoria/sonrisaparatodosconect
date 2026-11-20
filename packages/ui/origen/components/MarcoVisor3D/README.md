# MarcoVisor3D

Marco reservado para el visor 3D del odontograma, que se desarrolla aparte y se monta como `children`.

- Cabecera con el selector «Adulto 11–48 / Pediátrico 51–85» (numeración FDI).
- Rótulos fijos Superior / Inferior y Derecha / Izquierda **del paciente** alrededor del lienzo.
- Sin visor todavía: marcador «Visor 3D del odontograma». `cargando` muestra «Cargando visor…».
- Alrededor van: LeyendaOdontograma (herramientas), AlertaClinica en la cabecera del paciente, tarjeta del diente seleccionado, resumen, plan e historial.

El consumidor provee: `denticion`, `onDenticion` y el visor como `children`.
