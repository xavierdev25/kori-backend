-- CreateTable
-- "La señal" de DICIEMBRE+ [fin de año]: nombre y correo para los correos
-- personales de la campaña. Tabla nueva y solo aditiva: la versión anterior
-- del backend sigue funcionando con este esquema mientras dura el cambio de
-- contenedor (ver deploy.yml).
CREATE TABLE "signal_signups" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "privacy_version" TEXT NOT NULL,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signal_signups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signal_signups_email_key" ON "signal_signups"("email");

-- CreateIndex
CREATE INDEX "signal_signups_created_at_idx" ON "signal_signups"("created_at");

-- ── Reglas de forma ─────────────────────────────────────────────────
-- Las mismas que valida el DTO, repetidas aquí: si algún día otra ruta, un
-- script o una consulta a mano escriben en la tabla, la base no acepta lo
-- que la API nunca habría dejado pasar.
--
-- El correo en minúsculas no es estética: el índice único compara bytes, así
-- que "Ana@x.com" y "ana@x.com" serían dos filas y la misma persona recibiría
-- los correos dos veces.
ALTER TABLE "signal_signups"
  ADD CONSTRAINT "signal_signups_locale_check"
    CHECK ("locale" IN ('es', 'en')),
  ADD CONSTRAINT "signal_signups_name_check"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 60),
  ADD CONSTRAINT "signal_signups_email_check"
    CHECK ("email" = lower("email") AND char_length("email") <= 254),
  ADD CONSTRAINT "signal_signups_privacy_version_check"
    CHECK ("privacy_version" ~ '^\d{4}-\d{2}-\d{2}$');

-- Misma barrera que el resto de tablas con datos personales (ver
-- 20260810031958_enable_rls): nombre y correo de cada persona apuntada.
ALTER TABLE signal_signups ENABLE ROW LEVEL SECURITY;
