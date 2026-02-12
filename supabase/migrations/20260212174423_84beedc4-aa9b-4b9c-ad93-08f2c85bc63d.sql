
-- Phase 1: Fix match_faqs to query faq_database instead of faqs
CREATE OR REPLACE FUNCTION public.match_faqs(
  query_embedding extensions.vector,
  match_workspace_id uuid,
  match_threshold double precision DEFAULT 0.5,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  question text,
  answer text,
  source text,
  priority integer,
  similarity double precision
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
$function$;
