-- Create notification_preferences table
CREATE TABLE public.notification_preferences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  summary_enabled BOOLEAN DEFAULT true,
  summary_channels TEXT[] DEFAULT ARRAY['in_app']::TEXT[],
  summary_times TIME[] DEFAULT ARRAY['08:00'::TIME, '12:00'::TIME, '18:00'::TIME],
  summary_email TEXT,
  summary_phone TEXT,
  timezone TEXT DEFAULT 'Europe/London',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(workspace_id)
);

-- Create notifications table for in-app notifications
CREATE TABLE public.notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'ai_summary',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN DEFAULT false,
  metadata JSONB DEFAULT '{}'::JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- RLS policies for notification_preferences
CREATE POLICY "Users can view workspace notification preferences"
  ON public.notification_preferences FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace notification preferences"
  ON public.notification_preferences FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- RLS policies for notifications
CREATE POLICY "Users can view their notifications"
  ON public.notifications FOR SELECT
  USING (workspace_id = get_my_workspace_id() OR user_id = auth.uid());

CREATE POLICY "Users can update their notifications"
  ON public.notifications FOR UPDATE
  USING (workspace_id = get_my_workspace_id() OR user_id = auth.uid());

CREATE POLICY "System can insert notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

-- Create index for faster notification queries
CREATE INDEX idx_notifications_workspace_unread ON public.notifications(workspace_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notification_preferences_workspace ON public.notification_preferences(workspace_id);

-- Trigger for updated_at
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();