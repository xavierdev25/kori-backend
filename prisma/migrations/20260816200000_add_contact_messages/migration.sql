-- AlterEnum
-- El mensaje de contacto viaja por el mismo outbox que el resto de correos,
-- para heredar sus reintentos con backoff.
ALTER TYPE "OutboxJobType" ADD VALUE 'SEND_CONTACT_MESSAGE';

-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_messages_created_at_idx" ON "contact_messages"("created_at");


-- Misma barrera que el resto de tablas con datos personales: lleva nombre,
-- correo y lo que alguien haya escrito.
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;
