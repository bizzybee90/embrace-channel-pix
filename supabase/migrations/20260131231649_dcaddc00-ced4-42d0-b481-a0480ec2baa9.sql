-- Add match_reason column to competitor_sites for industry relevance tracking
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS match_reason TEXT;