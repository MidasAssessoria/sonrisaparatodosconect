/** Textos de la interfaz en español del Paraguay (voseo). Es el idioma completo y el de respaldo. */
export const es = {
  comun: {
    saludo: "Mba'éichapa",
    gracias: 'Aguyje',
    guardar: 'Guardar',
    cancelar: 'Cancelar',
    cerrar: 'Cerrar',
    volver: 'Volver',
    reintentar: 'Probá de nuevo',
    reintentarEn: (seg: number) => `Probá de nuevo en ${seg} s`,
    cargando: 'Cargando…',
    sinAcceso: 'Tu rol no tiene acceso a esto',
    sinAccesoTexto: 'Si necesitás entrar acá, pedile a la persona que administra la clínica.',
    irAlInicio: 'Ir al inicio',
    errorGenerico: 'Algo salió mal. Probá de nuevo en un momento.',
    sinConexion: 'No pudimos conectar con el servidor. Revisá tu conexión y probá de nuevo.',
  },
  acceso: {
    titulo: 'Ingresá a Conecta',
    subtitulo: 'Usá el correo y la contraseña de tu cuenta.',
    correo: 'Correo',
    clave: 'Contraseña',
    ingresar: 'Ingresar',
    olvide: 'Olvidé mi contraseña',
    faltaCorreo: 'Escribí tu correo.',
    correoInvalido: 'Revisá el correo: falta algo (por ejemplo, la @).',
    faltaClave: 'Escribí tu contraseña.',
    credenciales: 'Usuario o contraseña no coinciden. Probá de nuevo.',
    sinConfirmar:
      'Todavía no confirmaste tu correo. Buscá el mensaje de bienvenida y tocá el enlace.',
    demasiados: 'Hubo muchos intentos seguidos. Esperá unos minutos y probá de nuevo.',
    cerradaInactividad: (min: number) =>
      `Cerramos tu sesión porque pasaron ${min} minutos sin actividad. Ingresá de nuevo para seguir.`,
    cerradaVencida: 'Tu sesión venció. Ingresá de nuevo para seguir.',
    cerradaSinMembresia:
      'Cerramos tu sesión porque tu cuenta ya no está activa en esta clínica. Si creés que es un error, pedile acceso a quien administra la clínica.',
    sinConfiguracion:
      'Falta configurar el acceso (VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY). Avisá a soporte.',
  },
  recuperar: {
    titulo: 'Recuperá tu contraseña',
    texto: 'Te mandamos un correo con un enlace para que definas una contraseña nueva.',
    enviar: 'Enviar enlace',
    enviado: 'Listo. Si el correo tiene una cuenta, te llega el enlace en unos minutos.',
    enviadoTexto: 'Revisá también la carpeta de correo no deseado.',
    volverAcceso: 'Volver a ingresar',
  },
  nuevaClave: {
    titulo: 'Definí tu contraseña nueva',
    clave: 'Contraseña nueva',
    repetir: 'Repetí la contraseña',
    ayuda: 'Al menos 8 caracteres. Mejor si mezclás letras, números y signos.',
    corta: 'Usá al menos 8 caracteres.',
    distintas: 'Las dos contraseñas no coinciden.',
    debil: 'Esa contraseña es fácil de adivinar. Probá con una más larga.',
    repetida: 'Esa es tu contraseña actual. Elegí una distinta.',
    guardar: 'Guardar contraseña',
    lista: 'Tu contraseña quedó cambiada.',
    continuar: 'Entrar a Conecta',
    enlaceVencido: 'El enlace venció o ya se usó. Pedí uno nuevo.',
  },
  segundoFactor: {
    titulo: 'Confirmá que sos vos',
    texto: 'Abrí tu app de autenticación y escribí el código de 6 dígitos de Conecta.',
    codigo: 'Código de 6 dígitos',
    verificar: 'Verificar',
    formato: 'El código tiene 6 números.',
    incorrecto: 'Ese código no es válido o ya venció. Escribí el que se ve ahora.',
    usarOtraCuenta: 'Ingresar con otra cuenta',
    activarTitulo: 'Activá el doble factor',
    activarTexto:
      'Para entrar a Conecta, tu cuenta tiene que usar doble factor. Activalo ahora con una app de autenticación; lleva un minuto.',
  },
  clinica: {
    titulo: 'Elegí la clínica',
    texto: 'Trabajás en más de una clínica. Elegí en cuál vas a trabajar ahora.',
    cambiar: 'Cambiar de clínica',
    sinMembresia: 'Tu cuenta no está activa en ninguna clínica. Pedile acceso a la clínica.',
    sinLista:
      'Tenés varias clínicas, pero no pudimos saber cuáles. Cerrá sesión y probá de nuevo; si sigue pasando, avisá a soporte.',
  },
  armazon: {
    seguridad: 'Seguridad',
    cerrarSesion: 'Cerrar sesión',
    cargandoSesion: 'Preparando tu espacio de trabajo…',
    errorSesion: 'No pudimos cargar tu sesión.',
    rol: 'Rol',
  },
  inactividad: {
    titulo: 'Tu sesión está por cerrarse',
    texto: 'Por seguridad, en un minuto cerramos la sesión si no hay actividad.',
    seguir: 'Seguir conectado',
  },
  modulos: {
    inicio: 'Inicio',
    sedes: 'Sedes',
    auditoria: 'Auditoría',
  },
  inicio: {
    saludo: (nombre: string) => `Mba'éichapa, ${nombre}`,
    clinica: 'Clínica',
    sede: 'Sede activa',
    todasLasSedes: 'Todas las sedes',
    sinSede: 'Sin sede asignada',
    accesos: 'Accesos',
    accesoSedes: 'Ver sedes',
    accesoAuditoria: 'Ver auditoría',
    accesoSeguridad: 'Seguridad de la cuenta',
    nadaTodavia: 'Por ahora no hay módulos habilitados para tu rol.',
  },
  seguridad: {
    titulo: 'Seguridad',
    dobleFactor: 'Doble factor',
    explicacion:
      'Además de tu contraseña, te pedimos un código de 6 dígitos de una app de autenticación (por ejemplo, Google Authenticator o Microsoft Authenticator).',
    activo: 'Activo',
    inactivo: 'No activado',
    activar: 'Activar doble factor',
    paso1: 'Escaneá este código QR con tu app de autenticación.',
    claveManual: 'Si no podés escanear, cargá esta clave a mano:',
    paso2: 'Escribí el código de 6 dígitos que muestra la app.',
    confirmar: 'Confirmar y activar',
    activado: 'El doble factor quedó activado.',
    activadoTexto: 'Desde ahora te vamos a pedir el código cada vez que ingreses.',
    quitar: 'Quitar doble factor',
    quitarTitulo: 'Quitar el doble factor',
    quitarTexto: 'Tu cuenta va a quedar protegida solo con la contraseña.',
    quitarTextoExigido:
      'Tu rol pide doble factor: si lo quitás, vas a tener que activarlo de nuevo para seguir usando Conecta.',
    avisoFallido:
      'Quitamos el doble factor de tu app, pero no pudimos avisarle al servidor. Probá de nuevo para terminar.',
    terminarQuitar: 'Terminar de quitarlo',
    quitarConfirmar: 'Sí, quitar',
    quitado: 'Quitamos el doble factor.',
    nombreFactor: 'Conecta',
    necesitaCodigo: 'Para quitarlo, primero confirmá con un código de tu app.',
  },
} as const;

type Ensanchar<T> = T extends string
  ? string
  : T extends (...a: infer A) => infer R
    ? (...a: A) => R
    : { [K in keyof T]: Ensanchar<T[K]> };

export type Textos = Ensanchar<typeof es>;

export type TextosParciales = {
  [S in keyof Textos]?: Partial<Textos[S]>;
};
