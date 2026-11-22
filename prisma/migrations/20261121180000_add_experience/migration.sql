-- La experiencia del caballo (la portada nueva de DICIEMBRE+ [fin de año]):
-- registro con ubicación, sesiones, progreso del juego "Aún aquí" y las
-- cartas públicas moderadas.
--
-- Solo aditiva: la versión anterior del backend sigue funcionando con este
-- esquema mientras dura el cambio de contenedor (ver deploy.yml). Lo único que
-- se relaja es `signal_signups.name`, que deja de ser obligatorio; el código
-- viejo siempre lo manda, así que no le afecta.

-- ── signal_signups: el registro de la experiencia ─────────────────────
ALTER TABLE "signal_signups"
  ALTER COLUMN "name" DROP NOT NULL,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'senal',
  ADD COLUMN "country" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "age_confirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "event_zone" BOOLEAN NOT NULL DEFAULT false;

-- El nombre, si lo hay, con las mismas reglas de antes.
ALTER TABLE "signal_signups" DROP CONSTRAINT "signal_signups_name_check";
ALTER TABLE "signal_signups"
  ADD CONSTRAINT "signal_signups_name_check"
    CHECK ("name" IS NULL OR char_length(btrim("name")) BETWEEN 1 AND 60),
  ADD CONSTRAINT "signal_signups_source_check"
    CHECK ("source" IN ('senal', 'experiencia')),
  ADD CONSTRAINT "signal_signups_country_check"
    CHECK ("country" IS NULL OR "country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "signal_signups_region_check"
    CHECK ("region" IS NULL OR char_length(btrim("region")) BETWEEN 1 AND 60),
  ADD CONSTRAINT "signal_signups_city_check"
    CHECK ("city" IS NULL OR char_length(btrim("city")) BETWEEN 1 AND 60),
  -- Un registro de la experiencia siempre trae la confirmación de edad.
  ADD CONSTRAINT "signal_signups_experiencia_edad_check"
    CHECK ("source" <> 'experiencia' OR "age_confirmed"),
  -- Uno de "la señal" siempre trae nombre (así era la tabla).
  ADD CONSTRAINT "signal_signups_senal_nombre_check"
    CHECK ("source" <> 'senal' OR "name" IS NOT NULL);

CREATE INDEX "signal_signups_event_zone_idx" ON "signal_signups"("event_zone");

-- ── Sesiones ─────────────────────────────────────────────────────────
CREATE TABLE "experience_sessions" (
    "id" TEXT NOT NULL,
    "signup_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experience_sessions_pkey" PRIMARY KEY ("id"),
    -- la huella HMAC-SHA256 en hex: nunca el token
    CONSTRAINT "experience_sessions_token_hash_check"
      CHECK ("token_hash" ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX "experience_sessions_token_hash_key" ON "experience_sessions"("token_hash");
CREATE INDEX "experience_sessions_signup_id_idx" ON "experience_sessions"("signup_id");
ALTER TABLE "experience_sessions"
  ADD CONSTRAINT "experience_sessions_signup_id_fkey"
  FOREIGN KEY ("signup_id") REFERENCES "signal_signups"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Progreso de "Aún aquí" ───────────────────────────────────────────
CREATE TABLE "experience_progress" (
    "signup_id" TEXT NOT NULL,
    "estrellas" INTEGER NOT NULL DEFAULT 0,
    "record" INTEGER NOT NULL DEFAULT 0,
    "recorridos" INTEGER NOT NULL DEFAULT 0,
    "camino" INTEGER NOT NULL DEFAULT 0,
    "recuerdos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "paginas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "encuentros" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "logros" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "abiertas" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "experience_progress_pkey" PRIMARY KEY ("signup_id"),
    CONSTRAINT "experience_progress_numeros_check" CHECK (
      "estrellas" >= 0 AND "record" >= 0 AND "recorridos" >= 0
      AND "camino" BETWEEN 0 AND 8
    ),
    CONSTRAINT "experience_progress_listas_check" CHECK (
      cardinality("recuerdos") <= 50 AND cardinality("paginas") <= 50
      AND cardinality("encuentros") <= 50 AND cardinality("logros") <= 50
      AND cardinality("abiertas") <= 50
    )
);
ALTER TABLE "experience_progress"
  ADD CONSTRAINT "experience_progress_signup_id_fkey"
  FOREIGN KEY ("signup_id") REFERENCES "signal_signups"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Cartas públicas ──────────────────────────────────────────────────
CREATE TYPE "ExperienceLetterStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "experience_letters" (
    "id" TEXT NOT NULL,
    "to_name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "status" "ExperienceLetterStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),

    CONSTRAINT "experience_letters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "experience_letters_locale_check" CHECK ("locale" IN ('es', 'en')),
    CONSTRAINT "experience_letters_to_name_check"
      CHECK (char_length(btrim("to_name")) BETWEEN 1 AND 20),
    -- una rechazada se queda sin texto (se borra al revisarla)
    CONSTRAINT "experience_letters_text_check" CHECK (
      ("status" = 'REJECTED' AND "text" = '')
      OR char_length(btrim("text")) BETWEEN 2 AND 1000
    ),
    CONSTRAINT "experience_letters_reviewed_check"
      CHECK (("status" = 'PENDING') = ("reviewed_at" IS NULL))
);
CREATE INDEX "experience_letters_status_created_at_idx"
  ON "experience_letters"("status", "created_at");

-- Misma barrera que el resto de tablas con datos personales (ver
-- 20260810031958_enable_rls).
ALTER TABLE experience_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE experience_letters ENABLE ROW LEVEL SECURITY;
