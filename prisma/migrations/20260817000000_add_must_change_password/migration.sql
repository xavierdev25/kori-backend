-- AlterTable
-- Por defecto `false`: las cuentas que ya existen no se ven obligadas a nada.
-- Solo las que se creen con el script de alta llegan con `true`.
ALTER TABLE "users" ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;
