-- Drop and recreate the status check constraint with all valid statuses
ALTER TABLE public.competitor_research_jobs 
DROP CONSTRAINT competitor_research_jobs_status_check;

ALTER TABLE public.competitor_research_jobs 
ADD CONSTRAINT competitor_research_jobs_status_check 
CHECK (status = ANY (ARRAY[
  'queued'::text, 
  'geocoding'::text,
  'discovering'::text, 
  'filtering'::text,
  'scraping'::text, 
  'extracting'::text,
  'deduplicating'::text,
  'refining'::text,
  'embedding'::text,
  'generating'::text, 
  'completed'::text, 
  'failed'::text,
  'cancelled'::text,
  'error'::text
]));