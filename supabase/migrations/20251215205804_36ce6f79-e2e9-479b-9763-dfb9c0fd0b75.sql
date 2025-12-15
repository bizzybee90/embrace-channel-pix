-- Table to store user corrections for learning
CREATE TABLE public.triage_corrections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  conversation_id UUID REFERENCES conversations(id),
  original_classification TEXT,
  new_classification TEXT,
  original_requires_reply BOOLEAN,
  new_requires_reply BOOLEAN,
  sender_email TEXT,
  sender_domain TEXT,
  subject_keywords TEXT[],
  corrected_by UUID REFERENCES users(id),
  corrected_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.triage_corrections ENABLE ROW LEVEL SECURITY;

-- Users can view workspace corrections
CREATE POLICY "Users can view workspace triage corrections"
ON public.triage_corrections FOR SELECT
USING (workspace_id = get_my_workspace_id());

-- Users can create corrections
CREATE POLICY "Users can create triage corrections"
ON public.triage_corrections FOR INSERT
WITH CHECK (workspace_id = get_my_workspace_id());

-- Table for sender-based classification rules
CREATE TABLE public.sender_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id),
  sender_pattern TEXT NOT NULL, -- e.g., "@stripe.com", "noreply@indeed.com"
  default_classification TEXT NOT NULL,
  default_requires_reply BOOLEAN DEFAULT false,
  override_keywords TEXT[], -- If content contains these, override
  override_classification TEXT,
  override_requires_reply BOOLEAN,
  confidence_adjustment FLOAT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  hit_count INTEGER DEFAULT 0,
  created_from_correction UUID REFERENCES triage_corrections(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sender_rules ENABLE ROW LEVEL SECURITY;

-- Users can view workspace sender rules
CREATE POLICY "Users can view workspace sender rules"
ON public.sender_rules FOR SELECT
USING (workspace_id = get_my_workspace_id());

-- Users can manage workspace sender rules
CREATE POLICY "Users can manage workspace sender rules"
ON public.sender_rules FOR ALL
USING (workspace_id = get_my_workspace_id());

-- Table for business context flags
CREATE TABLE public.business_context (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) UNIQUE,
  is_hiring BOOLEAN DEFAULT false,
  active_stripe_case BOOLEAN DEFAULT false,
  active_insurance_claim BOOLEAN DEFAULT false,
  custom_flags JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.business_context ENABLE ROW LEVEL SECURITY;

-- Users can view workspace business context
CREATE POLICY "Users can view workspace business context"
ON public.business_context FOR SELECT
USING (workspace_id = get_my_workspace_id());

-- Users can manage workspace business context
CREATE POLICY "Users can manage workspace business context"
ON public.business_context FOR ALL
USING (workspace_id = get_my_workspace_id());