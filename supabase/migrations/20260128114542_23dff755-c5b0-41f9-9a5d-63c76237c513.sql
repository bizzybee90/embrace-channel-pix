-- ===========================================
-- SCRAPING JOBS TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS scraping_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL DEFAULT 'own_website',
  website_url TEXT,
  status TEXT DEFAULT 'pending',
  apify_run_id TEXT,
  apify_dataset_id TEXT,
  total_pages_found INT DEFAULT 0,
  pages_processed INT DEFAULT 0,
  faqs_found INT DEFAULT 0,
  faqs_stored INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scraping_jobs_workspace_idx ON scraping_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS scraping_jobs_status_idx ON scraping_jobs(status);

-- ===========================================
-- SCRAPED PAGES TABLE
-- ===========================================
CREATE TABLE IF NOT EXISTS scraped_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES scraping_jobs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  page_type TEXT,
  content_markdown TEXT,
  content_length INT,
  status TEXT DEFAULT 'pending',
  faqs_extracted INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scraped_pages_job_idx ON scraped_pages(job_id);
CREATE INDEX IF NOT EXISTS scraped_pages_status_idx ON scraped_pages(status);

-- ===========================================
-- UPDATE FAQ_DATABASE TABLE
-- ===========================================
ALTER TABLE faq_database
ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'implied',
ADD COLUMN IF NOT EXISTS quality_score INT DEFAULT 60,
ADD COLUMN IF NOT EXISTS source_page_url TEXT,
ADD COLUMN IF NOT EXISTS confidence INT DEFAULT 80;

-- ===========================================
-- INCREMENT PROGRESS FUNCTION
-- ===========================================
CREATE OR REPLACE FUNCTION increment_scraping_progress(
  p_job_id UUID,
  p_pages_processed INT DEFAULT 1,
  p_faqs_found INT DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE scraping_jobs
  SET 
    pages_processed = pages_processed + p_pages_processed,
    faqs_found = faqs_found + p_faqs_found
  WHERE id = p_job_id;
END;
$$;

-- ===========================================
-- ENABLE REALTIME FOR SCRAPING_JOBS
-- ===========================================
ALTER PUBLICATION supabase_realtime ADD TABLE scraping_jobs;

-- ===========================================
-- RLS POLICIES FOR SCRAPING_JOBS
-- ===========================================
ALTER TABLE scraping_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace scraping jobs"
ON scraping_jobs FOR SELECT
USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert scraping jobs for their workspace"
ON scraping_jobs FOR INSERT
WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace scraping jobs"
ON scraping_jobs FOR UPDATE
USING (user_has_workspace_access(workspace_id));

-- ===========================================
-- RLS POLICIES FOR SCRAPED_PAGES
-- ===========================================
ALTER TABLE scraped_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace scraped pages"
ON scraped_pages FOR SELECT
USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert scraped pages for their workspace"
ON scraped_pages FOR INSERT
WITH CHECK (user_has_workspace_access(workspace_id));