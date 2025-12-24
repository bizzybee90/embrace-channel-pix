-- Add automation_level column to email_provider_configs
ALTER TABLE public.email_provider_configs 
ADD COLUMN IF NOT EXISTS automation_level text DEFAULT 'draft_only' 
CHECK (automation_level IN ('automatic', 'draft_only', 'review_required', 'disabled'));

-- Add automation_level column to workspace_channels  
ALTER TABLE public.workspace_channels
ADD COLUMN IF NOT EXISTS automation_level text DEFAULT 'draft_only'
CHECK (automation_level IN ('automatic', 'draft_only', 'review_required', 'disabled'));

-- Add comment for documentation
COMMENT ON COLUMN public.email_provider_configs.automation_level IS 'Controls how AI handles responses: automatic (AI sends), draft_only (AI drafts, human sends), review_required (all go to review queue), disabled (no AI)';
COMMENT ON COLUMN public.workspace_channels.automation_level IS 'Controls how AI handles responses for this channel';