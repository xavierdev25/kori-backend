-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ARTIST', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('POD_APPAREL', 'PHYSICAL_INVENTORY', 'DIGITAL');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('POD', 'INVENTORY', 'DIGITAL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'IN_PRODUCTION', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "SaleSource" AS ENUM ('STRIPE', 'PAYHIP');

-- CreateEnum
CREATE TYPE "WebhookProvider" AS ENUM ('STRIPE', 'GELATO');

-- CreateEnum
CREATE TYPE "OutboxJobType" AS ENUM ('GELATO_CREATE_ORDER', 'SEND_ORDER_CONFIRMATION', 'SEND_SHIPPING_NOTIFICATION', 'SEND_ADMIN_ALERT');

-- CreateEnum
CREATE TYPE "OutboxJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ARTIST',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "type" "ProductType" NOT NULL DEFAULT 'POD_APPAREL',
    "fulfillment_type" "FulfillmentType" NOT NULL DEFAULT 'POD',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "size" TEXT,
    "color" TEXT,
    "label" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "gelato_product_uid" TEXT,
    "print_file_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storage_path" TEXT,
    "alt_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_quotes" (
    "id" TEXT NOT NULL,
    "country_code" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "items_hash" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "estimated_days_min" INTEGER,
    "estimated_days_max" INTEGER,
    "gelato_payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipping_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" SERIAL NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "source" "SaleSource" NOT NULL DEFAULT 'STRIPE',
    "stripe_checkout_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "gelato_order_id" TEXT,
    "gelato_error" TEXT,
    "gelato_attempts" INTEGER NOT NULL DEFAULT 0,
    "subtotal_cents" INTEGER NOT NULL,
    "shipping_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "shipping_quote_id" TEXT,
    "customer_email" TEXT NOT NULL,
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "ship_name" TEXT,
    "ship_line1" TEXT,
    "ship_line2" TEXT,
    "ship_city" TEXT,
    "ship_state" TEXT,
    "ship_postal_code" TEXT,
    "ship_country" TEXT,
    "tracking_url" TEXT,
    "tracking_code" TEXT,
    "carrier" TEXT,
    "review_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_variant_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_label" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_total_cents" INTEGER NOT NULL,
    "gelato_product_uid" TEXT,
    "print_file_url" TEXT,
    "fulfillment_type" "FulfillmentType" NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "event_id" TEXT NOT NULL,
    "provider" "WebhookProvider" NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "outbox_jobs" (
    "id" TEXT NOT NULL,
    "type" "OutboxJobType" NOT NULL,
    "status" "OutboxJobStatus" NOT NULL DEFAULT 'PENDING',
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_is_active_created_at_idx" ON "products"("is_active", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_size_color_key" ON "product_variants"("product_id", "size", "color");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_label_key" ON "product_variants"("product_id", "label");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "shipping_quotes_expires_at_idx" ON "shipping_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripe_checkout_session_id_key" ON "orders"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_stripe_payment_intent_id_key" ON "orders"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_gelato_order_id_key" ON "orders"("gelato_order_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_email_idx" ON "orders"("customer_email");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_variant_id_idx" ON "order_items"("product_variant_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_events_provider_received_at_idx" ON "webhook_events"("provider", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_jobs_dedupe_key_key" ON "outbox_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_jobs_status_next_attempt_at_idx" ON "outbox_jobs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_jobs_order_id_idx" ON "outbox_jobs"("order_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shipping_quote_id_fkey" FOREIGN KEY ("shipping_quote_id") REFERENCES "shipping_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_variant_id_fkey" FOREIGN KEY ("product_variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═══════════════════════════════════════════════════════════════════
-- Invariantes que Prisma no sabe expresar en el esquema.
-- Van aquí para que la base de datos sea la última línea de defensa:
-- un bug en el servicio no debe poder dejar dinero inconsistente.
-- ═══════════════════════════════════════════════════════════════════

-- Una sola imagen principal por producto (índice único parcial).
CREATE UNIQUE INDEX product_images_one_primary_per_product
  ON product_images (product_id)
  WHERE is_primary;

-- ── Dinero ──────────────────────────────────────────────────────────
-- Un precio de venta de 0 casi siempre es un bug de captura, no un regalo.
ALTER TABLE product_variants ADD CONSTRAINT chk_variant_price_positive
  CHECK (price_cents > 0);

ALTER TABLE orders ADD CONSTRAINT chk_order_amounts_non_negative
  CHECK (subtotal_cents >= 0 AND shipping_cents >= 0 AND total_cents >= 0);

-- El total tiene que cuadrar. Sin IVA aparte ni descuentos en v1, así que
-- la suma es exacta; si algún día entran descuentos, esta línea se relaja.
ALTER TABLE orders ADD CONSTRAINT chk_order_total_matches
  CHECK (total_cents = subtotal_cents + shipping_cents);

ALTER TABLE shipping_quotes ADD CONSTRAINT chk_quote_amount_non_negative
  CHECK (amount_cents >= 0);

-- ── Líneas de pedido ────────────────────────────────────────────────
ALTER TABLE order_items ADD CONSTRAINT chk_item_quantity_positive
  CHECK (quantity > 0);

ALTER TABLE order_items ADD CONSTRAINT chk_item_price_non_negative
  CHECK (unit_price_cents >= 0);

ALTER TABLE order_items ADD CONSTRAINT chk_item_line_total_matches
  CHECK (line_total_cents = unit_price_cents * quantity);

-- ── Texto ───────────────────────────────────────────────────────────
ALTER TABLE products ADD CONSTRAINT chk_product_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE products ADD CONSTRAINT chk_product_name_not_empty
  CHECK (LENGTH(TRIM(name)) > 0);

ALTER TABLE product_variants ADD CONSTRAINT chk_variant_label_not_empty
  CHECK (LENGTH(TRIM(label)) > 0);

-- ── Moneda ──────────────────────────────────────────────────────────
-- v1 es solo MXN. El CHECK evita que un bug de integración escriba otra
-- divisa silenciosamente; ampliar la lista es una migración de una línea.
ALTER TABLE orders ADD CONSTRAINT chk_order_currency
  CHECK (currency IN ('MXN'));

ALTER TABLE shipping_quotes ADD CONSTRAINT chk_quote_currency
  CHECK (currency IN ('MXN'));

-- ── Cola de trabajo ─────────────────────────────────────────────────
ALTER TABLE outbox_jobs ADD CONSTRAINT chk_outbox_attempts
  CHECK (attempts >= 0 AND max_attempts > 0);

-- ── Los pedidos no se borran ────────────────────────────────────────
-- Un pedido es registro contable. Un reembolso o una cancelación son
-- estados (REFUNDED / CANCELLED), nunca un DELETE. Sin esto, el ON DELETE
-- CASCADE de order_items permite que un solo DELETE borre la venta y sus
-- copias congeladas: exactamente lo que la regla del historial prohíbe.
-- Esto la convierte en algo que impone la base de datos, no en una
-- convención que un bug pueda saltarse.
CREATE OR REPLACE FUNCTION forbid_order_delete() RETURNS trigger AS $fn$
BEGIN
  RAISE EXCEPTION
    'Los pedidos no se borran (id=%). Usa el estado CANCELLED o REFUNDED.',
    OLD.id;
END;
$fn$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orders_no_delete
  BEFORE DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION forbid_order_delete();
