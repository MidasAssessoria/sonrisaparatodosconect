import type { InvitacionCreada, Persona } from '@conecta/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { HojaConfirmar, HojaConMotivo } from './componentes.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { useActualizarEquipo } from './consultas.js';
import { T } from './textos.js';

type Objetivo = { tipo: 'reenviar' | 'anular'; persona: Persona } | null;

/** «Reenviar» (enlace nuevo) y «Anular» (con motivo) de una invitación pendiente. */
export function useAccionesInvitacion({
  onEnlace,
  onAnulada,
}: {
  onEnlace: (inv: InvitacionCreada) => void;
  onAnulada: (persona: Persona) => void;
}) {
  const { api } = useSesionLista();
  const actualizar = useActualizarEquipo();
  const unaVez = useEnvioUnico();
  const [objetivo, setObjetivo] = useState<Objetivo>(null);

  const reenviar = useMutation({
    mutationFn: (p: Persona) => api.invitaciones.reenviar(p.membresiaId),
    onSuccess: async (inv) => {
      setObjetivo(null);
      onEnlace(inv);
      await actualizar(inv.persona);
    },
  });
  const anular = useMutation({
    mutationFn: ({ p, motivo }: { p: Persona; motivo: string }) =>
      api.invitaciones.anular(p.membresiaId, { motivo }),
    onSuccess: async (_r, { p }) => {
      setObjetivo(null);
      onAnulada(p);
      await actualizar();
    },
  });

  const cerrar = () => setObjetivo(null);
  const persona = objetivo?.persona;

  const hojas = (
    <>
      <HojaConfirmar
        abierta={objetivo?.tipo === 'reenviar'}
        titulo={T.reenviar.titulo(persona?.nombre ?? '')}
        texto={T.reenviar.texto}
        confirmar={T.reenviar.confirmar}
        onCerrar={cerrar}
        onConfirmar={() => {
          if (persona) void unaVez(() => reenviar.mutateAsync(persona).catch(() => undefined));
        }}
        enviando={reenviar.isPending}
        error={reenviar.error}
      />
      {objetivo?.tipo === 'anular' ? (
        <HojaConMotivo
          abierta
          titulo={T.anular.titulo(objetivo.persona.nombre)}
          texto={T.anular.texto}
          confirmar={T.anular.confirmar}
          onCerrar={cerrar}
          onConfirmar={(motivo) =>
            void unaVez(() =>
              anular.mutateAsync({ p: objetivo.persona, motivo }).catch(() => undefined),
            )
          }
          enviando={anular.isPending}
          error={anular.error}
        />
      ) : null}
    </>
  );

  return {
    abrirReenviar: (p: Persona) => {
      reenviar.reset();
      setObjetivo({ tipo: 'reenviar', persona: p });
    },
    abrirAnular: (p: Persona) => {
      anular.reset();
      setObjetivo({ tipo: 'anular', persona: p });
    },
    hojas,
  };
}
