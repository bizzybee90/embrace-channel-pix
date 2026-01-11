-- =============================================
-- STAGE 3 COMPLETE SQL MIGRATION (Fixed RLS)
-- =============================================

-- 1. Customer Intelligence
ALTER TABLE customers ADD COLUMN IF NOT EXISTS intelligence JSONB DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifetime_value DECIMAL(10,2) DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS sentiment_trend TEXT DEFAULT 'neutral';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS response_preference TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS topics_discussed TEXT[] DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS vip_status BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS customer_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  insight_text TEXT NOT NULL,
  confidence FLOAT,
  source_conversations UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_customer_insights_customer ON customer_insights(customer_id);
ALTER TABLE customer_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customer_insights_workspace_access" ON customer_insights FOR ALL
  USING (workspace_id = get_my_workspace_id());
CREATE POLICY "customer_insights_service_role" ON customer_insights FOR ALL
  TO service_role USING (true);

-- 2. Document Processing
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size INTEGER,
  status TEXT DEFAULT 'pending',
  extracted_text TEXT,
  page_count INTEGER,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  page_number INTEGER,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_document ON document_chunks(document_id);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_workspace_access" ON documents FOR ALL
  USING (workspace_id = get_my_workspace_id());
CREATE POLICY "document_chunks_workspace_access" ON document_chunks FOR SELECT
  USING (workspace_id = get_my_workspace_id());
CREATE POLICY "documents_service_role" ON documents FOR ALL TO service_role USING (true);
CREATE POLICY "document_chunks_service_role" ON document_chunks FOR ALL TO service_role USING (true);

-- Document chunk search function
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding vector,
  match_workspace_id uuid,
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5
)
RETURNS TABLE (id uuid, document_id uuid, content text, page_number int, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT dc.id, dc.document_id, dc.content, dc.page_number,
         1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE dc.workspace_id = match_workspace_id
    AND dc.embedding IS NOT NULL
    AND 1 - (dc.embedding <=> query_embedding) > match_threshold
  ORDER BY similarity DESC LIMIT match_count;
END;
$$;

-- 3. Pattern Detection / Inbox Insights
CREATE TABLE IF NOT EXISTS inbox_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  insight_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT DEFAULT 'info',
  metrics JSONB DEFAULT '{}',
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  is_read BOOLEAN DEFAULT false,
  is_actionable BOOLEAN DEFAULT false,
  action_taken BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbox_insights_workspace ON inbox_insights(workspace_id, created_at DESC);
ALTER TABLE inbox_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inbox_insights_workspace_access" ON inbox_insights FOR ALL
  USING (workspace_id = get_my_workspace_id());
CREATE POLICY "inbox_insights_service_role" ON inbox_insights FOR ALL TO service_role USING (true);

-- 4. Image Analysis
CREATE TABLE IF NOT EXISTS image_analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  image_url TEXT NOT NULL,
  analysis_type TEXT NOT NULL,
  extracted_data JSONB DEFAULT '{}',
  description TEXT,
  suggested_response TEXT,
  confidence FLOAT,
  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_image_analyses_workspace ON image_analyses(workspace_id);
ALTER TABLE image_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "image_analyses_workspace_access" ON image_analyses FOR ALL
  USING (workspace_id = get_my_workspace_id());
CREATE POLICY "image_analyses_service_role" ON image_analyses FOR ALL TO service_role USING (true);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN DEFAULT false;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachment_urls TEXT[] DEFAULT '{}';

-- 5. Audio Processing / Voicemail
CREATE TABLE IF NOT EXISTS voicemail_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  audio_url TEXT NOT NULL,
  duration_seconds INTEGER,
  transcript TEXT,
  summary TEXT,
  caller_sentiment TEXT,
  extracted_info JSONB DEFAULT '{}',
  suggested_response TEXT,
  processed_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voicemail_transcripts_workspace ON voicemail_transcripts(workspace_id);
ALTER TABLE voicemail_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voicemail_transcripts_workspace_access" ON voicemail_transcripts FOR ALL
  USING (workspace_id = get_my_workspace_id());
CREATE POLICY "voicemail_transcripts_service_role" ON voicemail_transcripts FOR ALL TO service_role USING (true);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_url TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_voicemail BOOLEAN DEFAULT false;

-- 6. Storage bucket for documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT DO NOTHING;