-- Phase 3: Security Hardening - Extensions and Token Encryption

-- Step 1: Create dedicated extensions schema
CREATE SCHEMA IF NOT EXISTS extensions;

-- Step 2: Enable pgcrypto for encryption (in extensions schema)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Step 3: Add encrypted token columns to email_provider_configs
ALTER TABLE public.email_provider_configs 
ADD COLUMN IF NOT EXISTS access_token_encrypted bytea,
ADD COLUMN IF NOT EXISTS encryption_key_id text DEFAULT 'v1';

-- Step 4: Add encrypted token columns to gmail_channel_configs
ALTER TABLE public.gmail_channel_configs 
ADD COLUMN IF NOT EXISTS access_token_encrypted bytea,
ADD COLUMN IF NOT EXISTS refresh_token_encrypted bytea,
ADD COLUMN IF NOT EXISTS encryption_key_id text DEFAULT 'v1';

-- Step 5: Create encryption helper functions
CREATE OR REPLACE FUNCTION public.encrypt_token(token text, secret text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF token IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_encrypt(token, secret);
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_token(encrypted_token bytea, secret text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF encrypted_token IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_decrypt(encrypted_token, secret);
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Step 6: Revoke direct access to encryption functions from anon/authenticated
-- Only service role should use these
REVOKE EXECUTE ON FUNCTION public.encrypt_token(text, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrypt_token(bytea, text) FROM anon, authenticated;

-- Note: Moving existing extensions (uuid-ossp, vector) to a new schema 
-- would break existing references, so we leave them in public but ensure
-- new extensions go to the extensions schema