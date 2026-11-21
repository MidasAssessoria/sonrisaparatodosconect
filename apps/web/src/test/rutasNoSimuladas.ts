/**
 * Registro de pedidos a rutas que la prueba no simuló. `setup.ts` hace fallar la prueba si queda
 * alguno: un 404 silencioso escondía pedidos que no debían salir (o rutas mal escritas).
 */
const pendientes: string[] = [];

export function registrarRutaNoSimulada(clave: string): void {
  pendientes.push(clave);
}

export function tomarRutasNoSimuladas(): string[] {
  return pendientes.splice(0, pendientes.length);
}

/**
 * Pedidos cuyo cuerpo no cumple el contrato (ver `pedidosContrato.ts`). `setup.ts` hace fallar la
 * prueba si queda alguno: la API real los rechazaría.
 */
const invalidos: string[] = [];

export function registrarPedidoInvalido(problema: string): void {
  invalidos.push(problema);
}

export function tomarPedidosInvalidos(): string[] {
  return invalidos.splice(0, invalidos.length);
}
