-- Create make_progress table for Make.com integration
CREATE TABLE IF NOT EXISTS public.make_progress (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'idle',
  emails_imported INT DEFAULT 0,
  emails_classified INT DEFAULT 0,
  emails_total INT DEFAULT 0,
  voice_profile_complete BOOLEAN DEFAULT FALSE,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.make_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "make_progress_select" ON public.make_progress 
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "make_progress_insert" ON public.make_progress 
  FOR INSERT WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "make_progress_update" ON public.make_progress 
  FOR UPDATE USING (user_has_workspace_access(workspace_id));

-- Create response_feedback table for AI learning
CREATE TABLE IF NOT EXISTS public.response_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  ai_draft TEXT,
  ai_confidence FLOAT,
  final_response TEXT,
  was_edited BOOLEAN DEFAULT FALSE,
  edit_distance FLOAT,
  scenario_type TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.response_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "response_feedback_select" ON public.response_feedback 
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "response_feedback_insert" ON public.response_feedback 
  FOR INSERT WITH CHECK (user_has_workspace_access(workspace_id));