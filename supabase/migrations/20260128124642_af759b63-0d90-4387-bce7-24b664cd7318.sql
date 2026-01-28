-- Enable RLS on new tables
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_credentials ENABLE ROW LEVEL SECURITY;

-- Import Jobs policies - users can view jobs for their workspace
CREATE POLICY "Users can view their import jobs"
ON import_jobs FOR SELECT
USING (
  workspace_id IN (
    SELECT workspace_id FROM users WHERE id = auth.uid()
  )
);

CREATE POLICY "Service role manages import jobs"
ON import_jobs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Folder Cursors policies
CREATE POLICY "Users can view their folder cursors"
ON folder_cursors FOR SELECT
USING (
  workspace_id IN (
    SELECT workspace_id FROM users WHERE id = auth.uid()
  )
);

CREATE POLICY "Service role manages folder cursors"
ON folder_cursors FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Workspace Credentials policies (sensitive - service role only)
CREATE POLICY "Service role manages workspace credentials"
ON workspace_credentials FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Fix function search paths
CREATE OR REPLACE FUNCTION get_emails_to_hydrate(
  p_job_id UUID,
  p_batch_size INT DEFAULT 400
)
RETURNS TABLE (id UUID, aurinko_id TEXT, folder TEXT) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE raw_emails
  SET status = 'hydrating'
  WHERE raw_emails.id IN (
    SELECT re.id FROM raw_emails re
    WHERE re.job_id = p_job_id AND re.status = 'scanned'
    ORDER BY re.sent_at DESC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING raw_emails.id, raw_emails.aurinko_id, raw_emails.folder;
END;
$$;

CREATE OR REPLACE FUNCTION increment_import_counts(
  p_job_id UUID,
  p_scanned INT DEFAULT 0,
  p_hydrated INT DEFAULT 0,
  p_processed INT DEFAULT 0
)
RETURNS void 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE import_jobs
  SET 
    total_scanned = total_scanned + p_scanned,
    total_hydrated = total_hydrated + p_hydrated,
    total_processed = total_processed + p_processed
  WHERE id = p_job_id;
END;
$$;