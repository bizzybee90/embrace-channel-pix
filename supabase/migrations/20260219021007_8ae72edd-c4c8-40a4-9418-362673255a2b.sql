
-- Update nuclear_reset function to also wipe scraping/knowledge base data and reset onboarding
CREATE OR REPLACE FUNCTION public.nuclear_reset(p_workspace_id uuid, p_confirm text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_confirm != 'CONFIRM_NUCLEAR_RESET' THEN
    RAISE EXCEPTION 'Invalid confirmation code';
  END IF;

  -- Delete workspace-scoped data (can't TRUNCATE with WHERE clause)
  DELETE FROM public.messages WHERE conversation_id IN (
    SELECT id FROM public.conversations WHERE workspace_id = p_workspace_id
  );
  DELETE FROM public.conversation_pairs WHERE workspace_id = p_workspace_id;
  DELETE FROM public.conversations WHERE workspace_id = p_workspace_id;
  DELETE FROM public.customers WHERE workspace_id = p_workspace_id;
  DELETE FROM public.raw_emails WHERE workspace_id = p_workspace_id;
  DELETE FROM public.email_import_queue WHERE workspace_id = p_workspace_id;
  DELETE FROM public.email_import_progress WHERE workspace_id = p_workspace_id;
  DELETE FROM public.email_import_jobs WHERE workspace_id = p_workspace_id;
  DELETE FROM public.email_fetch_retries WHERE workspace_id = p_workspace_id;

  -- Knowledge base / scraping data
  DELETE FROM public.faq_database WHERE workspace_id = p_workspace_id;
  DELETE FROM public.scraping_jobs WHERE workspace_id = p_workspace_id;
  DELETE FROM public.competitor_faqs_raw WHERE workspace_id = p_workspace_id;
  DELETE FROM public.competitor_faq_candidates WHERE workspace_id = p_workspace_id;
  DELETE FROM public.competitor_pages WHERE workspace_id = p_workspace_id;
  DELETE FROM public.competitor_sites WHERE workspace_id = p_workspace_id;
  DELETE FROM public.competitor_research_jobs WHERE workspace_id = p_workspace_id;
  DELETE FROM public.business_facts WHERE workspace_id = p_workspace_id;
  DELETE FROM public.document_chunks WHERE workspace_id = p_workspace_id;
  DELETE FROM public.documents WHERE workspace_id = p_workspace_id;

  -- Corrections / learning
  DELETE FROM public.correction_examples WHERE workspace_id = p_workspace_id;
  DELETE FROM public.draft_edits WHERE workspace_id = p_workspace_id;
  DELETE FROM public.classification_corrections WHERE workspace_id = p_workspace_id;

  -- Reset email provider config sync state
  UPDATE public.email_provider_configs
  SET sync_status = 'pending',
      sync_stage = NULL,
      sync_progress = 0,
      sync_total = 0,
      inbound_emails_found = 0,
      outbound_emails_found = 0,
      inbound_total = 0,
      outbound_total = 0,
      threads_linked = 0,
      sync_started_at = NULL,
      sync_completed_at = NULL,
      sync_error = NULL,
      last_sync_at = NULL,
      active_job_id = NULL
  WHERE workspace_id = p_workspace_id;

  -- Reset onboarding step so user starts fresh
  UPDATE public.users
  SET onboarding_step = 'business_context'
  WHERE workspace_id = p_workspace_id;

  -- Reset business_context knowledge base status
  UPDATE public.business_context
  SET knowledge_base_status = NULL,
      knowledge_base_started_at = NULL,
      knowledge_base_completed_at = NULL,
      website_faqs_generated = 0,
      industry_faqs_copied = 0
  WHERE workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'success', true,
    'wiped', true
  );
END;
$function$;
