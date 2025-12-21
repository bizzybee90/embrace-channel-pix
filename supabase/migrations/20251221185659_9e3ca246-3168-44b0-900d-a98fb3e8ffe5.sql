-- First, clean up duplicate sender_rules by keeping only the oldest one per workspace_id + sender_pattern
DELETE FROM sender_rules
WHERE id NOT IN (
  SELECT DISTINCT ON (workspace_id, sender_pattern) id
  FROM sender_rules
  ORDER BY workspace_id, sender_pattern, created_at ASC
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE sender_rules
ADD CONSTRAINT sender_rules_workspace_pattern_unique 
UNIQUE (workspace_id, sender_pattern);