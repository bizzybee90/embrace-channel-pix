-- Add column to track current site being scraped
ALTER TABLE public.competitor_research_jobs
ADD COLUMN current_scraping_domain text;