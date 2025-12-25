-- Enable realtime for messages table so new messages appear instantly
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Add subscription tracking columns to email_provider_configs
ALTER TABLE public.email_provider_configs
ADD COLUMN IF NOT EXISTS subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;