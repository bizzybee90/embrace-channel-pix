-- Add column for storing the cleaned email body (new content only, no quoted history)
ALTER TABLE public.email_import_queue 
ADD COLUMN IF NOT EXISTS body_clean TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN public.email_import_queue.body_clean IS 'Email body with quoted reply content stripped. Contains only the new message portion, extracted via AI parsing.';