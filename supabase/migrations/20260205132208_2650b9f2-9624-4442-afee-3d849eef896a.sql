-- Add n8n-specific tracking columns to existing onboarding_progress table
ALTER TABLE public.onboarding_progress 
ADD COLUMN IF NOT EXISTS n8n_competitor_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS n8n_competitor_message TEXT,
ADD COLUMN IF NOT EXISTS n8n_competitors_found INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS n8n_competitors_scraped INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS n8n_faqs_generated INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS n8n_email_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS n8n_email_message TEXT,
ADD COLUMN IF NOT EXISTS n8n_emails_imported INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS n8n_emails_classified INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS n8n_execution_id TEXT;

-- Add scrape_status and verification columns to competitor_sites if not exists
ALTER TABLE public.competitor_sites
ADD COLUMN IF NOT EXISTS raw_content TEXT,
ADD COLUMN IF NOT EXISTS verification_status TEXT,
ADD COLUMN IF NOT EXISTS found_by TEXT;

-- Create a separate table for step-based progress tracking that n8n can update
CREATE TABLE IF NOT EXISTS public.n8n_workflow_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  workflow_type TEXT NOT NULL, -- 'competitor_discovery' or 'email_import'
  status TEXT NOT NULL DEFAULT 'pending',
  details JSONB DEFAULT '{}',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(workspace_id, workflow_type)
);

-- Enable RLS
ALTER TABLE public.n8n_workflow_progress ENABLE ROW LEVEL SECURITY;

-- Users can view their own workspace progress
CREATE POLICY "Users can view own workflow progress" ON public.n8n_workflow_progress
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  );

-- Users can manage their own workflow progress
CREATE POLICY "Users can manage own workflow progress" ON public.n8n_workflow_progress
  FOR ALL USING (
    workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  );