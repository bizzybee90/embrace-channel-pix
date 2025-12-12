-- Create unified email provider configs table for Aurinko integration
CREATE TABLE public.email_provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) NOT NULL,
  provider TEXT NOT NULL, -- 'Google', 'Office365', 'iCloud', 'IMAP'
  account_id TEXT NOT NULL, -- Aurinko account ID
  access_token TEXT NOT NULL, -- Aurinko access token
  email_address TEXT NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT now(),
  last_sync_at TIMESTAMPTZ,
  import_mode TEXT DEFAULT 'new_only',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, email_address)
);

-- Enable RLS
ALTER TABLE public.email_provider_configs ENABLE ROW LEVEL SECURITY;

-- Users can view their workspace's email configs
CREATE POLICY "Users can view workspace email configs"
  ON public.email_provider_configs
  FOR SELECT
  USING (workspace_id = get_my_workspace_id());

-- Users can manage their workspace's email configs
CREATE POLICY "Users can manage workspace email configs"
  ON public.email_provider_configs
  FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- Create trigger for updated_at
CREATE TRIGGER update_email_provider_configs_updated_at
  BEFORE UPDATE ON public.email_provider_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();