-- Create automation_settings table for AI behavior configuration
CREATE TABLE IF NOT EXISTS public.automation_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  auto_send_enabled BOOLEAN DEFAULT FALSE,
  auto_send_threshold NUMERIC(4,2) DEFAULT 0.95,
  default_to_drafts BOOLEAN DEFAULT TRUE,
  always_verify BOOLEAN DEFAULT TRUE,
  notify_on_low_confidence BOOLEAN DEFAULT TRUE,
  low_confidence_threshold NUMERIC(4,2) DEFAULT 0.70,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(workspace_id)
);

-- Enable RLS
ALTER TABLE public.automation_settings ENABLE ROW LEVEL SECURITY;

-- RLS policies for automation_settings using users table
CREATE POLICY "Users can view their workspace automation settings"
  ON public.automation_settings FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their workspace automation settings"
  ON public.automation_settings FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM public.users 
      WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update their workspace automation settings"
  ON public.automation_settings FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM public.users 
      WHERE id = auth.uid()
    )
  );

-- Add trigger for updated_at
CREATE TRIGGER update_automation_settings_updated_at
  BEFORE UPDATE ON public.automation_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();