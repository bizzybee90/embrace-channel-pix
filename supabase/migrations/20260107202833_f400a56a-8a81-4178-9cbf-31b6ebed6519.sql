-- Fix nuclear_reset function with correct column names
CREATE OR REPLACE FUNCTION public.nuclear_reset(p_workspace_id UUID, p_confirm TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_confirm != 'CONFIRM_NUCLEAR_RESET' THEN
    RAISE EXCEPTION 'Invalid confirmation code';
  END IF;

  -- TRUNCATE all data tables to reclaim disk space
  TRUNCATE TABLE
    public.messages,
    public.conversation_pairs,
    public.email_pairs,
    public.conversations,
    public.customers,
    public.raw_emails,
    public.email_import_queue,
    public.email_import_progress,
    public.email_import_jobs,
    public.email_fetch_retries,
    public.email_sync_jobs,
    public.sync_logs
  RESTART IDENTITY CASCADE;

  -- Reset provider configs with CORRECT column names
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

  RETURN jsonb_build_object(
    'success', true,
    'wiped', true
  );
END;
$$;