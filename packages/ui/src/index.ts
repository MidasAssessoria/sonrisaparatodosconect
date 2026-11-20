/**
 * @conecta/ui — design system «Conecta» como paquete React.
 * Estilos: `import '@conecta/ui/estilos.css'` una vez en la entrada de la app (incluye fuentes y tokens).
 */
export type {
  AccionUsuario,
  Idioma,
  ItemNavegacion,
  ModuloId,
  PacienteResultado,
  PropsEnlace,
  RenderEnlace,
  Sede,
  Tono,
  TonoColor,
  UsuarioBarra,
} from './tipos.js';

export { Icono, NOMBRES_ICONOS, type IconoNombre, type IconoProps } from './componentes/Icono.js';
export { Boton, Giro, type BotonProps } from './componentes/Boton.js';
export {
  MenuExportar,
  type FormatoExportar,
  type MenuExportarProps,
} from './componentes/MenuExportar.js';
export {
  BarraInferior,
  BarraLateral,
  DESTINOS_MOVIL,
  Marca,
  MODULOS,
  type BarraInferiorProps,
  type BarraLateralProps,
} from './componentes/navegacion.js';
export {
  BarraSuperior,
  TEXTO_TODAS_LAS_SEDES,
  type BarraSuperiorProps,
} from './componentes/BarraSuperior.js';
export { SelectorIdioma, type SelectorIdiomaProps } from './componentes/SelectorIdioma.js';
export { Buscador, type BuscadorProps } from './componentes/Buscador.js';
export { TarjetaPaciente, type TarjetaPacienteProps } from './componentes/TarjetaPaciente.js';
export { Avatar, type AvatarProps } from './componentes/Avatar.js';
export {
  AlertaClinica,
  AvisoConexion,
  AvisoExito,
  Chip,
  EstadoVacio,
  PieMaqueta,
  type AlertaClinicaProps,
  type AvisoConexionProps,
  type AvisoExitoProps,
  type ChipProps,
  type EstadoVacioProps,
  type PieMaquetaProps,
} from './componentes/estado.js';
export { Campo, type CampoProps } from './componentes/Campo.js';
export { HojaInferior, type HojaInferiorProps } from './componentes/HojaInferior.js';
export { TablaLista, type Columna, type TablaListaProps } from './componentes/TablaLista.js';
export {
  GraficoBarras,
  TarjetaMetrica,
  type DatoGrafico,
  type GraficoBarrasProps,
  type TarjetaMetricaProps,
} from './componentes/datos.js';
export {
  LeyendaOdontograma,
  MarcoVisor3D,
  type Denticion,
  type LeyendaOdontogramaProps,
  type MarcaClinica,
  type MarcoVisor3DProps,
} from './componentes/odontologia.js';
export {
  EncabezadoPagina,
  MarcoApp,
  type EncabezadoPaginaProps,
  type MarcoAppProps,
} from './componentes/MarcoApp.js';

export { formatoGs } from './formato.js';
export * from './tokens.js';
