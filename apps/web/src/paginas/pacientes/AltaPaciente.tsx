import type { CrearPaciente } from '@conecta/shared';
import { Boton, HojaInferior } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useRef } from 'react';
import { useNavigate } from 'react-router';
import { ErrorCiDuplicada } from '../../api/errores.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { AvisoCiDuplicada, enviarConfirmando } from './AvisoCiDuplicada.js';
import { useActualizarPacientes } from './consultas.js';
import { FormularioPaciente } from './FormularioPaciente.js';

/** Hoja «Nuevo paciente». Al guardar abre la ficha. */
export function AltaPaciente({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const t = useTextos().pacientes;
  const { api } = useSesionLista();
  const navegar = useNavigate();
  const actualizar = useActualizarPacientes();
  const unaVez = useEnvioUnico();
  const idForm = useId();
  /** El próximo envío del formulario va con `confirmarCiDuplicada` («Guardar igual»). */
  const confirmar = useRef(false);

  const crear = useMutation({
    mutationFn: (datos: CrearPaciente) => api.pacientes.crear(datos),
    onSuccess: (p) => {
      actualizar.ficha(p);
      onCerrar();
      void navegar(`/pacientes/${p.id}`);
    },
  });

  const enviar = (datos: CrearPaciente) => {
    void unaVez(() => crear.mutateAsync(datos).catch(() => undefined));
  };

  const duplicada = crear.error instanceof ErrorCiDuplicada ? crear.error : null;
  const cerrar = () => {
    crear.reset();
    onCerrar();
  };

  return (
    <HojaInferior
      abierta={abierta}
      titulo={t.alta.titulo}
      onCerrar={cerrar}
      acciones={
        <>
          <Boton variante="secundario" onClick={cerrar}>
            {t.alta.cancelar}
          </Boton>
          <Boton type="submit" form={idForm} variante="primario" cargando={crear.isPending}>
            {t.alta.guardar}
          </Boton>
        </>
      }
    >
      {abierta ? (
        <>
          <FormularioPaciente
            id={idForm}
            onEnviar={(d) => {
              const datos = d as CrearPaciente;
              crear.reset();
              enviar(confirmar.current ? { ...datos, confirmarCiDuplicada: true } : datos);
            }}
            // Lo que se cambie después del 409 deja viejo el aviso: se oculta.
            onCambio={() => {
              if (crear.error instanceof ErrorCiDuplicada) crear.reset();
            }}
            error={duplicada ? undefined : (crear.error ?? undefined)}
          />
          {duplicada ? (
            <AvisoCiDuplicada
              error={duplicada}
              guardando={crear.isPending}
              onAbrir={(id) => {
                cerrar();
                void navegar(`/pacientes/${id}`);
              }}
              onGuardarIgual={() => enviarConfirmando(idForm, confirmar)}
            />
          ) : null}
        </>
      ) : null}
    </HojaInferior>
  );
}
