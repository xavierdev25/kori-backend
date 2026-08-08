/** Formatos aceptados para las fotos de producto del catálogo. */
export const ALLOWED_PRODUCT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

export type ProductImageMimeType =
  (typeof ALLOWED_PRODUCT_IMAGE_MIME_TYPES)[number];

/**
 * 5 MB. Son fotos de catálogo que la landing muestra a ~800px; más que esto
 * es un original sin optimizar y penaliza la carga del muro.
 */
export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** Máximo de fotos por producto. */
export const MAX_IMAGES_PER_PRODUCT = 10;

/** Carpeta dentro del bucket de Supabase. */
export const PRODUCT_IMAGE_FOLDER = 'products';
