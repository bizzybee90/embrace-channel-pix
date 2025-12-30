-- Add archived column to faq_database for archiving existing FAQs
ALTER TABLE public.faq_database 
ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;

-- Archive all existing FAQs so we can test fresh scraping
UPDATE public.faq_database 
SET archived = true 
WHERE archived IS NULL OR archived = false;