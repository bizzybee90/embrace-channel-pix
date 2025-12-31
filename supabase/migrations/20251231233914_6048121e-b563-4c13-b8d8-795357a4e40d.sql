-- Add FAQ tracking per site for real-time progress
ALTER TABLE public.competitor_sites
ADD COLUMN faqs_generated integer DEFAULT 0;