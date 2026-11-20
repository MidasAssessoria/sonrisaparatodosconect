import { AvisoExito, Boton, Chip, EncabezadoPagina, HojaInferior } from '@conecta/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { InscripcionTotp } from '../auth/servicioAuth.js';
import { CampoCodigo } from '../componentes/CampoCodigo.js';
import { Esqueleto, MensajeError } from '../componentes/estados.js';
import { useTextos } from '../i18n/idioma.js';
import { useSesionLista } from '../sesion/ProveedorSesion.js';
import { mensajeAuth, RE_CODIGO } from './acceso/textosError.js';

const CLAVE_FACTORES = ['auth', 'factores'] as const;

/** Seguridad de la cuenta: activar y quitar el doble factor (TOTP de Supabase). */
export function Seguridad() {
  const t = useTextos();
  const { auth, recargarSesion } = useSesionLista();
  const consultas = useQueryClient();
  const factores = useQuery({ queryKey: CLAVE_FACTORES, queryFn: () => auth.factoresTotp() });

  const [inscripcion, setInscripcion] = useState<InscripcionTotp | null>(null);
  const [codigo, setCodigo] = useState('');
  const [errorCodigo, setErrorCodigo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [exito, setExito] = useState<{ titulo: string; texto?: string } | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);

  const verificado = factores.data?.find((f) => f.verificado) ?? null;

  async function refrescar() {
    await consultas.invalidateQueries({ queryKey: CLAVE_FACTORES });
    await recargarSesion();
  }

  async function empezar() {
    setError(null);
    setExito(null);
    setOcupado(true);
    try {
      setInscripcion(await auth.inscribirTotp(t.seguridad.nombreFactor));
      setCodigo('');
    } catch (e) {
      setError(mensajeAuth(e, t));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!inscripcion) return;
    if (!RE_CODIGO.test(codigo)) {
      setErrorCodigo(t.segundoFactor.formato);
      return;
    }
    setErrorCodigo(null);
    setError(null);
    setOcupado(true);
    try {
      await auth.verificarCodigo(inscripcion.factorId, codigo);
      setInscripcion(null);
      setExito({ titulo: t.seguridad.activado, texto: t.seguridad.activadoTexto });
      await refrescar();
    } catch (ex) {
      setError(mensajeAuth(ex, t));
      setCodigo('');
    } finally {
      setOcupado(false);
    }
  }

  async function quitar() {
    if (!verificado) return;
    setError(null);
    setOcupado(true);
    try {
      await auth.quitarFactor(verificado.id);
      setConfirmarQuitar(false);
      setExito({ titulo: t.seguridad.quitado });
      await refrescar();
    } catch (ex) {
      setConfirmarQuitar(false);
      setError(mensajeAuth(ex, t));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <EncabezadoPagina titulo={t.seguridad.titulo} />
      {exito ? (
        <AvisoExito titulo={exito.titulo} texto={exito.texto} onCerrar={() => setExito(null)} />
      ) : null}
      <section className="w-tarjeta" aria-labelledby="w-seguridad-mfa">
        <div className="w-tarjeta__cabecera">
          <h2 id="w-seguridad-mfa" className="w-seccion__titulo">
            {t.seguridad.dobleFactor}
          </h2>
          {factores.isSuccess ? (
            verificado ? (
              <Chip tono="exito">{t.seguridad.activo}</Chip>
            ) : (
              <Chip tono="atencion">{t.seguridad.inactivo}</Chip>
            )
          ) : null}
        </div>
        <p>{t.seguridad.explicacion}</p>

        {factores.isPending ? <Esqueleto filas={2} etiqueta={t.comun.cargando} /> : null}
        {factores.isError ? (
          <MensajeError error={factores.error} onReintentar={() => void factores.refetch()} />
        ) : null}
        {error ? <MensajeError texto={error} /> : null}

        {factores.isSuccess && verificado ? (
          <Boton variante="peligro" onClick={() => setConfirmarQuitar(true)}>
            {t.seguridad.quitar}
          </Boton>
        ) : null}

        {factores.isSuccess && !verificado && !inscripcion ? (
          <Boton
            variante="primario"
            icono="candado"
            cargando={ocupado}
            onClick={() => void empezar()}
          >
            {t.seguridad.activar}
          </Boton>
        ) : null}

        {inscripcion ? (
          <form
            className="w-formulario w-inscripcion"
            onSubmit={(e) => void confirmar(e)}
            noValidate
          >
            <ol className="w-pasos">
              <li>
                <p>{t.seguridad.paso1}</p>
                <img
                  className="w-qr"
                  src={inscripcion.qr}
                  alt="Código QR para la app de autenticación"
                  width={200}
                  height={200}
                />
                <p className="w-secundario">{t.seguridad.claveManual}</p>
                <code className="w-clave-manual">{inscripcion.secreto}</code>
              </li>
              <li>
                <p>{t.seguridad.paso2}</p>
                <CampoCodigo valor={codigo} onCambio={setCodigo} error={errorCodigo} />
              </li>
            </ol>
            <div className="w-botonera">
              <Boton type="submit" variante="primario" cargando={ocupado}>
                {t.seguridad.confirmar}
              </Boton>
              <Boton variante="fantasma" onClick={() => setInscripcion(null)}>
                {t.comun.cancelar}
              </Boton>
            </div>
          </form>
        ) : null}
      </section>

      <HojaInferior
        abierta={confirmarQuitar}
        titulo={t.seguridad.quitarTitulo}
        onCerrar={() => setConfirmarQuitar(false)}
        acciones={
          <>
            <Boton variante="secundario" onClick={() => setConfirmarQuitar(false)}>
              {t.comun.cancelar}
            </Boton>
            <Boton variante="peligro" cargando={ocupado} onClick={() => void quitar()}>
              {t.seguridad.quitarConfirmar}
            </Boton>
          </>
        }
      >
        <p>{t.seguridad.quitarTexto}</p>
      </HojaInferior>
    </>
  );
}
