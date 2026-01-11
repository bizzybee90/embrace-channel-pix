-- Create draft_verifications table for tracking AI draft verification
CREATE TABLE IF NOT EXISTS draft_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  draft_id UUID,
  original_draft TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  issues_found JSONB DEFAULT '[]',
  corrected_draft TEXT,
  confidence_score FLOAT,
  verification_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_draft_verifications_workspace 
  ON draft_verifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_draft_verifications_conversation 
  ON draft_verifications(conversation_id);
CREATE INDEX IF NOT EXISTS idx_draft_verifications_status 
  ON draft_verifications(verification_status);

-- Enable Row Level Security
ALTER TABLE draft_verifications ENABLE ROW LEVEL SECURITY;

-- Users can view their workspace verifications
CREATE POLICY "Users can view their workspace verifications"
  ON draft_verifications FOR SELECT
  USING (workspace_id IN (
    SELECT w.id FROM workspaces w
    JOIN users u ON u.workspace_id = w.id
    WHERE u.id = auth.uid()
  ));

-- Users can insert verifications for their workspace
CREATE POLICY "Users can insert verifications for their workspace"
  ON draft_verifications FOR INSERT
  WITH CHECK (workspace_id IN (
    SELECT w.id FROM workspaces w
    JOIN users u ON u.workspace_id = w.id
    WHERE u.id = auth.uid()
  ));

-- Add verification columns to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'unverified';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS verification_id UUID REFERENCES draft_verifications(id);