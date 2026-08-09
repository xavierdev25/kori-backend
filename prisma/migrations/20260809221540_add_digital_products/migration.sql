-- AlterEnum
ALTER TYPE "OutboxJobType" ADD VALUE 'DELIVER_DIGITAL';

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "digital_asset_bytes" INTEGER,
ADD COLUMN     "digital_asset_path" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "digital_asset_path" TEXT;

-- CreateTable
CREATE TABLE "download_grants" (
    "id" TEXT NOT NULL,
    "order_item_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_downloads" INTEGER NOT NULL DEFAULT 5,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_download_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "download_grants_token_hash_key" ON "download_grants"("token_hash");

-- CreateIndex
CREATE INDEX "download_grants_order_item_id_idx" ON "download_grants"("order_item_id");

-- CreateIndex
CREATE INDEX "download_grants_expires_at_idx" ON "download_grants"("expires_at");

-- AddForeignKey
ALTER TABLE "download_grants" ADD CONSTRAINT "download_grants_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Moneda ──────────────────────────────────────────────────────────
-- Los drumkits se venden en dólares. El CHECK de la migración inicial solo
-- admitía 'MXN', así que sin esto cualquier pedido nuevo reventaría contra
-- la base de datos después de haber cobrado en Stripe.
--
-- Se admiten las dos: el merch en pesos llegará más adelante y la columna
-- ya guarda la moneda por pedido, así que conviven sin tocar nada más.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS chk_order_currency;
ALTER TABLE orders ADD CONSTRAINT chk_order_currency
  CHECK (currency IN ('MXN', 'USD'));

ALTER TABLE shipping_quotes DROP CONSTRAINT IF EXISTS chk_quote_currency;
ALTER TABLE shipping_quotes ADD CONSTRAINT chk_quote_currency
  CHECK (currency IN ('MXN', 'USD'));

-- ── Producto digital ────────────────────────────────────────────────
-- Un producto DIGITAL sin archivo no se puede entregar. La validación está
-- en el servicio al publicar, pero esto es la red: impide que quede a la
-- venta algo que nadie podría descargar.
ALTER TABLE product_variants ADD CONSTRAINT chk_digital_asset_bytes_positive
  CHECK (digital_asset_bytes IS NULL OR digital_asset_bytes > 0);

-- Un permiso de descarga con tope cero o negativo no tiene sentido, y uno
-- con más descargas usadas que permitidas significaría que el contador se
-- pasó de la raya.
ALTER TABLE download_grants ADD CONSTRAINT chk_download_limits
  CHECK (max_downloads > 0 AND download_count >= 0 AND download_count <= max_downloads);
