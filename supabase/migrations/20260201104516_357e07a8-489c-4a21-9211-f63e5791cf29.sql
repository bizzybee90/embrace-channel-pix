-- Add validation and relevance tracking columns to competitor_sites
ALTER TABLE public.competitor_sites 
ADD COLUMN IF NOT EXISTS validation_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS validated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS relevance_score INTEGER DEFAULT 0;

-- Add index for efficient querying of pending validations
CREATE INDEX IF NOT EXISTS idx_competitor_sites_validation_status ON public.competitor_sites(validation_status);

-- Add comment for documentation
COMMENT ON COLUMN public.competitor_sites.validation_status IS 'Website health check status: pending, valid, invalid, timeout';
COMMENT ON COLUMN public.competitor_sites.validated_at IS 'Timestamp when website validation was performed';
COMMENT ON COLUMN public.competitor_sites.relevance_score IS 'Score 0-100 based on niche match and location proximity';