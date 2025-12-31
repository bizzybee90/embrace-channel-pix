-- Create inbox insights table for learning analytics
CREATE TABLE IF NOT EXISTS public.inbox_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  total_emails_analyzed integer DEFAULT 0,
  total_outbound_analyzed integer DEFAULT 0,
  emails_by_category jsonb DEFAULT '{}',
  emails_by_sender_domain jsonb DEFAULT '{}',
  common_inquiry_types jsonb DEFAULT '[]',
  avg_response_time_hours numeric,
  response_rate_percent numeric,
  peak_email_hours jsonb DEFAULT '[]',
  patterns_learned integer DEFAULT 0,
  learning_phases_completed jsonb DEFAULT '{}',
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(workspace_id)
);

-- Create learned responses table
CREATE TABLE IF NOT EXISTS public.learned_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email_category text,
  trigger_phrases text[] DEFAULT '{}',
  response_pattern text,
  example_response text,
  success_indicators jsonb DEFAULT '{}',
  times_used integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.inbox_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learned_responses ENABLE ROW LEVEL SECURITY;

-- RLS policies for inbox_insights
CREATE POLICY "Users can view their workspace inbox insights"
  ON public.inbox_insights FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace inbox insights"
  ON public.inbox_insights FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace inbox insights"
  ON public.inbox_insights FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- RLS policies for learned_responses  
CREATE POLICY "Users can view their workspace learned responses"
  ON public.learned_responses FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace learned responses"
  ON public.learned_responses FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace learned responses"
  ON public.learned_responses FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_inbox_insights_workspace ON public.inbox_insights(workspace_id);
CREATE INDEX IF NOT EXISTS idx_learned_responses_workspace ON public.learned_responses(workspace_id);
CREATE INDEX IF NOT EXISTS idx_learned_responses_category ON public.learned_responses(workspace_id, email_category);