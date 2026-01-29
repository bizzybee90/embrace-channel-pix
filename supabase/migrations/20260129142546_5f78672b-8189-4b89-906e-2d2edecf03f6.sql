-- Add classification columns to email_import_queue for the simplified bulk classifier
ALTER TABLE email_import_queue
ADD COLUMN IF NOT EXISTS category TEXT,
ADD COLUMN IF NOT EXISTS requires_reply BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ;

-- Add index for querying unclassified emails efficiently
CREATE INDEX IF NOT EXISTS idx_email_import_queue_unclassified 
ON email_import_queue(workspace_id, status) 
WHERE category IS NULL;

-- Add index for classified emails by category
CREATE INDEX IF NOT EXISTS idx_email_import_queue_category 
ON email_import_queue(workspace_id, category) 
WHERE category IS NOT NULL;