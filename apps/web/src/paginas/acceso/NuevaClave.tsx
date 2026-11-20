import { AvisoExito, Boton, Campo } from '@conecta/ui';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { ErrorAuth } from '../../auth/servicioAuth.js';
import { CampoCodigo } from '../../componentes/CampoCodigo.js';
import { MensajeError } from '../../componentes/estados.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesion } from '../../sesion/ProveedorSesion.js';
import { MarcoAcceso } from './MarcoAcceso.js';
import { mensajeAuth, RE_CODIGO } from './textosError.js';

const LARGO_MINIMO = 8;

/**
 * Pantalla del enlace de recuperación. Si la cuenta tiene doble factor, Supabase pide aal2
 * para cambiar la contraseña: primero se pide el código.
 */
export function NuevaClave() {
  const t = useTextos();
  const { auth, estado, terminarRecuperacion } = useSesion();
  const navegar = useNavigate();
  const enRecuperacion = estado.fase === 'recuperacion';
  const [factorPendiente, setFactorPendiente] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [clave, setClave] = useState('');
  const [repetir, setRepetir] = useState('');
  const [errores, setErrores] = useState<{ codigo?: string; clave?: string; repetir?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [lista, setLista] = useState(false);

  useEffect(() => {
    if (!enRecuperacion) return;
    let vigente = true;
    void (async () => {
      try {
        const nivel = await auth.nivel();
        if (nivel.actual === 'aal1' && nivel.siguiente === 'aal2') {
          const factor = (await auth.factoresTotp()).find((f) => f.verificado);
          if (vigente && factor) setFactorPendiente(factor.id);
        }
      } catch {
        // Si no se puede saber, se intenta sin código; Supabase avisa si hace falta.
      }
    })();
    return () => {
      vigente = false;
    };
  }, [auth, enRecuperacion]);

  if (!enRecuperacion && !lista) {
    return (
      <MarcoAcceso titulo={t.nuevaClave.titulo}>
        <MensajeError texto={t.nuevaClave.enlaceVencido} />
        <Boton variante="primario" bloque onClick={() => void navegar('/acceso/recuperar')}>
          {t.recuperar.enviar}
        </Boton>
      </MarcoAcceso>
    );
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const nuevos: typeof errores = {};
    if (factorPendiente && !RE_CODIGO.test(codigo)) nuevos.codigo = t.segundoFactor.formato;
    if (clave.length < LARGO_MINIMO) nuevos.clave = t.nuevaClave.corta;
    else if (clave !== repetir) nuevos.repetir = t.nuevaClave.distintas;
    setErrores(nuevos);
    setErrorGeneral(null);
    if (Object.keys(nuevos).length) return;
    setEnviando(true);
    try {
      if (factorPendiente) {
        await auth.verificarCodigo(factorPendiente, codigo);
        setFactorPendiente(null);
      }
      await auth.cambiarClave(clave);
      setLista(true);
    } catch (ex) {
      if (ex instanceof ErrorAuth && ex.tipo === 'requiere_segundo_factor') {
        const factor = (await auth.factoresTotp()).find((f) => f.verificado);
        if (factor) setFactorPendiente(factor.id);
      }
      setErrorGeneral(mensajeAuth(ex, t));
    } finally {
      setEnviando(false);
    }
  }

  if (lista) {
    return (
      <MarcoAcceso titulo={t.nuevaClave.titulo}>
        <div className="w-formulario">
          <AvisoExito
            titulo={t.nuevaClave.lista}
            accion={
              <Boton variante="primario" onClick={() => void terminarRecuperacion()}>
                {t.nuevaClave.continuar}
              </Boton>
            }
          />
        </div>
      </MarcoAcceso>
    );
  }

  return (
    <MarcoAcceso titulo={t.nuevaClave.titulo}>
      <form className="w-formulario" onSubmit={(e) => void enviar(e)} noValidate>
        {factorPendiente ? (
          <>
            <p className="w-acceso__texto">{t.segundoFactor.texto}</p>
            <CampoCodigo valor={codigo} onCambio={setCodigo} error={errores.codigo} />
          </>
        ) : null}
        <Campo
          etiqueta={t.nuevaClave.clave}
          tipo="password"
          autoComplete="new-password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          ayuda={t.nuevaClave.ayuda}
          error={errores.clave}
        />
        <Campo
          etiqueta={t.nuevaClave.repetir}
          tipo="password"
          autoComplete="new-password"
          value={repetir}
          onChange={(e) => setRepetir(e.target.value)}
          error={errores.repetir}
        />
        {errorGeneral ? <MensajeError texto={errorGeneral} /> : null}
        <Boton type="submit" variante="primario" tamano="lg" bloque cargando={enviando}>
          {t.nuevaClave.guardar}
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
