-- Increment function for email import progress (called by webhook receiver)
CREATE OR REPLACE FUNCTION public.increment_emails_received(p_workspace_id UUID)
RETURNS void AS $$
BEGIN
  INSERT INTO email_import_progress (workspace_id, emails_received, current_phase, started_at)
  VALUES (p_workspace_id, 1, 'importing', NOW())
  ON CONFLICT (workspace_id) 
  DO UPDATE SET 
    emails_received = email_import_progress.emails_received + 1,
    current_phase = CASE 
      WHEN email_import_progress.current_phase = 'connecting' THEN 'importing'
      ELSE email_import_progress.current_phase
    END,
    started_at = COALESCE(email_import_progress.started_at, NOW()),
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;