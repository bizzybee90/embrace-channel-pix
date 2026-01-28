-- Enable pgvector extension for similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Create example_responses table for storing real email examples with embeddings
CREATE TABLE IF NOT EXISTS example_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category TEXT,
  inbound_text TEXT NOT NULL,
  outbound_text TEXT NOT NULL,
  inbound_embedding vector(1536),
  response_time_hours FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE example_responses ENABLE ROW LEVEL SECURITY;

-- RLS policies using the existing get_my_workspace_id() function pattern
CREATE POLICY "Users can view their workspace examples"
ON example_responses FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert examples for their workspace"
ON example_responses FOR INSERT
WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Service role full access to example_responses"
ON example_responses FOR ALL
USING (auth.role() = 'service_role');

-- Index for workspace filtering
CREATE INDEX IF NOT EXISTS example_responses_workspace_idx 
ON example_responses(workspace_id);

-- Create training_pairs view for easy data access
-- Join messages through conversations to get workspace_id
CREATE OR REPLACE VIEW training_pairs AS
SELECT 
  inbound.id AS inbound_id,
  inbound.conversation_id,
  c.title AS subject,
  inbound.body AS customer_text,
  outbound.body AS owner_text,
  c.workspace_id,
  EXTRACT(EPOCH FROM (outbound.created_at - inbound.created_at))/3600 AS response_hours
FROM messages AS inbound
JOIN messages AS outbound 
  ON inbound.conversation_id = outbound.conversation_id
JOIN conversations c
  ON inbound.conversation_id = c.id
WHERE 
  inbound.direction = 'inbound'
  AND outbound.direction = 'outbound'
  AND outbound.created_at > inbound.created_at 
  AND outbound.created_at < inbound.created_at + INTERVAL '3 days'
ORDER BY outbound.created_at DESC;

-- Add new columns to voice_profiles table
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS voice_dna JSONB;
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS playbook JSONB;
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS examples_stored INTEGER DEFAULT 0;

-- Create match_examples function for similarity search
CREATE OR REPLACE FUNCTION match_examples(
  query_embedding vector(1536),
  match_workspace UUID,
  match_count INT DEFAULT 3
)
RETURNS TABLE (
  id UUID,
  category TEXT,
  inbound_text TEXT,
  outbound_text TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.category,
    e.inbound_text,
    e.outbound_text,
    1 - (e.inbound_embedding <=> query_embedding) AS similarity
  FROM example_responses e
  WHERE e.workspace_id = match_workspace
  ORDER BY e.inbound_embedding <=> query_embedding
  LIMIT match_count;
END;
$$;