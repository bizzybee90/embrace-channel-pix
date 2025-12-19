-- Add decision routing columns to conversations table
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS decision_bucket text DEFAULT 'wait',
ADD COLUMN IF NOT EXISTS why_this_needs_you text,
ADD COLUMN IF NOT EXISTS cognitive_load text DEFAULT 'low',
ADD COLUMN IF NOT EXISTS risk_level text DEFAULT 'none';

-- Add check constraints for valid values
ALTER TABLE public.conversations 
ADD CONSTRAINT valid_decision_bucket CHECK (decision_bucket IN ('act_now', 'quick_win', 'auto_handled', 'wait')),
ADD CONSTRAINT valid_cognitive_load CHECK (cognitive_load IN ('high', 'low')),
ADD CONSTRAINT valid_risk_level CHECK (risk_level IN ('financial', 'retention', 'reputation', 'legal', 'none'));

-- Add index for decision bucket to optimize sorting/filtering
CREATE INDEX IF NOT EXISTS idx_conversations_decision_bucket ON public.conversations(decision_bucket);

-- Create a comment explaining the decision buckets
COMMENT ON COLUMN public.conversations.decision_bucket IS 'Decision routing bucket: act_now (urgent/risky), quick_win (fast to clear), auto_handled (no human needed), wait (defer/low priority)';
COMMENT ON COLUMN public.conversations.why_this_needs_you IS 'Human-readable explanation of why this needs attention (e.g., "Customer upset about late delivery")';
COMMENT ON COLUMN public.conversations.cognitive_load IS 'Whether this requires significant thinking (high) or is simple (low)';
COMMENT ON COLUMN public.conversations.risk_level IS 'Type of risk if ignored: financial, retention, reputation, legal, or none';