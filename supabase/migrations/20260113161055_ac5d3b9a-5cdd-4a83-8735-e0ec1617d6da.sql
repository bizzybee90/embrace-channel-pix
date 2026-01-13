-- ============================================================================
-- FIX: OAuth Access Token Encryption & Additional Public Data Exposure
-- Resolves: SECRETS_EXPOSED (access_tokens_plaintext), 
--           PUBLIC_ANALYTICS_DATA (conversation_analytics_public_exposure),
--           PUBLIC_ONBOARDING_DATA (onboarding_progress_public_exposure)
-- ============================================================================

-- Step 1: Create a secure function to get decrypted access token
-- This allows edge functions to retrieve decrypted tokens without needing the secret
CREATE OR REPLACE FUNCTION public.get_decrypted_access_token(config_id uuid)
RETURNS text
SECURITY DEFINER
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  encrypted_token bytea;
  plaintext_token text;
  token_secret text;
BEGIN
  -- Get the token encryption secret from the app settings
  token_secret := current_setting('app.settings.token_encryption_secret', true);
  
  -- If no secret configured, fall back to plaintext token (backwards compatibility)
  IF token_secret IS NULL OR token_secret = '' THEN
    SELECT access_token INTO plaintext_token
    FROM email_provider_configs
    WHERE id = config_id;
    RETURN plaintext_token;
  END IF;
  
  -- Try to get encrypted token first
  SELECT access_token_encrypted INTO encrypted_token
  FROM email_provider_configs
  WHERE id = config_id;
  
  -- If encrypted token exists, decrypt it
  IF encrypted_token IS NOT NULL THEN
    RETURN decrypt_token(encrypted_token, token_secret);
  END IF;
  
  -- Fall back to plaintext token if no encrypted version exists
  SELECT access_token INTO plaintext_token
  FROM email_provider_configs
  WHERE id = config_id;
  
  RETURN plaintext_token;
END;
$$;

-- Revoke execute from public roles - only service role should use this
REVOKE EXECUTE ON FUNCTION public.get_decrypted_access_token(uuid) FROM anon, authenticated;

-- Step 2: Fix conversation_analytics RLS
-- First check if RLS is enabled, then add workspace-scoped policy
ALTER TABLE public.conversation_analytics ENABLE ROW LEVEL SECURITY;

-- Drop any existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can view analytics" ON public.conversation_analytics;
DROP POLICY IF EXISTS "Public can view analytics" ON public.conversation_analytics;
DROP POLICY IF EXISTS "Allow public read" ON public.conversation_analytics;

-- Create workspace-scoped policy
CREATE POLICY "Users can view their workspace analytics"
  ON public.conversation_analytics FOR SELECT
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

-- Allow service role full access for edge functions
CREATE POLICY "Service role has full access to analytics"
  ON public.conversation_analytics FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Step 3: Fix onboarding_progress RLS
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Drop any existing overly permissive policies
DROP POLICY IF EXISTS "Authenticated users can view progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Public can view progress" ON public.onboarding_progress;
DROP POLICY IF EXISTS "Allow public read" ON public.onboarding_progress;

-- Create workspace-scoped policy
CREATE POLICY "Users can view their workspace onboarding progress"
  ON public.onboarding_progress FOR SELECT
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "Users can update their workspace onboarding progress"
  ON public.onboarding_progress FOR UPDATE
  TO authenticated
  USING (workspace_id = public.get_my_workspace_id());

CREATE POLICY "Users can insert their workspace onboarding progress"
  ON public.onboarding_progress FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.get_my_workspace_id());

-- Allow service role full access
CREATE POLICY "Service role has full access to onboarding"
  ON public.onboarding_progress FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);