-- =========================================
-- HYBRID DISCOVERY: Add quality scoring and enhanced metadata
-- =========================================

-- Add new columns for quality scoring and hybrid discovery
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS quality_score INTEGER DEFAULT 0;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS priority_tier TEXT DEFAULT 'medium';
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS is_places_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS google_place_id TEXT;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS serp_position INTEGER;
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS search_query_used TEXT;

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_competitor_sites_quality 
  ON competitor_sites(job_id, quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_sites_priority 
  ON competitor_sites(job_id, priority_tier);
CREATE INDEX IF NOT EXISTS idx_competitor_sites_places_verified
  ON competitor_sites(job_id, is_places_verified);

-- Create Market Intelligence View
CREATE OR REPLACE VIEW competitor_market_intelligence AS
SELECT 
  job_id,
  COUNT(*) as total_competitors,
  COUNT(*) FILTER (WHERE is_places_verified = TRUE) as verified_count,
  COUNT(*) FILTER (WHERE discovery_source = 'google_places') as from_places,
  COUNT(*) FILTER (WHERE discovery_source = 'google_serp') as from_serp,
  ROUND(AVG(distance_miles) FILTER (WHERE distance_miles IS NOT NULL)::numeric, 2) as avg_distance,
  ROUND(AVG(rating) FILTER (WHERE rating IS NOT NULL)::numeric, 2) as avg_rating,
  ROUND(AVG(reviews_count) FILTER (WHERE reviews_count IS NOT NULL)::numeric, 0) as avg_reviews,
  COUNT(*) FILTER (WHERE priority_tier = 'high') as high_priority,
  COUNT(*) FILTER (WHERE priority_tier = 'medium') as medium_priority,
  COUNT(*) FILTER (WHERE priority_tier = 'low') as low_priority,
  ROUND(AVG(quality_score)::numeric, 1) as avg_quality_score
FROM competitor_sites
WHERE is_selected = TRUE
GROUP BY job_id;