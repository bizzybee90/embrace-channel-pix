-- Email sync jobs table for chunked, resumable imports
CREATE TABLE IF NOT EXISTS public.email_sync_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  config_id UUID NOT NULL REFERENCES public.email_provider_configs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'error')),
  import_mode TEXT NOT NULL,
  
  -- Progress tracking
  inbound_cursor TEXT,
  inbound_processed INTEGER DEFAULT 0,
  sent_cursor TEXT,
  sent_processed INTEGER DEFAULT 0,
  threads_linked INTEGER DEFAULT 0,
  
  -- Metadata
  error_message TEXT,
  last_batch_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Competitor research jobs table
CREATE TABLE IF NOT EXISTS public.competitor_research_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'discovering', 'scraping', 'generating', 'completed', 'error')),
  
  -- Configuration
  niche_query TEXT NOT NULL,
  service_area TEXT,
  target_count INTEGER DEFAULT 100,
  exclude_domains TEXT[] DEFAULT ARRAY['yell.com', 'checkatrade.com', 'bark.com', 'trustpilot.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'maps.google.com', 'yelp.com', 'gumtree.com', 'freeindex.co.uk', 'cylex-uk.co.uk', 'hotfrog.co.uk', 'thebestof.co.uk'],
  
  -- Progress tracking
  sites_discovered INTEGER DEFAULT 0,
  sites_approved INTEGER DEFAULT 0,
  sites_scraped INTEGER DEFAULT 0,
  faqs_generated INTEGER DEFAULT 0,
  faqs_added INTEGER DEFAULT 0,
  
  -- Metadata
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Competitor sites table (discovered + filtered)
CREATE TABLE IF NOT EXISTS public.competitor_sites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.competitor_research_jobs(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  
  -- Site info
  domain TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  description TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'discovered' CHECK (status IN ('discovered', 'approved', 'rejected', 'scraped', 'error')),
  is_directory BOOLEAN DEFAULT false,
  rejection_reason TEXT,
  
  -- Scraping results
  pages_scraped INTEGER DEFAULT 0,
  content_extracted TEXT,
  scraped_at TIMESTAMP WITH TIME ZONE,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Competitor FAQ candidates (before merge)
CREATE TABLE IF NOT EXISTS public.competitor_faq_candidates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.competitor_research_jobs(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.competitor_sites(id) ON DELETE SET NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  source_domain TEXT,
  
  -- Dedup status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'merged', 'duplicate', 'rejected')),
  merged_into_faq_id UUID REFERENCES public.faq_database(id) ON DELETE SET NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all new tables
ALTER TABLE public.email_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_faq_candidates ENABLE ROW LEVEL SECURITY;

-- RLS policies for email_sync_jobs
CREATE POLICY "Users can view their workspace sync jobs"
  ON public.email_sync_jobs FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace sync jobs"
  ON public.email_sync_jobs FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace sync jobs"
  ON public.email_sync_jobs FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- RLS policies for competitor_research_jobs
CREATE POLICY "Users can view their workspace competitor jobs"
  ON public.competitor_research_jobs FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace competitor jobs"
  ON public.competitor_research_jobs FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace competitor jobs"
  ON public.competitor_research_jobs FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- RLS policies for competitor_sites
CREATE POLICY "Users can view their workspace competitor sites"
  ON public.competitor_sites FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can manage their workspace competitor sites"
  ON public.competitor_sites FOR ALL
  USING (user_has_workspace_access(workspace_id));

-- RLS policies for competitor_faq_candidates
CREATE POLICY "Users can view their workspace faq candidates"
  ON public.competitor_faq_candidates FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can manage their workspace faq candidates"
  ON public.competitor_faq_candidates FOR ALL
  USING (user_has_workspace_access(workspace_id));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_email_sync_jobs_status ON public.email_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_email_sync_jobs_workspace ON public.email_sync_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_competitor_research_jobs_status ON public.competitor_research_jobs(status);
CREATE INDEX IF NOT EXISTS idx_competitor_research_jobs_workspace ON public.competitor_research_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_competitor_sites_job ON public.competitor_sites(job_id);
CREATE INDEX IF NOT EXISTS idx_competitor_sites_status ON public.competitor_sites(status);
CREATE INDEX IF NOT EXISTS idx_competitor_faq_candidates_job ON public.competitor_faq_candidates(job_id);