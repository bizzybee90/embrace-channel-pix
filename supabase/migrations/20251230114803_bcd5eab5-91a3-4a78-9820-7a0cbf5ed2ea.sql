-- Migration: Knowledge Base System for Multi-Tenant Onboarding

-- 1. Create industry_faq_templates table (starts EMPTY - populated via Apify scraping)
CREATE TABLE IF NOT EXISTS public.industry_faq_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_type TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  tags TEXT[],
  metadata JSONB DEFAULT '{}',
  embedding vector(1536),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_industry_faq_templates_type ON public.industry_faq_templates(industry_type);
CREATE INDEX IF NOT EXISTS idx_industry_faq_templates_active ON public.industry_faq_templates(is_active) WHERE is_active = true;

-- Enable RLS
ALTER TABLE public.industry_faq_templates ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users (templates are shared)
CREATE POLICY "Anyone can read industry templates" ON public.industry_faq_templates
  FOR SELECT USING (true);

-- Only service role can insert/update/delete templates
CREATE POLICY "Service role can manage templates" ON public.industry_faq_templates
  FOR ALL USING (auth.role() = 'service_role');

-- 2. Update faq_database table
-- Rename is_mac_specific to is_own_content (multi-tenant naming)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'faq_database' AND column_name = 'is_mac_specific') THEN
    ALTER TABLE public.faq_database RENAME COLUMN is_mac_specific TO is_own_content;
  END IF;
END $$;

-- Add new columns if they don't exist
ALTER TABLE public.faq_database 
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS generation_source TEXT DEFAULT 'manual';

-- 3. Add knowledge base tracking fields to business_context
ALTER TABLE public.business_context
  ADD COLUMN IF NOT EXISTS website_url TEXT,
  ADD COLUMN IF NOT EXISTS service_area TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_base_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS knowledge_base_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS knowledge_base_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS industry_faqs_copied INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS website_faqs_generated INTEGER DEFAULT 0;

-- 4. Create priority-aware FAQ search function
CREATE OR REPLACE FUNCTION public.match_faqs_with_priority(
  query_embedding vector(1536),
  p_workspace_id UUID,
  match_threshold DOUBLE PRECISION DEFAULT 0.7,
  match_count INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  question TEXT,
  answer TEXT,
  category TEXT,
  is_own_content BOOLEAN,
  priority INTEGER,
  similarity DOUBLE PRECISION
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
    f.category,
    COALESCE(f.is_own_content, false) as is_own_content,
    COALESCE(f.priority, 5) as priority,
    1 - (f.embedding <=> query_embedding) as similarity
  FROM public.faq_database f
  WHERE f.workspace_id = p_workspace_id
    AND f.embedding IS NOT NULL
    AND f.is_active = true
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
  ORDER BY 
    COALESCE(f.is_own_content, false) DESC,  -- Own content first
    COALESCE(f.priority, 5) DESC,             -- Higher priority first
    (f.embedding <=> query_embedding) ASC     -- Then by similarity
  LIMIT match_count;
END;
$$;