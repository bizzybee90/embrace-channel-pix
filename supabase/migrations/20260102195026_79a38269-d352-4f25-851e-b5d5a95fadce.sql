-- ============================================================
-- BIZZYBEE EMAIL IMPORT SYSTEM - DATABASE SCHEMA
-- ============================================================

-- ============================================================
-- TABLE: email_import_jobs
-- Main job tracking with checkpointing for reliability
-- ============================================================
CREATE TABLE IF NOT EXISTS email_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES email_provider_configs(id) ON DELETE CASCADE,
  
  -- Status tracking
  status TEXT NOT NULL DEFAULT 'queued' 
    CHECK (status IN ('queued', 'scanning_inbox', 'scanning_sent', 'analyzing', 'fetching', 'training', 'completed', 'error', 'cancelled', 'paused')),
  
  -- Progress counters
  inbox_emails_scanned INT DEFAULT 0,
  sent_emails_scanned INT DEFAULT 0,
  total_threads_found INT DEFAULT 0,
  conversation_threads INT DEFAULT 0,
  bodies_fetched INT DEFAULT 0,
  bodies_skipped INT DEFAULT 0,
  messages_created INT DEFAULT 0,
  
  -- Checkpointing for resume capability
  checkpoint JSONB DEFAULT '{}',
  
  -- Heartbeat for watchdog
  heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  
  -- Error handling
  error_message TEXT,
  error_details JSONB,
  retry_count INT DEFAULT 0,
  
  -- Metadata
  import_mode TEXT DEFAULT 'last_1000',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_jobs_status ON email_import_jobs(status);
CREATE INDEX IF NOT EXISTS idx_import_jobs_heartbeat ON email_import_jobs(heartbeat_at) WHERE status IN ('scanning_inbox', 'scanning_sent', 'analyzing', 'fetching');
CREATE INDEX IF NOT EXISTS idx_import_jobs_workspace ON email_import_jobs(workspace_id);

-- Enable RLS
ALTER TABLE email_import_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace import jobs"
  ON email_import_jobs FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can create import jobs in their workspace"
  ON email_import_jobs FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update their workspace import jobs"
  ON email_import_jobs FOR UPDATE
  USING (workspace_id = get_my_workspace_id());


