-- Add columns for resumable imports
ALTER TABLE email_import_progress 
ADD COLUMN IF NOT EXISTS aurinko_next_page_token TEXT,
ADD COLUMN IF NOT EXISTS last_import_batch_at TIMESTAMPTZ;