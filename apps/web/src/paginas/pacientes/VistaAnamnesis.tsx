import { formatoCi, SECCIONES_ANAMNESIS, type Anamnesis } from '@conecta/shared';
import { AlertaClinica, Boton, Chip } from '@conecta/ui';
import { useId, useState, type ReactNode } from 'react';
import { useTextos } from '../../i18n/idioma.js';
import { textoAlertaMedica } from './formato.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { formatoFechaHora } from '../../utilidades/fechas.js';

type RespuestaGuardada = Anamnesis['respuestas'][number];

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="w-anam-bloque" aria-labelledby={id}>
      <h3 id={id} className="w-anam-bloque__titulo">
        {titulo}
      </h3>
      {children}
    </section>
  );
}

/** Lo respondido, con el texto y la unidad copiados al guardar (no los del catálogo de hoy). */
function ValorRespuesta({ r }: { r: RespuestaGuardada }) {
  const t = useTextos().pacientes.anamnesis;
  let valor: ReactNode = null;
  if (r.tipo === 'si_no' && r.si !== undefined) {
    valor = r.si ? (
      <Chip tono="neutro" icono="check">
        {t.si}
      </Chip>
    ) : (
      <Chip tono="neutro" icono="cerrar">
        {t.no}
      </Chip>
    );
  } else if (r.tipo === 'multiple') {
    valor = (
      <span className="w-chips">
        {r.etiquetas.length ? (
          r.etiquetas.map((e) => (
            <Chip key={e} tono="neutro" icono="check">
              {e}
            </Chip>
          ))
        ) : (
          <Chip tono="neutro" icono="cerrar">
            {t.ninguna}
          </Chip>
        )}
      </span>
    );
  } else if (r.tipo === 'texto') {
    valor = <span className="w-anam-respuesta__texto">{r.texto}</span>;
  } else if (r.tipo === 'numero' && r.numero !== undefined) {
    valor = (
      <span className="w-anam-respuesta__texto">
        {String(r.numero).replace('.', ',')}
        {r.unidad ? ` ${r.unidad}` : ''}
      </span>
    );
  }
  return (
    <>
      <dd className="w-anam-respuesta__valor">{valor}</dd>
      {r.detalle ? <dd className="w-secundario w-anam-respuesta__detalle">{r.detalle}</dd> : null}
    </>
  );
}

/** Imagen de la firma (URL firmada que vence: si no carga, se puede volver a pedir). */
function ImagenFirma({
  url,
  nombre,
  onRecargar,
}: {
  url: string | null;
  nombre: string;
  onRecargar: () => void;
}) {
  const t = useTextos().pacientes.anamnesis;
  const [fallo, setFallo] = useState<string | null>(null);
  if (url === null) {
    return (
      <div className="w-anam-firma__fallo">
        <p className="w-secundario">{t.firmaNoDisponible}</p>
      </div>
    );
  }
  if (fallo === url) {
    return (
      <div className="w-anam-firma__fallo">
        <p className="w-secundario">{t.firmaNoCarga}</p>
        <Boton variante="secundario" icono="sincronizar" onClick={onRecargar}>
          {t.recargarFirma}
        </Boton>
      </div>
    );
  }
  return (
    <img
      className="w-anam-firma__imagen"
      src={url}
      alt={t.firmaAlt(nombre)}
      onError={() => setFallo(url)}
    />
  );
}

/** Una versión de la anamnesis, de solo lectura. */
export function VistaAnamnesis({
  anamnesis: a,
  onRecargar,
}: {
  anamnesis: Anamnesis;
  onRecargar: () => void;
}) {
  const t = useTextos().pacientes.anamnesis;
  const { sesion } = useSesionLista();
  const zona = sesion.clinica.zonaHoraria;
  const sv = a.signosVitales;
  const signos: [string, string][] = [];
  if (sv.presionSistolica !== null || sv.presionDiastolica !== null)
    signos.push([t.presion, t.presionValor(sv.presionSistolica, sv.presionDiastolica)]);
  if (sv.pulso !== null) signos.push([t.pulso, t.pulsoValor(sv.pulso)]);
  if (sv.pesoKg !== null) signos.push([t.peso, t.pesoValor(sv.pesoKg)]);

  return (
    <div className="w-anam-vista">
      <p className="w-secundario">
        {t.registrada(formatoFechaHora(a.fecha, zona), a.registradaPor)}
      </p>

      {/* La región la pone `AlertaClinica` (con este nombre): no se duplica con otra sección. */}
      <div className="w-anam-bloque">
        <h3 className="w-anam-bloque__titulo">{t.alertasVersion}</h3>
        {a.alertasMedicas.length ? (
          <AlertaClinica
            compacta
            etiqueta={t.alertasVersion}
            alertas={a.alertasMedicas.map((m) => ({ tipo: m.tipo, texto: textoAlertaMedica(m) }))}
          />
        ) : (
          <p className="w-secundario">{t.sinAlertasVersion}</p>
        )}
      </div>

      {SECCIONES_ANAMNESIS.map((s) => {
        const respuestas = a.respuestas.filter((r) => r.seccion === s.numero);
        return (
          <Bloque key={s.numero} titulo={`${s.numero}. ${s.titulo}`}>
            {respuestas.length ? (
              <dl className="w-anam-respuestas">
                {respuestas.map((r) => (
                  <div key={r.codigo} className="w-anam-respuesta">
                    <dt className="w-anam-respuesta__pregunta">{r.pregunta}</dt>
                    <ValorRespuesta r={r} />
                  </div>
                ))}
              </dl>
            ) : (
              <p className="w-secundario">{t.sinRespuestasSeccion}</p>
            )}
          </Bloque>
        );
      })}

      <Bloque titulo={t.signos}>
        {signos.length ? (
          <dl className="w-datos">
            {signos.map(([etiqueta, valor]) => (
              <div key={etiqueta}>
                <dt>{etiqueta}</dt>
                <dd>{valor}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="w-secundario">{t.sinSignos}</p>
        )}
      </Bloque>

      <Bloque titulo={t.firma}>
        <p>{t.declaro}</p>
        <ImagenFirma url={a.firmaUrl} nombre={a.firmante.nombre} onRecargar={onRecargar} />
        <p className="w-secundario">
          {a.firmante.esTutor
            ? t.firmoTutor(a.firmante.nombre, a.firmante.ci ? formatoCi(a.firmante.ci) : null)
            : t.firmo(a.firmante.nombre)}
        </p>
      </Bloque>
    </div>
  );
}
