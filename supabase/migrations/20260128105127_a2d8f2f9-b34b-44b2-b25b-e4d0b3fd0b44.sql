-- Add classification columns to raw_emails
ALTER TABLE raw_emails 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS requires_reply BOOLEAN,
ADD COLUMN IF NOT EXISTS urgency TEXT DEFAULT 'medium',
ADD COLUMN IF NOT EXISTS confidence FLOAT,
ADD COLUMN IF NOT EXISTS classified_by TEXT,
ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;

-- Indexes for fast queue processing
CREATE INDEX IF NOT EXISTS raw_emails_status_idx ON raw_emails(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS raw_emails_workspace_status_idx ON raw_emails(workspace_id, status);

-- Create classification_corrections table for learning
CREATE TABLE IF NOT EXISTS classification_corrections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email_id UUID,
  original_text TEXT,
  original_category TEXT,
  corrected_category TEXT,
  corrected_requires_reply BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE classification_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace corrections"
ON classification_corrections FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert corrections for their workspace"
ON classification_corrections FOR INSERT
WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Service role full access to corrections"
ON classification_corrections FOR ALL
USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS classification_corrections_workspace_idx 
ON classification_corrections(workspace_id);

-- Create known_senders table for rule-based classification
CREATE TABLE IF NOT EXISTS known_senders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern TEXT NOT NULL,
  pattern_type TEXT NOT NULL,
  category TEXT NOT NULL,
  requires_reply BOOLEAN DEFAULT false,
  is_global BOOLEAN DEFAULT true,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE known_senders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view global senders"
ON known_senders FOR SELECT
USING (is_global = true OR workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace senders"
ON known_senders FOR ALL
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Service role full access to known_senders"
ON known_senders FOR ALL
USING (auth.role() = 'service_role');

-- Seed with common patterns
INSERT INTO known_senders (pattern, pattern_type, category, requires_reply, is_global) VALUES
('noreply@', 'contains', 'notification', false, true),
('no-reply@', 'contains', 'notification', false, true),
('notifications@', 'contains', 'notification', false, true),
('mailer-daemon@', 'contains', 'notification', false, true),
('postmaster@', 'contains', 'notification', false, true),
('stripe.com', 'ends_with', 'payment_billing', false, true),
('xero.com', 'ends_with', 'payment_billing', false, true),
('quickbooks.com', 'ends_with', 'payment_billing', false, true),
('paypal.com', 'ends_with', 'payment_billing', false, true),
('square.com', 'ends_with', 'payment_billing', false, true),
('facebookmail.com', 'ends_with', 'notification', false, true),
('linkedin.com', 'ends_with', 'notification', false, true),
('twitter.com', 'ends_with', 'notification', false, true),
('indeed.com', 'ends_with', 'job_application', true, true),
('reed.co.uk', 'ends_with', 'job_application', true, true),
('totaljobs.com', 'ends_with', 'job_application', true, true),
('@newsletter', 'contains', 'newsletter', false, true),
('@marketing', 'contains', 'newsletter', false, true),
('mailchimp.com', 'ends_with', 'newsletter', false, true),
('sendgrid.net', 'ends_with', 'notification', false, true)
ON CONFLICT DO NOTHING;

-- Create batch-fetch function with row locking (CRITICAL for parallel processing)
CREATE OR REPLACE FUNCTION get_unprocessed_batch(
  p_workspace_id UUID,
  p_batch_size INT DEFAULT 50
)
RETURNS TABLE (
  id UUID, 
  subject TEXT, 
  body_text TEXT, 
  from_email TEXT,
  folder TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE raw_emails r
  SET status = 'processing'
  WHERE r.id IN (
    SELECT r2.id 
    FROM raw_emails r2
    WHERE r2.workspace_id = p_workspace_id
      AND r2.status = 'pending'
      AND r2.category IS NULL
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING 
    r.id, 
    r.subject, 
    r.body_text, 
    r.from_email,
    r.folder;
END;
$$;