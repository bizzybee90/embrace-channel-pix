-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create app_role enum for user roles
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'reviewer');

-- Create workspaces table
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  timezone TEXT DEFAULT 'Europe/London',
  business_hours_start TIME DEFAULT '09:00',
  business_hours_end TIME DEFAULT '17:00',
  business_days INTEGER[] DEFAULT '{1,2,3,4,5}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create user_roles table (CRITICAL: separate from users for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Create users table (profiles)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_online BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'available',
  last_active_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create customers table
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES public.workspaces(id),
  name TEXT,
  email TEXT,
  phone TEXT,
  preferred_channel TEXT,
  tier TEXT DEFAULT 'regular',
  notes TEXT,
  custom_fields JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create conversations table (replaces escalated_messages)
CREATE TABLE public.conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES public.workspaces(id),
  customer_id UUID REFERENCES public.customers(id),
  external_conversation_id TEXT,
  
  title TEXT,
  summary_for_human TEXT,
  
  channel TEXT NOT NULL,
  category TEXT DEFAULT 'other',
  priority TEXT DEFAULT 'medium',
  status TEXT DEFAULT 'new',
  
  ai_confidence DECIMAL(3,2),
  ai_sentiment TEXT,
  ai_reason_for_escalation TEXT,
  
  assigned_to UUID REFERENCES public.users(id),
  
  sla_target_minutes INTEGER DEFAULT 240,
  sla_due_at TIMESTAMP WITH TIME ZONE,
  sla_status TEXT DEFAULT 'safe',
  first_response_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create messages table
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE CASCADE,
  
  actor_type TEXT NOT NULL,
  actor_id UUID REFERENCES public.users(id),
  actor_name TEXT,
  
  direction TEXT NOT NULL,
  channel TEXT NOT NULL,
  body TEXT NOT NULL,
  
  is_internal BOOLEAN DEFAULT FALSE,
  
  raw_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create sla_configs table
CREATE TABLE public.sla_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES public.workspaces(id),
  priority TEXT NOT NULL,
  first_response_minutes INTEGER NOT NULL,
  pause_outside_hours BOOLEAN DEFAULT TRUE,
  UNIQUE(workspace_id, priority)
);

-- Create templates table
CREATE TABLE public.templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID REFERENCES public.workspaces(id),
  name TEXT NOT NULL,
  category TEXT,
  body TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_customers_workspace ON public.customers(workspace_id);
CREATE INDEX idx_customers_phone ON public.customers(phone);
CREATE INDEX idx_customers_email ON public.customers(email);
CREATE INDEX idx_conversations_workspace ON public.conversations(workspace_id);
CREATE INDEX idx_conversations_status ON public.conversations(status);
CREATE INDEX idx_conversations_assigned ON public.conversations(assigned_to);
CREATE INDEX idx_conversations_sla ON public.conversations(sla_due_at);
CREATE INDEX idx_conversations_external ON public.conversations(external_conversation_id);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_messages_created ON public.messages(created_at);

-- Create security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email
  );
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Enable RLS on all tables
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;

-- RLS Policies for workspaces
CREATE POLICY "Users can view their workspace"
  ON public.workspaces FOR SELECT
  TO authenticated
  USING (
    id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for users
CREATE POLICY "Users can view workspace members"
  ON public.users FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update their own profile"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = auth.uid());

-- RLS Policies for customers
CREATE POLICY "Users can view workspace customers"
  ON public.customers FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can create customers"
  ON public.customers FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update workspace customers"
  ON public.customers FOR UPDATE
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

-- RLS Policies for conversations
CREATE POLICY "Users can view workspace conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can update workspace conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

-- RLS Policies for messages
CREATE POLICY "Users can view conversation messages"
  ON public.messages FOR SELECT
  TO authenticated
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations 
      WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can create messages"
  ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    conversation_id IN (
      SELECT id FROM public.conversations 
      WHERE workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
    )
  );

-- RLS Policies for sla_configs
CREATE POLICY "Users can view workspace SLA configs"
  ON public.sla_configs FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Managers can manage SLA configs"
  ON public.sla_configs FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin')
  );

-- RLS Policies for templates
CREATE POLICY "Users can view workspace templates"
  ON public.templates FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY "Users can create templates"
  ON public.templates FOR INSERT
  TO authenticated
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM public.users WHERE id = auth.uid())
  );

-- Insert demo workspace
INSERT INTO public.workspaces (name, slug) VALUES ('BizzyBee Demo', 'bizzybee-demo');

-- Insert default SLA configs for demo workspace
INSERT INTO public.sla_configs (workspace_id, priority, first_response_minutes) 
SELECT id, 'high', 60 FROM public.workspaces WHERE slug = 'bizzybee-demo';

INSERT INTO public.sla_configs (workspace_id, priority, first_response_minutes) 
SELECT id, 'medium', 240 FROM public.workspaces WHERE slug = 'bizzybee-demo';

INSERT INTO public.sla_configs (workspace_id, priority, first_response_minutes) 
SELECT id, 'low', 1440 FROM public.workspaces WHERE slug = 'bizzybee-demo';

-- Insert default categories as templates
INSERT INTO public.templates (workspace_id, name, category, body)
SELECT id, 'Quick Response - Appointment Confirmed', 'appointments', 'Hi {{customer_name}}, your appointment is confirmed for {{date}}. Looking forward to seeing you!' 
FROM public.workspaces WHERE slug = 'bizzybee-demo';

INSERT INTO public.templates (workspace_id, name, category, body)
SELECT id, 'Service Quality Apology', 'service_quality', 'Hi {{customer_name}}, I''m so sorry to hear about your experience. This isn''t the standard we hold ourselves to. Let me make this right.' 
FROM public.workspaces WHERE slug = 'bizzybee-demo';