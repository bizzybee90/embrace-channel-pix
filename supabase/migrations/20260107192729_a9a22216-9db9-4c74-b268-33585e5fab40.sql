-- Create a nuclear reset function that uses TRUNCATE for instant clearing
-- This bypasses row-by-row deletion which times out on large datasets

CREATE OR REPLACE FUNCTION public.nuclear_reset(p_workspace_id UUID, p_confirm TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '600s'
AS $$
DECLARE
  msg_count BIGINT;
  conv_count BIGINT;
  cust_count BIGINT;
BEGIN
  -- Safety check - require explicit confirmation
  IF p_confirm != 'CONFIRM_NUCLEAR_RESET' THEN
    RETURN jsonb_build_object('error', 'Confirmation string "CONFIRM_NUCLEAR_RESET" required');
  END IF;

  -- Get counts before truncation for reporting
  SELECT count(*) INTO msg_count FROM messages;
  SELECT count(*) INTO conv_count FROM conversations;
  SELECT count(*) INTO cust_count FROM customers;

  -- TRUNCATE with CASCADE - instant regardless of row count
  -- Order matters less with CASCADE but being explicit
  TRUNCATE TABLE email_pairs CASCADE;
  TRUNCATE TABLE conversation_pairs CASCADE;
  TRUNCATE TABLE draft_edits CASCADE;
  TRUNCATE TABLE email_fetch_retries CASCADE;
  TRUNCATE TABLE messages CASCADE;
  TRUNCATE TABLE conversations CASCADE;
  TRUNCATE TABLE customers CASCADE;
  TRUNCATE TABLE email_import_queue CASCADE;
  TRUNCATE TABLE email_import_progress CASCADE;
  TRUNCATE TABLE email_import_jobs CASCADE;

  RETURN jsonb_build_object(
    'status', 'complete',
    'messages_cleared', msg_count,
    'conversations_cleared', conv_count,
    'customers_cleared', cust_count,
    'message', 'Nuclear reset complete - all data truncated'
  );
END;
$$;