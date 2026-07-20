-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('PENDING', 'APPROVED');

-- AlterTable
ALTER TABLE "notes" ADD COLUMN     "status" "NoteStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "notes_status_created_at_idx" ON "notes"("status", "created_at");

-- Las notas existentes ya estaban publicadas: se conservan visibles
UPDATE "notes" SET "status" = 'APPROVED';
