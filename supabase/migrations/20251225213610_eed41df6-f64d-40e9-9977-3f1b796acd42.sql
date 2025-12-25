-- Add sync progress tracking columns to email_provider_configs
ALTER TABLE public.email_provider_configs 
ADD COLUMN IF NOT EXISTS sync_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS sync_progress integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS sync_total integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS sync_started_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS sync_completed_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS sync_error text;