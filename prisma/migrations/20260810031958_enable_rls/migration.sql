-- ── Row Level Security ──────────────────────────────────────────────
-- Hoy no hace falta: las tablas las creó Prisma como `postgres`, así que
-- los roles `anon` y `authenticated` — los de las claves públicas de
-- Supabase — no tienen ningún permiso sobre ellas. Se comprobó.
--
-- Se activa igualmente como segunda barrera. El día que alguien cree algo
-- desde el panel de Supabase, o ejecute un GRANT sin pensarlo, esto es lo
-- que evita que los pedidos y los correos queden a la vista.
--
-- No afecta al backend: se conecta como dueño de las tablas, y el dueño
-- salta RLS salvo que se active FORCE, que no se activa.
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE download_grants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens   ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscribers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_jobs      ENABLE ROW LEVEL SECURITY;

-- Y se revoca explícitamente lo que nunca debieron tener, por si alguna
-- migración futura los añade sin querer.
--
-- Va dentro de un bloque condicional porque `anon` y `authenticated` son
-- roles que crea Supabase: en un Postgres normal no existen, y un REVOKE a
-- secas reventaría el arranque en local y en CI. Lo descubrió la prueba
-- local antes de llegar a producción.
DO $rls$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END
$rls$;
