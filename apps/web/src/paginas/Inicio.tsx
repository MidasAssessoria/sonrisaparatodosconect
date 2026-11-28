import { Boton, Chip, EncabezadoPagina, EstadoVacio } from '@conecta/ui';
import { useNavigate } from 'react-router';
import { RUTA_SEGURIDAD } from '../armazon/Armazon.js';
import { useTextos } from '../i18n/idioma.js';
import { MODULOS_WEB, moduloVisible } from '../modulos.js';
import { useSesionLista } from '../sesion/ProveedorSesion.js';
import { infoEstadoSede } from './sedes/estadoSede.js';

/** Inicio provisional del Sprint 1: saludo, contexto de trabajo y accesos a lo que ya existe. */
export function Inicio() {
  const t = useTextos();
  const navegar = useNavigate();
  const { sesion, sedeActiva, puede } = useSesionLista();
  const sede =
    sedeActiva.tipo === 'sede' ? sesion.sedes.find((s) => s.id === sedeActiva.id) : undefined;
  const estadoSede = sede ? infoEstadoSede(sede.estado) : null;
  const primerNombre = sesion.usuario.nombre.split(/\s+/)[0] ?? sesion.usuario.nombre;

  const accesos = MODULOS_WEB.filter((m) => m.id !== 'inicio' && moduloVisible(m, puede));
  const textoAcceso: Record<string, string> = {
    sedes: t.inicio.accesoSedes,
    auditoria: t.inicio.accesoAuditoria,
  };

  return (
    <>
      <EncabezadoPagina titulo={t.inicio.saludo(primerNombre)} />
      <section className="w-tarjeta" aria-label={t.inicio.clinica}>
        <dl className="w-datos">
          <div>
            <dt>{t.inicio.clinica}</dt>
            <dd>{sesion.clinica.nombre}</dd>
          </div>
          <div>
            <dt>{t.inicio.sede}</dt>
            <dd className="w-datos__sede">
              {sede ? (
                <>
                  <span>{sede.nombre}</span>
                  {estadoSede ? (
                    <Chip tono={estadoSede.tono} icono={estadoSede.icono}>
                      {estadoSede.texto}
                    </Chip>
                  ) : null}
                </>
              ) : sedeActiva.tipo === 'todas' ? (
                t.inicio.todasLasSedes
              ) : (
                t.inicio.sinSede
              )}
            </dd>
          </div>
          <div>
            <dt>{t.armazon.rol}</dt>
            <dd>{sesion.rol.nombre}</dd>
          </div>
        </dl>
      </section>

      <section className="w-seccion" aria-labelledby="w-inicio-accesos">
        <h2 id="w-inicio-accesos" className="w-seccion__titulo">
          {t.inicio.accesos}
        </h2>
        {accesos.length === 0 ? (
          <EstadoVacio titulo={t.inicio.nadaTodavia} ilustracion={false} />
        ) : null}
        <div className="w-accesos">
          {accesos.map((m) => (
            <Boton key={m.id} icono={m.icono} onClick={() => void navegar(m.ruta)}>
              {textoAcceso[m.id] ?? t.modulos[m.id]}
            </Boton>
          ))}
          <Boton icono="candado" variante="fantasma" onClick={() => void navegar(RUTA_SEGURIDAD)}>
            {t.inicio.accesoSeguridad}
          </Boton>
        </div>
      </section>
    </>
  );
}
