
-- Add training_reviewed column to conversations
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS training_reviewed boolean NOT NULL DEFAULT false;

-- Add training_reviewed_at for tracking when reviewed
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS training_reviewed_at timestamptz DEFAULT null;

-- Index for fast queue lookups
CREATE INDEX IF NOT EXISTS idx_conversations_training_reviewed 
ON public.conversations (training_reviewed, workspace_id) 
WHERE training_reviewed = false;
