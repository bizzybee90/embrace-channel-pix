-- Create website scrape progress tracking table
CREATE TABLE IF NOT EXISTS website_scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  website_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, mapping, scraping, extracting, completed, failed
  
  -- Progress tracking
  pages_found INT DEFAULT 0,
  pages_scraped INT DEFAULT 0,
  pages_extracted INT DEFAULT 0,
  faqs_extracted INT DEFAULT 0,
  ground_truth_facts INT DEFAULT 0,
  
  -- Page details
  priority_pages TEXT[] DEFAULT '{}',
  scraped_pages JSONB DEFAULT '[]',
  
  -- Business data extracted
  business_info JSONB,
  voice_profile JSONB,
  search_keywords TEXT[] DEFAULT '{}',
  
  -- Error handling
  error_message TEXT,
  retry_count INT DEFAULT 0,
  
  -- Timing
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Apify/Firecrawl job IDs
  map_job_id TEXT,
  scrape_job_id TEXT,
  
  UNIQUE(workspace_id, website_url)
);

-- Enable RLS
ALTER TABLE website_scrape_jobs ENABLE ROW LEVEL SECURITY;

-- Simple policy for service role access and public read
CREATE POLICY "Anyone can view website scrape jobs"
ON website_scrape_jobs FOR SELECT
USING (true);

-- Index for status polling
CREATE INDEX IF NOT EXISTS website_scrape_jobs_workspace_status_idx 
ON website_scrape_jobs(workspace_id, status);

-- Enable realtime for progress updates
ALTER PUBLICATION supabase_realtime ADD TABLE website_scrape_jobs;