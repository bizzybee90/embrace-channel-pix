-- Add review columns to conversations table
ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false;

ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;

ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES public.users(id);

ALTER TABLE public.conversations 
ADD COLUMN IF NOT EXISTS review_outcome text CHECK (review_outcome IN ('confirmed', 'changed'));

-- Create index for efficient review queue queries
CREATE INDEX IF NOT EXISTS idx_conversations_needs_review 
ON public.conversations(workspace_id, needs_review, reviewed_at) 
WHERE needs_review = true;