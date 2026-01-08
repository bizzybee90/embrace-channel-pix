-- Create faqs table for website scraping (workflow 8)
CREATE TABLE IF NOT EXISTS public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  source TEXT DEFAULT 'manual',
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add unique constraint to prevent duplicate FAQs
ALTER TABLE public.faqs ADD CONSTRAINT faqs_workspace_question_unique 
  UNIQUE (workspace_id, question);

-- Index for workspace lookups
CREATE INDEX IF NOT EXISTS idx_faqs_workspace_id ON public.faqs(workspace_id);

-- Enable RLS
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;

-- RLS policies for FAQs using existing pattern
CREATE POLICY "Users can view workspace FAQs"
  ON public.faqs FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can create FAQs"
  ON public.faqs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update workspace FAQs"
  ON public.faqs FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can delete workspace FAQs"
  ON public.faqs FOR DELETE
  USING (user_has_workspace_access(workspace_id));

-- Create correction_examples table for workflow 10
CREATE TABLE IF NOT EXISTS public.correction_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  original_draft TEXT NOT NULL,
  edited_draft TEXT NOT NULL,
  learnings JSONB DEFAULT '[]',
  analysis TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for correction_examples
CREATE INDEX IF NOT EXISTS idx_correction_examples_workspace 
  ON public.correction_examples(workspace_id);
CREATE INDEX IF NOT EXISTS idx_correction_examples_created 
  ON public.correction_examples(workspace_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.correction_examples ENABLE ROW LEVEL SECURITY;

-- RLS policies for correction_examples
CREATE POLICY "Users can view workspace corrections"
  ON public.correction_examples FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can create corrections"
  ON public.correction_examples FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update workspace corrections"
  ON public.correction_examples FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Add learnings and examples_count to voice_profiles
ALTER TABLE public.voice_profiles 
  ADD COLUMN IF NOT EXISTS learnings TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS examples_count INTEGER DEFAULT 0;