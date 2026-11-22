/** ¿El navegador puede crear un contexto WebGL? Se prueba una vez y se suelta el contexto enseguida. */
let cache: boolean | null = null;

export function hayWebGL(): boolean {
  if (cache !== null) return cache;
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl2') ?? cv.getContext('webgl');
    cache = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cache = false;
  }
  return cache;
}
