-- ============================================================
-- BIZZYBEE COMPETITOR RESEARCH SYSTEM - DATABASE SCHEMA UPDATE
-- ============================================================

-- ============================================================
-- TABLE: competitor_pages
-- Individual scraped pages from competitor sites
-- ============================================================
CREATE TABLE IF NOT EXISTS competitor_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES competitor_sites(id) ON DELETE CASCADE,
  
  -- Page info
  url TEXT NOT NULL,
  page_type TEXT, -- 'homepage', 'services', 'faq', 'about', 'pricing', 'contact', 'other'
  title TEXT,
  
  -- Content
  content TEXT, -- Main text content
  word_count INT DEFAULT 0,
  
  -- Extraction status
  faqs_extracted BOOLEAN DEFAULT FALSE,
  faq_count INT DEFAULT 0,
  
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id, url)
);

CREATE INDEX IF NOT EXISTS idx_competitor_pages_site ON competitor_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_competitor_pages_type ON competitor_pages(page_type);
CREATE INDEX IF NOT EXISTS idx_competitor_pages_workspace ON competitor_pages(workspace_id);

-- ============================================================
-- TABLE: competitor_faqs_raw
-- Extracted FAQs before refinement
-- ============================================================
CREATE TABLE IF NOT EXISTS competitor_faqs_raw (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id UUID REFERENCES competitor_research_jobs(id) ON DELETE SET NULL,
  site_id UUID REFERENCES competitor_sites(id) ON DELETE SET NULL,
  page_id UUID REFERENCES competitor_pages(id) ON DELETE SET NULL,
  
  -- FAQ content
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  
  -- Source tracking
  source_url TEXT,
  source_business TEXT,
  
  -- Processing status
  is_duplicate BOOLEAN DEFAULT FALSE,
  duplicate_of UUID REFERENCES competitor_faqs_raw(id),
  similarity_score FLOAT,
  
  is_refined BOOLEAN DEFAULT FALSE,
  refined_faq_id UUID,
  
  -- Embedding for dedup
  embedding vector(1536),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_faqs_workspace ON competitor_faqs_raw(workspace_id);
CREATE INDEX IF NOT EXISTS idx_raw_faqs_job ON competitor_faqs_raw(job_id);
CREATE INDEX IF NOT EXISTS idx_raw_faqs_duplicate ON competitor_faqs_raw(is_duplicate) WHERE is_duplicate = FALSE;
CREATE INDEX IF NOT EXISTS idx_raw_faqs_refined ON competitor_faqs_raw(is_refined) WHERE is_refined = FALSE;
CREATE INDEX IF NOT EXISTS idx_raw_faqs_embedding ON competitor_faqs_raw(embedding) WHERE embedding IS NOT NULL;

-- ============================================================
-- TABLE: business_profile (if not exists)
-- Business details used for FAQ refinement
-- ============================================================
CREATE TABLE IF NOT EXISTS business_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  
  -- Basic info
  business_name TEXT NOT NULL,
  industry TEXT,
  tagline TEXT,
  
  -- Services
  services JSONB DEFAULT '[]',
  service_area TEXT,
  service_radius_miles INT,
  
  -- Pricing
  price_summary TEXT,
  pricing_model TEXT,
  
  -- Contact
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  
  -- Brand voice
  tone TEXT,
  tone_description TEXT,
  
  -- Unique selling points
  usps JSONB DEFAULT '[]',
  
  -- Policies
  cancellation_policy TEXT,
  guarantee TEXT,
  payment_methods TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(workspace_id)
);

-- ============================================================
-- ALTER competitor_research_jobs to add new columns
-- ============================================================
ALTER TABLE competitor_research_jobs 
  ADD COLUMN IF NOT EXISTS industry TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS radius_miles INT DEFAULT 20,
  ADD COLUMN IF NOT EXISTS search_queries JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS sites_validated INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pages_scraped INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS faqs_extracted INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS faqs_after_dedup INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS faqs_refined INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS faqs_embedded INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkpoint JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0;

-- ============================================================
-- ALTER competitor_sites to add new columns
-- ============================================================
ALTER TABLE competitor_sites 
  ADD COLUMN IF NOT EXISTS business_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS postcode TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS rating FLOAT,
  ADD COLUMN IF NOT EXISTS review_count INT,
  ADD COLUMN IF NOT EXISTS place_id TEXT,
  ADD COLUMN IF NOT EXISTS latitude FLOAT,
  ADD COLUMN IF NOT EXISTS longitude FLOAT,
  ADD COLUMN IF NOT EXISTS distance_miles FLOAT,
  ADD COLUMN IF NOT EXISTS discovery_source TEXT DEFAULT 'google_places',
  ADD COLUMN IF NOT EXISTS discovery_query TEXT,
  ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_valid BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS validation_reason TEXT,
  ADD COLUMN IF NOT EXISTS domain_type TEXT,
  ADD COLUMN IF NOT EXISTS scrape_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS scrape_error TEXT,
  ADD COLUMN IF NOT EXISTS total_words INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS has_faq_page BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS has_pricing_page BOOLEAN DEFAULT FALSE;

-- ============================================================
-- ALTER faq_database to add new columns if needed
-- ============================================================
ALTER TABLE faq_database 
  ADD COLUMN IF NOT EXISTS priority INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS relevance_score FLOAT,
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS source_business TEXT,
  ADD COLUMN IF NOT EXISTS original_faq_id UUID,
  ADD COLUMN IF NOT EXISTS refined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_own_content BOOLEAN DEFAULT FALSE;

