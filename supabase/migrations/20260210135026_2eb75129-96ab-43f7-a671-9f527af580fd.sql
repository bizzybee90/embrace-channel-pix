
-- ============================================================
-- COMPREHENSIVE RLS HARDENING: Replace all {public} role policies
-- with {authenticated} + workspace-scoped policies
-- ============================================================

-- ============================================================
-- 1. business_context - Drop public policies, add authenticated
-- ============================================================
DROP POLICY IF EXISTS "Users can manage workspace business context" ON public.business_context;
DROP POLICY IF EXISTS "Users can view workspace business context" ON public.business_context;

CREATE POLICY "authenticated_workspace_select_business_context"
  ON public.business_context FOR SELECT
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "authenticated_workspace_all_business_context"
  ON public.business_context FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_business_context"
  ON public.business_context FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 2. business_profile - Drop public policies, add authenticated
-- ============================================================
DROP POLICY IF EXISTS "Service role full access to business_profile" ON public.business_profile;
DROP POLICY IF EXISTS "Users can manage business profile in their workspace" ON public.business_profile;
DROP POLICY IF EXISTS "Users can view business profile in their workspace" ON public.business_profile;

CREATE POLICY "authenticated_workspace_select_business_profile"
  ON public.business_profile FOR SELECT
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "authenticated_workspace_all_business_profile"
  ON public.business_profile FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_business_profile"
  ON public.business_profile FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 3. competitor_sites - Drop public policies, add authenticated
-- ============================================================
DROP POLICY IF EXISTS "Users can insert workspace competitor sites" ON public.competitor_sites;
DROP POLICY IF EXISTS "Users can manage their workspace competitor sites" ON public.competitor_sites;
DROP POLICY IF EXISTS "Users can update workspace competitor sites" ON public.competitor_sites;
DROP POLICY IF EXISTS "Users can view their workspace competitor sites" ON public.competitor_sites;
DROP POLICY IF EXISTS "Users can view workspace competitor sites" ON public.competitor_sites;

CREATE POLICY "authenticated_workspace_all_competitor_sites"
  ON public.competitor_sites FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_competitor_sites"
  ON public.competitor_sites FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 4. faq_database - Drop public policies, add authenticated
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage FAQs" ON public.faq_database;
DROP POLICY IF EXISTS "Users can view workspace FAQs" ON public.faq_database;

CREATE POLICY "authenticated_workspace_all_faq_database"
  ON public.faq_database FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_faq_database"
  ON public.faq_database FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 5. voice_profiles - Drop public policies, add authenticated
-- ============================================================
DROP POLICY IF EXISTS "Users can manage workspace voice profile" ON public.voice_profiles;
DROP POLICY IF EXISTS "Users can view workspace voice profile" ON public.voice_profiles;

CREATE POLICY "authenticated_workspace_all_voice_profiles"
  ON public.voice_profiles FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_voice_profiles"
  ON public.voice_profiles FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 6. price_list - Drop public policies, add authenticated
-- ============================================================
DROP POLICY IF EXISTS "Admins can manage pricing" ON public.price_list;
DROP POLICY IF EXISTS "Users can view workspace pricing" ON public.price_list;

CREATE POLICY "authenticated_workspace_all_price_list"
  ON public.price_list FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_price_list"
  ON public.price_list FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 7. onboarding_progress - Drop public policies, keep auth+service
-- ============================================================
DROP POLICY IF EXISTS "Service role can manage onboarding progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can manage own workspace onboarding" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can view onboarding progress in their workspace" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can view own workspace onboarding" ON public.onboarding_progress;
-- Keep existing authenticated policies, drop duplicates
DROP POLICY IF EXISTS "Users can insert their workspace onboarding progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can update their workspace onboarding progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Users can view their workspace onboarding progress" ON public.onboarding_progress;
-- Service role policy already exists as "Service role has full access to onboarding"

CREATE POLICY "authenticated_workspace_all_onboarding_progress"
  ON public.onboarding_progress FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

-- ============================================================
-- 8. raw_emails - Add full CRUD for authenticated (only SELECT exists)
-- ============================================================
DROP POLICY IF EXISTS "Users can view workspace raw emails" ON public.raw_emails;

CREATE POLICY "authenticated_workspace_all_raw_emails"
  ON public.raw_emails FOR ALL
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id())
  WITH CHECK (workspace_id = public.get_my_workspace_id());

-- ============================================================
-- 9. conversations - Already authenticated, add DELETE + service_role
-- ============================================================
CREATE POLICY "authenticated_workspace_delete_conversations"
  ON public.conversations FOR DELETE
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_conversations"
  ON public.conversations FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 10. customers - Already authenticated, add DELETE + service_role
-- ============================================================
CREATE POLICY "authenticated_workspace_delete_customers"
  ON public.customers FOR DELETE
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "service_role_customers"
  ON public.customers FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 11. messages - Already authenticated, add UPDATE/DELETE + service_role
-- ============================================================
CREATE POLICY "authenticated_workspace_update_messages"
  ON public.messages FOR UPDATE
  TO authenticated
  USING (conversation_id IN (
    SELECT id FROM public.conversations WHERE workspace_id = public.get_my_workspace_id()
  ));

CREATE POLICY "authenticated_workspace_delete_messages"
  ON public.messages FOR DELETE
  TO authenticated
  USING (conversation_id IN (
    SELECT id FROM public.conversations WHERE workspace_id = public.get_my_workspace_id()
  ));

CREATE POLICY "service_role_messages"
  ON public.messages FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 12. workspaces - Already authenticated SELECT, add service_role
-- ============================================================
CREATE POLICY "authenticated_workspace_update_workspaces"
  ON public.workspaces FOR UPDATE
  TO authenticated
  USING (id = public.get_my_workspace_id());

CREATE POLICY "service_role_workspaces"
  ON public.workspaces FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 13. users - Already has good policies, add service_role
-- ============================================================
CREATE POLICY "service_role_users"
  ON public.users FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- ============================================================
-- 14. documents storage bucket - Workspace-scoped policies
-- ============================================================
DROP POLICY IF EXISTS "Users can upload documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their documents" ON storage.objects;

CREATE POLICY "Users can upload to their workspace documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT u.workspace_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can read their workspace documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT u.workspace_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their workspace documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents' AND
    (storage.foldername(name))[1] IN (
      SELECT u.workspace_id::text FROM public.users u WHERE u.id = auth.uid()
    )
  );
