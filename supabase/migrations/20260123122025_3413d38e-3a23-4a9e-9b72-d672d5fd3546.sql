-- Add missing faqs_extracted column to competitor_sites
ALTER TABLE competitor_sites ADD COLUMN IF NOT EXISTS faqs_extracted INTEGER DEFAULT 0;