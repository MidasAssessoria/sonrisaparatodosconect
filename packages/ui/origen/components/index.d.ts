import type * as React from 'react';

/** Tonos de estado. Siempre con ícono o texto, nunca solo color. */
export type Tono = 'exito' | 'atencion' | 'progreso' | 'info' | 'categoria' | 'familia' | 'neutro';
export type ModuloId = 'inicio' | 'pacientes' | 'odontologia' | 'agenda' | 'caja' | 'personal' | 'inventario' | 'comunitaria' | 'estadisticas';
export type IconoNombre =
  | 'inicio' | 'agenda' | 'pacientes' | 'caja' | 'odontologia' | 'personal' | 'inventario' | 'comunitaria' | 'estadisticas'
  | 'buscar' | 'campana' | 'mas' | 'menu-mas' | 'check' | 'cerrar' | 'alerta' | 'info' | 'exportar' | 'candado'
  | 'sin-conexion' | 'idioma' | 'chevron' | 'chevron-abajo' | 'telefono' | 'mensaje' | 'reloj' | 'ojo' | 'ojo-cerrado'
  | 'imprimir' | 'archivo' | 'familia' | 'sube' | 'baja' | 'sincronizar' | 'sede' | 'tabla';

export interface BotonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primario: una vez por vista. secundario (por defecto), fantasma, peligro. */
  variante?: 'primario' | 'secundario' | 'fantasma' | 'peligro';
  /** md = 48px, lg = 56px (sillón, acción principal en móvil). */
  tamano?: 'md' | 'lg';
  icono?: IconoNombre;
  iconoFinal?: IconoNombre;
  cargando?: boolean;
  bloque?: boolean;
}
export declare function Boton(props: BotonProps): React.ReactElement;

export interface MenuExportarProps {
  /** inactivo | preparando («Preparando archivo…») | listo | error */
  estado?: 'inactivo' | 'preparando' | 'listo' | 'error';
  onElegir?: (formato: 'pdf' | 'excel' | 'imprimir') => void;
  /** En móvil: solo el ícono, con aria-label «Exportar». */
  soloIcono?: boolean;
  abierto?: boolean;
}
export declare function MenuExportar(props: MenuExportarProps): React.ReactElement;

export interface BarraLateralProps {
  activo?: ModuloId;
  /** Módulos que el rol puede ver; los demás no aparecen. Por defecto, todos. */
  modulos?: ModuloId[];
  rutas?: Partial<Record<ModuloId, string>>;
  onNavegar?: (id: ModuloId) => void;
  /** Reemplaza la marca tipográfica cuando exista un logo definitivo. */
  logo?: React.ReactNode;
  pie?: React.ReactNode;
}
export declare function BarraLateral(props: BarraLateralProps): React.ReactElement;

export interface PacienteResultado { nombre: string; documento?: string; telefono?: string; alerta?: string }

export interface BarraSuperiorProps {
  idioma?: 'es' | 'gn';
  onIdioma?: (v: 'es' | 'gn') => void;
  sede?: string;
  notificaciones?: number;
  usuario?: { nombre: string; rol?: string };
  resultados?: PacienteResultado[];
  onElegirPaciente?: (p: PacienteResultado) => void;
  /** Muestra la marca (cuando no hay barra lateral, p. ej. tablet). */
  conMarca?: boolean;
  logo?: React.ReactNode;
}
export declare function BarraSuperior(props: BarraSuperiorProps): React.ReactElement;

export interface BarraInferiorProps {
  activo?: 'inicio' | 'agenda' | 'pacientes' | 'caja' | 'mas';
  fija?: boolean;
  rutas?: Record<string, string>;
  onNavegar?: (id: string) => void;
}
export declare function BarraInferior(props: BarraInferiorProps): React.ReactElement;

export interface SelectorIdiomaProps { valor?: 'es' | 'gn'; onCambio?: (v: 'es' | 'gn') => void }
export declare function SelectorIdioma(props: SelectorIdiomaProps): React.ReactElement;

export interface BuscadorProps {
  /** Controlado: pasá valor + onCambio y filtrá resultados vos. Sin valor, filtra resultados solo. */
  valor?: string;
  valorInicial?: string;
  onCambio?: (v: string) => void;
  resultados?: PacienteResultado[];
  onElegir?: (p: PacienteResultado) => void;
  placeholder?: string;
  etiqueta?: string;
  compacto?: boolean;
}
export declare function Buscador(props: BuscadorProps): React.ReactElement;

export interface TarjetaPacienteProps {
  nombre: string;
  edad?: number;
  telefono?: string;
  proximoTurno?: string;
  chips?: { tono: Tono; texto: string; icono?: IconoNombre | null }[];
  desactivado?: boolean;
  onAbrir?: () => void;
}
export declare function TarjetaPaciente(props: TarjetaPacienteProps): React.ReactElement;

export interface AvatarProps {
  nombre: string;
  tamano?: 'sm' | 'md' | 'lg';
  tono?: 'turquesa' | 'cielo' | 'uva' | 'rosa' | 'sol' | 'coral';
  /** true cuando el nombre ya está escrito al lado. */
  decorativo?: boolean;
}
export declare function Avatar(props: AvatarProps): React.ReactElement;

export interface ChipProps { tono?: Tono; icono?: IconoNombre | null; children?: React.ReactNode }
export declare function Chip(props: ChipProps): React.ReactElement;

export interface AlertaClinicaProps {
  alertas: { tipo: 'alergia' | 'condicion'; texto: string }[];
  compacta?: boolean;
}
export declare function AlertaClinica(props: AlertaClinicaProps): React.ReactElement;

