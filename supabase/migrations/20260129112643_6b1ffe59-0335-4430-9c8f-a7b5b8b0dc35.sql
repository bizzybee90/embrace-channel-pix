-- =============================================================================
-- PIPELINE LOCKS TABLE - Prevents thundering herd problem
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.pipeline_locks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  function_name TEXT NOT NULL,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT,
  UNIQUE(workspace_id, function_name)
);

-- Index for efficient cleanup of stale locks
CREATE INDEX IF NOT EXISTS idx_pipeline_locks_locked_at ON public.pipeline_locks(locked_at);

-- Enable RLS
ALTER TABLE public.pipeline_locks ENABLE ROW LEVEL SECURITY;

-- Service role can manage locks (edge functions use service role)
CREATE POLICY "Service role manages pipeline locks" 
ON public.pipeline_locks 
FOR ALL 
USING (true)
WITH CHECK (true);