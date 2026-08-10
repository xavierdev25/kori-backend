/**
 * Los textos de los correos, en los dos idiomas que la tienda escribe.
 *
 * Sin librería de traducción a propósito: son dos idiomas y cuatro correos.
 * Un objeto tipado da lo mismo que `i18next` para este tamaño, y el
 * compilador avisa si a un idioma le falta una clave — cosa que una librería
 * con ficheros JSON sueltos no hace.
 *
 * Las cadenas llevan funciones donde hay datos que interpolar, en vez de
 * plantillas con `{{llaves}}`: así el tipo dice exactamente qué necesita cada
 * texto y no se puede olvidar un dato.
 */

export type Locale = 'es' | 'en';

export const SUPPORTED_LOCALES: Locale[] = ['es', 'en'];

/**
 * "es-MX", "en-GB", "ES" → "es" | "en".
 *
 * Lo que manda el navegador es una etiqueta BCP 47 completa; aquí solo
 * interesa la parte del idioma. Cualquier cosa que no se sepa escribir cae
 * al español, que es la lengua del artista.
 */
export function normalizeLocale(raw: string | null | undefined): Locale {
  const base = (raw ?? '').trim().toLowerCase().split(/[-_]/)[0];

  return SUPPORTED_LOCALES.includes(base as Locale) ? (base as Locale) : 'es';
}

interface EmailStrings {
  confirmation: {
    body: string[];
    greeting: (name: string | null) => string;
    orderLabel: (orderNumber: number) => string;
    shipTo: string;
    shippingFree: string;
    shippingLabel: string;
    subject: (orderNumber: number) => string;
    subtotal: string;
    total: string;
    trackingSoon: string;
  };
  downloads: {
    body: string;
    expiry: (hours: number, maxDownloads: number) => string;
    ifExpired: string;
    subject: (orderNumber: number) => string;
    thanks: string;
  };
  shipping: {
    greeting: (name: string | null) => string;
    onItsWay: string;
    subject: (orderNumber: number) => string;
    tracking: string;
  };
  signature: string;
}

const es: EmailStrings = {
  confirmation: {
    body: [
      'Gracias por tu compra. Ya recibimos tu pago y tu pedido entró en',
      'producción: cada prenda se imprime bajo pedido, así que tarda unos',
      'días más que algo que ya está en un almacén.',
    ],
    greeting: (name) => `Hola${name ? ` ${name}` : ''},`,
    orderLabel: (orderNumber) => `PEDIDO #${orderNumber}`,
    shipTo: 'ENVIAREMOS A',
    shippingFree: '  Envío:    incluido',
    shippingLabel: '  Envío:   ',
    subject: (orderNumber) => `Tu pedido #${orderNumber} está confirmado`,
    subtotal: '  Subtotal:',
    total: '  Total:   ',
    trackingSoon:
      'Te escribimos otra vez en cuanto salga, con el número de rastreo.',
  },
  downloads: {
    body: 'Aquí están tus archivos:',
    expiry: (hours, maxDownloads) =>
      `Los enlaces caducan en ${hours} horas y sirven para ${maxDownloads} descargas.`,
    ifExpired: 'Si se te pasa el plazo, escríbenos y te mandamos unos nuevos.',
    subject: (orderNumber) => `Tu descarga de Kori — pedido #${orderNumber}`,
    thanks: 'Gracias por tu compra.',
  },
  shipping: {
    greeting: (name) => `Hola${name ? ` ${name}` : ''},`,
    onItsWay: 'Tu pedido va en camino.',
    subject: (orderNumber) => `Tu pedido #${orderNumber} va en camino`,
    tracking: 'RASTREO',
  },
  signature: 'Kori',
};

const en: EmailStrings = {
  confirmation: {
    body: [
      'Thanks for your order. We received your payment and it is now in',
      'production: every garment is printed to order, so it takes a few more',
      'days than something sitting in a warehouse.',
    ],
    greeting: (name) => `Hi${name ? ` ${name}` : ''},`,
    orderLabel: (orderNumber) => `ORDER #${orderNumber}`,
    shipTo: 'SHIPPING TO',
    shippingFree: '  Shipping: included',
    shippingLabel: '  Shipping:',
    subject: (orderNumber) => `Your order #${orderNumber} is confirmed`,
    subtotal: '  Subtotal:',
    total: '  Total:   ',
    trackingSoon: 'We will write again once it ships, with the tracking code.',
  },
  downloads: {
    body: 'Here are your files:',
    expiry: (hours, maxDownloads) =>
      `The links expire in ${hours} hours and work for ${maxDownloads} downloads.`,
    ifExpired: 'If they expire, write to us and we will send new ones.',
    subject: (orderNumber) => `Your Kori download — order #${orderNumber}`,
    thanks: 'Thanks for your order.',
  },
  shipping: {
    greeting: (name) => `Hi${name ? ` ${name}` : ''},`,
    onItsWay: 'Your order is on its way.',
    subject: (orderNumber) => `Your order #${orderNumber} is on its way`,
    tracking: 'TRACKING',
  },
  signature: 'Kori',
};

const MESSAGES: Record<Locale, EmailStrings> = { en, es };

export function t(locale: string | null | undefined): EmailStrings {
  return MESSAGES[normalizeLocale(locale)];
}
