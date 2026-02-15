
-- Add confidence, needs_review, and entities columns to email_import_queue
ALTER TABLE public.email_import_queue 
  ADD COLUMN IF NOT EXISTS confidence FLOAT,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS entities JSONB;

-- Index for needs_review filtering
CREATE INDEX IF NOT EXISTS idx_email_import_queue_needs_review 
  ON public.email_import_queue (workspace_id, needs_review) 
  WHERE needs_review = true;
