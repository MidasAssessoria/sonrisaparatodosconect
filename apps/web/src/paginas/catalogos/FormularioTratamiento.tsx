import {
  crearTratamientoSchema,
  TASAS_IVA,
  type CrearTratamiento,
  type TasaIva,
  type Tratamiento,
} from '@conecta/shared';
import { Campo } from '@conecta/ui';
import { useId, useState, type FormEvent } from 'react';
import { MensajeError } from '../../componentes/estados.js';
import { conMiles, montoDesdeTexto, soloDigitos, TEXTO_IVA, textoMinutos } from './formato.js';

type CampoForm = 'nombre' | 'categoria' | 'precio' | 'iva' | 'duracionMin';
type Errores = Partial<Record<CampoForm, string>>;

export interface DatosTratamiento {
  nombre: string;
  categoria: string;
  /** Lo que se ve en el campo, con separador de miles: «300.000». */
  precio: string;
  iva: TasaIva;
  duracionMin: number;
}

export function datosTratamiento(t?: Tratamiento): DatosTratamiento {
  return {
    nombre: t?.nombre ?? '',
    categoria: t?.categoria ?? '',
    precio: t ? conMiles(String(t.precio)) : '',
    iva: t?.iva ?? 10,
    duracionMin: t?.duracionMin ?? 30,
  };
}

const DURACIONES = Array.from({ length: 96 }, (_, i) => (i + 1) * 5);

/** Valida con el contrato; el precio va entero (sin separadores). */
export function validarTratamiento(
  d: DatosTratamiento,
): { ok: true; datos: CrearTratamiento } | { ok: false; errores: Errores } {
  const precio = montoDesdeTexto(d.precio);
  const errores: Errores = {};
  if (precio === null) errores.precio = 'Poné el precio en guaraníes (puede ser 0).';
  const r = crearTratamientoSchema.safeParse({
    nombre: d.nombre,
    ...(d.categoria.trim() ? { categoria: d.categoria } : {}),
    precio: precio ?? 0,
    iva: d.iva,
    duracionMin: d.duracionMin,
  });
  if (r.success && !errores.precio) return { ok: true, datos: r.data };
  if (!r.success) {
    for (const issue of r.error.issues) {
      const campo = issue.path[0] as CampoForm | undefined;
      if (!campo || errores[campo]) continue;
      errores[campo] =
        campo === 'nombre'
          ? issue.code === 'too_big'
            ? 'El nombre puede tener hasta 120 caracteres.'
            : 'Poné el nombre del tratamiento.'
          : campo === 'categoria'
            ? 'La categoría puede tener hasta 60 caracteres.'
            : campo === 'precio'
              ? 'El precio va de Gs. 0 a Gs. 999.999.999.'
              : issue.message;
    }
  }
  return { ok: false, errores };
}

export function FormularioTratamiento({
  id,
  inicial,
  categorias,
  onGuardar,
  error,
}: {
  id: string;
  inicial: DatosTratamiento;
  /** Categorías que ya existen, como sugerencia. */
  categorias: string[];
  onGuardar: (datos: CrearTratamiento) => void;
  error?: unknown;
}) {
  const [d, setD] = useState(inicial);
  const [errores, setErrores] = useState<Errores>({});
  const idLista = useId();

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = validarTratamiento(d);
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    setErrores({});
    onGuardar(r.datos);
  }

  return (
    <form id={id} className="w-formulario" onSubmit={enviar} noValidate>
      <Campo
        etiqueta="Nombre"
        requerido
        value={d.nombre}
        maxLength={120}
        placeholder="Limpieza dental"
        onChange={(e) => setD({ ...d, nombre: e.target.value })}
        error={errores.nombre}
      />
      <Campo
        etiqueta="Categoría"
        value={d.categoria}
        maxLength={60}
        list={idLista}
        placeholder="Prevención"
        onChange={(e) => setD({ ...d, categoria: e.target.value })}
        error={errores.categoria}
      />
      <datalist id={idLista}>
        {categorias.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Campo
        className="w-campo-monto"
        etiqueta="Precio en guaraníes"
        requerido
        inputMode="numeric"
        autoComplete="off"
        value={d.precio}
        placeholder="300.000"
        ayuda="IVA incluido. Cambiar el precio no toca presupuestos ya hechos."
        onChange={(e) => setD({ ...d, precio: conMiles(soloDigitos(e.target.value)) })}
        error={errores.precio}
      />
      <Campo
        etiqueta="IVA"
        tipo="select"
        value={String(d.iva)}
        opciones={TASAS_IVA.map((t) => ({ valor: String(t), texto: TEXTO_IVA[t] }))}
        onChange={(e) => setD({ ...d, iva: Number(e.target.value) as TasaIva })}
        error={errores.iva}
      />
      <Campo
        etiqueta="Duración"
        tipo="select"
        value={String(d.duracionMin)}
        opciones={(DURACIONES.includes(d.duracionMin)
          ? DURACIONES
          : [d.duracionMin, ...DURACIONES]
        ).map((m) => ({ valor: String(m), texto: textoMinutos(m) }))}
        onChange={(e) => setD({ ...d, duracionMin: Number(e.target.value) })}
        error={errores.duracionMin}
      />
      {error ? <MensajeError error={error} /> : null}
    </form>
  );
}
