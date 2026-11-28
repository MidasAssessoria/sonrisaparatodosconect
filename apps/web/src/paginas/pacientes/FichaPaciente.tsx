import type { Paciente } from '@conecta/shared';
import { AlertaClinica, Avatar, Boton, Icono, type AlertaClinicaProps } from '@conecta/ui';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ErrorConecta } from '../../api/errores.js';
import { Esqueleto, MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { usePaciente } from './consultas.js';
import { enlaceWhatsapp, metaPaciente, nombreCompleto, textoAlertaMedica } from './formato.js';
import { ChipsPaciente } from './ListaPacientes.js';
import { PESTANAS_FICHA, pestanasVisibles } from './pestanas.js';
import './pacientes.css';

/**
 * Alertas de la cabecera: las manuales activas y las que salen de la anamnesis vigente, juntas.
 * Las derivadas llevan «De la anamnesis»; primero las de gravedad alta. Si una manual dice lo
 * mismo que una derivada, se muestra una sola vez (la manual).
 */
export function alertasCabecera(
  paciente: Pick<Paciente, 'alertas' | 'alertasMedicas'>,
  origen: string,
): AlertaClinicaProps['alertas'] {
  const manuales = paciente.alertas
    .filter((a) => a.activa)
    .map((a) => ({ tipo: a.tipo, texto: a.texto }));
  const vistas = new Set(manuales.map((a) => `${a.tipo}|${a.texto.trim().toLowerCase()}`));
  // El detalle libre llega solo para quien ve la ficha clínica (recepción recibe `null`).
  const derivadas = [...paciente.alertasMedicas]
    .sort((a, b) => (a.gravedad === b.gravedad ? 0 : a.gravedad === 'alta' ? -1 : 1))
    .map((a) => ({ tipo: a.tipo, texto: textoAlertaMedica(a), origen }))
    .filter((a) => !vistas.has(`${a.tipo}|${a.texto.trim().toLowerCase()}`));
  return [...manuales, ...derivadas];
}

/** Cabecera: avatar, nombre, edad, CI, teléfono, estado y accesos. */
function CabeceraFicha({ paciente }: { paciente: Paciente }) {
  const t = useTextos().pacientes;
  const nombre = nombreCompleto(paciente);
  const alertas = alertasCabecera(paciente, t.ficha.origenAnamnesis);
  return (
    <>
      <header className="w-ficha-cabecera">
        <Avatar nombre={nombre} tamano="lg" decorativo />
        <div className="w-ficha-cabecera__cuerpo">
          <h1 className="w-ficha-cabecera__nombre">{nombre}</h1>
          <p className="w-secundario">{metaPaciente(t, paciente)}</p>
          {!paciente.activo || paciente.pediatrico ? (
            <ChipsPaciente paciente={{ ...paciente, conAlerta: false }} />
          ) : null}
        </div>
        {paciente.telefono ? (
          <div className="w-ficha-cabecera__accesos">
            <a
              className="cn-boton cn-boton--secundario cn-boton--md"
              href={`tel:${paciente.telefono}`}
            >
              <Icono nombre="telefono" tamano={20} />
              <span>{t.ficha.llamar}</span>
            </a>
            {paciente.aceptaWhatsapp ? (
              <a
                className="cn-boton cn-boton--secundario cn-boton--md"
                href={enlaceWhatsapp(paciente.telefono)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icono nombre="mensaje" tamano={20} />
                <span>{t.ficha.whatsapp}</span>
              </a>
            ) : null}
          </div>
        ) : null}
      </header>
      {/*
       * Alertas activas arriba de todo (README «Datos de salud»): ícono + texto + color, sin rojo
       * clínico ni parpadeo. Alergias en coral, condiciones en sol. Las ve también recepción, con
       * las de la anamnesis (la alerta médica llega en la ficha con `pacientes:ver`).
       */}
      {alertas.length ? <AlertaClinica className="w-ficha-alertas" alertas={alertas} /> : null}
      {!paciente.activo ? (
        <div className="w-aviso-atencion w-aviso-neutro" role="status">
          <Icono nombre="info" tamano={22} />
          <div className="w-aviso-atencion__cuerpo">
            <p className="w-aviso-atencion__titulo">{t.ficha.inactivo}</p>
            {paciente.motivoBaja ? (
              <p className="w-aviso-atencion__texto">
                {t.ficha.inactivoMotivo(paciente.motivoBaja)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function FichaPaciente() {
  const t = useTextos().pacientes;
  const { id = '', pestana = '' } = useParams();
  const { puede } = useSesionLista();
  const navegar = useNavigate();
  const consulta = usePaciente(id);

  const visibles = pestanasVisibles(PESTANAS_FICHA, puede);
  const actual = visibles.find((p) => p.ruta === pestana);
  // Una pestaña que no existe o que el rol no ve (las clínicas, para recepción): a «Datos».
  if (!actual) return <Navigate to={`/pacientes/${id}`} replace />;

  const volver = (
    <Link className="w-volver" to="/pacientes">
      <Icono nombre="chevron" tamano={20} className="w-volver__icono" />
      <span>{t.ficha.volver}</span>
    </Link>
  );

  if (consulta.isPending) {
    return (
      <>
        {volver}
        <Esqueleto filas={5} etiqueta={t.ficha.cargando} />
      </>
    );
  }
  // Sin ficha cargada, el error ocupa la pantalla. Si ya había una ficha y falló una recarga, se
  // sigue mostrando la ficha con un aviso (como la lista).
  const paciente = consulta.data;
  if (!paciente) {
    const noEsta =
      consulta.error instanceof ErrorConecta && consulta.error.codigo === 'no_encontrado';
    return (
      <>
        {volver}
        {noEsta ? (
          <MensajeError texto={t.ficha.noEncontrado} />
        ) : (
          <MensajeError error={consulta.error} onReintentar={() => void consulta.refetch()} />
        )}
        <Boton variante="secundario" onClick={() => void navegar('/pacientes')}>
          {t.ficha.volver}
        </Boton>
      </>
    );
  }

  const { Componente } = actual;
  return (
    <div className="w-ficha">
      {volver}
      {consulta.isError ? (
        <MensajeError texto={t.ficha.errorRecarga} onReintentar={() => void consulta.refetch()} />
      ) : null}
      <CabeceraFicha paciente={paciente} />
      <nav className="w-pestanas" aria-label={t.ficha.secciones}>
        {visibles.map((p) => (
          <Link
            key={p.id}
            className="w-pestanas__pestana"
            to={p.ruta ? `/pacientes/${paciente.id}/${p.ruta}` : `/pacientes/${paciente.id}`}
            aria-current={p === actual ? 'page' : undefined}
          >
            {t.pestanas[p.id]}
          </Link>
        ))}
      </nav>
      <Componente paciente={paciente} />
    </div>
  );
}
