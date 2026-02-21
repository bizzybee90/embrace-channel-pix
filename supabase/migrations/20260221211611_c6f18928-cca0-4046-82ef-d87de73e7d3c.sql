ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_reasoning text;
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS ai_why_flagged text;