-- Add location fields to business_profile for Gemini location resolution
ALTER TABLE business_profile 
ADD COLUMN IF NOT EXISTS place_id text,
ADD COLUMN IF NOT EXISTS county text,
ADD COLUMN IF NOT EXISTS latitude numeric,
ADD COLUMN IF NOT EXISTS longitude numeric,
ADD COLUMN IF NOT EXISTS formatted_address text;