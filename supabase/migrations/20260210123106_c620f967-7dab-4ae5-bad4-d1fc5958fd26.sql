
-- Fix 1: raw_emails - Replace overly permissive public policy with service_role only
DROP POLICY IF EXISTS "Service role can manage raw emails" ON public.raw_emails;

CREATE POLICY "Service role full access to raw emails"
  ON public.raw_emails FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Fix 2: email_provider_configs - Change from public to proper roles
DROP POLICY IF EXISTS "Users can manage workspace email configs" ON public.email_provider_configs;
DROP POLICY IF EXISTS "Users can view workspace email configs" ON public.email_provider_configs;

CREATE POLICY "Authenticated users can view workspace email configs"
  ON public.email_provider_configs FOR SELECT
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "Authenticated users can manage workspace email configs"
  ON public.email_provider_configs FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "Service role full access to email configs"
  ON public.email_provider_configs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Fix 3: get_sent_conversations - Add workspace validation
CREATE OR REPLACE FUNCTION public.get_sent_conversations(
  p_user_id UUID,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  status TEXT,
  priority TEXT,
  category TEXT,
  channel TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  sla_due_at TIMESTAMPTZ,
  sla_status TEXT,
  summary_for_human TEXT,
  ai_reason_for_escalation TEXT,
  customer_id UUID,
  assigned_to UUID,
  snoozed_until TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  caller_workspace_id UUID;
  target_workspace_id UUID;
BEGIN
  -- Get caller's workspace
  SELECT u.workspace_id INTO caller_workspace_id
  FROM users u WHERE u.id = auth.uid();

  -- Get target user's workspace
  SELECT u.workspace_id INTO target_workspace_id
  FROM users u WHERE u.id = p_user_id;

  -- Verify same workspace
  IF caller_workspace_id IS NULL OR target_workspace_id IS NULL OR caller_workspace_id != target_workspace_id THEN
    RAISE EXCEPTION 'Access denied: workspace mismatch';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (c.id)
    c.id,
    c.title,
    c.status,
    c.priority,
    c.category,
    c.channel,
    c.created_at,
    c.updated_at,
    c.sla_due_at,
    c.sla_status,
    c.summary_for_human,
    c.ai_reason_for_escalation,
    c.customer_id,
    c.assigned_to,
    c.snoozed_until
  FROM conversations c
  INNER JOIN messages m ON m.conversation_id = c.id
  WHERE m.actor_id = p_user_id
    AND m.direction = 'outbound'
    AND m.is_internal = false
  ORDER BY c.id, c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;
