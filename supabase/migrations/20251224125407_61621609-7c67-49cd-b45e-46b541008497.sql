-- Email Triage System v2.0: Add lanes, flags, evidence, batch_group

-- Add new routing columns to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS lane TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS flags JSONB DEFAULT '{}';
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS evidence JSONB;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS batch_group TEXT;

-- Add workspace context columns for dynamic business context injection
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS business_type TEXT;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS core_services TEXT[];
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS vip_domains TEXT[];
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS hiring_mode BOOLEAN DEFAULT false;

-- Add sender_rules columns for deterministic routing
ALTER TABLE sender_rules ADD COLUMN IF NOT EXISTS default_lane TEXT;
ALTER TABLE sender_rules ADD COLUMN IF NOT EXISTS skip_llm BOOLEAN DEFAULT false;

-- Backfill lane from decision_bucket for existing conversations
UPDATE conversations SET 
  lane = CASE 
    WHEN decision_bucket = 'act_now' THEN 'to_reply'
    WHEN decision_bucket = 'quick_win' THEN 'to_reply'
    WHEN decision_bucket = 'auto_handled' THEN 'done'
    WHEN decision_bucket = 'wait' THEN 'review'
    ELSE 'review'
  END,
  flags = jsonb_build_object(
    'urgent', decision_bucket = 'act_now',
    'reply_required', COALESCE(requires_reply, false),
    'financial', email_classification IN ('supplier_invoice', 'receipt_confirmation', 'payment_confirmation')
  )
WHERE lane IS NULL;