-- Drop existing function first to allow parameter rename
DROP FUNCTION IF EXISTS public.get_decrypted_access_token(uuid);

-- Create the store_encrypted_token function
CREATE OR REPLACE FUNCTION public.store_encrypted_token(
  p_config_id uuid,
  p_access_token text,
  p_refresh_token text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
DECLARE
  v_token_secret text;
BEGIN
  v_token_secret := current_setting('app.settings.token_encryption_secret', true);
  
  IF v_token_secret IS NULL OR v_token_secret = '' THEN
    UPDATE email_provider_configs
    SET 
      access_token = p_access_token,
      refresh_token = p_refresh_token,
      updated_at = NOW()
    WHERE id = p_config_id;
  ELSE
    UPDATE email_provider_configs
    SET 
      access_token = pgp_sym_encrypt(p_access_token, v_token_secret),
      refresh_token = CASE 
        WHEN p_refresh_token IS NOT NULL 
        THEN pgp_sym_encrypt(p_refresh_token, v_token_secret)
        ELSE NULL
      END,
      updated_at = NOW()
    WHERE id = p_config_id;
  END IF;
END;
$$;

-- Recreate get_decrypted_access_token with correct parameter name
CREATE OR REPLACE FUNCTION public.get_decrypted_access_token(
  p_workspace_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions'
AS $$
DECLARE
  v_token_secret text;
  v_access_token text;
BEGIN
  v_token_secret := current_setting('app.settings.token_encryption_secret', true);
  
  SELECT access_token INTO v_access_token
  FROM email_provider_configs
  WHERE workspace_id = p_workspace_id;
  
  IF v_access_token IS NULL THEN
    RETURN NULL;
  END IF;
  
  IF v_token_secret IS NOT NULL AND v_token_secret != '' THEN
    BEGIN
      RETURN pgp_sym_decrypt(v_access_token::bytea, v_token_secret);
    EXCEPTION WHEN OTHERS THEN
      RETURN v_access_token;
    END;
  ELSE
    RETURN v_access_token;
  END IF;
END;
$$;