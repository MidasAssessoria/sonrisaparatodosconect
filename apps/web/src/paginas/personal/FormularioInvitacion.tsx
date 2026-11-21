import { crearInvitacionSchema, type CrearInvitacion, type Rol } from '@conecta/shared';
import { Campo } from '@conecta/ui';
import { useState, type FormEvent } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { ElegirSedes } from './componentes.js';
import { T } from './textos.js';

type Errores = Partial<Record<'nombre' | 'email' | 'rolId' | 'sedeDefectoId', string>>;

export function validarInvitacion(d: {
  nombre: string;
  email: string;
  rolId: string;
  sedeIds: string[];
  sedeDefectoId: string;
}): { ok: true; datos: CrearInvitacion } | { ok: false; errores: Errores } {
  const r = crearInvitacionSchema.safeParse({
    nombre: d.nombre,
    email: d.email,
    rolId: d.rolId,
    sedeIds: d.sedeIds,
    ...(d.sedeDefectoId ? { sedeDefectoId: d.sedeDefectoId } : {}),
  });
  if (r.success) return { ok: true, datos: r.data };
  const errores: Errores = {};
  for (const issue of r.error.issues) {
    const campo = issue.path[0] as keyof Errores | undefined;
    if (!campo || errores[campo]) continue;
    errores[campo] =
      campo === 'rolId'
        ? T.invitar.faltaRol
        : campo === 'nombre' && issue.code === 'too_big'
          ? 'El nombre puede tener hasta 120 caracteres.'
          : campo === 'email'
            ? 'Escribí un correo válido.'
            : issue.message;
  }
  return { ok: false, errores };
}

/** Alta de invitación. El botón de envío vive en las acciones de la hoja y apunta al form por `id`. */
export function FormularioInvitacion({
  id,
  roles,
  sedes,
  onEnviar,
  error,
}: {
  id: string;
  roles: Rol[];
  sedes: { id: string; nombre: string }[];
  onEnviar: (datos: CrearInvitacion) => void;
  error?: unknown;
}) {
  const [d, setD] = useState({
    nombre: '',
    email: '',
    rolId: '',
    sedeIds: sedes.length === 1 && sedes[0] ? [sedes[0].id] : ([] as string[]),
    sedeDefectoId: '',
  });
  const [errores, setErrores] = useState<Errores>({});

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = validarInvitacion(d);
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    onEnviar(r.datos);
  }

  return (
    <form id={id} className="w-formulario" onSubmit={enviar} noValidate>
      <Campo
        etiqueta={T.invitar.nombre}
        requerido
        autoComplete="off"
        maxLength={120}
        value={d.nombre}
        onChange={(e) => setD({ ...d, nombre: e.target.value })}
        error={errores.nombre}
      />
      <Campo
        etiqueta={T.invitar.correo}
        tipo="email"
        inputMode="email"
        autoComplete="off"
        requerido
        maxLength={254}
        value={d.email}
        onChange={(e) => setD({ ...d, email: e.target.value })}
        error={errores.email}
      />
      <Campo
        etiqueta={T.invitar.rol}
        tipo="select"
        requerido
        value={d.rolId}
        opciones={[
          { valor: '', texto: T.invitar.elegiRol },
          ...roles.map((r) => ({ valor: r.id, texto: r.nombre })),
        ]}
        onChange={(e) => setD({ ...d, rolId: e.target.value })}
        error={errores.rolId}
      />
      <ElegirSedes
        sedes={sedes}
        elegidas={d.sedeIds}
        defecto={d.sedeDefectoId}
        onCambio={(sedeIds, sedeDefectoId) => setD({ ...d, sedeIds, sedeDefectoId })}
        error={errores.sedeDefectoId}
      />
      {error ? <MensajeError error={error} /> : null}
    </form>
  );
}
