-- Drop existing function if it exists (for idempotency)
DROP FUNCTION IF EXISTS get_partitioned_unclassified_batch(UUID, INT, INT, INT);

-- Create the partitioned batch function
CREATE OR REPLACE FUNCTION get_partitioned_unclassified_batch(
  p_workspace_id UUID,
  p_partition_id INT,
  p_total_partitions INT,
  p_batch_size INT DEFAULT 5000
)
RETURNS SETOF raw_emails
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM raw_emails
  WHERE workspace_id = p_workspace_id
    AND status = 'pending'
    AND category IS NULL
    AND (abs(hashtext(id::text)) % p_total_partitions) = p_partition_id
  ORDER BY created_at ASC
  LIMIT p_batch_size;
END;
$$;

GRANT EXECUTE ON FUNCTION get_partitioned_unclassified_batch(UUID, INT, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_partitioned_unclassified_batch(UUID, INT, INT, INT) TO service_role;

-- Also create a function to count remaining unclassified emails
DROP FUNCTION IF EXISTS count_unclassified_emails(UUID);

CREATE OR REPLACE FUNCTION count_unclassified_emails(p_workspace_id UUID)
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COUNT(*)::INT
  FROM raw_emails
  WHERE workspace_id = p_workspace_id
    AND status = 'pending'
    AND category IS NULL;
$$;

GRANT EXECUTE ON FUNCTION count_unclassified_emails(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION count_unclassified_emails(UUID) TO service_role;

-- Add index to speed up partitioned queries
CREATE INDEX IF NOT EXISTS idx_raw_emails_unclassified 
ON raw_emails (workspace_id, status, category) 
WHERE status = 'pending' AND category IS NULL;

COMMENT ON FUNCTION get_partitioned_unclassified_batch IS 
'Returns a batch of unclassified emails for a specific partition. Used by parallel classification workers.';

COMMENT ON FUNCTION count_unclassified_emails IS
'Returns count of unclassified emails for a workspace. Used for completion detection.';