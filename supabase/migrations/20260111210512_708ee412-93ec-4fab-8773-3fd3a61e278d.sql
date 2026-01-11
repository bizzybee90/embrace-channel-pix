-- Create classification_jobs table for tracking batch classification progress
CREATE TABLE IF NOT EXISTS public.classification_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  total_to_classify INTEGER DEFAULT 0,
  classified_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  last_processed_id UUID,
  retry_count INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_classification_jobs_workspace ON public.classification_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_classification_jobs_status ON public.classification_jobs(status);

-- Enable RLS
ALTER TABLE public.classification_jobs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies using users table for workspace membership
CREATE POLICY "Users can view their workspace classification jobs" 
ON public.classification_jobs 
FOR SELECT 
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.users WHERE id = auth.uid()
  )
);

CREATE POLICY "Users can manage their workspace classification jobs" 
ON public.classification_jobs 
FOR ALL 
USING (
  workspace_id IN (
    SELECT workspace_id FROM public.users WHERE id = auth.uid()
  )
);

-- Add columns to email_import_jobs if they don't exist
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_import_jobs' AND column_name = 'inbox_page_token') THEN
    ALTER TABLE public.email_import_jobs ADD COLUMN inbox_page_token TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_import_jobs' AND column_name = 'sent_page_token') THEN
    ALTER TABLE public.email_import_jobs ADD COLUMN sent_page_token TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_import_jobs' AND column_name = 'current_folder') THEN
    ALTER TABLE public.email_import_jobs ADD COLUMN current_folder TEXT DEFAULT 'SENT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_import_jobs' AND column_name = 'total_target') THEN
    ALTER TABLE public.email_import_jobs ADD COLUMN total_target INTEGER DEFAULT 1000;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_import_jobs' AND column_name = 'inbox_imported') THEN
    ALTER TABLE public.email_import_jobs ADD COLUMN inbox_imported INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_import_jobs' AND column_name = 'sent_imported') THEN
    ALTER TABLE public.email_import_jobs ADD COLUMN sent_imported INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'email_import_jobs' AND column_name = 'last_batch_at') THEN
    ALTER TABLE public.email_import_jobs ADD COLUMN last_batch_at TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;