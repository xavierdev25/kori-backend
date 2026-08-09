/**
 * La moneda de la tienda, en un único sitio.
 *
 * Estaba repetida a mano en el checkout, en las estadísticas, en la serie
 * diaria y en los correos. Cinco literales que había que acordarse de cambiar
 * a la vez, y con el dinero eso es exactamente lo que no se puede permitir:
 * si uno se queda atrás, Stripe cobra en una moneda y el correo dice otra.
 *
 * Hoy es USD porque los drumkits se venden en dólares a un público que no es
 * solo mexicano. El día que se añada el merch en pesos, esto deja de ser una
 * constante y pasa a ser un campo por producto — pero ese día se cambia aquí
 * y el compilador señala todos los sitios afectados.
 */
export const STORE_CURRENCY = 'USD';

/** El locale con el que se formatean los importes de cara al comprador. */
const MONEY_LOCALE = 'en-US';

/** "$1,234.00 USD" a partir de centavos. Nunca a partir de un float. */
export function formatMoney(cents: number, currency = STORE_CURRENCY): string {
  const amount = (cents / 100).toLocaleString(MONEY_LOCALE, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });

  return `$${amount} ${currency}`;
}
