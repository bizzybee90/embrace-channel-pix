-- Phase 1: Add active_job_id to prevent race conditions
ALTER TABLE email_provider_configs ADD COLUMN IF NOT EXISTS active_job_id UUID;

-- Phase 2: Expand voice_profiles with full schema
ALTER TABLE voice_profiles 
  ADD COLUMN IF NOT EXISTS warmth_level INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS directness_level INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS avg_sentences INT DEFAULT 3,
  ADD COLUMN IF NOT EXISTS avg_words_per_sentence FLOAT DEFAULT 12,
  ADD COLUMN IF NOT EXISTS emoji_frequency TEXT DEFAULT 'never',
  ADD COLUMN IF NOT EXISTS exclamation_frequency FLOAT DEFAULT 0.1,
  ADD COLUMN IF NOT EXISTS avoided_words TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS response_patterns JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ignore_patterns JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS reply_triggers JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS price_mention_style TEXT DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS booking_confirmation_style TEXT,
  ADD COLUMN IF NOT EXISTS objection_handling_style TEXT,
  ADD COLUMN IF NOT EXISTS total_pairs_analyzed INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS response_rate_percent FLOAT,
  ADD COLUMN IF NOT EXISTS avg_response_time_minutes INT,
  ADD COLUMN IF NOT EXISTS style_confidence FLOAT DEFAULT 0;

-- Phase 3: Create email_pairs table (matched inbound → outbound)
CREATE TABLE IF NOT EXISTS email_pairs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  
  -- The inbound email
  inbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  inbound_from TEXT,
  inbound_subject TEXT,
  inbound_body TEXT,
  inbound_received_at TIMESTAMPTZ,
  
  -- The matching outbound reply
  outbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  outbound_body TEXT,
  outbound_sent_at TIMESTAMPTZ,
  
  -- Analysis results (populated by AI)
  category TEXT,
  subcategory TEXT,
  sentiment_inbound TEXT,
  sentiment_outbound TEXT,
  
  -- Response characteristics
  response_time_minutes INT,
  response_word_count INT,
  response_has_question BOOLEAN DEFAULT false,
  response_has_price BOOLEAN DEFAULT false,
  response_has_cta BOOLEAN DEFAULT false,
  
  -- Outcome tracking
  led_to_booking BOOLEAN,
  led_to_reply BOOLEAN,
  
  -- For similarity search during drafting
  embedding vector(1536),
  
  -- Quality score for selecting best examples
  quality_score FLOAT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_pairs_workspace ON email_pairs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_email_pairs_workspace_category ON email_pairs(workspace_id, category);
CREATE INDEX IF NOT EXISTS idx_email_pairs_quality ON email_pairs(workspace_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_email_pairs_conversation ON email_pairs(conversation_id);

-- Enable RLS on email_pairs
ALTER TABLE email_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view email pairs in their workspace" ON email_pairs
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage email pairs" ON email_pairs
  FOR ALL USING (true);

-- Phase 3: Create ignored_emails table
CREATE TABLE IF NOT EXISTS ignored_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  inbound_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  
  from_domain TEXT,
  subject_pattern TEXT,
  ignore_reason TEXT,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ignored_emails_workspace ON ignored_emails(workspace_id);

-- Enable RLS on ignored_emails
ALTER TABLE ignored_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view ignored emails in their workspace" ON ignored_emails
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage ignored emails" ON ignored_emails
  FOR ALL USING (true);

-- Phase 5: Create few_shot_examples table
CREATE TABLE IF NOT EXISTS few_shot_examples (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  email_pair_id UUID REFERENCES email_pairs(id) ON DELETE CASCADE,
  
  category TEXT NOT NULL,
  inbound_text TEXT,
  outbound_text TEXT,
  
  quality_score FLOAT,
  selection_reason TEXT,
  rank_in_category INT,
  
  embedding vector(1536),
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_few_shot_workspace ON few_shot_examples(workspace_id);
CREATE INDEX IF NOT EXISTS idx_few_shot_category ON few_shot_examples(workspace_id, category, rank_in_category);

-- Enable RLS on few_shot_examples
ALTER TABLE few_shot_examples ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view few shot examples in their workspace" ON few_shot_examples
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage few shot examples" ON few_shot_examples
  FOR ALL USING (true);

-- Phase 6: Create onboarding_progress table
CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE UNIQUE,
  
  -- Phase statuses
  email_import_status TEXT DEFAULT 'pending',
  email_import_progress INT DEFAULT 0,
  email_import_count INT DEFAULT 0,
  
  thread_matching_status TEXT DEFAULT 'pending',
  thread_matching_progress INT DEFAULT 0,
  pairs_matched INT DEFAULT 0,
  
  categorization_status TEXT DEFAULT 'pending',
  categorization_progress INT DEFAULT 0,
  pairs_categorized INT DEFAULT 0,
  
  style_analysis_status TEXT DEFAULT 'pending',
  
  few_shot_status TEXT DEFAULT 'pending',
  
  -- Discovered insights
  response_rate_percent FLOAT,
  avg_response_time_hours FLOAT,
  top_categories JSONB DEFAULT '[]',
  ignored_email_count INT DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ,
  estimated_completion_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on onboarding_progress
ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view onboarding progress in their workspace" ON onboarding_progress
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage onboarding progress" ON onboarding_progress
  FOR ALL USING (true);