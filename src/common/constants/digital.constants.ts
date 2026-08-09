/**
 * Tope de subida de un archivo de venta.
 *
 * 500 MB es muy por encima de lo que pesa un drumkit (los de kor! son 30 y
 * 80 MB), pero el archivo pasa por la memoria del contenedor antes de ir al
 * bucket, y Render da 512 MB. Sin un techo, un archivo enorme tumba el
 * proceso entero en vez de devolver un error.
 */
export const MAX_DIGITAL_ASSET_BYTES = 500 * 1024 * 1024;

/** Cuánto vive el enlace de descarga que va en el correo. */
export const DOWNLOAD_GRANT_TTL_HOURS = 72;

/**
 * Cuántas veces se puede usar ese enlace.
 *
 * Uno solo deja tirado a quien se le corte la descarga a medias; ilimitado
 * acaba circulando por Telegram. Cinco cubre los reintentos razonables.
 */
export const DOWNLOAD_GRANT_MAX_USES = 5;
