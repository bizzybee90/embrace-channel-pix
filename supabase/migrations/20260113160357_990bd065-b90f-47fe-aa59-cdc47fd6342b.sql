-- ============================================================================
-- FIX: API Usage Cross-Workspace Exposure & Security Definer View
-- Resolves: PUBLIC_DATA_EXPOSURE (api_usage_cross_workspace) and 
--           SUPA_security_definer_view findings
-- ============================================================================

-- Step 1: Drop the overly permissive SELECT policy on api_usage
DROP POLICY IF EXISTS "Authenticated users can read api usage" ON public.api_usage;

-- Step 2: Create workspace-scoped policy for api_usage
CREATE POLICY "Users can view their workspace api usage"
  ON public.api_usage FOR SELECT
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

-- Step 3: Drop the SECURITY DEFINER view (causes the Supabase linter warning)
DROP VIEW IF EXISTS public.api_usage_summary;

-- Step 4: Create a SECURITY INVOKER function instead
-- This respects RLS of the calling user and scopes to their workspace
CREATE OR REPLACE FUNCTION public.get_api_usage_summary()
RETURNS TABLE (
  provider text,
  hour timestamptz,
  total_requests bigint,
  total_tokens bigint,
  total_cost numeric
)
SECURITY INVOKER
LANGUAGE SQL
STABLE
SET search_path = public
AS $$
  SELECT 
    provider,
    DATE_TRUNC('hour', created_at) as hour,
    SUM(requests)::bigint as total_requests,
    SUM(tokens_used)::bigint as total_tokens,
    SUM(cost_estimate) as total_cost
  FROM public.api_usage
  WHERE workspace_id = public.get_my_workspace_id()
    AND created_at > NOW() - INTERVAL '24 hours'
  GROUP BY provider, DATE_TRUNC('hour', created_at)
  ORDER BY hour DESC
$$;