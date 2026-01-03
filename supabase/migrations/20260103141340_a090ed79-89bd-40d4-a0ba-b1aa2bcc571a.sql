-- Add workspace-scoped RLS policy for raw_emails table
-- This ensures authenticated users can only view emails from their own workspace

CREATE POLICY "Users can view workspace raw emails"
ON raw_emails FOR SELECT
TO authenticated
USING (workspace_id = get_my_workspace_id());