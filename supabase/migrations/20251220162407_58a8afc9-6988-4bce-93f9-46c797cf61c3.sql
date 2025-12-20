-- Add automation_level column to sender_rules for teaching preferences
ALTER TABLE sender_rules ADD COLUMN IF NOT EXISTS automation_level text DEFAULT 'auto';
-- Values: 'auto' (always auto-handle), 'draft_first' (draft but ask), 'always_review' (always flag)

-- Add tone_preference column for future use
ALTER TABLE sender_rules ADD COLUMN IF NOT EXISTS tone_preference text DEFAULT 'keep_current';
-- Values: 'keep_current', 'more_formal', 'more_brief'

COMMENT ON COLUMN sender_rules.automation_level IS 'How BizzyBee should handle emails from this sender: auto, draft_first, always_review';
COMMENT ON COLUMN sender_rules.tone_preference IS 'Preferred tone for responses: keep_current, more_formal, more_brief';