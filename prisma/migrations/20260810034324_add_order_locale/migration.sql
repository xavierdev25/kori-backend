-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'es';


-- Solo los idiomas que el sistema sabe escribir. Un valor fuera de la lista
-- dejaría al comprador con un correo en un idioma que no existe.
ALTER TABLE orders ADD CONSTRAINT chk_order_locale
  CHECK (locale IN ('es', 'en'));
