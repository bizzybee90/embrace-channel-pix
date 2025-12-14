-- Add aliases column to email_provider_configs table
ALTER TABLE public.email_provider_configs
ADD COLUMN aliases text[] DEFAULT '{}'::text[];

-- Add comment for documentation
COMMENT ON COLUMN public.email_provider_configs.aliases IS 'Array of email aliases associated with this account (e.g., info@domain.com, hello@domain.com)';