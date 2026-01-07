-- Part 1: Update the nuclear_reset function to clear all tables and reset sync status
CREATE OR REPLACE FUNCTION public.nuclear_reset(p_workspace_id UUID, p_confirm TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
  msg_count INT;
  conv_count INT;
  cust_count INT;
  raw_count INT;
  queue_count INT;
BEGIN
  -- Verify confirmation
  IF p_confirm != 'CONFIRM_NUCLEAR_RESET' THEN
    RAISE EXCEPTION 'Invalid confirmation code';
  END IF;

  -- Get counts before deletion for reporting
  SELECT COUNT(*) INTO msg_count FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.workspace_id = p_workspace_id;
  
  SELECT COUNT(*) INTO conv_count FROM conversations WHERE workspace_id = p_workspace_id;
  SELECT COUNT(*) INTO cust_count FROM customers WHERE workspace_id = p_workspace_id;
  SELECT COUNT(*) INTO raw_count FROM raw_emails WHERE workspace_id = p_workspace_id;
  SELECT COUNT(*) INTO queue_count FROM email_import_queue WHERE workspace_id = p_workspace_id;

  -- Delete in order respecting foreign keys
  DELETE FROM messages WHERE conversation_id IN (
    SELECT id FROM conversations WHERE workspace_id = p_workspace_id
  );
  
  DELETE FROM conversation_pairs WHERE workspace_id = p_workspace_id;
  DELETE FROM email_pairs WHERE workspace_id = p_workspace_id;
  DELETE FROM conversations WHERE workspace_id = p_workspace_id;
  DELETE FROM customers WHERE workspace_id = p_workspace_id;
  
  -- Clear raw_emails and import queue (this was missing before!)
  DELETE FROM raw_emails WHERE workspace_id = p_workspace_id;
  DELETE FROM email_import_queue WHERE workspace_id = p_workspace_id;
  
  -- Reset email provider config sync status
  UPDATE email_provider_configs 
  SET sync_status = 'pending',
      sync_stage = NULL,
      emails_received = 0,
      emails_classified = 0,
      last_sync_at = NULL
  WHERE workspace_id = p_workspace_id;
  
  -- Reset email import progress
  DELETE FROM email_import_progress WHERE workspace_id = p_workspace_id;
  
  -- Reset email import jobs
  UPDATE email_import_jobs 
  SET status = 'cancelled',
      completed_at = NOW()
  WHERE workspace_id = p_workspace_id AND status IN ('pending', 'running', 'processing');

  result := jsonb_build_object(
    'success', true,
    'deleted', jsonb_build_object(
      'messages', msg_count,
      'conversations', conv_count,
      'customers', cust_count,
      'raw_emails', raw_count,
      'email_queue', queue_count
    )
  );

  RETURN result;
END;
$$;

-- Part 2: Add duplicate prevention constraints

-- 2.1 Customers: unique on (workspace_id, lower(email))
-- First clean up any existing duplicates (keep oldest)
DELETE FROM customers a USING customers b 
WHERE a.id > b.id 
  AND a.workspace_id = b.workspace_id 
  AND a.email IS NOT NULL 
  AND b.email IS NOT NULL
  AND LOWER(a.email) = LOWER(b.email);

-- Create unique index for customer email per workspace
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_workspace_email_unique 
ON customers (workspace_id, LOWER(email)) 
WHERE email IS NOT NULL;

-- 2.2 Conversations: unique on (workspace_id, external_conversation_id)
-- Clean up any duplicates first
DELETE FROM conversations a USING conversations b 
WHERE a.id > b.id 
  AND a.workspace_id = b.workspace_id 
  AND a.external_conversation_id IS NOT NULL 
  AND b.external_conversation_id IS NOT NULL
  AND a.external_conversation_id = b.external_conversation_id;

-- Create unique index
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_external_unique 
ON conversations (workspace_id, external_conversation_id) 
WHERE external_conversation_id IS NOT NULL;

-- 2.3 Messages: unique on external_id per conversation
-- Extract external_id and create index (for messages with raw_payload containing external_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_external_unique 
ON messages (conversation_id, ((raw_payload->>'external_id')::text))
WHERE raw_payload->>'external_id' IS NOT NULL;