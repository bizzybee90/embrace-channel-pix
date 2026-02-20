
-- Add conversation_id and is_read columns to email_import_queue
ALTER TABLE public.email_import_queue 
  ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id),
  ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false;

-- Index for the conversion query (classified but not yet converted)
CREATE INDEX IF NOT EXISTS idx_email_import_queue_unconverted 
  ON public.email_import_queue (workspace_id, category, conversation_id) 
  WHERE category IS NOT NULL AND conversation_id IS NULL;
