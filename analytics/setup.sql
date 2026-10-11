-- Prepara la base de simulación y el rol de análisis. Se ejecuta como postgres.
--
-- hub_analytics es como un usuario de data warehouse: LEE todas las filas
-- (BYPASSRLS, porque agrega toda la red) pero no puede escribir en las tablas
-- de la app. Solo crea y escribe sus propios esquemas (los modelos de dbt).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hub_analytics') THEN
    CREATE ROLE hub_analytics LOGIN PASSWORD 'hub_analytics' BYPASSRLS;
  END IF;
END $$;
GRANT CONNECT, CREATE ON DATABASE licence_hub_sim TO hub_analytics;
GRANT USAGE ON SCHEMA public TO hub_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO hub_analytics;
