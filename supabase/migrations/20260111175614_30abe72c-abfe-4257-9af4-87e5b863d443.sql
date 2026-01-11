-- Add classification fields to raw_emails for Gemini bulk classification
ALTER TABLE raw_emails 
ADD COLUMN IF NOT EXISTS classification_category text,
ADD COLUMN IF NOT EXISTS classification_confidence numeric,
ADD COLUMN IF NOT EXISTS classification_reasoning text,
ADD COLUMN IF NOT EXISTS requires_reply boolean DEFAULT false;