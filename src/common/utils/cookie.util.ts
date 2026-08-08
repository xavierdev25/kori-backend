/**
 * Parseo de la cabecera `Cookie` sin dependencias.
 *
 * Se evita `cookie-parser` a propósito: son veinte líneas, se necesitan en un
 * único sitio (el extractor del JWT) y una dependencia menos es una superficie
 * de suministro menos en un servicio que maneja pagos.
 */
export function parseCookieHeader(
  header: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};

  if (!header) {
    return cookies;
  }

  for (const segment of header.split(';')) {
    const separatorIndex = segment.indexOf('=');

    // Sin '=' o con el '=' al principio no hay nombre: se descarta.
    if (separatorIndex < 1) {
      continue;
    }

    const name = segment.slice(0, separatorIndex).trim();

    if (!name || cookies[name] !== undefined) {
      // La primera aparición gana, como hacen los navegadores.
      continue;
    }

    const rawValue = segment.slice(separatorIndex + 1).trim();
    const value = rawValue.startsWith('"') ? rawValue.slice(1, -1) : rawValue;

    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      // Un valor mal codificado no debe tumbar la petición entera.
      cookies[name] = value;
    }
  }

  return cookies;
}
