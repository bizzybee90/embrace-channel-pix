-- =============================================================================
-- Workflow 2 & 3: Email Import Pipeline - Database Requirements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Create import_progress table for tracking import status
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_progress (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'idle',
  total_emails INTEGER DEFAULT 0,
  processed_emails INTEGER DEFAULT 0,
  current_step TEXT,
  error TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.import_progress ENABLE ROW LEVEL SECURITY;

-- RLS policies for import_progress
CREATE POLICY "Users can view their workspace import progress"
  ON public.import_progress FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace import progress"
  ON public.import_progress FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace import progress"
  ON public.import_progress FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- -----------------------------------------------------------------------------
-- 2. Unique constraints for upsert operations
-- -----------------------------------------------------------------------------

-- raw_emails: Unique by workspace + external_id (prevents duplicate imports)
ALTER TABLE public.raw_emails 
DROP CONSTRAINT IF EXISTS raw_emails_workspace_external_unique;

ALTER TABLE public.raw_emails 
ADD CONSTRAINT raw_emails_workspace_external_unique 
UNIQUE (workspace_id, external_id);

-- import_progress: One progress record per workspace
ALTER TABLE public.import_progress 
ADD CONSTRAINT import_progress_workspace_unique 
UNIQUE (workspace_id);

-- -----------------------------------------------------------------------------
-- 3. Performance Indexes
-- -----------------------------------------------------------------------------

-- Index for faster email queries by workspace and folder
CREATE INDEX IF NOT EXISTS idx_raw_emails_workspace_folder 
ON public.raw_emails (workspace_id, folder);

-- Index for thread lookups (used for conversation threading)
CREATE INDEX IF NOT EXISTS idx_raw_emails_thread 
ON public.raw_emails (workspace_id, thread_id);

-- Enable realtime for import_progress so frontend can poll efficiently
ALTER PUBLICATION supabase_realtime ADD TABLE public.import_progress;