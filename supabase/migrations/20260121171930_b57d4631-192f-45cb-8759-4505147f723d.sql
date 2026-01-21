-- Fix remaining overly permissive RLS policies (without knowledge_documents)

-- Fix email_import_progress
DROP POLICY IF EXISTS "Users can view import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can update import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can insert import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can view workspace import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can update workspace import progress" ON email_import_progress;
DROP POLICY IF EXISTS "Users can insert workspace import progress" ON email_import_progress;

CREATE POLICY "Users can view workspace import progress"
  ON email_import_progress FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace import progress"
  ON email_import_progress FOR UPDATE
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace import progress"
  ON email_import_progress FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

-- Fix response_playbook
DROP POLICY IF EXISTS "Users can view playbook" ON response_playbook;
DROP POLICY IF EXISTS "Users can manage playbook" ON response_playbook;
DROP POLICY IF EXISTS "Users can view workspace playbook" ON response_playbook;
DROP POLICY IF EXISTS "Users can insert workspace playbook" ON response_playbook;
DROP POLICY IF EXISTS "Users can update workspace playbook" ON response_playbook;
DROP POLICY IF EXISTS "Users can delete workspace playbook" ON response_playbook;

CREATE POLICY "Users can view workspace playbook"
  ON response_playbook FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace playbook"
  ON response_playbook FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace playbook"
  ON response_playbook FOR UPDATE
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can delete workspace playbook"
  ON response_playbook FOR DELETE
  USING (workspace_id = get_my_workspace_id());

-- Fix competitor_research_jobs
DROP POLICY IF EXISTS "Users can view competitor research jobs" ON competitor_research_jobs;
DROP POLICY IF EXISTS "Users can insert competitor research jobs" ON competitor_research_jobs;
DROP POLICY IF EXISTS "Users can update competitor research jobs" ON competitor_research_jobs;
DROP POLICY IF EXISTS "Users can view workspace competitor research jobs" ON competitor_research_jobs;
DROP POLICY IF EXISTS "Users can insert workspace competitor research jobs" ON competitor_research_jobs;
DROP POLICY IF EXISTS "Users can update workspace competitor research jobs" ON competitor_research_jobs;

CREATE POLICY "Users can view workspace competitor research jobs"
  ON competitor_research_jobs FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace competitor research jobs"
  ON competitor_research_jobs FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace competitor research jobs"
  ON competitor_research_jobs FOR UPDATE
  USING (workspace_id = get_my_workspace_id());

-- Fix competitor_sites
DROP POLICY IF EXISTS "Users can view competitor sites" ON competitor_sites;
DROP POLICY IF EXISTS "Users can insert competitor sites" ON competitor_sites;
DROP POLICY IF EXISTS "Users can update competitor sites" ON competitor_sites;
DROP POLICY IF EXISTS "Users can view workspace competitor sites" ON competitor_sites;
DROP POLICY IF EXISTS "Users can insert workspace competitor sites" ON competitor_sites;
DROP POLICY IF EXISTS "Users can update workspace competitor sites" ON competitor_sites;

CREATE POLICY "Users can view workspace competitor sites"
  ON competitor_sites FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace competitor sites"
  ON competitor_sites FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace competitor sites"
  ON competitor_sites FOR UPDATE
  USING (workspace_id = get_my_workspace_id());

-- Fix competitor_pages
DROP POLICY IF EXISTS "Users can view competitor pages" ON competitor_pages;
DROP POLICY IF EXISTS "Users can insert competitor pages" ON competitor_pages;
DROP POLICY IF EXISTS "Users can update competitor pages" ON competitor_pages;
DROP POLICY IF EXISTS "Users can view workspace competitor pages" ON competitor_pages;
DROP POLICY IF EXISTS "Users can insert workspace competitor pages" ON competitor_pages;
DROP POLICY IF EXISTS "Users can update workspace competitor pages" ON competitor_pages;

CREATE POLICY "Users can view workspace competitor pages"
  ON competitor_pages FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace competitor pages"
  ON competitor_pages FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace competitor pages"
  ON competitor_pages FOR UPDATE
  USING (workspace_id = get_my_workspace_id());

-- Fix competitor_faqs_raw
DROP POLICY IF EXISTS "Users can view competitor faqs" ON competitor_faqs_raw;
DROP POLICY IF EXISTS "Users can insert competitor faqs" ON competitor_faqs_raw;
DROP POLICY IF EXISTS "Users can update competitor faqs" ON competitor_faqs_raw;
DROP POLICY IF EXISTS "Users can view workspace competitor faqs" ON competitor_faqs_raw;
DROP POLICY IF EXISTS "Users can insert workspace competitor faqs" ON competitor_faqs_raw;
DROP POLICY IF EXISTS "Users can update workspace competitor faqs" ON competitor_faqs_raw;

CREATE POLICY "Users can view workspace competitor faqs"
  ON competitor_faqs_raw FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can insert workspace competitor faqs"
  ON competitor_faqs_raw FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace competitor faqs"
  ON competitor_faqs_raw FOR UPDATE
  USING (workspace_id = get_my_workspace_id());