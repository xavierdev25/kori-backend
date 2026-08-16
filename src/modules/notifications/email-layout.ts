/**
 * La plantilla HTML de los correos de kor!.
 *
 * Escrita a mano y con tablas, que en 2026 sigue sonando raro pero es lo que
 * hay: Outlook renderiza con el motor de Word, ignora `flex`, `grid` y casi
 * todo el CSS moderno, y descarta la mayoría de hojas de estilo. Un correo
 * "bien hecho" con CSS actual se ve roto justo en el cliente que usa media
 * oficina. Por eso: tablas anidadas, estilos en línea y anchos en píxeles.
 *
 * Sin librería. Se valoraron React Email —metería React y react-dom en una
 * imagen que hoy no tiene nada de React, para cinco correos— y Handlebars,
 * que separaría los textos de sus tipos: hoy viven en `i18n/email-messages`
 * y el compilador avisa si a un idioma le falta una clave.
 *
 * Va en oscuro porque es la identidad de la marca, y además esquiva el
 * problema más feo del correo: los clientes con modo oscuro invierten los
 * correos claros por su cuenta y suelen destrozarlos. Un correo ya oscuro
 * llega igual a todas partes.
 */

const FONDO = '#0e120c';
const PAPEL = '#161a13';
const TEXTO = '#e8e7df';
const APAGADO = '#9a9e91';
const ROJO = '#96122f';
const BORDE = '#2a2f26';

/** Ancho clásico del correo: cabe en el panel de vista previa de Outlook. */
const ANCHO = 600;

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * Escapa lo que venga de fuera antes de meterlo en el HTML.
 *
 * El nombre y la dirección los escribe el comprador en Stripe. Sin esto, un
 * nombre con `<` rompe la maquetación del correo, y uno con una etiqueta
 * dentro podría colar contenido en el mensaje que reciben.
 */
export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface BotonCorreo {
  texto: string;
  url: string;
}

export interface ContenidoCorreo {
  /** Se ve en la bandeja de entrada, junto al asunto. */
  avance: string;
  titulo: string;
  /** Párrafos. Ya escapados si vienen de fuera. */
  parrafos: string[];
  boton?: BotonCorreo;
  /** Bloque destacado: la lista de descargas, el resumen del pedido… */
  bloque?: string;
  /** Letra pequeña bajo el contenido: caducidades, avisos. */
  nota?: string;
}

/**
 * Un botón que funciona en Outlook.
 *
 * Outlook ignora `padding` en un `<a>`, así que el botón sería solo texto
 * subrayado. La forma que aguanta en todas partes es una tabla de una celda
 * con el color de fondo y el relleno puestos en el `<td>`.
 */
function boton({ texto, url }: BotonCorreo): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
    <tr>
      <td align="center" bgcolor="${ROJO}" style="border-radius:5px;">
        <a href="${url}" style="display:inline-block;padding:14px 32px;font-family:${SANS};font-size:15px;font-weight:bold;color:${TEXTO};text-decoration:none;border-radius:5px;">${escaparHtml(texto)}</a>
      </td>
    </tr>
  </table>`;
}

/**
 * Envuelve el contenido en la plantilla.
 *
 * `pie` se pasa desde fuera porque cambia según el idioma, y esta función no
 * sabe de idiomas a propósito: así se puede probar sin arrastrar el i18n.
 */
export function renderizarCorreo(
  contenido: ContenidoCorreo,
  pie: string,
): string {
  const parrafos = contenido.parrafos
    .map(
      (texto) =>
        `<p style="margin:0 0 16px;font-family:${SANS};font-size:15px;line-height:1.6;color:${TEXTO};">${texto}</p>`,
    )
    .join('');

  const bloque = contenido.bloque
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;background-color:#11150f;border:1px solid ${BORDE};border-radius:6px;">
         <tr><td style="padding:18px 20px;font-family:${SANS};font-size:14px;line-height:1.6;color:${TEXTO};">${contenido.bloque}</td></tr>
       </table>`
    : '';

  const nota = contenido.nota
    ? `<p style="margin:20px 0 0;font-family:${SANS};font-size:13px;line-height:1.55;color:${APAGADO};">${contenido.nota}</p>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escaparHtml(contenido.titulo)}</title>
</head>
<body style="margin:0;padding:0;background-color:${FONDO};">
<!-- El avance: lo que se lee junto al asunto en la bandeja. Oculto en el
     cuerpo, y con espacios detrás para que el cliente no rellene el hueco
     con las primeras palabras del HTML. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escaparHtml(contenido.avance)}${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${FONDO}" style="background-color:${FONDO};">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" width="${ANCHO}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${ANCHO}px;">

        <tr>
          <td align="center" style="padding-bottom:24px;">
            <span style="font-family:${SERIF};font-size:30px;letter-spacing:0.08em;color:${TEXTO};">kor!</span>
          </td>
        </tr>

        <tr>
          <td bgcolor="${PAPEL}" style="background-color:${PAPEL};border:1px solid ${BORDE};border-radius:8px;padding:32px 28px;">
            <h1 style="margin:0 0 20px;font-family:${SERIF};font-size:24px;font-weight:normal;line-height:1.25;color:${TEXTO};">${escaparHtml(contenido.titulo)}</h1>
            ${parrafos}
            ${contenido.boton ? boton(contenido.boton) : ''}
            ${bloque}
            ${nota}
          </td>
        </tr>

        <tr>
          <td align="center" style="padding:24px 8px 0;">
            <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${APAGADO};">${pie}</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Una lista de enlaces con nombre, para las descargas de un pedido. */
export function listaDeEnlaces(
  elementos: { nombre: string; url: string }[],
): string {
  return elementos
    .map(
      ({ nombre, url }) =>
        `<div style="margin:0 0 12px;">
           <strong style="color:${TEXTO};">${escaparHtml(nombre)}</strong><br>
           <a href="${url}" style="color:#e8657f;word-break:break-all;">${escaparHtml(url)}</a>
         </div>`,
    )
    .join('');
}

/**
 * Filas de "concepto — importe", para el resumen del pedido.
 *
 * Los importes van a la derecha y con `nowrap`: sin eso, un total largo se
 * parte en dos líneas en el móvil y el correo parece descuadrado.
 */
export function filasDeImporte(
  filas: { concepto: string; importe: string; fuerte?: boolean }[],
): string {
  const celdas = filas
    .map(({ concepto, importe, fuerte }) => {
      const peso = fuerte ? 'bold' : 'normal';
      const borde = fuerte
        ? `border-top:1px solid ${BORDE};padding-top:10px;`
        : '';

      return `<tr>
        <td style="padding:4px 0;${borde}font-family:${SANS};font-size:14px;color:${TEXTO};font-weight:${peso};">${escaparHtml(concepto)}</td>
        <td align="right" style="padding:4px 0;${borde}font-family:${SANS};font-size:14px;color:${TEXTO};font-weight:${peso};white-space:nowrap;">${escaparHtml(importe)}</td>
      </tr>`;
    })
    .join('');

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${celdas}</table>`;
}
