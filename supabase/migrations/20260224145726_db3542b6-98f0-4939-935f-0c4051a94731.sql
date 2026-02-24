-- =============================================================================
-- Security Hardening: Move extensions to extensions schema
-- =============================================================================
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not move uuid-ossp: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER EXTENSION vector SET SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not move vector: %', SQLERRM;
END $$;