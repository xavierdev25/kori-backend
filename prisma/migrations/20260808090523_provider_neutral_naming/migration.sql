-- Se quita el nombre "Gelato" del esquema: se descartó como proveedor y dejar
-- su nombre en columnas y enums era una mentira que iba a confundir después.
--
-- Usa DROP + ADD en vez de RENAME, y es seguro porque ninguna de estas tablas
-- ha existido nunca en producción: se crean vacías por las migraciones
-- anteriores de esta misma tanda. Si ya hubiera datos, habría que cambiarlo
-- por ALTER TABLE ... RENAME COLUMN antes de desplegar.

-- AlterEnum
BEGIN;
CREATE TYPE "OutboxJobType_new" AS ENUM ('FULFILL_ORDER', 'SEND_ORDER_CONFIRMATION', 'SEND_SHIPPING_NOTIFICATION', 'SEND_ADMIN_ALERT');
ALTER TABLE "outbox_jobs" ALTER COLUMN "type" TYPE "OutboxJobType_new" USING ("type"::text::"OutboxJobType_new");
ALTER TYPE "OutboxJobType" RENAME TO "OutboxJobType_old";
ALTER TYPE "OutboxJobType_new" RENAME TO "OutboxJobType";
DROP TYPE "public"."OutboxJobType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "gelato_orders" DROP CONSTRAINT "gelato_orders_order_id_fkey";

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "gelato_product_uid",
ADD COLUMN     "provider_product_uid" TEXT;

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "gelato_attempts",
DROP COLUMN "gelato_error",
DROP COLUMN "gelato_submitted_at",
ADD COLUMN     "fulfillment_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fulfillment_error" TEXT,
ADD COLUMN     "fulfillment_submitted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "product_variants" DROP COLUMN "gelato_product_uid",
ADD COLUMN     "provider_product_uid" TEXT;

-- AlterTable
ALTER TABLE "shipping_quotes" DROP COLUMN "gelato_payload",
DROP COLUMN "gelato_quote_id",
ADD COLUMN     "provider_payload" JSONB NOT NULL,
ADD COLUMN     "provider_quote_id" TEXT;

-- DropTable
DROP TABLE "gelato_orders";

-- CreateTable
CREATE TABLE "fulfillment_orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "fulfillment_status" TEXT NOT NULL,
    "tracking_code" TEXT,
    "tracking_url" TEXT,
    "shipment_method_name" TEXT,
    "fulfillment_country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fulfillment_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fulfillment_orders_provider_order_id_key" ON "fulfillment_orders"("provider_order_id");

-- CreateIndex
CREATE INDEX "fulfillment_orders_order_id_idx" ON "fulfillment_orders"("order_id");

-- AddForeignKey
ALTER TABLE "fulfillment_orders" ADD CONSTRAINT "fulfillment_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

