-- ============================================================================
-- Workflow 4-7: Database Requirements (Indexes Only)
-- ============================================================================

-- Add missing columns to voice_profiles for compatibility
ALTER TABLE voice_profiles 
ADD COLUMN IF NOT EXISTS tone text,
ADD COLUMN IF NOT EXISTS greeting_style text,
ADD COLUMN IF NOT EXISTS signoff_style text,
ADD COLUMN IF NOT EXISTS average_length integer,
ADD COLUMN IF NOT EXISTS examples jsonb;

-- Indexes for voice learning
CREATE INDEX IF NOT EXISTS idx_raw_emails_workspace_folder 
ON raw_emails(workspace_id, folder);

CREATE INDEX IF NOT EXISTS idx_raw_emails_thread_id 
ON raw_emails(thread_id);

-- Indexes for AI draft generation  
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id 
ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_faq_database_workspace_id 
ON faq_database(workspace_id);

CREATE INDEX IF NOT EXISTS idx_voice_profiles_workspace_id 
ON voice_profiles(workspace_id);

-- Indexes for email send
CREATE INDEX IF NOT EXISTS idx_email_provider_configs_workspace 
ON email_provider_configs(workspace_id);

-- Indexes for email webhook
CREATE INDEX IF NOT EXISTS idx_email_provider_configs_account_id 
ON email_provider_configs(account_id);

CREATE INDEX IF NOT EXISTS idx_raw_emails_external_id 
ON raw_emails(workspace_id, external_id);