export interface AvisoExitoProps {
  titulo: React.ReactNode;
  texto?: React.ReactNode;
  accion?: React.ReactNode;
  onCerrar?: () => void;
  flotante?: boolean;
}
export declare function AvisoExito(props: AvisoExitoProps): React.ReactElement;

export interface AvisoConexionProps { estado?: 'sin-conexion' | 'sincronizando' | 'sincronizado'; pendientes?: number }
export declare function AvisoConexion(props: AvisoConexionProps): React.ReactElement;

export interface EstadoVacioProps {
  titulo: React.ReactNode;
  texto?: React.ReactNode;
  accion?: React.ReactNode;
  /** false para quitarla; o un nodo propio. */
  ilustracion?: React.ReactNode | false;
}
export declare function EstadoVacio(props: EstadoVacioProps): React.ReactElement;

export interface CampoProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  etiqueta: React.ReactNode;
  tipo?: 'text' | 'email' | 'tel' | 'number' | 'date' | 'time' | 'password' | 'select' | 'textarea';
  opciones?: (string | { valor: string; texto: string })[];
  ayuda?: React.ReactNode;
  error?: React.ReactNode;
  requerido?: boolean;
  rows?: number;
}
export declare function Campo(props: CampoProps): React.ReactElement;

export interface HojaInferiorProps {
  abierta: boolean;
  titulo: React.ReactNode;
  onCerrar?: () => void;
  acciones?: React.ReactNode;
  children?: React.ReactNode;
  /** Sin fondo ni posición fija (documentación). */
  enLinea?: boolean;
}
export declare function HojaInferior(props: HojaInferiorProps): React.ReactElement | null;

export interface Columna<F> { clave: string; titulo: string; alinear?: 'inicio' | 'fin'; render?: (fila: F) => React.ReactNode }
export interface TablaListaProps<F = Record<string, unknown>> { titulo?: string; columnas: Columna<F>[]; filas: F[] }
export declare function TablaLista<F>(props: TablaListaProps<F>): React.ReactElement;

export interface TarjetaMetricaProps {
  etiqueta: React.ReactNode;
  valor: React.ReactNode;
  cambio?: string;
  tendencia?: 'sube' | 'baja' | 'igual';
  /** Color del cambio según si es bueno o malo (no según la dirección). */
  tono?: 'exito' | 'atencion' | 'neutro';
  nota?: string;
  icono?: IconoNombre;
}
export declare function TarjetaMetrica(props: TarjetaMetricaProps): React.ReactElement;

export interface GraficoBarrasProps {
  titulo: React.ReactNode;
  datos: { etiqueta: string; valor: number; tono?: 'turquesa' | 'cielo' | 'uva' | 'rosa' | 'sol' | 'coral'; nota?: string; notaTono?: Tono }[];
  tono?: 'turquesa' | 'cielo' | 'uva' | 'rosa' | 'sol' | 'coral';
  maximo?: number;
  formato?: (v: number) => string;
  columnaEtiqueta?: string;
  columnaValor?: string;
  pie?: React.ReactNode;
}
export declare function GraficoBarras(props: GraficoBarrasProps): React.ReactElement;

export type MarcaClinica = 'caries' | 'extraccion' | 'periodontal' | 'sano';
export interface LeyendaOdontogramaProps {
  seleccion?: MarcaClinica;
  onElegir?: (m: MarcaClinica) => void;
  /** Solo leyenda, sin botones. */
  soloLeyenda?: boolean;
  vertical?: boolean;
}
export declare function LeyendaOdontograma(props: LeyendaOdontogramaProps): React.ReactElement;

export interface MarcoVisor3DProps {
  denticion?: 'adulto' | 'pediatrico';
  onDenticion?: (d: 'adulto' | 'pediatrico') => void;
  cargando?: boolean;
  titulo?: React.ReactNode;
  ayuda?: React.ReactNode;
  /** El visor 3D real se monta aquí. */
  children?: React.ReactNode;
}
export declare function MarcoVisor3D(props: MarcoVisor3DProps): React.ReactElement;

export interface PieMaquetaProps { texto?: React.ReactNode }
export declare function PieMaqueta(props: PieMaquetaProps): React.ReactElement;

export interface IconoProps { nombre: IconoNombre; tamano?: number; titulo?: string; className?: string }
export declare function Icono(props: IconoProps): React.ReactElement;

declare global {
  interface Window {
    Conecta: {
      Boton: typeof Boton; MenuExportar: typeof MenuExportar; BarraLateral: typeof BarraLateral;
      BarraSuperior: typeof BarraSuperior; BarraInferior: typeof BarraInferior; SelectorIdioma: typeof SelectorIdioma;
      Buscador: typeof Buscador; TarjetaPaciente: typeof TarjetaPaciente; Avatar: typeof Avatar; Chip: typeof Chip;
      AlertaClinica: typeof AlertaClinica; AvisoExito: typeof AvisoExito; AvisoConexion: typeof AvisoConexion;
      EstadoVacio: typeof EstadoVacio; Campo: typeof Campo; HojaInferior: typeof HojaInferior; TablaLista: typeof TablaLista;
      TarjetaMetrica: typeof TarjetaMetrica; GraficoBarras: typeof GraficoBarras; LeyendaOdontograma: typeof LeyendaOdontograma;
      MarcoVisor3D: typeof MarcoVisor3D; PieMaqueta: typeof PieMaqueta; Icono: typeof Icono;
      MODULOS: { id: ModuloId; nombre: string; icono: IconoNombre }[];
    };
  }
}
