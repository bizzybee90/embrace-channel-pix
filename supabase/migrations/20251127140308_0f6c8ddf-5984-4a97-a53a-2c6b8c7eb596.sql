-- Phase 2: Channel Management
CREATE TABLE public.workspace_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'whatsapp', 'email', 'webchat')),
  enabled BOOLEAN DEFAULT false,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, channel)
);

ALTER TABLE public.workspace_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workspace channels"
  ON public.workspace_channels FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage channels"
  ON public.workspace_channels FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_workspace_channels_workspace_id ON public.workspace_channels(workspace_id);

CREATE TRIGGER update_workspace_channels_updated_at
  BEFORE UPDATE ON public.workspace_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Seed default channels for existing workspaces
INSERT INTO public.workspace_channels (workspace_id, channel, enabled)
SELECT id, 'sms', true FROM public.workspaces
UNION ALL
SELECT id, 'whatsapp', true FROM public.workspaces
ON CONFLICT (workspace_id, channel) DO NOTHING;

-- Phase 3: Attachments Support
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

-- Create storage bucket for attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'video/quicktime']
)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for attachments bucket
CREATE POLICY "Users can view workspace attachments"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] IN (
      SELECT w.id::text
      FROM workspaces w
      WHERE w.id = get_my_workspace_id()
    )
  );

CREATE POLICY "Users can upload workspace attachments"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] IN (
      SELECT w.id::text
      FROM workspaces w
      WHERE w.id = get_my_workspace_id()
    )
  );

CREATE POLICY "Users can delete workspace attachments"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'attachments' AND
    (storage.foldername(name))[1] IN (
      SELECT w.id::text
      FROM workspaces w
      WHERE w.id = get_my_workspace_id()
    )
  );

-- Phase 5: Enable Realtime for conversations
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;