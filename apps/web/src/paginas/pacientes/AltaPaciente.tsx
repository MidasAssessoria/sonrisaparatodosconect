import type { CrearPaciente } from '@conecta/shared';
import { Boton, HojaInferior } from '@conecta/ui';
import { useMutation } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { ErrorCiDuplicada } from '../../api/errores.js';
import { useEnvioUnico } from '../../componentes/useEnvioUnico.js';
import { useTextos } from '../../i18n/idioma.js';
import { useSesionLista } from '../../sesion/ProveedorSesion.js';
import { AvisoCiDuplicada } from './AvisoCiDuplicada.js';
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
  /** Último cuerpo enviado: «Guardar igual» lo reenvía confirmando la CI duplicada. */
  const [ultimo, setUltimo] = useState<CrearPaciente | null>(null);

  const crear = useMutation({
    mutationFn: (datos: CrearPaciente) => api.pacientes.crear(datos),
    onSuccess: (p) => {
      actualizar.ficha(p);
      onCerrar();
      void navegar(`/pacientes/${p.id}`);
    },
  });

  const enviar = (datos: CrearPaciente) => {
    setUltimo(datos);
    void unaVez(() => crear.mutateAsync(datos).catch(() => undefined));
  };

  const duplicada = crear.error instanceof ErrorCiDuplicada ? crear.error : null;
  const cerrar = () => {
    crear.reset();
    setUltimo(null);
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
              crear.reset();
              enviar(d as CrearPaciente);
            }}
            error={duplicada ? undefined : (crear.error ?? undefined)}
          />
          {duplicada && ultimo ? (
            <AvisoCiDuplicada
              existente={duplicada.existente}
              guardando={crear.isPending}
              onAbrir={() => {
                cerrar();
                void navegar(`/pacientes/${duplicada.existente.id}`);
              }}
              onGuardarIgual={() => enviar({ ...ultimo, confirmarCiDuplicada: true })}
            />
          ) : null}
        </>
      ) : null}
    </HojaInferior>
  );
}
