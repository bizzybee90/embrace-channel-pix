-- Add columns for direct OAuth token management and total counts
ALTER TABLE public.email_provider_configs
ADD COLUMN IF NOT EXISTS refresh_token text,
ADD COLUMN IF NOT EXISTS token_expires_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS inbound_total integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS outbound_total integer DEFAULT 0;