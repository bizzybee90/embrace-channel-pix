-- Add backfill_status column to email_import_progress
ALTER TABLE public.email_import_progress 
ADD COLUMN IF NOT EXISTS backfill_status TEXT DEFAULT NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.email_import_progress.backfill_status IS 'Tracks background deep backfill: pending, running, complete';
