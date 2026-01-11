-- Drop and recreate match_faqs with flexible vector type (no dimension constraint)
DROP FUNCTION IF EXISTS match_faqs(vector(1536), uuid, float, int);
DROP FUNCTION IF EXISTS match_faqs(vector, uuid, float, int);

CREATE OR REPLACE FUNCTION match_faqs(
  query_embedding vector,
  match_workspace_id uuid,
  match_threshold float DEFAULT 0.5,
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
SECURITY DEFINER
SET search_path = public
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

-- Also create a version for faq_database table
CREATE OR REPLACE FUNCTION match_faq_database(
  query_embedding vector,
  match_workspace_id uuid,
  match_threshold float DEFAULT 0.5,
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
SECURITY DEFINER
SET search_path = public
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
  FROM faq_database f
  WHERE f.workspace_id = match_workspace_id
    AND f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
  ORDER BY 
    f.priority DESC,
    similarity DESC
  LIMIT match_count;
END;
$$;