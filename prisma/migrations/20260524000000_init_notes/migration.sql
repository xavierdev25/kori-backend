CREATE TYPE "NoteType" AS ENUM ('TEXT', 'DRAWING');

CREATE TABLE "notes" (
  "id" TEXT NOT NULL,
  "type" "NoteType" NOT NULL,
  "recipient_name" TEXT NOT NULL,
  "message" TEXT,
  "image_url" TEXT,
  "storage_path" TEXT,
  "color" TEXT,
  "rotation" INTEGER NOT NULL,
  "position_x" INTEGER NOT NULL,
  "position_y" INTEGER NOT NULL,
  "z_index" INTEGER NOT NULL,
  "ip_hash" TEXT,
  "user_agent_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notes_created_at_idx" ON "notes"("created_at");
CREATE INDEX "notes_type_created_at_idx" ON "notes"("type", "created_at");
