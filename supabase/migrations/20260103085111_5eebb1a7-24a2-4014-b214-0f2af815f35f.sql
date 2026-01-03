-- ============================================================
-- RAW EMAILS TABLE (Webhook Queue)
-- ============================================================
CREATE TABLE IF NOT EXISTS raw_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Aurinko data
  external_id TEXT NOT NULL,
  thread_id TEXT,
  
  -- Email content
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT,
  to_name TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  
  -- Metadata
  folder TEXT,
  received_at TIMESTAMPTZ,
  has_attachments BOOLEAN DEFAULT FALSE,
  
  -- Processing status
  status TEXT DEFAULT 'pending',
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INT DEFAULT 0,
  
  -- Classification results
  classification JSONB,
  email_type TEXT,
  lane TEXT,
  confidence FLOAT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_emails_pending ON raw_emails(workspace_id, status) 
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_raw_emails_workspace ON raw_emails(workspace_id);

-- ============================================================
-- EMAIL IMPORT PROGRESS (Single source of truth for UI)
-- ============================================================
CREATE TABLE IF NOT EXISTS email_import_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  current_phase TEXT DEFAULT 'connecting',
  phase1_status TEXT DEFAULT 'pending',
  emails_received INT DEFAULT 0,
  emails_classified INT DEFAULT 0,
  emails_failed INT DEFAULT 0,
  phase2_status TEXT DEFAULT 'pending',
  conversations_found INT DEFAULT 0,
  conversations_with_replies INT DEFAULT 0,
  phase3_status TEXT DEFAULT 'pending',
  pairs_analyzed INT DEFAULT 0,
  voice_profile_complete BOOLEAN DEFAULT FALSE,
  playbook_complete BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMPTZ,
  phase1_completed_at TIMESTAMPTZ,
  phase2_completed_at TIMESTAMPTZ,
  phase3_completed_at TIMESTAMPTZ,
  estimated_completion_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id)
);

ALTER PUBLICATION supabase_realtime ADD TABLE public.email_import_progress;

-- ============================================================
-- CONVERSATION PAIRS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id),
  inbound_message_id UUID NOT NULL,
  outbound_message_id UUID NOT NULL,
  inbound_body TEXT,
  outbound_body TEXT,
  inbound_type TEXT,
  reply_time_hours FLOAT,
  reply_length INT,
  received_at TIMESTAMPTZ,
  analyzed_in_phase3 BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id, inbound_message_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_pairs_workspace ON conversation_pairs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversation_pairs_unanalyzed ON conversation_pairs(workspace_id, analyzed_in_phase3) 
  WHERE analyzed_in_phase3 = FALSE;

-- ============================================================
-- CONVERSATION ANALYTICS
-- ============================================================
CREATE TABLE IF NOT EXISTS conversation_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  total_conversations INT DEFAULT 0,
  conversations_with_replies INT DEFAULT 0,
  total_pairs INT DEFAULT 0,
  avg_reply_time_hours FLOAT,
  reply_rate FLOAT,
  avg_reply_length FLOAT,
  by_type JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id)
);

-- ============================================================
-- RESPONSE PLAYBOOK
-- ============================================================
CREATE TABLE IF NOT EXISTS response_playbook (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  playbook JSONB NOT NULL,
  decision_patterns JSONB,
  timing_patterns JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id)
);

-- ============================================================
-- Update voice_profiles table
-- ============================================================
ALTER TABLE voice_profiles 
ADD COLUMN IF NOT EXISTS personality_traits JSONB,
ADD COLUMN IF NOT EXISTS example_responses JSONB;

-- ============================================================
-- Helper function
-- ============================================================
CREATE OR REPLACE FUNCTION increment_emails_received(p_workspace_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO email_import_progress (workspace_id, emails_received, current_phase, started_at)
  VALUES (p_workspace_id, 1, 'importing', NOW())
  ON CONFLICT (workspace_id) DO UPDATE
  SET emails_received = email_import_progress.emails_received + 1,
      current_phase = CASE 
        WHEN email_import_progress.current_phase = 'connecting' THEN 'importing'
        ELSE email_import_progress.current_phase
      END,
      started_at = COALESCE(email_import_progress.started_at, NOW()),
      updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RLS Policies (using users table)
-- ============================================================
ALTER TABLE raw_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage raw emails" ON raw_emails FOR ALL USING (true);

ALTER TABLE email_import_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view import progress" ON email_import_progress FOR SELECT USING (true);
CREATE POLICY "Service role can manage import progress" ON email_import_progress FOR ALL USING (true);

ALTER TABLE conversation_pairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage conversation pairs" ON conversation_pairs FOR ALL USING (true);

ALTER TABLE conversation_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view analytics" ON conversation_analytics FOR SELECT USING (true);
CREATE POLICY "Service role can manage analytics" ON conversation_analytics FOR ALL USING (true);

ALTER TABLE response_playbook ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view playbook" ON response_playbook FOR SELECT USING (true);
CREATE POLICY "Service role can manage playbook" ON response_playbook FOR ALL USING (true);