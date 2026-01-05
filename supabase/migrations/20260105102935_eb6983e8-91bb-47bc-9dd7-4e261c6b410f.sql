-- Reset stuck processing emails back to pending
UPDATE raw_emails 
SET status = 'pending', processing_started_at = NULL 
WHERE status = 'processing';

-- Add processing_started_at column if it doesn't exist (for timeout recovery)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'raw_emails' AND column_name = 'processing_started_at'
  ) THEN
    ALTER TABLE raw_emails ADD COLUMN processing_started_at timestamptz;
  END IF;
END $$;