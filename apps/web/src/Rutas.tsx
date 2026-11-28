import { Boton, EstadoVacio } from '@conecta/ui';
import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { Armazon, RUTA_SEGURIDAD } from './armazon/Armazon.js';
import { RutaModulo } from './armazon/RutaModulo.js';
import { Candado, Esqueleto } from './componentes/estados.js';
import { useTextos } from './i18n/idioma.js';
import { modulosVisibles } from './modulos.js';
import { Acceso } from './paginas/acceso/Acceso.js';
import { ActivarSegundoFactor } from './paginas/acceso/ActivarSegundoFactor.js';
import { ElegirClinica } from './paginas/acceso/ElegirClinica.js';
import { NuevaClave } from './paginas/acceso/NuevaClave.js';
import { PantallaCarga, PantallaErrorSesion } from './paginas/acceso/PantallasEstado.js';
import { Recuperar } from './paginas/acceso/Recuperar.js';
import { SegundoFactor } from './paginas/acceso/SegundoFactor.js';
import { Inicio } from './paginas/Inicio.js';
import {
  RUTA_INVITACION,
  RUTA_NUEVA_CLAVE,
  useSesion,
  useSesionLista,
} from './sesion/ProveedorSesion.js';

// Módulos que no hacen falta para entrar: se bajan recién cuando se visitan.
const ListaSedes = lazy(() =>
  import('./paginas/sedes/ListaSedes.js').then((m) => ({ default: m.ListaSedes })),
);
const DetalleSede = lazy(() =>
  import('./paginas/sedes/DetalleSede.js').then((m) => ({ default: m.DetalleSede })),
);
const Auditoria = lazy(() =>
  import('./paginas/auditoria/Auditoria.js').then((m) => ({ default: m.Auditoria })),
);
const ListaPersonal = lazy(() =>
  import('./paginas/personal/ListaPersonal.js').then((m) => ({ default: m.ListaPersonal })),
);
const DetallePersona = lazy(() =>
  import('./paginas/personal/DetallePersona.js').then((m) => ({ default: m.DetallePersona })),
);
const Roles = lazy(() => import('./paginas/personal/Roles.js').then((m) => ({ default: m.Roles })));
const AceptarInvitacion = lazy(() =>
  import('./paginas/personal/AceptarInvitacion.js').then((m) => ({ default: m.AceptarInvitacion })),
);
const ListaProfesionales = lazy(() =>
  import('./paginas/catalogos/ListaProfesionales.js').then((m) => ({
    default: m.ListaProfesionales,
  })),
);
const DetalleProfesional = lazy(() =>
  import('./paginas/catalogos/DetalleProfesional.js').then((m) => ({
    default: m.DetalleProfesional,
  })),
);
const ListaPacientes = lazy(() =>
  import('./paginas/pacientes/ListaPacientes.js').then((m) => ({ default: m.ListaPacientes })),
);
const FichaPaciente = lazy(() =>
  import('./paginas/pacientes/FichaPaciente.js').then((m) => ({ default: m.FichaPaciente })),
);
const Cuestionario = lazy(() =>
  import('./paginas/cuestionario/Cuestionario.js').then((m) => ({ default: m.Cuestionario })),
);
const Tratamientos = lazy(() =>
  import('./paginas/catalogos/Tratamientos.js').then((m) => ({ default: m.Tratamientos })),
);
/*
 * Prueba técnica del odontograma 3D: solo en desarrollo. Es un experimento con datos de ejemplo,
 * no una pantalla del producto, así que no existe en producción para nadie (tampoco para un
 * dueño). Con `import.meta.env.DEV` falso en el build, Vite descarta este `import()` y three.js
 * ni siquiera viaja en el bundle de producción.
 */
const PruebaOdontograma = import.meta.env.DEV
  ? lazy(() => import('./experimentos/index.js').then((m) => ({ default: m.PruebaOdontograma })))
  : null;
const Seguridad = lazy(() =>
  import('./paginas/Seguridad.js').then((m) => ({ default: m.Seguridad })),
);

interface EstadoDesde {
  desde?: string;
}

/** «/» : Inicio si el rol lo ve; si no, el primer módulo que pueda ver. */
function RutaRaiz() {
  const { puede } = useSesionLista();
  if (puede('inicio', 'ver')) return <Inicio />;
  const primero = modulosVisibles(puede)[0];
  if (primero) return <Navigate to={primero.ruta} replace />;
  return <Candado />;
}

function NoEncontrada() {
  const t = useTextos();
  const navegar = useNavigate();
  return (
    <EstadoVacio
      titulo="No encontramos esta página."
      texto="Puede que el enlace esté mal escrito o que la página ya no exista."
      accion={
        <Boton variante="primario" icono="inicio" onClick={() => void navegar('/')}>
          {t.comun.irAlInicio}
        </Boton>
      }
    />
  );
}

/** Vuelve a donde quería ir la persona antes de ingresar. */
function VolverTrasIngresar() {
  const desde = (useLocation().state as EstadoDesde | null)?.desde;
  return <Navigate to={desde && !desde.startsWith('/acceso') ? desde : '/'} replace />;
}