-- Create index for priority-based search
CREATE INDEX IF NOT EXISTS idx_faq_database_priority ON faq_database(workspace_id, priority DESC);

-- ============================================================
-- FUNCTION: Search FAQs with priority (priority 10 first!)
-- ============================================================
CREATE OR REPLACE FUNCTION search_faqs_with_priority(
  p_workspace_id UUID,
  p_embedding vector(1536),
  p_match_threshold FLOAT DEFAULT 0.7,
  p_match_count INT DEFAULT 5
)
RETURNS TABLE(
  id UUID,
  question TEXT,
  answer TEXT,
  category TEXT,
  priority INT,
  similarity FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT 
    f.id,
    f.question,
    f.answer,
    f.category,
    COALESCE(f.priority, 5) as priority,
    1 - (f.embedding <=> p_embedding) as similarity
  FROM faq_database f
  WHERE f.workspace_id = p_workspace_id
    AND f.is_active = TRUE
    AND f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> p_embedding) > p_match_threshold
  ORDER BY 
    COALESCE(f.priority, 5) DESC,
    similarity DESC
  LIMIT p_match_count;
$$;

-- ============================================================
-- FUNCTION: Find duplicate FAQs using embedding similarity
-- ============================================================
CREATE OR REPLACE FUNCTION find_duplicate_faqs(
  p_workspace_id UUID,
  p_job_id UUID,
  p_similarity_threshold FLOAT DEFAULT 0.95
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
  v_duplicates_found INT := 0;
  v_faq RECORD;
  v_match RECORD;
BEGIN
  FOR v_faq IN 
    SELECT id, embedding, created_at
    FROM competitor_faqs_raw 
    WHERE workspace_id = p_workspace_id 
      AND job_id = p_job_id
      AND is_duplicate = FALSE
      AND embedding IS NOT NULL
    ORDER BY created_at ASC
  LOOP
    SELECT id, 1 - (embedding <=> v_faq.embedding) as similarity
    INTO v_match
    FROM competitor_faqs_raw
    WHERE workspace_id = p_workspace_id
      AND job_id = p_job_id
      AND id != v_faq.id
      AND created_at < v_faq.created_at
      AND is_duplicate = FALSE
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> v_faq.embedding) > p_similarity_threshold
    ORDER BY similarity DESC
    LIMIT 1;
    
    IF v_match.id IS NOT NULL THEN
      UPDATE competitor_faqs_raw SET
        is_duplicate = TRUE,
        duplicate_of = v_match.id,
        similarity_score = v_match.similarity
      WHERE id = v_faq.id;
      
      v_duplicates_found := v_duplicates_found + 1;
    END IF;
  END LOOP;
  
  RETURN v_duplicates_found;
END;
$$;

-- ============================================================
-- FUNCTION: Get research job stats
-- ============================================================
CREATE OR REPLACE FUNCTION get_research_job_stats(p_job_id UUID)
RETURNS TABLE(
  status TEXT,
  sites_discovered INT,
  sites_validated INT,
  sites_scraped INT,
  pages_scraped INT,
  faqs_extracted INT,
  faqs_unique INT,
  faqs_refined INT,
  progress_percent INT
)
LANGUAGE SQL
AS $$
  SELECT 
    j.status,
    COALESCE(j.sites_discovered, 0),
    COALESCE(j.sites_validated, 0),
    COALESCE(j.sites_scraped, 0),
    COALESCE(j.pages_scraped, 0),
    COALESCE(j.faqs_extracted, 0),
    COALESCE(j.faqs_after_dedup, 0),
    COALESCE(j.faqs_refined, 0),
    CASE 
      WHEN j.status = 'completed' THEN 100
      WHEN j.status = 'discovering' THEN 10
      WHEN j.status = 'validating' THEN 20
      WHEN j.status = 'scraping' THEN 30 + LEAST(20, COALESCE(j.sites_scraped, 0))
      WHEN j.status = 'extracting' THEN 50 + LEAST(15, COALESCE(j.faqs_extracted, 0) / 50)
      WHEN j.status = 'deduplicating' THEN 70
      WHEN j.status = 'refining' THEN 75 + LEAST(15, COALESCE(j.faqs_refined, 0) / 20)
      WHEN j.status = 'embedding' THEN 95
      ELSE 0
    END as progress_percent
  FROM competitor_research_jobs j
  WHERE j.id = p_job_id;
$$;

-- Enable RLS on new tables
ALTER TABLE competitor_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_faqs_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_profile ENABLE ROW LEVEL SECURITY;

-- RLS policies for competitor_pages
CREATE POLICY "Users can view pages in their workspace" ON competitor_pages
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert pages in their workspace" ON competitor_pages
  FOR INSERT WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update pages in their workspace" ON competitor_pages
  FOR UPDATE USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role full access to competitor_pages" ON competitor_pages
  FOR ALL USING (auth.role() = 'service_role');

-- RLS policies for competitor_faqs_raw
CREATE POLICY "Users can view raw faqs in their workspace" ON competitor_faqs_raw
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert raw faqs in their workspace" ON competitor_faqs_raw
  FOR INSERT WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update raw faqs in their workspace" ON competitor_faqs_raw
  FOR UPDATE USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role full access to competitor_faqs_raw" ON competitor_faqs_raw
  FOR ALL USING (auth.role() = 'service_role');

-- RLS policies for business_profile
CREATE POLICY "Users can view business profile in their workspace" ON business_profile
  FOR SELECT USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can manage business profile in their workspace" ON business_profile
  FOR ALL USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role full access to business_profile" ON business_profile
  FOR ALL USING (auth.role() = 'service_role');