-- ============================================================
-- TABLE: email_import_queue
-- Raw email metadata from Phase 1, bodies added in Phase 2
-- ============================================================
CREATE TABLE IF NOT EXISTS email_import_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES email_provider_configs(id) ON DELETE CASCADE,
  job_id UUID REFERENCES email_import_jobs(id) ON DELETE SET NULL,
  
  -- Email identity
  external_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  
  -- Direction
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  
  -- Metadata (from Phase 1)
  from_email TEXT,
  from_name TEXT,
  to_emails TEXT[],
  subject TEXT,
  received_at TIMESTAMPTZ,
  
  -- Classification
  is_noise BOOLEAN DEFAULT FALSE,
  noise_reason TEXT,
  
  -- Body (from Phase 2)
  body TEXT,
  body_html TEXT,
  has_body BOOLEAN DEFAULT FALSE,
  
  -- Processing status
  status TEXT DEFAULT 'scanned' 
    CHECK (status IN ('scanned', 'queued_for_fetch', 'fetched', 'processed', 'skipped', 'error')),
  error_message TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  fetched_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  
  UNIQUE(workspace_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_email_queue_thread ON email_import_queue(workspace_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_direction ON email_import_queue(workspace_id, direction);
CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_import_queue(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_email_queue_job ON email_import_queue(job_id);
CREATE INDEX IF NOT EXISTS idx_email_queue_noise ON email_import_queue(workspace_id, is_noise) WHERE is_noise = FALSE;

-- Enable RLS
ALTER TABLE email_import_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace email queue"
  ON email_import_queue FOR SELECT
  USING (workspace_id = get_my_workspace_id());


-- ============================================================
-- TABLE: email_fetch_retries
-- Failed fetches that need retry
-- ============================================================
CREATE TABLE IF NOT EXISTS email_fetch_retries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id UUID REFERENCES email_import_jobs(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  
  attempt_count INT DEFAULT 1,
  max_attempts INT DEFAULT 3,
  last_error TEXT,
  last_status_code INT,
  
  next_retry_at TIMESTAMPTZ DEFAULT NOW(),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_email_retries_next ON email_fetch_retries(next_retry_at) WHERE attempt_count < max_attempts;

-- Enable RLS
ALTER TABLE email_fetch_retries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace email retries"
  ON email_fetch_retries FOR SELECT
  USING (workspace_id = get_my_workspace_id());


-- ============================================================
-- TABLE: email_thread_analysis
-- Results of thread grouping
-- ============================================================
CREATE TABLE IF NOT EXISTS email_thread_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id UUID REFERENCES email_import_jobs(id) ON DELETE CASCADE,
  
  thread_id TEXT NOT NULL,
  
  inbound_count INT DEFAULT 0,
  outbound_count INT DEFAULT 0,
  total_count INT DEFAULT 0,
  
  is_conversation BOOLEAN DEFAULT FALSE,
  is_noise_thread BOOLEAN DEFAULT FALSE,
  
  first_inbound_id TEXT,
  first_outbound_id TEXT,
  latest_inbound_id TEXT,
  latest_outbound_id TEXT,
  
  needs_body_fetch BOOLEAN DEFAULT FALSE,
  bodies_fetched BOOLEAN DEFAULT FALSE,
  conversation_created BOOLEAN DEFAULT FALSE,
  conversation_id UUID REFERENCES conversations(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_thread_analysis_conversation ON email_thread_analysis(workspace_id, is_conversation) WHERE is_conversation = TRUE;
CREATE INDEX IF NOT EXISTS idx_thread_analysis_needs_fetch ON email_thread_analysis(workspace_id, needs_body_fetch) WHERE needs_body_fetch = TRUE AND bodies_fetched = FALSE;

-- Enable RLS
ALTER TABLE email_thread_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace thread analysis"
  ON email_thread_analysis FOR SELECT
  USING (workspace_id = get_my_workspace_id());


-- ============================================================
-- FUNCTION: analyze_email_threads
-- ============================================================
CREATE OR REPLACE FUNCTION analyze_email_threads(p_workspace_id UUID, p_job_id UUID)
RETURNS TABLE(threads_analyzed INT, conversation_threads INT, noise_threads INT) 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threads_analyzed INT;
  v_conversation_threads INT;
  v_noise_threads INT;
BEGIN
  DELETE FROM email_thread_analysis WHERE job_id = p_job_id;
  
  INSERT INTO email_thread_analysis (
    workspace_id, job_id, thread_id, inbound_count, outbound_count, total_count,
    is_conversation, is_noise_thread, first_inbound_id, first_outbound_id,
    latest_inbound_id, latest_outbound_id, needs_body_fetch
  )
  SELECT 
    p_workspace_id, p_job_id, eq.thread_id,
    COUNT(*) FILTER (WHERE eq.direction = 'inbound'),
    COUNT(*) FILTER (WHERE eq.direction = 'outbound'),
    COUNT(*),
    (COUNT(*) FILTER (WHERE eq.direction = 'inbound') > 0 
     AND COUNT(*) FILTER (WHERE eq.direction = 'outbound') > 0),
    (COUNT(*) FILTER (WHERE eq.is_noise = FALSE) = 0),
    MIN(eq.external_id) FILTER (WHERE eq.direction = 'inbound'),
    MIN(eq.external_id) FILTER (WHERE eq.direction = 'outbound'),
    MAX(eq.external_id) FILTER (WHERE eq.direction = 'inbound'),
    MAX(eq.external_id) FILTER (WHERE eq.direction = 'outbound'),
    (COUNT(*) FILTER (WHERE eq.direction = 'inbound') > 0 
     AND COUNT(*) FILTER (WHERE eq.direction = 'outbound') > 0
     AND COUNT(*) FILTER (WHERE eq.is_noise = FALSE) > 0)
  FROM email_import_queue eq
  WHERE eq.workspace_id = p_workspace_id AND eq.job_id = p_job_id
  GROUP BY eq.thread_id;
  
  SELECT COUNT(*) INTO v_threads_analyzed FROM email_thread_analysis WHERE job_id = p_job_id;
  SELECT COUNT(*) INTO v_conversation_threads FROM email_thread_analysis WHERE job_id = p_job_id AND is_conversation = TRUE;
  SELECT COUNT(*) INTO v_noise_threads FROM email_thread_analysis WHERE job_id = p_job_id AND is_noise_thread = TRUE;
  
  UPDATE email_import_jobs SET
    total_threads_found = v_threads_analyzed,
    conversation_threads = v_conversation_threads,
    updated_at = NOW()
  WHERE id = p_job_id;
  
  RETURN QUERY SELECT v_threads_analyzed, v_conversation_threads, v_noise_threads;
END;
$$;


-- ============================================================
-- FUNCTION: mark_noise_emails
-- ============================================================
CREATE OR REPLACE FUNCTION mark_noise_emails(p_workspace_id UUID, p_job_id UUID)
RETURNS INT 
LANGUAGE plpgsql 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_marked INT;
BEGIN
  UPDATE email_import_queue SET
    is_noise = TRUE,
    noise_reason = CASE
      WHEN from_email LIKE '%noreply%' THEN 'noreply'
      WHEN from_email LIKE '%no-reply%' THEN 'noreply'
      WHEN from_email LIKE '%@stripe.com' THEN 'payment_notification'
      WHEN from_email LIKE '%@paypal.com' THEN 'payment_notification'
      WHEN from_email LIKE '%@indeed.com' THEN 'job_board'
      WHEN from_email LIKE '%@linkedin.com' THEN 'job_board'
      WHEN from_email LIKE '%@facebook.com' THEN 'social_notification'
      WHEN from_email LIKE '%@twitter.com' THEN 'social_notification'
      WHEN from_email LIKE '%@mailchimp.com' THEN 'newsletter'
      WHEN from_email LIKE '%newsletter%' THEN 'newsletter'
      WHEN from_email LIKE 'mailer-daemon%' THEN 'system'
      ELSE 'other_noise'
    END,
    status = 'skipped'
  WHERE workspace_id = p_workspace_id
    AND job_id = p_job_id
    AND is_noise = FALSE
    AND (
      from_email LIKE '%noreply%' OR from_email LIKE '%no-reply%'
      OR from_email LIKE '%@stripe.com' OR from_email LIKE '%@paypal.com'
      OR from_email LIKE '%@indeed.com' OR from_email LIKE '%@linkedin.com'
      OR from_email LIKE '%@facebook.com' OR from_email LIKE '%@twitter.com'
      OR from_email LIKE '%@mailchimp.com' OR from_email LIKE '%newsletter%'
      OR from_email LIKE 'mailer-daemon%'
    );
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RETURN v_marked;
END;
$$;


-- ============================================================
-- Trigger for updated_at on email_import_jobs
-- ============================================================
DROP TRIGGER IF EXISTS update_email_import_jobs_updated_at ON email_import_jobs;
CREATE TRIGGER update_email_import_jobs_updated_at
  BEFORE UPDATE ON email_import_jobs 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();