-- Fix overly permissive RLS policies for email_import_progress and response_playbook
-- Drop ALL existing policies first, then recreate with proper workspace-scoping

-- 1. Drop all policies on email_import_progress
DROP POLICY IF EXISTS "Service role can manage import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can view workspace import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can update workspace import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can insert workspace import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Service role full access to import progress" ON email_import_progress;

-- 2. Drop all policies on response_playbook
DROP POLICY IF EXISTS "Anyone can read playbooks" ON response_playbook;
DROP POLICY IF EXISTS "Service role can manage playbooks" ON response_playbook;
DROP POLICY IF EXISTS "Users can view workspace playbook" ON response_playbook;
DROP POLICY IF EXISTS "Users can update workspace playbook" ON response_playbook;
DROP POLICY IF EXISTS "Users can insert workspace playbook" ON response_playbook;
DROP POLICY IF EXISTS "Service role full access to playbook" ON response_playbook;

-- 3. Create workspace-scoped policies for email_import_progress
CREATE POLICY "Users can view workspace import progress"
  ON email_import_progress FOR SELECT
  TO authenticated
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace import progress"
  ON email_import_progress FOR UPDATE
  TO authenticated
  USING (workspace_id = get_my_workspace_id())
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace import progress"
  ON email_import_progress FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Service role full access to import progress"
  ON email_import_progress FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Create workspace-scoped policies for response_playbook
CREATE POLICY "Users can view workspace playbook"
  ON response_playbook FOR SELECT
  TO authenticated
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace playbook"
  ON response_playbook FOR UPDATE
  TO authenticated
  USING (workspace_id = get_my_workspace_id())
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace playbook"
  ON response_playbook FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Service role full access to playbook"
  ON response_playbook FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);