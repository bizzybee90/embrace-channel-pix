-- Fix function search path security issue
CREATE OR REPLACE FUNCTION public.match_conversations(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.7,
  match_count int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  text text,
  ai_response text,
  final_response text,
  human_edited boolean,
  led_to_booking boolean,
  customer_satisfaction integer,
  mode text,
  confidence numeric,
  similarity float
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    COALESCE(c.summary_for_human, c.title, '') as text,
    c.ai_draft_response,
    c.final_response,
    c.human_edited,
    c.led_to_booking,
    c.customer_satisfaction,
    c.mode,
    c.confidence,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM public.conversations c
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;