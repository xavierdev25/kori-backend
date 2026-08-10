-- CreateTable
CREATE TABLE "purchase_access_tokens" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_access_tokens_token_hash_key" ON "purchase_access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "purchase_access_tokens_email_idx" ON "purchase_access_tokens"("email");

-- CreateIndex
CREATE INDEX "purchase_access_tokens_expires_at_idx" ON "purchase_access_tokens"("expires_at");


-- Misma barrera que el resto: los roles publicos de Supabase no deben ver
-- esta tabla, que es una llave a los datos de compra de alguien.
ALTER TABLE purchase_access_tokens ENABLE ROW LEVEL SECURITY;
