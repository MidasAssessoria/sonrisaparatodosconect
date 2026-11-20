import { Boton, HojaInferior, MarcoApp, type ItemNavegacion, type RenderEnlace } from '@conecta/ui';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useIdioma } from '../i18n/idioma.js';
import { modulosVisibles, moduloDeRuta, type IdModuloWeb } from '../modulos.js';
import { useSesionLista } from '../sesion/ProveedorSesion.js';
import { useInactividad } from '../sesion/useInactividad.js';

export const RUTA_SEGURIDAD = '/seguridad';

const renderEnlace: RenderEnlace<IdModuloWeb> = ({ href, item, activo, children, ...resto }) => {
  void item;
  void activo;
  return (
    <Link to={href} {...resto}>
      {children}
    </Link>
  );
};

/** Armazón con sesión: navegación según permisos, sede, menú de usuario e inactividad. */
export function Armazon({ children }: { children: ReactNode }) {
  const { idioma, setIdioma, t } = useIdioma();
  const { sesion, puede, sedeActiva, elegirSede, cerrarSesion, irAElegirClinica } =
    useSesionLista();
  const ubicacion = useLocation();
  const navegar = useNavigate();

  const items: ItemNavegacion<IdModuloWeb>[] = modulosVisibles(puede).map((m) => ({
    id: m.id,
    nombre: t.modulos[m.id],
    icono: m.icono,
    ruta: m.ruta,
  }));

  const { aviso, seguir } = useInactividad({
    minutos: sesion.inactividadMin,
    activo: true,
    alCerrar: () => void cerrarSesion({ tipo: 'inactividad', minutos: sesion.inactividadMin }),
  });

  const acciones = [
    {
      id: 'seguridad',
      texto: t.armazon.seguridad,
      icono: 'candado' as const,
      onElegir: () => void navegar(RUTA_SEGURIDAD),
    },
    ...(sesion.clinicas.length > 1
      ? [
          {
            id: 'clinica',
            texto: t.clinica.cambiar,
            icono: 'sede' as const,
            onElegir: irAElegirClinica,
          },
        ]
      : []),
  ];

  return (
    <MarcoApp<IdModuloWeb>
      className="w-marco"
      items={items}
      activo={moduloDeRuta(ubicacion.pathname)}
      renderEnlace={renderEnlace}
      usuario={{ nombre: sesion.usuario.nombre, rol: sesion.rol.nombre }}
      accionesUsuario={acciones}
      onCerrarSesion={() => void cerrarSesion()}
      {...(sedeActiva.tipo === 'ninguna'
        ? { sede: t.inicio.sinSede, sedes: [] }
        : {
            sedes: sesion.sedes.map((s) => ({ id: s.id, nombre: s.nombre })),
            sedeActiva: sedeActiva.tipo === 'sede' ? sedeActiva.id : null,
            onSede: elegirSede,
          })}
      permitirTodas={sesion.puedeVerTodasLasSedes}
      idioma={idioma}
      onIdioma={setIdioma}
      pieLateral={sesion.clinica.nombre}
    >
      {children}
      <HojaInferior
        abierta={aviso}
        titulo={t.inactividad.titulo}
        onCerrar={seguir}
        acciones={
          <Boton variante="primario" bloque onClick={seguir}>
            {t.inactividad.seguir}
          </Boton>
        }
      >
        <p>{t.inactividad.texto}</p>
      </HojaInferior>
    </MarcoApp>
  );
}
