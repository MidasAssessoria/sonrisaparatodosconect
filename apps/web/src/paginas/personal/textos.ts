import type { Accion, EstadoMembresia, Modulo } from '@conecta/shared';
import type { IconoNombre, Tono } from '@conecta/ui';

/*
 * Textos de Equipo, Roles e Invitación. Viven acá mientras el módulo de idioma general (`i18n/es.ts`)
 * no los incorpore; el orquestador puede moverlos tal cual.
 */

/** Nombres legibles de los módulos de permisos (nunca el código). */
export const NOMBRE_MODULO: Record<Modulo, string> = {
  inicio: 'Inicio',
  agenda: 'Agenda',
  pacientes: 'Pacientes',
  ficha_clinica: 'Ficha clínica',
  presupuestos: 'Presupuestos',
  caja: 'Caja',
  contabilidad: 'Contabilidad',
  reportes: 'Reportes',
  personal: 'Equipo',
  inventario: 'Inventario',
  mensajeria: 'Mensajería',
  sedes: 'Sedes',
  auditoria: 'Auditoría',
  configuracion: 'Configuración',
};

export const NOMBRE_ACCION: Record<Accion, string> = {
  ver: 'Ver',
  crear: 'Crear',
  editar: 'Editar',
  anular: 'Anular',
  exportar: 'Exportar',
};

export const TEXTO_ESTADO_PERSONA: Record<EstadoMembresia, string> = {
  activo: 'Activo',
  pendiente: 'Pendiente de aceptar',
  inactivo: 'Inactivo',
};

/** Estado = color + ícono + texto. */
export function infoEstadoPersona(estado: EstadoMembresia): {
  tono: Tono;
  icono: IconoNombre;
  texto: string;
} {
  switch (estado) {
    case 'activo':
      return { tono: 'exito', icono: 'check', texto: TEXTO_ESTADO_PERSONA.activo };
    case 'pendiente':
      return { tono: 'atencion', icono: 'reloj', texto: TEXTO_ESTADO_PERSONA.pendiente };
    case 'inactivo':
      return { tono: 'neutro', icono: 'cerrar', texto: TEXTO_ESTADO_PERSONA.inactivo };
  }
}

