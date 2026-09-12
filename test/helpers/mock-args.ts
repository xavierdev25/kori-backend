/**
 * Lee tipado el argumento de una llamada a un mock de Jest.
 *
 * `mock.calls[0][0]` es `any`, y typescript-eslint lo rechaza con razón: es la
 * grieta por la que un test deja de comprobar lo que cree comprobar cuando
 * cambia la firma de lo que llama. Cada spec se lo apañaba con su propio
 * `as`, o directamente accedía al `any`.
 *
 * Vive en `test/` y no en `src/` porque `tsconfig.build.json` excluye esa
 * carpeta: un ayudante de pruebas no tiene por qué acabar dentro de la imagen
 * de producción.
 */
export function argDe<T>(mock: jest.Mock, llamada = 0, posicion = 0): T {
  const llamadas = mock.mock.calls as unknown[][];
  const args = llamadas[llamada];

  if (!args) {
    throw new Error(
      `El mock no recibio la llamada numero ${llamada + 1} (tuvo ${llamadas.length}).`,
    );
  }

  return args[posicion] as T;
}
