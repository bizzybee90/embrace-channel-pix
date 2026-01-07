-- Replace nuclear_reset to TRUNCATE tables (reclaim disk space) and reset provider state
CREATE OR REPLACE FUNCTION public.nuclear_reset(p_workspace_id UUID, p_confirm TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_confirm != 'CONFIRM_NUCLEAR_RESET' THEN
    RAISE EXCEPTION 'Invalid confirmation code';
  END IF;

  -- IMPORTANT: This is a true wipe to reclaim disk space.
  -- Workspace id is retained in the signature for safety/compatibility with callers.

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

  -- Reset provider configs
  UPDATE public.email_provider_configs
  SET sync_status = 'pending',
      sync_stage = NULL,
      emails_received = 0,
      emails_classified = 0,
      last_sync_at = NULL;

  result := jsonb_build_object(
    'success', true,
    'wiped', true
  );

  RETURN result;
END;
$$;