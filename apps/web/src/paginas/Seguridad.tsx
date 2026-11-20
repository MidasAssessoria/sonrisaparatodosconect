import { AvisoExito, Boton, Chip, EncabezadoPagina, HojaInferior } from '@conecta/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { mensajeDeError } from '../api/errores.js';
import { ActivarTotp } from '../componentes/ActivarTotp.js';
import { AvisoPersistente, Esqueleto, MensajeError } from '../componentes/estados.js';
import { useEnvioUnico } from '../componentes/useEnvioUnico.js';
import { useTextos } from '../i18n/idioma.js';
import { useSesionLista } from '../sesion/ProveedorSesion.js';
import { mensajeAuth } from './acceso/textosError.js';

const CLAVE_FACTORES = ['auth', 'factores'] as const;

/** Seguridad de la cuenta: activar y quitar el doble factor (TOTP de Supabase). */
export function Seguridad() {
  const t = useTextos();
  const { auth, api, sesion, recargarSesion } = useSesionLista();
  const consultas = useQueryClient();
  const unaVez = useEnvioUnico();
  const factores = useQuery({ queryKey: CLAVE_FACTORES, queryFn: () => auth.factoresTotp() });

  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [exito, setExito] = useState<{ titulo: string; texto?: string } | null>(null);
  const [confirmarQuitar, setConfirmarQuitar] = useState(false);
  /** El factor ya se quitó en Supabase pero la API todavía no se enteró. */
  const [avisoPendiente, setAvisoPendiente] = useState(false);

  const verificado = factores.data?.find((f) => f.verificado) ?? null;

  async function refrescar() {
    await consultas.invalidateQueries({ queryKey: CLAVE_FACTORES });
    await recargarSesion();
  }

  /**
   * Después de quitar el factor en Supabase, todavía con el token aal2: avisarle a la API
   * (`DELETE /sesion/mfa`) y recién ahí pedir un token nuevo (aal1). En ese orden: con el token
   * nuevo la API ya no aceptaría el aviso, y la cuenta quedaría trabada pidiendo un código.
   */
  async function avisarYRefrescar() {
    try {
      await api.sesion.quitarMfa();
    } catch (ex) {
      setAvisoPendiente(true);
      setError(`${t.seguridad.avisoFallido} ${mensajeDeError(ex)}`);
      return;
    }
    setAvisoPendiente(false);
    try {
      await auth.refrescarSesion();
    } catch {
      // Si no se pudo refrescar, el token viejo vence solo; la API ya tiene el dato.
    }
    setExito({ titulo: t.seguridad.quitado });
    await refrescar();
  }

  function quitar() {
    if (!verificado) return;
    void unaVez(async () => {
      setError(null);
      setOcupado(true);
      try {
        await auth.quitarFactor(verificado.id);
      } catch (ex) {
        setConfirmarQuitar(false);
        setError(mensajeAuth(ex, t));
        setOcupado(false);
        return;
      }
      setConfirmarQuitar(false);
      try {
        await avisarYRefrescar();
      } finally {
        setOcupado(false);
      }
    });
  }

  function reintentarAviso() {
    void unaVez(async () => {
      setError(null);
      setOcupado(true);
      try {
        await avisarYRefrescar();
      } finally {
        setOcupado(false);
      }
    });
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
              <Chip tono="exito" icono="check">
                {t.seguridad.activo}
              </Chip>
            ) : (
              <Chip tono="atencion" icono="alerta">
                {t.seguridad.inactivo}
              </Chip>
            )
          ) : null}
        </div>
        <p>{t.seguridad.explicacion}</p>

        {factores.isPending ? <Esqueleto filas={2} etiqueta={t.comun.cargando} /> : null}
        {factores.isError ? (
          <MensajeError error={factores.error} onReintentar={() => void factores.refetch()} />
        ) : null}
        {avisoPendiente && error ? (
          <AvisoPersistente
            titulo={error}
            accion={
              <Boton variante="primario" cargando={ocupado} onClick={reintentarAviso}>
                {t.seguridad.terminarQuitar}
              </Boton>
            }
          />
        ) : error ? (
          <MensajeError texto={error} />
        ) : null}

        {factores.isSuccess && verificado && !avisoPendiente ? (
          <Boton variante="peligro" onClick={() => setConfirmarQuitar(true)}>
            {t.seguridad.quitar}
          </Boton>
        ) : null}

        {factores.isSuccess && !verificado && !avisoPendiente ? (
          <ActivarTotp
            onActivado={async () => {
              setExito({ titulo: t.seguridad.activado, texto: t.seguridad.activadoTexto });
              await refrescar();
            }}
          />
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
            <Boton variante="peligro" cargando={ocupado} onClick={quitar}>
              {t.seguridad.quitarConfirmar}
            </Boton>
          </>
        }
      >
        <p>{sesion.rol.exigeMfa ? t.seguridad.quitarTextoExigido : t.seguridad.quitarTexto}</p>
      </HojaInferior>
    </>
  );
}
