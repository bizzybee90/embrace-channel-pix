-- Add run_id and resume_after to email_import_progress for deterministic retries
ALTER TABLE email_import_progress 
ADD COLUMN IF NOT EXISTS run_id uuid DEFAULT gen_random_uuid(),
ADD COLUMN IF NOT EXISTS resume_after timestamptz DEFAULT NULL,
ADD COLUMN IF NOT EXISTS paused_reason text DEFAULT NULL;