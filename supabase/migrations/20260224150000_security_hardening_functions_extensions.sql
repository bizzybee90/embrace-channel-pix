-- =============================================================================
-- Security Hardening Migration
-- Fixes: Function Search Path Mutable, Extension in Public, RLS Policy Always True
-- =============================================================================

-- ============================================================
-- 1. EXTENSIONS: Move from public to extensions schema
-- ============================================================
-- Create extensions schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS extensions;

-- Move uuid-ossp to extensions schema
-- Note: gen_random_uuid() is built-in to Postgres 13+, not from this extension
DO $$
BEGIN
  ALTER EXTENSION "uuid-ossp" SET SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not move uuid-ossp to extensions schema: %', SQLERRM;
END $$;

-- Move vector to extensions schema  
DO $$
BEGIN
  ALTER EXTENSION vector SET SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not move vector to extensions schema: %', SQLERRM;
END $$;

-- ============================================================
-- 2. FUNCTION SEARCH PATH: Set explicit search_path on all functions
-- This prevents search path manipulation attacks (CVE-2018-1058 pattern)
-- ============================================================

-- Auth/workspace helpers
ALTER FUNCTION IF EXISTS public.handle_new_user() SET search_path = public;
ALTER FUNCTION IF EXISTS public.has_role(UUID, app_role) SET search_path = public;
ALTER FUNCTION IF EXISTS public.user_has_workspace_access(UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.get_my_workspace_id() SET search_path = public;
ALTER FUNCTION IF EXISTS public.update_updated_at_column() SET search_path = public;

-- Token encryption
ALTER FUNCTION IF EXISTS public.encrypt_token(text, text) SET search_path = public, extensions;
ALTER FUNCTION IF EXISTS public.decrypt_token(bytea, text) SET search_path = public, extensions;
ALTER FUNCTION IF EXISTS public.store_encrypted_token(text, text) SET search_path = public, extensions;
ALTER FUNCTION IF EXISTS public.get_decrypted_access_token(text) SET search_path = public, extensions;

-- Conversation/email functions
ALTER FUNCTION IF EXISTS public.get_sent_conversations(UUID, integer, integer) SET search_path = public;
ALTER FUNCTION IF EXISTS public.match_conversations(vector, double precision, integer, UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.match_faqs(vector, double precision, integer, UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.match_faqs_with_priority(vector, double precision, integer, UUID, text) SET search_path = public;
ALTER FUNCTION IF EXISTS public.match_document_chunks(vector, double precision, integer, UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.match_examples(vector, double precision, integer, UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.match_faq_database(vector, double precision, integer, UUID) SET search_path = public;

-- Email pipeline functions
ALTER FUNCTION IF EXISTS public.count_unclassified_emails(UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.get_partitioned_unclassified_batch(UUID, integer, integer, integer) SET search_path = public;
ALTER FUNCTION IF EXISTS public.increment_emails_received(UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.increment_import_counts(UUID, integer, integer) SET search_path = public;
ALTER FUNCTION IF EXISTS public.get_emails_to_hydrate(UUID, integer) SET search_path = public;
ALTER FUNCTION IF EXISTS public.get_unprocessed_batch(UUID, integer) SET search_path = public;
ALTER FUNCTION IF EXISTS public.bulk_update_email_classifications(UUID, jsonb) SET search_path = public;

-- Analysis functions
ALTER FUNCTION IF EXISTS public.analyze_email_threads(UUID, UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.mark_noise_emails(UUID, UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.search_faqs_with_priority(vector, double precision, integer, UUID, text) SET search_path = public;
ALTER FUNCTION IF EXISTS public.find_duplicate_faqs(UUID, double precision) SET search_path = public;
ALTER FUNCTION IF EXISTS public.get_research_job_stats(UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.get_training_pair_threads(UUID) SET search_path = public;
ALTER FUNCTION IF EXISTS public.nuclear_reset(UUID) SET search_path = public;

-- API usage
ALTER FUNCTION IF EXISTS public.get_api_usage_summary() SET search_path = public;

-- Scraping
ALTER FUNCTION IF EXISTS public.increment_scraping_progress(UUID, text, integer) SET search_path = public;

-- Queue functions (pgmq)
ALTER FUNCTION IF EXISTS public.bb_queue_read(text, integer, integer) SET search_path = public;
ALTER FUNCTION IF EXISTS public.bb_materialize_event(text, jsonb, integer) SET search_path = public;
ALTER FUNCTION IF EXISTS public.bb_purge_archived_queues() SET search_path = public;

-- ============================================================
-- 3. RLS: Tighten remaining service_role USING(true) policies
-- These are technically safe (service_role bypasses RLS) but
-- the scanner flags them. Adding explicit TO clause makes intent clear.
-- ============================================================

-- industry_faq_templates: "Anyone can read" is intentional (shared templates)
-- But ensure the service_role policy is explicit
DO $$
BEGIN
  -- Only tighten if the old permissive policy exists
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'industry_faq_templates' 
    AND policyname = 'Service role can manage templates'
    AND roles = '{public}'
  ) THEN
    DROP POLICY IF EXISTS "Service role can manage templates" ON public.industry_faq_templates;
    CREATE POLICY "Service role can manage templates" ON public.industry_faq_templates
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
