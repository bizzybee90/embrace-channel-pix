-- 1. Import Jobs table (tracks overall progress for UI)
CREATE TABLE IF NOT EXISTS import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'initializing',
  total_scanned INT DEFAULT 0,
  total_hydrated INT DEFAULT 0,
  total_processed INT DEFAULT 0,
  total_estimated INT,
  started_at TIMESTAMPTZ,
  scanning_completed_at TIMESTAMPTZ,
  hydrating_completed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS import_jobs_workspace_idx ON import_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS import_jobs_status_idx ON import_jobs(status);

-- 2. Folder Cursors table (tracks progress per folder with page tokens)
CREATE TABLE IF NOT EXISTS folder_cursors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  folder_name TEXT NOT NULL,
  folder_id TEXT,
  next_page_token TEXT,
  is_complete BOOLEAN DEFAULT FALSE,
  priority INT DEFAULT 10,
  emails_found INT DEFAULT 0,
  last_processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, folder_name)
);

CREATE INDEX IF NOT EXISTS folder_cursors_job_idx ON folder_cursors(job_id);

-- 3. Update raw_emails table for pipeline
ALTER TABLE raw_emails 
ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES import_jobs(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS aurinko_id TEXT,
ADD COLUMN IF NOT EXISTS thread_id TEXT,
ADD COLUMN IF NOT EXISTS folder TEXT,
ADD COLUMN IF NOT EXISTS body_html TEXT,
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'scanned';

CREATE INDEX IF NOT EXISTS raw_emails_pipeline_idx ON raw_emails(job_id, status);
CREATE INDEX IF NOT EXISTS raw_emails_thread_idx ON raw_emails(workspace_id, thread_id);

-- 4. Workspace credentials table (stores Aurinko tokens)
CREATE TABLE IF NOT EXISTS workspace_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, provider)
);

-- 5. Helper function: Get emails to hydrate (with row locking)
CREATE OR REPLACE FUNCTION get_emails_to_hydrate(
  p_job_id UUID,
  p_batch_size INT DEFAULT 400
)
RETURNS TABLE (id UUID, aurinko_id TEXT, folder TEXT) AS $$
BEGIN
  RETURN QUERY
  UPDATE raw_emails
  SET status = 'hydrating'
  WHERE id IN (
    SELECT raw_emails.id FROM raw_emails
    WHERE job_id = p_job_id AND status = 'scanned'
    ORDER BY sent_at DESC
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING raw_emails.id, raw_emails.aurinko_id, raw_emails.folder;
END;
$$ LANGUAGE plpgsql;

-- 6. Helper function: Increment import counts
CREATE OR REPLACE FUNCTION increment_import_counts(
  p_job_id UUID,
  p_scanned INT DEFAULT 0,
  p_hydrated INT DEFAULT 0,
  p_processed INT DEFAULT 0
)
RETURNS void AS $$
BEGIN
  UPDATE import_jobs
  SET 
    total_scanned = total_scanned + p_scanned,
    total_hydrated = total_hydrated + p_hydrated,
    total_processed = total_processed + p_processed
  WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql;

-- 7. Enable Realtime for progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE import_jobs;