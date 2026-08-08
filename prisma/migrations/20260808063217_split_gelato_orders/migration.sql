/*
  Warnings:

  - You are about to drop the column `carrier` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `gelato_order_id` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `tracking_code` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `tracking_url` on the `orders` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "orders_gelato_order_id_key";

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "carrier",
DROP COLUMN "gelato_order_id",
DROP COLUMN "tracking_code",
DROP COLUMN "tracking_url",
ADD COLUMN     "gelato_submitted_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "shipping_quotes" ADD COLUMN     "gelato_quote_id" TEXT,
ADD COLUMN     "shipment_method_name" TEXT,
ADD COLUMN     "shipment_method_uid" TEXT;

-- CreateTable
CREATE TABLE "gelato_orders" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "gelato_order_id" TEXT NOT NULL,
    "fulfillment_status" TEXT NOT NULL,
    "tracking_code" TEXT,
    "tracking_url" TEXT,
    "shipment_method_name" TEXT,
    "fulfillment_country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gelato_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gelato_orders_gelato_order_id_key" ON "gelato_orders"("gelato_order_id");

-- CreateIndex
CREATE INDEX "gelato_orders_order_id_idx" ON "gelato_orders"("order_id");

-- AddForeignKey
ALTER TABLE "gelato_orders" ADD CONSTRAINT "gelato_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
