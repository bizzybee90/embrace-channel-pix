-- Create a function to bulk update email classifications efficiently
CREATE OR REPLACE FUNCTION bulk_update_email_classifications(
  p_updates JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER := 0;
  v_update JSONB;
BEGIN
  FOR v_update IN SELECT * FROM jsonb_array_elements(p_updates)
  LOOP
    UPDATE email_import_queue
    SET 
      category = v_update->>'category',
      requires_reply = (v_update->>'requires_reply')::boolean,
      classified_at = NOW(),
      status = 'processed',
      processed_at = NOW()
    WHERE id = (v_update->>'id')::uuid;
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;