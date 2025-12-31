-- ========================================
-- VOICE LEARNING SYSTEM TABLES
-- ========================================

-- Voice profile for each workspace - stores learned communication style
CREATE TABLE public.voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  greeting_patterns JSONB DEFAULT '[]'::jsonb,
  signoff_patterns JSONB DEFAULT '[]'::jsonb,
  formality_score INTEGER DEFAULT 50,
  avg_response_length INTEGER DEFAULT 0,
  uses_emojis BOOLEAN DEFAULT false,
  uses_exclamations BOOLEAN DEFAULT false,
  common_phrases JSONB DEFAULT '[]'::jsonb,
  tone_descriptors TEXT[] DEFAULT '{}'::text[],
  sample_responses JSONB DEFAULT '[]'::jsonb,
  analysis_status TEXT DEFAULT 'pending',
  emails_analyzed INTEGER DEFAULT 0,
  outbound_emails_found INTEGER DEFAULT 0,
  last_analyzed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(workspace_id)
);

-- Track draft edits for continuous learning
CREATE TABLE public.draft_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  original_draft TEXT NOT NULL,
  edited_draft TEXT NOT NULL,
  edit_distance FLOAT DEFAULT 0,
  edit_type TEXT DEFAULT 'manual',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add index for faster lookups
CREATE INDEX idx_voice_profiles_workspace ON public.voice_profiles(workspace_id);
CREATE INDEX idx_draft_edits_workspace ON public.draft_edits(workspace_id);
CREATE INDEX idx_draft_edits_conversation ON public.draft_edits(conversation_id);

-- Enable RLS
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_edits ENABLE ROW LEVEL SECURITY;

-- RLS policies for voice_profiles
CREATE POLICY "Users can view workspace voice profile"
  ON public.voice_profiles
  FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace voice profile"
  ON public.voice_profiles
  FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- RLS policies for draft_edits
CREATE POLICY "Users can view workspace draft edits"
  ON public.draft_edits
  FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can create draft edits"
  ON public.draft_edits
  FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

-- Add new columns to email_provider_configs for enhanced sync tracking
ALTER TABLE public.email_provider_configs
  ADD COLUMN IF NOT EXISTS sync_stage TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS inbound_emails_found INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS outbound_emails_found INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS threads_linked INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voice_profile_status TEXT DEFAULT 'pending';

-- Trigger to update updated_at
CREATE TRIGGER update_voice_profiles_updated_at
  BEFORE UPDATE ON public.voice_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();