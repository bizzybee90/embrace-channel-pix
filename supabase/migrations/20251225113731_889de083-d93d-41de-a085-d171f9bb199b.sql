-- =====================================================
-- PHASE 1: CRITICAL SECURITY FIXES
-- =====================================================

-- 1. Fix system_prompts RLS - Remove public access to prompts without workspace
DROP POLICY IF EXISTS "Users can view prompts in their workspace" ON public.system_prompts;

CREATE POLICY "Users can view workspace prompts only" 
ON public.system_prompts 
FOR SELECT 
TO authenticated
USING (
  (workspace_id IS NOT NULL AND user_has_workspace_access(workspace_id))
  OR (workspace_id IS NULL AND has_role(auth.uid(), 'admin'::app_role))
);

-- =====================================================
-- PHASE 2: FIX OVERLY PERMISSIVE POLICIES
-- =====================================================

-- 2. Secure escalated_messages - Add workspace_id and proper RLS
ALTER TABLE public.escalated_messages 
ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id);

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can insert test messages" ON public.escalated_messages;
DROP POLICY IF EXISTS "Authenticated users can update messages" ON public.escalated_messages;
DROP POLICY IF EXISTS "Authenticated users can view messages" ON public.escalated_messages;

-- Create proper workspace-scoped policies
CREATE POLICY "Users can view workspace escalations" 
ON public.escalated_messages 
FOR SELECT 
TO authenticated
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can create workspace escalations" 
ON public.escalated_messages 
FOR INSERT 
TO authenticated
WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace escalations" 
ON public.escalated_messages 
FOR UPDATE 
TO authenticated
USING (workspace_id = get_my_workspace_id());

-- 3. Secure message_responses - Chain through escalated_messages
DROP POLICY IF EXISTS "Authenticated users can create responses" ON public.message_responses;
DROP POLICY IF EXISTS "Authenticated users can view responses" ON public.message_responses;

CREATE POLICY "Users can view responses for workspace messages" 
ON public.message_responses 
FOR SELECT 
TO authenticated
USING (
  message_id IN (
    SELECT id FROM public.escalated_messages 
    WHERE workspace_id = get_my_workspace_id()
  )
);

CREATE POLICY "Users can create responses for workspace messages" 
ON public.message_responses 
FOR INSERT 
TO authenticated
WITH CHECK (
  message_id IN (
    SELECT id FROM public.escalated_messages 
    WHERE workspace_id = get_my_workspace_id()
  )
);

-- 4. Secure notifications - Fix overly permissive INSERT
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update their notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can view their notifications" ON public.notifications;

-- System insert via service role only (no policy needed, service role bypasses RLS)
-- But we need authenticated users to create notifications in some cases
CREATE POLICY "Users can create notifications in their workspace" 
ON public.notifications 
FOR INSERT 
TO authenticated
WITH CHECK (
  (workspace_id = get_my_workspace_id()) 
  OR (user_id = auth.uid())
);

CREATE POLICY "Users can view their own notifications" 
ON public.notifications 
FOR SELECT 
TO authenticated
USING (
  (workspace_id = get_my_workspace_id()) 
  OR (user_id = auth.uid())
);

CREATE POLICY "Users can update their own notifications" 
ON public.notifications 
FOR UPDATE 
TO authenticated
USING (
  (workspace_id = get_my_workspace_id()) 
  OR (user_id = auth.uid())
);

-- 5. Secure sync_logs - Remove system insert, only service role should insert
DROP POLICY IF EXISTS "System can insert sync logs" ON public.sync_logs;
DROP POLICY IF EXISTS "Users can view workspace sync logs" ON public.sync_logs;

-- No INSERT policy - only service role (edge functions) can insert
CREATE POLICY "Users can view their workspace sync logs" 
ON public.sync_logs 
FOR SELECT 
TO authenticated
USING (workspace_id = get_my_workspace_id());

-- 6. Secure webhook_logs - Remove system insert, only service role should insert
DROP POLICY IF EXISTS "System can insert webhook logs" ON public.webhook_logs;
DROP POLICY IF EXISTS "Users can view workspace webhook logs" ON public.webhook_logs;

-- No INSERT policy - only service role (edge functions) can insert
CREATE POLICY "Users can view their workspace webhook logs" 
ON public.webhook_logs 
FOR SELECT 
TO authenticated
USING (
  conversation_id IN (
    SELECT id FROM public.conversations 
    WHERE workspace_id = get_my_workspace_id()
  )
);

-- 7. Secure data_access_logs - Remove system insert, only service role should insert
DROP POLICY IF EXISTS "System can insert access logs" ON public.data_access_logs;
DROP POLICY IF EXISTS "Admins can view all access logs" ON public.data_access_logs;

-- No INSERT policy - only service role (edge functions) can insert
-- Only admins can view, but scoped to their workspace
CREATE POLICY "Admins can view workspace access logs" 
ON public.data_access_logs 
FOR SELECT 
TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) 
  AND (
    customer_id IN (SELECT id FROM public.customers WHERE workspace_id = get_my_workspace_id())
    OR conversation_id IN (SELECT id FROM public.conversations WHERE workspace_id = get_my_workspace_id())
    OR user_id = auth.uid()
  )
);