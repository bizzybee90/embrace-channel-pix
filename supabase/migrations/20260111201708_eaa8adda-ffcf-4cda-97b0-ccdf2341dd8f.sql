-- Add missing columns to inbox_insights table for pattern detection
-- These columns support the insight-based workflow

ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS insight_type TEXT;
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'info';
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS metrics JSONB DEFAULT '{}';
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ;
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ;
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS is_read BOOLEAN DEFAULT false;
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS is_actionable BOOLEAN DEFAULT false;
ALTER TABLE inbox_insights ADD COLUMN IF NOT EXISTS action_taken BOOLEAN DEFAULT false;

-- Create index for unread insights
CREATE INDEX IF NOT EXISTS idx_inbox_insights_unread 
  ON inbox_insights(workspace_id, is_read) WHERE is_read = false;