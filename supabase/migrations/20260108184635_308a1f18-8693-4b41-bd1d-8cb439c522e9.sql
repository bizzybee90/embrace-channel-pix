-- =============================================================================
-- Workflow 3: Email Classify - Complete Database Requirements
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Add missing columns
-- -----------------------------------------------------------------------------

-- conversations: add source_id for thread grouping
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS source_id TEXT;

-- messages: add external_id for deduplication  
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS external_id TEXT;

-- raw_emails: add processed flag for workflow
ALTER TABLE raw_emails 
ADD COLUMN IF NOT EXISTS processed BOOLEAN DEFAULT FALSE;

-- -----------------------------------------------------------------------------
-- 2. Backfill data
-- -----------------------------------------------------------------------------

-- Copy existing external_conversation_id to source_id
UPDATE conversations 
SET source_id = external_conversation_id 
WHERE source_id IS NULL AND external_conversation_id IS NOT NULL;

-- Mark emails with completed status as processed
UPDATE raw_emails 
SET processed = TRUE 
WHERE status IN ('completed', 'classified', 'processed') AND processed = FALSE;

-- -----------------------------------------------------------------------------
-- 3. Unique constraints for upsert operations
-- -----------------------------------------------------------------------------

-- Customers: upsert by workspace + email
ALTER TABLE customers 
ADD CONSTRAINT customers_workspace_email_unique 
UNIQUE (workspace_id, email);

-- Conversations: upsert by workspace + thread
ALTER TABLE conversations 
ADD CONSTRAINT conversations_workspace_source_unique 
UNIQUE (workspace_id, source_id);

-- Messages: prevent duplicate imports
ALTER TABLE messages 
ADD CONSTRAINT messages_external_id_unique 
UNIQUE (external_id);

-- -----------------------------------------------------------------------------
-- 4. Performance indexes
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_raw_emails_unprocessed 
ON raw_emails (workspace_id, processed, received_at)
WHERE processed = false;

CREATE INDEX IF NOT EXISTS idx_customers_workspace_email 
ON customers (workspace_id, email);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_source 
ON conversations (workspace_id, source_id);