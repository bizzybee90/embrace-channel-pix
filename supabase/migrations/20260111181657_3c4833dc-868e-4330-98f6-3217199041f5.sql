-- Add search_keywords to business_profile if not present
ALTER TABLE business_profile
ADD COLUMN IF NOT EXISTS search_keywords text[] DEFAULT '{}';