-- Fix overly permissive RLS policies by adding proper workspace scoping
-- Tables affected: system_logs, api_usage, email_import_progress, conversation_analytics, response_playbook, sender_behaviour_stats

-- ============================================
-- 1. FIX system_logs RLS policies
-- ============================================
DROP POLICY IF EXISTS "Users can view their workspace logs" ON public.system_logs;
DROP POLICY IF EXISTS "Authenticated users can read logs" ON public.system_logs;
DROP POLICY IF EXISTS "System logs are viewable by workspace members" ON public.system_logs;

CREATE POLICY "Users can view their workspace logs"
ON public.system_logs FOR SELECT
TO authenticated
USING (workspace_id = public.get_my_workspace_id());

-- Service role override for background processing
CREATE POLICY "Service role has full access to system_logs"
ON public.system_logs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- 2. FIX api_usage RLS policies
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can read api_usage" ON public.api_usage;
DROP POLICY IF EXISTS "Users can view API usage" ON public.api_usage;
DROP POLICY IF EXISTS "API usage is viewable by workspace members" ON public.api_usage;

CREATE POLICY "Users can view their workspace API usage"
ON public.api_usage FOR SELECT
TO authenticated
USING (workspace_id = public.get_my_workspace_id());

-- Service role override for background processing
CREATE POLICY "Service role has full access to api_usage"
ON public.api_usage FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- 3. FIX email_import_progress RLS policies
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can read email_import_progress" ON public.email_import_progress;
DROP POLICY IF EXISTS "Users can view email import progress" ON public.email_import_progress;
DROP POLICY IF EXISTS "Email import progress is viewable by workspace members" ON public.email_import_progress;
DROP POLICY IF EXISTS "email_import_progress_select_policy" ON public.email_import_progress;
DROP POLICY IF EXISTS "email_import_progress_service_role_policy" ON public.email_import_progress;

CREATE POLICY "Users can view their workspace email import progress"
ON public.email_import_progress FOR SELECT
TO authenticated
USING (workspace_id = public.get_my_workspace_id());

-- Service role override for background processing
CREATE POLICY "Service role has full access to email_import_progress"
ON public.email_import_progress FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- 4. FIX conversation_analytics RLS policies
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can read conversation_analytics" ON public.conversation_analytics;
DROP POLICY IF EXISTS "Users can view conversation analytics" ON public.conversation_analytics;
DROP POLICY IF EXISTS "Conversation analytics is viewable by workspace members" ON public.conversation_analytics;

CREATE POLICY "Users can view their workspace conversation analytics"
ON public.conversation_analytics FOR SELECT
TO authenticated
USING (workspace_id = public.get_my_workspace_id());

-- Service role override for background processing
CREATE POLICY "Service role has full access to conversation_analytics"
ON public.conversation_analytics FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- 5. FIX response_playbook RLS policies
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can read response_playbook" ON public.response_playbook;
DROP POLICY IF EXISTS "Users can view response playbook" ON public.response_playbook;
DROP POLICY IF EXISTS "Response playbook is viewable by workspace members" ON public.response_playbook;
DROP POLICY IF EXISTS "response_playbook_select_policy" ON public.response_playbook;
DROP POLICY IF EXISTS "response_playbook_service_role_policy" ON public.response_playbook;

CREATE POLICY "Users can view their workspace response playbook"
ON public.response_playbook FOR SELECT
TO authenticated
USING (workspace_id = public.get_my_workspace_id());

-- Service role override for background processing
CREATE POLICY "Service role has full access to response_playbook"
ON public.response_playbook FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ============================================
-- 6. FIX sender_behaviour_stats RLS policies
-- ============================================
DROP POLICY IF EXISTS "Authenticated users can manage sender_behaviour_stats" ON public.sender_behaviour_stats;
DROP POLICY IF EXISTS "Users can manage sender behaviour stats" ON public.sender_behaviour_stats;
DROP POLICY IF EXISTS "Sender behaviour stats is viewable by workspace members" ON public.sender_behaviour_stats;
DROP POLICY IF EXISTS "Users can view sender behaviour stats" ON public.sender_behaviour_stats;
DROP POLICY IF EXISTS "sender_behaviour_stats_all_policy" ON public.sender_behaviour_stats;

-- Separate policies for each operation with workspace scoping
CREATE POLICY "Users can view their workspace sender stats"
ON public.sender_behaviour_stats FOR SELECT
TO authenticated
USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "Users can insert their workspace sender stats"
ON public.sender_behaviour_stats FOR INSERT
TO authenticated
WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "Users can update their workspace sender stats"
ON public.sender_behaviour_stats FOR UPDATE
TO authenticated
USING (workspace_id = public.get_my_workspace_id())
WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "Users can delete their workspace sender stats"
ON public.sender_behaviour_stats FOR DELETE
TO authenticated
USING (workspace_id = public.get_my_workspace_id());

-- Service role override for background processing (like compute-sender-stats edge function)
CREATE POLICY "Service role has full access to sender_behaviour_stats"
ON public.sender_behaviour_stats FOR ALL
TO service_role
USING (true)
WITH CHECK (true);