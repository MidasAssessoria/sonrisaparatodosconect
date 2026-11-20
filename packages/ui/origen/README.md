Sistema de diseño de **Sonrisa Para Todos Conecta**, un software de gestión (SaaS) para clínicas odontológicas nacido del proyecto social Sonrisa Para Todos (Paraguay). Lo usan dueños/as, odontólogos/as, asistentes y recepción, a menudo desde el celular, con prisa o con guantes. Tiene ocho módulos (Pacientes, Odontología, Agenda, Caja, Personal, Inventario, Sonrisa Comunitaria y Estadísticas) más Acceso e Inicio. Toda pantalla se usa bien en el celular, está disponible en guaraní y permite exportar.

Construí cada pantalla con estos tokens y con los componentes de `window.Conecta`. Un solo sistema: los mismos componentes, nombres y colores de estado en todas las páginas.

## Contenido y voz

- Español del Paraguay con **voseo** natural: «Confirmás», «Tenés», «Elegí», «Agregá el primero». Nunca «usted» ni «tú».
- Tono **cercano pero serio**: una clínica que cuida a las personas. Cálido sin ser infantil; claro sin ser frío ni hospitalario.
- Botones con verbo + objeto, sin punto: «Nuevo turno», «Cobrar», «Enviar presupuesto», «Guardar atención».
- Errores que dicen qué hacer y no culpan: «Usuario o contraseña no coinciden. Probá de nuevo.» — no «Error de credenciales».
- Mayúscula solo al inicio («Turnos de hoy», no «Turnos De Hoy»). Rótulos técnicos en `sobretitulo` (mayúsculas espaciadas): SUPERIOR, INFERIOR, MARCAR.
- Montos en guaraníes con punto de miles: «Gs. 300.000». Horas «9:00». Fechas «jue 14 de nov».
- **Guaraní** solo en saludos y etiquetas simples («Mba'éichapa», «Aguyje»). Lo que no tenga traducción validada se marca «traducción pendiente»; nunca inventes frases largas. Diseñá para textos un 30 % más largos.
- Recordatorios al paciente en el idioma de su ficha («Idioma del paciente: Español / Guaraní»): «Hola Ana, te esperamos mañana a las 9:00. ¿Confirmás?».
- Sin emojis en la interfaz. Sin testimonios, cifras de éxito ni logos de terceros.
- **Datos de ejemplo siempre ficticios** y los mismos personajes en todas las pantallas: Ana Giménez (34), su hijo Mateo Giménez (7), Lucía Benítez, Carlos Ayala, Rosa Duarte, Tomás Villalba; Dra. Marta Acosta, Dr. Esteban Rojas, Gloria Páez (asistente), Lorena Fretes (recepción). Toda pantalla de maqueta termina con `PieMaqueta`: «Maqueta de concepto · los datos son un ejemplo».

## Color

- Dominan **`crema`, `blanco` y `tinta`**. `turquesa` guía la acción; los demás colores aparecen en dosis chicas y siempre con el mismo significado, nunca de adorno.
- Fondo de la app en `crema`; tarjetas, barras y hojas en `blanco` con borde `borde`; campos de búsqueda, filas alternas y segmentos en `fondo-suave`.
- Texto en `tinta`; secundario en `tinta-suave`. Ambos pasan 4.5:1 sobre crema, blanco, fondo-suave y todos los `-suave`.
- **Los colores de marca no son colores de texto.** `turquesa`, `coral`, `sol`, `cielo` y `rosa` son rellenos con texto `tinta` encima (`sobre-turquesa` = tinta; nunca blanco). Para texto o íconos de ese color sobre fondo claro usá la versión `-texto` (`turquesa-texto`, `coral-texto`, `sol-texto`, `cielo-texto`, `uva-texto`, `rosa-texto`), derivadas para pasar 4.5:1. `uva` con tinta encima no llega a 4.5:1: es solo para barras, puntos y fondos de chip en `uva-suave`.
- Bordes de controles (campos, casillas, botón secundario) en `borde-control`, que pasa 3:1; `borde` es decorativo.
- **Estado = color + ícono + texto, siempre.** El mismo estado usa el mismo tono en todo el producto:

| tono | color | estados |
| --- | --- | --- |
| éxito | turquesa | Confirmado, Atendido, Aprobado, Pagado, Factura emitida, Sincronizado |
| atención | coral | Pendiente, Sin confirmar, Atrasado, Nivel bajo, Agotado, Con error, alergias |
| progreso | sol | En curso, En sala, Pago parcial, Próximo a vencer, condiciones clínicas, Sin conexión |
| info | cielo | Agendado, Enviado, Propuesto, Seguimiento |
| categoría | uva | Tipo de tratamiento, categoría de insumo, serie extra en gráficos |
| familia | rosa | Pediátrico, Grupo familiar |
| neutro | fondo-suave + tinta-suave | Ausente, Cancelado, Inactivo, Borrador, Deshabilitado |

- **Colores clínicos del odontograma, fijos** (los pidió el cliente): caries `clinico-caries` (punto negro), extracción `clinico-extraccion` (X azul), problema periodontal `clinico-periodontal` (arco rojo), sano sin marca. Solo dentro del odontograma, sus leyendas y documentos clínicos. En la pantalla de Odontología **ningún otro elemento usa azul o rojo**: ahí los chips de info pasan a `neutro` y no se usa `cielo-texto` para estados.
- Gráficos: series en `turquesa`, `cielo`, `uva`, `rosa`, `sol`, en ese orden, con el valor escrito al lado y «Ver como tabla». Nunca los rojos o azules clínicos.
- Un solo tema (claro). Un tema oscuro o de alto contraste se agrega como tema aparte cuando haga falta.

## Tipografía

- **Fredoka** (`display`, Google Fonts, 500–700): títulos y números grandes. **Hanken Grotesk** (`sans`, Google Fonts, 400–700): todo lo demás — interfaz, tablas, formularios, botones. (El brief la llama «Hanken Grotesque»; en Google Fonts es «Hanken Grotesk».) Se cargan desde Google Fonts: `family=Fredoka:wght@500;600;700&family=Hanken+Grotesk:wght@400;500;600;700`.
- Título de página: `titulo-pagina` (36px) en escritorio, `titulo-pagina-movil` (28px) en el celular. Secciones en `titulo-seccion`; nombres de paciente y títulos de hoja en `titulo-tarjeta`; cifras en `numero`.
- Lectura en `cuerpo` (16px): nunca menos en el celular. `etiqueta` para labels de campos y cabeceras de tabla; `secundario` para metadatos en `tinta-suave`; `pequeno` (13px) solo en chips y contadores; `sobretitulo` (12px, mayúsculas) solo en rótulos.
- Verificá que acentos, «ñ» y guaraní se vean bien: `ñ ẽ ĩ õ ũ ỹ g̃` y el apóstrofo de «Mba'éichapa». La `g̃` usa tilde combinante: probala en cada fuente antes de dar una pantalla por buena.
- Texto escalable hasta 200 % sin romper el layout: alturas mínimas, nunca fijas, en todo lo que lleve texto.

## Espacio, forma y profundidad

- Base de 4px: `espacio-1` … `espacio-12`. Mucho aire: tarjetas con `espacio-4` de relleno en móvil y `espacio-6` en escritorio; `espacio-8` entre secciones.
- Esquinas generosas: `radio-tarjeta` (16) en tarjetas y avisos, `radio-control` (12) en botones, campos y buscador, `radio-pill` en chips, avatares y el selector ES · GN, `radio-hoja` (24) arriba de la hoja inferior.
- Sombras muy suaves: `sombra-1` en tarjetas en reposo, `sombra-2` en lo que flota (menús, resultados del buscador, hoja, avisos). El límite lo da el borde fino, no la sombra.
- Sin degradados 3D, brillos, estrellitas ni bolitas de colores sueltas.

## Layout

- **Mobile-first**: diseñá a 360–430px y después escritorio de clínica (1280–1440px); la tablet (768–1024px) usa el escritorio compacto. Cada pantalla se entrega en móvil y escritorio.
- **Celular**: `BarraInferior` con Inicio, Agenda, Pacientes, Caja y Más (Más abre una `HojaInferior` con Odontología, Personal, Inventario, Sonrisa Comunitaria, Estadísticas, ES · GN y ajustes). `Buscador` arriba del contenido. Acción principal fija al pie (`Boton` primario `lg` `bloque`): «Nuevo turno», «Nuevo paciente». Exportar como ícono en el menú de acciones.
- **Escritorio**: `BarraLateral` (248px) con los módulos, `BarraSuperior` con buscador global, ES · GN, sede, notificaciones y perfil. Contenido en rejilla de 12 columnas hasta `contenido-max` (1200px). Encabezado de página: título a la izquierda; `MenuExportar` y la acción primaria a la derecha.
- Tablas largas se vuelven **listas de tarjetas** en el celular (`TablaLista`), nunca scroll horizontal.
- **Zonas táctiles de 44×44 mínimo** (`toque-minimo`), con `espacio-2` entre ellas; controles de 48px (`control`) y herramientas del sillón de 56px (`control-grande`).
- Nada depende del hover para existir: toda acción se ve sin pasar el cursor.
- Cada rol ve solo lo que le corresponde: los módulos sin permiso no aparecen en la navegación; dentro de una pantalla, lo restringido se muestra con candado + «Tu rol no tiene acceso a esto».

## Movimiento

- Sutil y prescindible: 150–250 ms, `ease-out`, solo para aparecer/desaparecer (hoja, menú, aviso) y cambios de estado. Nada que rebote ni anime en bucle salvo los indicadores de carga.
- Con «reducir movimiento» activo, todo se vuelve instantáneo y los giros de carga se enlentecen.

## Estados

Toda pieza contempla: normal, hover, foco, activo, deshabilitado, cargando, vacío, error y éxito.

- **Foco**: anillo sólido de 3px en `foco` (turquesa-texto) con 2px de separación, en todo elemento interactivo.
- **Cargando**: `Boton` con `cargando`; listas con filas esqueleto en `fondo-suave`; el visor con «Cargando visor…».
- **Vacío**: `EstadoVacio` con frase que orienta y una acción («Todavía no hay pacientes. Agregá el primero»).
- **Error**: texto claro + ícono + `coral-texto`, cerca del campo, diciendo cómo resolverlo.
- **Éxito**: `AvisoExito` con la acción siguiente («Imprimir comprobante»).
- **Sin conexión** (Sonrisa Comunitaria, Odontología): `AvisoConexion` — se guarda local y se sincroniza; nunca se bloquea el registro.
- **Exportar**: «Preparando archivo…» y «Listo» en `MenuExportar`.

## Datos de salud

- Alertas clínicas (`AlertaClinica`) aparecen solas arriba de la ficha, del odontograma y del plan de tratamiento: visibles pero no alarmistas — ícono + texto + color, sin rojo clínico, sin parpadeo. Alergias en coral; condiciones (hepatitis, hipertensión, diabetes, tabaquismo, embarazo) en sol.
- Mostrar con discreción y solo a roles con permiso clínico. Recepción no ve el historial clínico.

## Iconografía

- Íconos lineales de trazo 2px con puntas y uniones redondeadas, caja de 24, en `currentColor`: `Conecta.Icono` (36 íconos, uno por módulo y los de interfaz). En la navegación siempre con texto al lado.
- Set propio de este sistema. Si falta un ícono, tomalo de **Lucide** con trazo 2 (mismo estilo) y agregalo al set; no mezcles íconos rellenos ni de otro grosor.
- Ilustraciones: solo planas, simples y en la paleta, como la del `EstadoVacio`. Sin clip-art ni mascotas repartidas.

## Marca e imágenes

- No hay logo definitivo todavía: la marca es tipográfica — «SONRISA PARA TODOS» en `sobretitulo` sobre «Conecta» en Fredoka 600 (la muestra `BarraLateral`). Cuando exista el sello o logo final, pasalo en la prop `logo` de `BarraLateral`/`BarraSuperior` y en la pantalla de Acceso; dejá libre alrededor la mitad de su alto. Las exploraciones de logotipo no se usan como logo.
- El diente-mascota del sello del proyecto vive en el sello y en momentos puntuales (Acceso, un estado vacío, un éxito importante), nunca como decoración repetida.
- Fotografías del proyecto social: solo como ambientación editorial en Acceso, Inicio y Sonrisa Comunitaria, con recorte cuidadoso, sin filtros ni texto sobre rostros. **Nunca** como foto de un paciente del sistema ni en fichas, listas o tablas: ahí van `Avatar` con iniciales. No uses imágenes generadas.

## Componentes por módulo

- **Acceso**: `Campo` (usuario «lorena.fretes», contraseña con mostrar/ocultar), `Boton` primario «Ingresar», «Olvidé mi contraseña» fantasma, `SelectorIdioma`, saludo con «Mba'éichapa».
- **Inicio**: `TarjetaMetrica`, línea de turnos con `Chip` (Confirmado, En sala, Atendido, Ausente), accesos rápidos con `Boton`, alertas del día, `EstadoVacio` para «Hoy no hay turnos». Variantes por rol.
- **Pacientes**: `Buscador`, `TarjetaPaciente` / `TablaLista`, ficha con `Avatar lg` y `AlertaClinica` arriba, grupo familiar con `Chip familia`, «Idioma del paciente» en `Campo select`.
- **Odontología**: `MarcoVisor3D` (el visor 3D se monta adentro), `LeyendaOdontograma` como herramientas (vertical en escritorio, `HojaInferior` en móvil), `AlertaClinica` en la cabecera del paciente, plan con `Chip`, `AvisoConexion`, `AvisoExito` «Atención guardada».
- **Agenda**: turnos con `Chip` por estado de WhatsApp (Sin enviar, Enviado, Confirmado, Cancelado) y por tipo (`categoria` + ícono), conflicto con banner de atención y horario sugerido, `HojaInferior` «Nuevo turno».
- **Caja**: `TarjetaMetrica` (ingresos, egresos, saldo), `TablaLista` de movimientos, pagos en partes con barra consumido/pagado/saldo, factura SIFEN con `Chip` (Emitida, Pendiente, Con error), `AvisoExito` con comprobante.
- **Personal**: `TablaLista` del equipo, matriz de permisos por rol, candado + «Tu rol no tiene acceso a esto».
- **Inventario**: `GraficoBarras` de niveles con `Chip` «Nivel bajo», alerta de reabastecimiento arriba.
- **Sonrisa Comunitaria**: formulario corto y grande (`Campo`, `Boton lg`), `AvisoConexion`, jornadas con `Chip` (futura, en curso, cerrada), seguimiento «Control en 6 meses».
- **Estadísticas**: `TarjetaMetrica`, `GraficoBarras` con «Ver como tabla», selector de período en segmento, `MenuExportar`.

Todas las páginas: `Buscador` accesible, `SelectorIdioma`, `MenuExportar` y `PieMaqueta` mientras los datos sean de ejemplo.
