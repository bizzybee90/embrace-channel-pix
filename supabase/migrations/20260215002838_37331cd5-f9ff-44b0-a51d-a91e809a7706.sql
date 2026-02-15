
-- Create voice_drift_log table for tracking style drift checks
CREATE TABLE public.voice_drift_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  drift_score FLOAT NOT NULL DEFAULT 0,
  traits_changed JSONB DEFAULT '[]'::jsonb,
  refresh_triggered BOOLEAN NOT NULL DEFAULT false,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  emails_sampled INT DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'checked'
);

-- Enable RLS
ALTER TABLE public.voice_drift_log ENABLE ROW LEVEL SECURITY;

-- Users can view drift logs for their workspace
CREATE POLICY "Users can view drift logs for their workspace"
ON public.voice_drift_log
FOR SELECT
USING (workspace_id = public.get_my_workspace_id());

-- Service role can insert (edge functions)
CREATE POLICY "Service role can manage drift logs"
ON public.voice_drift_log
FOR ALL
USING (true)
WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_voice_drift_log_workspace ON public.voice_drift_log(workspace_id, checked_at DESC);
