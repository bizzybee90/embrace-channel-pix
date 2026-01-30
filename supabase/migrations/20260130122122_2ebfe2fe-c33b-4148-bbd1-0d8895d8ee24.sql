-- Add columns to competitor_sites for review workflow
ALTER TABLE competitor_sites
ADD COLUMN IF NOT EXISTS is_selected BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS location_data JSONB;

-- Add index for efficient review queries
CREATE INDEX IF NOT EXISTS idx_competitor_sites_job_selected 
  ON competitor_sites(job_id, is_selected) WHERE is_selected = true;

-- Add review_ready status to competitor_research_jobs if not already in constraint
-- First drop the old constraint if it exists
ALTER TABLE competitor_research_jobs DROP CONSTRAINT IF EXISTS competitor_research_jobs_status_check;

-- Add updated constraint with review_ready status
ALTER TABLE competitor_research_jobs 
ADD CONSTRAINT competitor_research_jobs_status_check 
CHECK (status IN ('queued', 'geocoding', 'discovering', 'filtering', 'review_ready', 'sites_ready', 'scraping', 'extracting', 'deduplicating', 'refining', 'embedding', 'generating', 'completed', 'failed', 'cancelled', 'error'));

-- Expand directory blocklist with additional domains
INSERT INTO directory_blocklist (domain, reason) VALUES
  ('trustpilot.com', 'reviews'),
  ('houzz.co.uk', 'directory'),
  ('houzz.com', 'directory'),
  ('which.co.uk', 'directory'),
  ('lapage.co.uk', 'directory'),
  ('en-gb.facebook.com', 'social'),
  ('google.com', 'search'),
  ('gov.uk', 'government'),
  ('nhs.uk', 'government'),
  ('wikipedia.org', 'reference'),
  ('youtube.com', 'video'),
  ('instagram.com', 'social'),
  ('tiktok.com', 'social'),
  ('pinterest.com', 'social'),
  ('amazon.co.uk', 'marketplace'),
  ('amazon.com', 'marketplace'),
  ('ebay.co.uk', 'marketplace'),
  ('ebay.com', 'marketplace'),
  ('nextdoor.com', 'social'),
  ('nextdoor.co.uk', 'social'),
  ('scoot.co.uk', 'directory'),
  ('freeindex.co.uk', 'directory'),
  ('checkatrader.com', 'directory'),
  ('ratedpeople.com', 'directory'),
  ('findatrade.com', 'directory'),
  ('hotfrog.co.uk', 'directory'),
  ('cylex-uk.co.uk', 'directory'),
  ('businessmagnet.co.uk', 'directory'),
  ('bizwiki.co.uk', 'directory'),
  ('brownbook.net', 'directory')
ON CONFLICT (domain) DO NOTHING;

-- Add comments for documentation
COMMENT ON COLUMN competitor_sites.is_selected IS 'User-togglable in review phase. true=will be scraped';
COMMENT ON COLUMN competitor_sites.location_data IS 'Raw Google Maps data: address, phone, rating, openingHours';