
-- ============================================================
-- Fix 1: directory_blocklist - restrict to authenticated only
-- No workspace_id column (global list), so restrict to authenticated
-- ============================================================
DROP POLICY IF EXISTS "Anyone can read directory blocklist" ON public.directory_blocklist;

CREATE POLICY "authenticated_read_directory_blocklist"
  ON public.directory_blocklist FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_directory_blocklist"
  ON public.directory_blocklist FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- Fix 2: known_senders - replace {public} with authenticated
-- ============================================================
DROP POLICY IF EXISTS "Anyone can view global senders" ON public.known_senders;
DROP POLICY IF EXISTS "Service role full access to known_senders" ON public.known_senders;
DROP POLICY IF EXISTS "Users can manage workspace senders" ON public.known_senders;

CREATE POLICY "authenticated_view_known_senders"
  ON public.known_senders FOR SELECT
  TO authenticated
  USING (is_global = true OR workspace_id = public.get_my_workspace_id());

CREATE POLICY "authenticated_manage_workspace_senders"
  ON public.known_senders FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_known_senders"
  ON public.known_senders FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);
