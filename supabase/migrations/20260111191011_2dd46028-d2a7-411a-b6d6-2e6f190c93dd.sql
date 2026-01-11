-- Function to search FAQs by semantic similarity
CREATE OR REPLACE FUNCTION match_faqs(
  query_embedding vector(1536),
  match_workspace_id uuid,
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  question text,
  answer text,
  source text,
  priority int4,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.question,
    f.answer,
    f.source,
    f.priority,
    (1 - (f.embedding <=> query_embedding))::float AS similarity
  FROM faqs f
  WHERE f.workspace_id = match_workspace_id
    AND f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
  ORDER BY 
    f.priority DESC,
    similarity DESC
  LIMIT match_count;
END;
$$;

-- Create index for faster vector search (if not exists)
CREATE INDEX IF NOT EXISTS faqs_embedding_idx ON faqs 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);