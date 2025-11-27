-- Enable pgvector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding and AI tracking columns to conversations table
ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS embedding vector(1536),
ADD COLUMN IF NOT EXISTS ai_draft_response text,
ADD COLUMN IF NOT EXISTS final_response text,
ADD COLUMN IF NOT EXISTS human_edited boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_responded boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS mode text DEFAULT 'ai',
ADD COLUMN IF NOT EXISTS confidence numeric(3,2),
ADD COLUMN IF NOT EXISTS customer_satisfaction integer,
ADD COLUMN IF NOT EXISTS led_to_booking boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS needs_embedding boolean GENERATED ALWAYS AS (embedding IS NULL) STORED;

-- Add check constraint for customer_satisfaction (1-5 rating)
ALTER TABLE public.conversations
ADD CONSTRAINT conversations_customer_satisfaction_check 
CHECK (customer_satisfaction IS NULL OR (customer_satisfaction >= 1 AND customer_satisfaction <= 5));

-- Create indexes for vector similarity search
CREATE INDEX IF NOT EXISTS conversations_embedding_idx 
ON public.conversations 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Index for finding conversations that need embeddings
CREATE INDEX IF NOT EXISTS conversations_needs_embedding_idx 
ON public.conversations (needs_embedding)
WHERE needs_embedding = true;

-- Indexes for AI learning queries
CREATE INDEX IF NOT EXISTS idx_conversations_led_to_booking 
ON public.conversations (led_to_booking) 
WHERE led_to_booking = true;

CREATE INDEX IF NOT EXISTS idx_conversations_human_edited 
ON public.conversations (human_edited) 
WHERE human_edited = true;

CREATE INDEX IF NOT EXISTS idx_conversations_customer_satisfaction 
ON public.conversations (customer_satisfaction DESC)
WHERE customer_satisfaction IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_mode 
ON public.conversations (mode);

-- Create business_facts table for get_business_facts tool
CREATE TABLE IF NOT EXISTS public.business_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id),
  category text NOT NULL,
  fact_key text NOT NULL,
  fact_value text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on business_facts
ALTER TABLE public.business_facts ENABLE ROW LEVEL SECURITY;

-- RLS policies for business_facts
CREATE POLICY "Users can view workspace business facts"
ON public.business_facts
FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage business facts"
ON public.business_facts
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger to update updated_at on business_facts
CREATE TRIGGER update_business_facts_updated_at
BEFORE UPDATE ON public.business_facts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes on business_facts
CREATE INDEX IF NOT EXISTS idx_business_facts_workspace_id 
ON public.business_facts (workspace_id);

CREATE INDEX IF NOT EXISTS idx_business_facts_category 
ON public.business_facts (category);

-- Create price_list table for get_pricing tool
CREATE TABLE IF NOT EXISTS public.price_list (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id),
  service_name text NOT NULL,
  description text,
  price_range text,
  base_price numeric(10,2),
  currency text DEFAULT 'GBP',
  unit text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS on price_list
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;

-- RLS policies for price_list
CREATE POLICY "Users can view workspace pricing"
ON public.price_list
FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage pricing"
ON public.price_list
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create trigger to update updated_at on price_list
CREATE TRIGGER update_price_list_updated_at
BEFORE UPDATE ON public.price_list
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes on price_list
CREATE INDEX IF NOT EXISTS idx_price_list_workspace_id 
ON public.price_list (workspace_id);

CREATE INDEX IF NOT EXISTS idx_price_list_service_name 
ON public.price_list (service_name);

-- Rename existing faqs table to faq_database for consistency
ALTER TABLE IF EXISTS public.faqs RENAME TO faq_database;

-- Update foreign key name if the table was renamed
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'faq_database'
  ) THEN
    -- Drop old constraint if it exists
    ALTER TABLE public.faq_database 
    DROP CONSTRAINT IF EXISTS faqs_workspace_id_fkey;
    
    -- Add new constraint
    ALTER TABLE public.faq_database
    ADD CONSTRAINT faq_database_workspace_id_fkey 
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id);
  END IF;
END $$;