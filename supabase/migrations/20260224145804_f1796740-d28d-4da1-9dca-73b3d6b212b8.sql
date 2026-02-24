-- =============================================================================
-- Security Hardening: Fix function search_path on all mutable functions
-- =============================================================================

-- Wrap each in DO block to gracefully handle functions that may not exist
DO $$ BEGIN ALTER FUNCTION public.handle_new_user() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.has_role(UUID, app_role) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.user_has_workspace_access(UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_my_workspace_id() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.update_updated_at_column() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN ALTER FUNCTION public.encrypt_token(text, text) SET search_path = public, extensions; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.decrypt_token(bytea, text) SET search_path = public, extensions; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.store_encrypted_token(uuid, text, text) SET search_path = public, extensions; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_decrypted_access_token(uuid) SET search_path = public, extensions; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN ALTER FUNCTION public.get_sent_conversations(UUID, integer, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.match_conversations(extensions.vector, double precision, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.match_faqs(extensions.vector, UUID, double precision, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.match_faqs_with_priority(extensions.vector, UUID, double precision, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.match_document_chunks(extensions.vector, UUID, double precision, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.match_examples(extensions.vector, UUID, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.match_faq_database(extensions.vector, UUID, double precision, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.search_faqs_with_priority(UUID, extensions.vector, double precision, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN ALTER FUNCTION public.count_unclassified_emails(UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_partitioned_unclassified_batch(UUID, integer, integer, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_emails_received(UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_import_counts(UUID, integer, integer, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_emails_to_hydrate(UUID, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_unprocessed_batch(UUID, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bulk_update_email_classifications(jsonb) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN ALTER FUNCTION public.analyze_email_threads(UUID, UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.mark_noise_emails(UUID, UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.find_duplicate_faqs(UUID, UUID, double precision) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_research_job_stats(UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.get_training_pair_threads(UUID, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.nuclear_reset(UUID, text) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN ALTER FUNCTION public.get_api_usage_summary() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.increment_scraping_progress(UUID, integer, integer) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN ALTER FUNCTION public.bb_queue_read(text, integer, integer) SET search_path = public, pgmq, pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_queue_send(text, jsonb, integer) SET search_path = public, pgmq, pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_queue_send_batch(text, jsonb[], integer) SET search_path = public, pgmq, pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_queue_delete(text, bigint) SET search_path = public, pgmq, pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_queue_archive(text, bigint) SET search_path = public, pgmq, pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_purge_archived_queues() SET search_path = public, pgmq, pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_queue_visible_count(text) SET search_path = public, pg_catalog; EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN ALTER FUNCTION public.bb_materialize_event(UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_ingest_unified_messages(UUID, UUID, UUID, text, jsonb) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_touch_pipeline_run(UUID, jsonb, text, text, boolean) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_trigger_worker(text, jsonb) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_record_incident(UUID, UUID, text, text, text, jsonb) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_schedule_pipeline_crons() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_unschedule_pipeline_crons() SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_try_timestamptz(text) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER FUNCTION public.bb_user_in_workspace(UUID) SET search_path = public; EXCEPTION WHEN OTHERS THEN NULL; END $$;