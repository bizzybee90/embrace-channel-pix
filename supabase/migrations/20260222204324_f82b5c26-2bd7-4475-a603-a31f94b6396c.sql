
-- Task 2: Add training_reviewed column to conversations
ALTER TABLE conversations 
ADD COLUMN IF NOT EXISTS training_reviewed BOOLEAN DEFAULT false;

-- Task 6: Add channel column to conversations if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'conversations' AND column_name = 'channel'
  ) THEN
    ALTER TABLE conversations ADD COLUMN channel TEXT DEFAULT 'email';
  END IF;
END $$;

-- Task 6: Add channel column to messages if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'messages' AND column_name = 'channel'
  ) THEN
    ALTER TABLE messages ADD COLUMN channel TEXT DEFAULT 'email';
  END IF;
END $$;

-- Task 6: Add check constraint for valid channel values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE constraint_name = 'conversations_channel_check'
  ) THEN
    ALTER TABLE conversations 
    ADD CONSTRAINT conversations_channel_check 
    CHECK (channel IN ('email', 'sms', 'whatsapp', 'webchat'));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE constraint_name = 'messages_channel_check'
  ) THEN
    ALTER TABLE messages 
    ADD CONSTRAINT messages_channel_check 
    CHECK (channel IN ('email', 'sms', 'whatsapp', 'webchat'));
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Task 2/3: Add extra columns to classification_corrections
ALTER TABLE classification_corrections 
ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES conversations(id),
ADD COLUMN IF NOT EXISTS sender_email TEXT,
ADD COLUMN IF NOT EXISTS subject TEXT;

-- Task 7d: Nightly queue cleanup function
CREATE OR REPLACE FUNCTION public.bb_purge_archived_queues()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pgmq', 'pg_catalog'
AS $function$
BEGIN
  PERFORM pgmq.purge_queue('bb_ingest');
  PERFORM pgmq.purge_queue('bb_classify');
  PERFORM pgmq.purge_queue('bb_draft');
  RAISE NOTICE 'Queue cleanup completed at %', now();
END;
$function$;

-- Set all existing conversations to training_reviewed = false
UPDATE conversations 
SET training_reviewed = false 
WHERE training_reviewed IS NULL;
