-- Create a function to efficiently find threads with both inbound and outbound messages
CREATE OR REPLACE FUNCTION public.get_training_pair_threads(
  p_workspace_id UUID,
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (thread_id TEXT, inbound_count BIGINT, outbound_count BIGINT)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH thread_stats AS (
    SELECT 
      e.thread_id,
      SUM(CASE WHEN e.direction = 'inbound' AND e.body IS NOT NULL THEN 1 ELSE 0 END) as inbound_count,
      SUM(CASE WHEN e.direction = 'outbound' AND e.body IS NOT NULL THEN 1 ELSE 0 END) as outbound_count
    FROM email_import_queue e
    WHERE e.workspace_id = p_workspace_id
      AND e.is_noise = false
      AND e.thread_id IS NOT NULL
    GROUP BY e.thread_id
  )
  SELECT ts.thread_id, ts.inbound_count, ts.outbound_count
  FROM thread_stats ts
  WHERE ts.inbound_count > 0 AND ts.outbound_count > 0
  ORDER BY ts.inbound_count DESC, ts.outbound_count DESC
  LIMIT p_limit;
$$;