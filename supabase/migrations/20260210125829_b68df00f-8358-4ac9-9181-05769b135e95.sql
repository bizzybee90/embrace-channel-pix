-- Fix: Restrict get_decrypted_access_token to service_role only
-- This function is only called from edge functions (which use service_role key),
-- so authenticated users should never call it directly.

REVOKE EXECUTE ON FUNCTION public.get_decrypted_access_token(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_decrypted_access_token(uuid) FROM anon;

-- Also restrict store_encrypted_token (same risk pattern)
REVOKE EXECUTE ON FUNCTION public.store_encrypted_token(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.store_encrypted_token(uuid, text, text) FROM anon;