export const T = {
  equipo: {
    titulo: 'Equipo',
    invitar: 'Invitar',
    cargando: 'Cargando el equipo',
    vacio: 'Todavía no hay nadie más en el equipo.',
    vacioTexto: 'Invitá a la primera persona para que entre con su rol.',
    vacioFiltro: 'No hay personas con ese estado.',
    tituloTabla: 'Personas del equipo',
    filtro: 'Filtrar por estado',
    todos: 'Todos',
    nuncaIngreso: 'Todavía no ingresó',
    sinSedes: 'Sin sedes asignadas',
    sedeOculta: (n: number) => (n === 1 ? '1 sede que no ves' : `${n} sedes que no ves`),
    venceEl: (fecha: string) => `El enlace vence el ${fecha}`,
    vencido: 'El enlace ya venció',
    reenviar: 'Reenviar',
    anular: 'Anular',
    roles: 'Roles y permisos',
  },
  invitar: {
    titulo: 'Invitar a una persona',
    nombre: 'Nombre y apellido',
    correo: 'Correo',
    rol: 'Rol',
    elegiRol: 'Elegí un rol',
    sedes: 'Sedes donde trabaja',
    sedesAyuda: 'Solo aparecen las sedes que vos podés ver.',
    sedeDefecto: 'Sede por defecto',
    sinSedeDefecto: 'Sin sede por defecto',
    enviar: 'Crear invitación',
    cancelar: 'Cancelar',
    cargandoRoles: 'Cargando roles…',
    faltaRol: 'Elegí el rol.',
    errorRoles: 'No pudimos cargar los roles. Cerrá y probá de nuevo.',
  },
  enlace: {
    tituloNueva: (nombre: string) => `Invitación para ${nombre} creada`,
    tituloReenvio: (nombre: string) => `Enlace nuevo para ${nombre}`,
    unaVez:
      'Este enlace se muestra una sola vez. Copialo o mandalo ahora: si lo perdés, usá «Reenviar» para generar otro.',
    queRecibe:
      'Si esa persona todavía no tiene cuenta en Conecta, le llega un correo para crear su contraseña. Si ya tiene cuenta, entra con su correo y su contraseña de siempre.',
    anteriorAnulado: 'El enlace anterior ya no sirve.',
    vence: (fecha: string) => `Vence el ${fecha}.`,
    etiqueta: 'Enlace de la invitación',
    copiar: 'Copiar enlace',
    copiado: 'Enlace copiado',
    noSeCopio: 'No pudimos copiarlo solo. Seleccioná el enlace y copialo a mano.',
    whatsapp: 'Enviar por WhatsApp',
    listo: 'Listo, ya lo mandé',
    mensajeWhatsapp: (nombre: string, clinica: string, url: string, vence: string) =>
      `Hola ${nombre}, te invitamos a sumarte al equipo de ${clinica} en Sonrisa Para Todos Conecta. ` +
      `Si todavía no tenés cuenta, te va a llegar un correo para crear tu contraseña: abrilo desde este mismo teléfono o computadora. ` +
      `Si ya tenés cuenta, entrá con tu correo y tu contraseña. ` +
      `La invitación está en este enlace: ${url} (vence el ${vence}).`,
  },
  reenviar: {
    titulo: (nombre: string) => `Reenviar la invitación de ${nombre}`,
    texto:
      'Se genera un enlace nuevo y el anterior deja de servir. Vas a poder copiarlo o mandarlo por WhatsApp.',
    confirmar: 'Generar enlace nuevo',
  },
  anular: {
    titulo: (nombre: string) => `Anular la invitación de ${nombre}`,
    texto:
      'El enlace deja de servir y la persona queda inactiva. Si después querés sumarla, invitala de nuevo.',
    motivo: 'Motivo',
    confirmar: 'Anular invitación',
    hecho: (nombre: string) => `La invitación de ${nombre} quedó anulada.`,
  },
  persona: {
    cargando: 'Cargando la persona',
    noEncontrada: 'No encontramos a esa persona en el equipo.',
    volver: 'Volver al equipo',
    datos: 'Datos',
    correo: 'Correo',
    telefono: 'Teléfono',
    estado: 'Estado',
    rol: 'Rol',
    sedes: 'Sedes',
    sedeDefecto: 'Sede por defecto',
    ultimoAcceso: 'Último acceso',
    dobleFactor: 'Doble factor',
    conDobleFactor: 'Activado',
    sinDobleFactor: 'Sin activar',
    profesional: 'Atiende pacientes',
    verProfesional: 'Ver ficha de profesional',
    editar: 'Editar rol y sedes',
    tituloEditar: 'Editar rol y sedes',
    guardar: 'Guardar cambios',
    guardado: 'Cambios guardados',
    desactivar: 'Desactivar',
    tituloDesactivar: (nombre: string) => `Desactivar a ${nombre}`,
    textoDesactivar:
      'Pierde el acceso en el acto. No se borra nada: sus registros siguen a su nombre y podés reactivarla después.',
    confirmarDesactivar: 'Confirmar desactivación',
    desactivada: 'La persona quedó desactivada.',
    reactivar: 'Reactivar',
    reactivada: 'La persona volvió a tener acceso.',
    propia:
      'Esta es tu cuenta. Tu rol y tus sedes los cambia otra persona con permiso sobre el equipo: nadie edita su propio acceso.',
    anuladaSinUsuario:
      'La invitación se anuló antes de que la aceptara. Para sumarla, invitala de nuevo desde Equipo.',
    sedesOcultas: 'Además trabaja en sedes que vos no ves; esas no cambian.',
    fueraDeAlcance:
      'Esta persona trabaja también en sedes que vos no ves: sus cambios los hace alguien que vea todas sus sedes.',
  },
  roles: {
    titulo: 'Roles y permisos',
    nuevo: 'Nuevo rol',
    cargando: 'Cargando roles',
    tituloTabla: 'Roles de la clínica',
    vacio: 'Todavía no hay roles.',
    personas: (n: number) => (n === 1 ? '1 persona' : `${n} personas`),
    sistema: 'De sistema',
    propio: 'De la clínica',
    activo: 'Activo',
    inactivo: 'Inactivo',
    ver: (nombre: string) => `Ver permisos de ${nombre}`,
    permisos: 'Permisos por módulo',
    todasLasSedes: 'Ve todas las sedes',
    soloSusSedes: 'Solo las sedes asignadas',
    exigeMfa: 'Exige doble factor',
    noExigeMfa: 'No exige doble factor',
    inactividad: (min: number) => `Cierra la sesión tras ${min} minutos sin uso`,
    permitido: 'permitido',
    noPermitido: 'no permitido',
    editar: 'Editar rol',
    cerrar: 'Cerrar detalle',
    duenoSoloLectura:
      'El rol Dueño/a no se edita: tiene todos los permisos y es el que sostiene la clínica.',
    propioSoloLectura: 'Este es tu rol: lo edita otra persona con permiso de configuración.',
    sistemaNoRenombra: 'Es un rol de sistema: podés cambiar sus permisos, no su nombre.',
    nombre: 'Nombre del rol',
    campoTodasLasSedes: 'Ve todas las sedes de la clínica',
    campoExigeMfa: 'Exige doble factor para entrar',
    campoInactividad: 'Minutos sin uso hasta cerrar la sesión',
    inactividadAyuda: 'Entre 5 y 240 minutos.',
    inactividadError: 'Poné un número entre 5 y 240.',
    guardar: 'Guardar rol',
    crear: 'Crear rol',
    cancelar: 'Cancelar',
    guardado: (nombre: string) => `Rol «${nombre}» guardado`,
    creado: (nombre: string) => `Rol «${nombre}» creado`,
    marcarFila: (modulo: string) => `Todo ${modulo}`,
    volverEquipo: 'Volver al equipo',
    sistemaSoloDueno: 'Es un rol de sistema: solo lo edita el Dueño/a de la clínica.',
    fueraDeLimites:
      'Este rol da permisos que vos no tenés: lo edita alguien que los tenga (o el Dueño/a).',
    soloLoQueTenes: 'Solo podés dar los permisos que vos tenés; los demás quedan sin marcar.',
    sinTodasLasSedes: 'Vos no ves todas las sedes, así que tampoco podés darlo.',
    mfaFijo: 'Este rol siempre exige doble factor.',
    desactivar: 'Desactivar rol',
    tituloDesactivar: (nombre: string) => `Desactivar el rol «${nombre}»`,
    textoDesactivar:
      'No se puede asignar a nadie más. No se borra: queda en la lista como inactivo y en la auditoría.',
    confirmarDesactivar: 'Confirmar desactivación',
    desactivado: (nombre: string) => `El rol «${nombre}» quedó desactivado.`,
  },
  aceptar: {
    titulo: 'Invitación al equipo',
    cargando: 'Buscando la invitación…',
    invalidoTitulo: 'Este enlace ya no sirve',
    invalidoTexto:
      'Puede que haya vencido, que ya se haya usado o que te hayan mandado uno más nuevo. Pedile a quien te invitó que te mande un enlace nuevo.',
    correoVencidoTitulo: 'El enlace del correo ya no sirve',
    correoVencidoTexto:
      'Los enlaces del correo se usan una sola vez y vencen. Pedile a quien te invitó que reenvíe la invitación: te llega un correo nuevo.',
    irAIngresar: 'Ir a ingresar',
    teInvitan: (clinica: string) => `Te invitan a sumarte a ${clinica}`,
    clinica: 'Clínica',
    rol: 'Rol',
    nombre: 'Nombre',
    correo: 'Correo',
    vence: 'La invitación vence',
    // Cuenta nueva, sin sesión: el correo de Supabase trae la sesión.
    revisaTuCorreoTitulo: 'Revisá tu correo',
    revisaTuCorreo: (mascara: string) =>
      `Te mandamos un correo a ${mascara}: abrilo para crear tu contraseña.`,
    revisaTuCorreoAyuda:
      'Abrilo en este mismo dispositivo. Si no lo ves en unos minutos, buscá en la carpeta de correo no deseado.',
    // Cuenta nueva, de vuelta desde el correo (ya con sesión)
    crearClave: 'Elegí tu contraseña para entrar a Conecta.',
    clave: 'Contraseña',
    claveAyuda: 'Al menos 10 caracteres.',
    repetir: 'Repetí la contraseña',
    faltaClave: 'Escribí una contraseña.',
    claveCorta: 'Usá al menos 10 caracteres.',
    claveLarga: 'Usá hasta 72 caracteres.',
    noCoinciden: 'Las contraseñas no coinciden. Escribilas de nuevo.',
    crearYEntrar: 'Guardar contraseña y unirme',
    // Cuenta existente
    yaTenesCuenta:
      'Ese correo ya tiene una cuenta en Conecta. Ingresá con tu contraseña de siempre para sumar esta clínica.',
    correoAyuda: (mascara: string) => `Es el correo de la invitación: ${mascara}`,
    faltaCorreo: 'Escribí tu correo.',
    correoInvalido: 'Escribí un correo válido.',
    otroCorreoEscrito: (mascara: string) =>
      `Ese no es el correo de la invitación (${mascara}). Escribí ese correo.`,
    ingresarYAceptar: 'Ingresar y aceptar',
    // Con sesión
    unirme: (clinica: string) => `Unirme a ${clinica}`,
    uniendo: 'Sumándote a la clínica…',
    otraCuentaTitulo: 'Tenés abierta otra cuenta',
    otraCuentaTexto: (actual: string, mascara: string) =>
      `Ingresaste como ${actual}, y esta invitación es para ${mascara}. Cerrá la sesión para seguir con el correo de la invitación.`,
    cerrarYSeguir: 'Cerrar sesión y seguir',
  },
} as const;
