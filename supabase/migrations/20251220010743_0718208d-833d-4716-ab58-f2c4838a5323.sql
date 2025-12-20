-- Create sender_behaviour_stats table for learning from history
CREATE TABLE IF NOT EXISTS public.sender_behaviour_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  sender_domain TEXT NOT NULL,
  sender_email TEXT,
  total_messages INTEGER DEFAULT 0,
  replied_count INTEGER DEFAULT 0,
  ignored_count INTEGER DEFAULT 0,
  reply_rate NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_messages > 0 THEN replied_count::NUMERIC / total_messages::NUMERIC ELSE 0 END
  ) STORED,
  ignored_rate NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_messages > 0 THEN ignored_count::NUMERIC / total_messages::NUMERIC ELSE 0 END
  ) STORED,
  avg_response_time_minutes NUMERIC,
  last_interaction_at TIMESTAMPTZ,
  vip_score NUMERIC DEFAULT 0,
  suggested_bucket TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, sender_domain)
);

-- Enable RLS
ALTER TABLE public.sender_behaviour_stats ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view workspace sender stats"
ON public.sender_behaviour_stats FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "System can manage sender stats"
ON public.sender_behaviour_stats FOR ALL
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_sender_behaviour_domain ON public.sender_behaviour_stats(workspace_id, sender_domain);

-- Add handled_today tracking to conversations for the "BizzyBee handled X today" metric
-- This is computed at runtime from decision_bucket but we add a column for easier querying
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS auto_handled_at TIMESTAMPTZ;

-- Update trigger for updated_at
CREATE TRIGGER update_sender_behaviour_stats_updated_at
BEFORE UPDATE ON public.sender_behaviour_stats
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();