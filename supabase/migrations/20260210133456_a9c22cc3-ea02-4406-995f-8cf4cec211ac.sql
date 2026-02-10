
DROP FUNCTION IF EXISTS public.get_decrypted_access_token(uuid);

CREATE OR REPLACE FUNCTION public.get_decrypted_access_token(p_config_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_token_secret text;
  v_access_token text;
  v_caller_workspace_id uuid;
  v_config_workspace_id uuid;
BEGIN
  SELECT workspace_id INTO v_config_workspace_id
  FROM email_provider_configs
  WHERE id = p_config_id;

  IF v_config_workspace_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    SELECT workspace_id INTO v_caller_workspace_id
    FROM public.users
    WHERE id = auth.uid();

    IF v_caller_workspace_id IS NULL OR v_caller_workspace_id != v_config_workspace_id THEN
      RAISE EXCEPTION 'Access denied: workspace mismatch';
    END IF;
  END IF;

  v_token_secret := current_setting('app.settings.token_encryption_secret', true);
  
  SELECT access_token INTO v_access_token
  FROM email_provider_configs
  WHERE id = p_config_id;
  
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
$function$;
