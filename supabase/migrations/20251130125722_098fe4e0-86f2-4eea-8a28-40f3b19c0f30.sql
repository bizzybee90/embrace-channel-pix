-- Create RPC function to get sent conversations for a user efficiently
CREATE OR REPLACE FUNCTION get_sent_conversations(
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
) AS $$
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_sent_conversations(UUID, INT, INT) TO authenticated;