import sanitizeHtml from 'sanitize-html';

/** Lo unico que sanitize-html escapa en la salida. Las comillas las deja. */
const ENTIDADES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
};

/**
 * Deshace el escapado en UNA pasada de izquierda a derecha.
 *
 * De izquierda a derecha importa: `&amp;lt;` tiene que dar `&lt;` y no `<`.
 * Con reemplazos encadenados —primero `&lt;`, luego `&amp;`— saldria `<`, que
 * es justo el error clasico de destaparse una capa de mas.
 */
function desescapar(valor: string): string {
  return valor.replace(
    /&(?:amp|lt|gt);/g,
    (entidad) => ENTIDADES[entidad] ?? entidad,
  );
}

/**
 * Texto de usuario convertido en texto plano de verdad.
 *
 * Quita cualquier etiqueta HTML y devuelve el resto TAL CUAL, sin escapar.
 * Lo segundo no es un detalle: quien escribia `<3` en una notita se encontraba
 * `&lt;3` en el muro. `sanitize-html` escapa `& < >` porque da por hecho que
 * su salida se va a insertar como HTML, y aqui no: esto se guarda en la base y
 * se pinta con `textContent` en la web, con JSX en el panel y pasando por
 * `escaparHtml` en los correos. Escapar en el almacen y otra vez al pintar es
 * escapar dos veces, y lo que se ve es la entidad en crudo.
 *
 * El bucle es el detalle que evita cambiar un fallo por otro peor. Desescapar
 * una sola vez dejaria pasar `&lt;script&gt;`: la primera pasada no ve
 * ninguna etiqueta —le llega como texto—, y al desescapar apareceria
 * `<script>` ya guardado en la base. Volver a pasar el sanitizador sobre el
 * resultado cierra esa puerta, y se repite hasta que el texto deja de cambiar:
 *
 *   '<3'              -> '&lt;3'          -> '<3'        (estable, se queda)
 *   '&lt;script&gt;'  -> '&lt;script&gt;' -> '<script>'  -> ''  (se va)
 *
 * Converge en dos o tres vueltas sobre cadenas de 50 caracteres. El tope esta
 * por si acaso: un bucle infinito en el camino de una peticion publica es peor
 * que cualquier entidad mal puesta.
 */
const MAX_VUELTAS = 5;

export function sanitizePlainText(value: string): string {
  let actual = value;

  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta += 1) {
    const siguiente = desescapar(
      sanitizeHtml(actual, {
        allowedTags: [],
        allowedAttributes: {},
        disallowedTagsMode: 'discard',
      }),
    );

    if (siguiente === actual) {
      return actual.trim();
    }

    actual = siguiente;
  }

  return actual.trim();
}
