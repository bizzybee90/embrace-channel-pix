-- =============================================================================
-- Workflow 4-7: Database Requirements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Voice Profiles: Unique constraint for workspace_id (if not exists)
-- -----------------------------------------------------------------------------
-- Check and add unique constraint on voice_profiles.workspace_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'voice_profiles_workspace_id_unique'
  ) THEN
    ALTER TABLE voice_profiles 
    ADD CONSTRAINT voice_profiles_workspace_id_unique UNIQUE (workspace_id);
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Indexes for performance
-- -----------------------------------------------------------------------------

-- Index for messages by conversation (Workflow 5 & 6)
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id 
ON messages(conversation_id);

-- Index for faq_database by workspace (Workflow 5)
CREATE INDEX IF NOT EXISTS idx_faq_database_workspace_id 
ON faq_database(workspace_id);

-- Index for voice_profiles by workspace (Workflow 5)
CREATE INDEX IF NOT EXISTS idx_voice_profiles_workspace_id 
ON voice_profiles(workspace_id);

-- Index for email_provider_configs by workspace (Workflow 6)
CREATE INDEX IF NOT EXISTS idx_email_provider_configs_workspace 
ON email_provider_configs(workspace_id);

-- Index for email_provider_configs by account_id (Workflow 7)
CREATE INDEX IF NOT EXISTS idx_email_provider_configs_account_id 
ON email_provider_configs(account_id);