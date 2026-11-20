# AlertaClinica

Banda de alertas clínicas que aparece sola arriba de la ficha, del odontograma y al abrir un plan de tratamiento.

- `alergia` (coral, triángulo): látex, penicilina, anestésicos. `condicion` (sol, i): hepatitis, hipertensión, diabetes, tabaquismo, embarazo.
- Visible pero no alarmista: ícono + texto + color, sin rojo clínico, sin parpadeo.
- `compacta` en cabeceras angostas (solo las píldoras). Sin alertas: dice «Sin alertas clínicas registradas».
- Datos de salud: mostrar solo a roles con permiso clínico.

El consumidor provee: `alertas` con `tipo` y `texto` completo («Alergia a la penicilina»).
