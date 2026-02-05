-- Onboarding progress tracking table
CREATE TABLE IF NOT EXISTS public.onboarding_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  step TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  details JSONB DEFAULT '{}',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_onboarding_progress_workspace ON onboarding_progress(workspace_id);

-- Enable RLS
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Users can view their own workspace onboarding progress
CREATE POLICY "Users can view own workspace onboarding" ON public.onboarding_progress
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM users WHERE id = auth.uid()
    )
  );

-- Users can insert/update their own workspace onboarding progress
CREATE POLICY "Users can manage own workspace onboarding" ON public.onboarding_progress
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM users WHERE id = auth.uid()
    )
  );