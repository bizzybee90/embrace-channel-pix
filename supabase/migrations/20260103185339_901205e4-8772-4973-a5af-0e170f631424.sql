-- Add folder tracking columns to email_import_progress
ALTER TABLE email_import_progress
ADD COLUMN IF NOT EXISTS current_import_folder TEXT DEFAULT 'SENT',
ADD COLUMN IF NOT EXISTS sent_next_page_token TEXT,
ADD COLUMN IF NOT EXISTS inbox_next_page_token TEXT,
ADD COLUMN IF NOT EXISTS sent_import_complete BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS inbox_import_complete BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sent_email_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS inbox_email_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS estimated_total_emails INTEGER,
ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;