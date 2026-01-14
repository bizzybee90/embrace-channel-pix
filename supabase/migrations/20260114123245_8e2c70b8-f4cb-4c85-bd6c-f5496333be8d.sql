-- Add workspace_id to webhook_logs and fix RLS policies

-- 1. Add workspace_id column (nullable first for existing data)
ALTER TABLE public.webhook_logs ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- 2. Create index for performance
CREATE INDEX IF NOT EXISTS idx_webhook_logs_workspace_id ON public.webhook_logs(workspace_id);

-- 3. Drop existing SELECT policy that allows NULL bypass
DROP POLICY IF EXISTS "Users can view their workspace webhook logs" ON public.webhook_logs;

-- 4. Create new SELECT policy requiring workspace match
CREATE POLICY "Users can view their workspace webhook logs"
  ON public.webhook_logs
  FOR SELECT
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

-- 5. Create INSERT policy for service role only (webhooks insert via service role)
DROP POLICY IF EXISTS "Service role can insert webhook logs" ON public.webhook_logs;
CREATE POLICY "Service role can insert webhook logs"
  ON public.webhook_logs
  FOR INSERT
  TO service_role
  WITH CHECK (workspace_id IS NOT NULL);

-- 6. Create INSERT policy for authenticated users with workspace scope
DROP POLICY IF EXISTS "Authenticated users can insert webhook logs" ON public.webhook_logs;
CREATE POLICY "Authenticated users can insert webhook logs"
  ON public.webhook_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.get_my_workspace_id());