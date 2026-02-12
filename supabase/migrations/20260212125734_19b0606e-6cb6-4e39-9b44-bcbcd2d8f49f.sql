-- Fix RPCs to target email_import_queue instead of raw_emails

-- Drop existing functions
DROP FUNCTION IF EXISTS public.get_partitioned_unclassified_batch(uuid, integer, integer, integer);
DROP FUNCTION IF EXISTS public.count_unclassified_emails(uuid);

-- Drop old index if it exists
DROP INDEX IF EXISTS idx_raw_emails_unclassified;

-- Create index on email_import_queue for unclassified emails
CREATE INDEX IF NOT EXISTS idx_email_import_queue_unclassified 
ON public.email_import_queue (workspace_id, status) 
WHERE status = 'scanned' AND category IS NULL;

-- Recreate get_partitioned_unclassified_batch targeting email_import_queue
CREATE OR REPLACE FUNCTION public.get_partitioned_unclassified_batch(
  p_workspace_id uuid,
  p_partition_id integer,
  p_total_partitions integer,
  p_batch_size integer DEFAULT 5000
)
RETURNS TABLE (
  id uuid,
  from_email text,
  subject text,
  body text,
  direction text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    e.id,
    e.from_email,
    e.subject,
    e.body,
    e.direction
  FROM email_import_queue e
  WHERE e.workspace_id = p_workspace_id
    AND e.status = 'scanned'
    AND e.category IS NULL
    AND (abs(hashtext(e.id::text)) % p_total_partitions) = p_partition_id
  ORDER BY e.id
  LIMIT p_batch_size;
$$;

-- Recreate count_unclassified_emails targeting email_import_queue
CREATE OR REPLACE FUNCTION public.count_unclassified_emails(
  p_workspace_id uuid
)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM email_import_queue
  WHERE workspace_id = p_workspace_id
    AND status = 'scanned'
    AND category IS NULL;
$$;