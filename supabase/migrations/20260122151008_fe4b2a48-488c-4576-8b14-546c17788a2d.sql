-- Task 1: Knowledge Base Pipeline v2 - Database Schema Updates

-- Add columns to workspaces table
ALTER TABLE workspaces 
ADD COLUMN IF NOT EXISTS website_url TEXT,
ADD COLUMN IF NOT EXISTS ground_truth_generated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS knowledge_base_status TEXT DEFAULT 'pending';

-- Create knowledge_base_faqs table (unified FAQ storage with priority system)
CREATE TABLE IF NOT EXISTS knowledge_base_faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  source_domain TEXT,
  priority INTEGER DEFAULT 5,
  is_validated BOOLEAN DEFAULT false,
  validation_notes TEXT,
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, question)
);

-- Create ground_truth_facts table
CREATE TABLE IF NOT EXISTS ground_truth_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_value TEXT NOT NULL,
  confidence FLOAT DEFAULT 1.0,
  source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, fact_type, fact_key)
);

-- Add columns to competitor_sites for tracking
ALTER TABLE competitor_sites 
ADD COLUMN IF NOT EXISTS faqs_validated INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS faqs_added INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_error TEXT;

-- Add skipped_reason and ground_truth_validated to competitor_faqs_raw
ALTER TABLE competitor_faqs_raw 
ADD COLUMN IF NOT EXISTS skipped_reason TEXT,
ADD COLUMN IF NOT EXISTS ground_truth_validated BOOLEAN DEFAULT false;

-- Enable RLS on new tables
ALTER TABLE knowledge_base_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ground_truth_facts ENABLE ROW LEVEL SECURITY;

-- RLS policies for knowledge_base_faqs
CREATE POLICY "Users can view own workspace knowledge base faqs" 
ON knowledge_base_faqs FOR SELECT 
USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert own workspace knowledge base faqs" 
ON knowledge_base_faqs FOR INSERT 
WITH CHECK (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update own workspace knowledge base faqs" 
ON knowledge_base_faqs FOR UPDATE 
USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete own workspace knowledge base faqs" 
ON knowledge_base_faqs FOR DELETE 
USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

-- RLS policies for ground_truth_facts
CREATE POLICY "Users can view own workspace ground truth" 
ON ground_truth_facts FOR SELECT 
USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert own workspace ground truth" 
ON ground_truth_facts FOR INSERT 
WITH CHECK (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can update own workspace ground truth" 
ON ground_truth_facts FOR UPDATE 
USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete own workspace ground truth" 
ON ground_truth_facts FOR DELETE 
USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

-- Enable realtime for new tables
ALTER PUBLICATION supabase_realtime ADD TABLE knowledge_base_faqs;
ALTER PUBLICATION supabase_realtime ADD TABLE ground_truth_facts;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_knowledge_base_faqs_workspace ON knowledge_base_faqs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_faqs_source ON knowledge_base_faqs(source);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_faqs_priority ON knowledge_base_faqs(priority DESC);
CREATE INDEX IF NOT EXISTS idx_ground_truth_facts_workspace ON ground_truth_facts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ground_truth_facts_type ON ground_truth_facts(fact_type);