-- Update competitor_research_jobs table with new columns
ALTER TABLE competitor_research_jobs 
ADD COLUMN IF NOT EXISTS discovery_run_id TEXT,
ADD COLUMN IF NOT EXISTS scrape_run_id TEXT,
ADD COLUMN IF NOT EXISTS extraction_run_id TEXT,
ADD COLUMN IF NOT EXISTS geocoded_lat FLOAT,
ADD COLUMN IF NOT EXISTS geocoded_lng FLOAT,
ADD COLUMN IF NOT EXISTS radius_km FLOAT,
ADD COLUMN IF NOT EXISTS sites_filtered INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_competitors INT DEFAULT 50;

-- Update competitor_sites table with new columns
ALTER TABLE competitor_sites
ADD COLUMN IF NOT EXISTS reviews_count INT,
ADD COLUMN IF NOT EXISTS filter_reason TEXT,
ADD COLUMN IF NOT EXISTS distance_km FLOAT;

-- Create directory blocklist table
CREATE TABLE IF NOT EXISTS directory_blocklist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE directory_blocklist ENABLE ROW LEVEL SECURITY;

-- Policy for reading (anyone can read)
CREATE POLICY "Anyone can read directory blocklist"
ON directory_blocklist FOR SELECT
USING (true);

-- Seed with known directories and aggregators
INSERT INTO directory_blocklist (domain, reason) VALUES
('yell.com', 'directory'),
('checkatrade.com', 'directory'),
('trustatrader.com', 'directory'),
('bark.com', 'aggregator'),
('mybuilder.com', 'aggregator'),
('ratedpeople.com', 'aggregator'),
('thomsonlocal.com', 'directory'),
('cylex-uk.co.uk', 'directory'),
('yelp.co.uk', 'directory'),
('facebook.com', 'social'),
('gumtree.com', 'classifieds'),
('bizify.co.uk', 'directory'),
('freeindex.co.uk', 'directory'),
('scoot.co.uk', 'directory'),
('192.com', 'directory'),
('nextdoor.co.uk', 'social'),
('hotfrog.co.uk', 'directory'),
('brownbook.net', 'directory'),
('misterwhat.co.uk', 'directory'),
('uksmallbusinessdirectory.co.uk', 'directory'),
('thebestof.co.uk', 'directory'),
('touchlocal.com', 'directory'),
('accessplace.com', 'directory'),
('fyple.co.uk', 'directory')
ON CONFLICT (domain) DO NOTHING;