/** Fuera de la página de invitación sin haber aceptado: sigue el flujo normal de la sesión. */
function SeguirSinInvitacion() {
  const t = useTextos();
  const { seguirSinInvitacion } = useSesion();
  useEffect(() => {
    void seguirSinInvitacion();
  }, [seguirSinInvitacion]);
  return <PantallaCarga texto={t.armazon.cargandoSesion} />;
}

/** Invitación abierta con la app ya cargada: se acepta antes de seguir (fase `invitacion`). */
function AbrirInvitacion() {
  const { abrirInvitacion } = useSesion();
  useEffect(() => {
    abrirInvitacion();
  }, [abrirInvitacion]);
  return null;
}

function IrAAcceso() {
  const ubicacion = useLocation();
  const estado: EstadoDesde = { desde: ubicacion.pathname + ubicacion.search };
  return <Navigate to="/acceso" replace state={estado} />;
}

export function Rutas() {
  const t = useTextos();
  const { estado } = useSesion();

  switch (estado.fase) {
    case 'iniciando':
      return <PantallaCarga texto={t.comun.cargando} />;
    case 'cargando_sesion':
      return <PantallaCarga texto={t.armazon.cargandoSesion} />;
    case 'segundo_factor':
      return <SegundoFactor />;
    case 'activar_segundo_factor':
      return <ActivarSegundoFactor />;
    case 'elegir_clinica':
      return <ElegirClinica />;
    case 'recuperacion':
      return <NuevaClave />;
    case 'error':
      return <PantallaErrorSesion mensaje={estado.mensaje} />;
    case 'invitacion':
      return (
        <Routes>
          <Route
            path={RUTA_INVITACION}
            element={
              <Suspense fallback={<PantallaCarga texto={t.comun.cargando} />}>
                <AceptarInvitacion />
              </Suspense>
            }
          />
          <Route path="*" element={<SeguirSinInvitacion />} />
        </Routes>
      );
    case 'sin_sesion':
      return (
        <Routes>
          <Route path="/acceso" element={<Acceso />} />
          <Route path="/acceso/recuperar" element={<Recuperar />} />
          <Route path={RUTA_NUEVA_CLAVE} element={<NuevaClave />} />
          <Route
            path={RUTA_INVITACION}
            element={
              <Suspense fallback={<PantallaCarga texto={t.comun.cargando} />}>
                <AceptarInvitacion />
              </Suspense>
            }
          />
          <Route path="*" element={<IrAAcceso />} />
        </Routes>
      );
    case 'lista':
      return (
        <Armazon>
          <Suspense fallback={<Esqueleto filas={4} etiqueta={t.comun.cargando} />}>
            <Routes>
              <Route path="/" element={<RutaRaiz />} />
              <Route
                path="/pacientes"
                element={
                  <RutaModulo modulo="pacientes">
                    <ListaPacientes />
                  </RutaModulo>
                }
              />
              <Route
                path="/pacientes/:id/:pestana?"
                element={
                  <RutaModulo modulo="pacientes">
                    <FichaPaciente />
                  </RutaModulo>
                }
              />
              <Route
                path="/sedes"
                element={
                  <RutaModulo modulo="sedes">
                    <ListaSedes />
                  </RutaModulo>
                }
              />
              <Route
                path="/sedes/:id"
                element={
                  <RutaModulo modulo="sedes">
                    <DetalleSede />
                  </RutaModulo>
                }
              />
              <Route
                path="/auditoria"
                element={
                  <RutaModulo modulo="auditoria">
                    <Auditoria />
                  </RutaModulo>
                }
              />
              <Route
                path="/personal"
                element={
                  <RutaModulo modulo="personal">
                    <ListaPersonal />
                  </RutaModulo>
                }
              />
              <Route
                path="/personal/:id"
                element={
                  <RutaModulo modulo="personal">
                    <DetallePersona />
                  </RutaModulo>
                }
              />
              <Route
                path="/roles"
                element={
                  <RutaModulo modulo="personal">
                    <Roles />
                  </RutaModulo>
                }
              />
              <Route
                path="/profesionales"
                element={
                  <RutaModulo modulo="personal">
                    <ListaProfesionales />
                  </RutaModulo>
                }
              />
              <Route
                path="/profesionales/:id"
                element={
                  <RutaModulo modulo="personal">
                    <DetalleProfesional />
                  </RutaModulo>
                }
              />
              <Route
                path="/tratamientos"
                element={
                  <RutaModulo modulo="configuracion">
                    <Tratamientos />
                  </RutaModulo>
                }
              />
              <Route
                path="/cuestionario"
                element={
                  <RutaModulo modulo="configuracion" accion="editar">
                    <Cuestionario />
                  </RutaModulo>
                }
              />
              {/* Prueba técnica del Sprint 2 (odontograma 3D): solo en desarrollo. */}
              {import.meta.env.DEV && PruebaOdontograma ? (
                <Route path="/experimentos/odontograma" element={<PruebaOdontograma />} />
              ) : null}
              {/* Invitación abierta con la app cargada: se acepta fuera del armazón. */}
              <Route path={RUTA_INVITACION} element={<AbrirInvitacion />} />
              <Route path={RUTA_SEGURIDAD} element={<Seguridad />} />
              <Route path="/acceso/*" element={<VolverTrasIngresar />} />
              <Route path="*" element={<NoEncontrada />} />
            </Routes>
          </Suspense>
        </Armazon>
      );
  }
}
