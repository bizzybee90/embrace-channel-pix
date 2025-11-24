-- GDPR & Webhook Logging Tables

-- Track all webhook communications with n8n
CREATE TABLE public.webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  webhook_url TEXT,
  payload JSONB,
  response_payload JSONB,
  status_code INTEGER,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Track customer consent for GDPR compliance
CREATE TABLE public.customer_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  consent_given BOOLEAN DEFAULT false,
  consent_date TIMESTAMPTZ,
  consent_method TEXT CHECK (consent_method IN ('explicit', 'opt-in', 'legitimate_interest', 'implied')),
  withdrawn_date TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Audit trail for data access (GDPR requirement)
CREATE TABLE public.data_access_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'edit', 'export', 'delete', 'anonymize')),
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Track data deletion requests (GDPR right to erasure)
CREATE TABLE public.data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed', 'rejected')),
  deletion_type TEXT DEFAULT 'full' CHECK (deletion_type IN ('full', 'anonymize')),
  reason TEXT,
  requested_at TIMESTAMPTZ DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  notes TEXT
);

-- Workspace-level data retention policies
CREATE TABLE public.data_retention_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  retention_days INTEGER NOT NULL DEFAULT 365,
  auto_delete_enabled BOOLEAN DEFAULT false,
  anonymize_instead_of_delete BOOLEAN DEFAULT true,
  exclude_vip_customers BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id)
);

-- Allowed IPs for webhook security
CREATE TABLE public.allowed_webhook_ips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ip_address TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowed_webhook_ips ENABLE ROW LEVEL SECURITY;

-- RLS Policies for webhook_logs
CREATE POLICY "Users can view workspace webhook logs"
  ON public.webhook_logs FOR SELECT
  USING (
    conversation_id IN (
      SELECT id FROM public.conversations 
      WHERE workspace_id = get_my_workspace_id()
    ) OR conversation_id IS NULL
  );

CREATE POLICY "System can insert webhook logs"
  ON public.webhook_logs FOR INSERT
  WITH CHECK (true);

-- RLS Policies for customer_consents
CREATE POLICY "Users can view workspace customer consents"
  ON public.customer_consents FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM public.customers 
      WHERE workspace_id = get_my_workspace_id()
    )
  );

CREATE POLICY "Users can manage workspace customer consents"
  ON public.customer_consents FOR ALL
  USING (
    customer_id IN (
      SELECT id FROM public.customers 
      WHERE workspace_id = get_my_workspace_id()
    )
  );

-- RLS Policies for data_access_logs
CREATE POLICY "Admins can view all access logs"
  ON public.data_access_logs FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "System can insert access logs"
  ON public.data_access_logs FOR INSERT
  WITH CHECK (true);

-- RLS Policies for data_deletion_requests
CREATE POLICY "Users can view workspace deletion requests"
  ON public.data_deletion_requests FOR SELECT
  USING (
    customer_id IN (
      SELECT id FROM public.customers 
      WHERE workspace_id = get_my_workspace_id()
    )
  );

CREATE POLICY "Users can create deletion requests"
  ON public.data_deletion_requests FOR INSERT
  WITH CHECK (
    customer_id IN (
      SELECT id FROM public.customers 
      WHERE workspace_id = get_my_workspace_id()
    )
  );

CREATE POLICY "Admins can update deletion requests"
  ON public.data_deletion_requests FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for data_retention_policies
CREATE POLICY "Users can view workspace retention policy"
  ON public.data_retention_policies FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage retention policies"
  ON public.data_retention_policies FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- RLS Policies for allowed_webhook_ips
CREATE POLICY "Users can view workspace allowed IPs"
  ON public.allowed_webhook_ips FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage allowed IPs"
  ON public.allowed_webhook_ips FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Indexes for performance
CREATE INDEX idx_webhook_logs_conversation ON public.webhook_logs(conversation_id);
CREATE INDEX idx_webhook_logs_created ON public.webhook_logs(created_at DESC);
CREATE INDEX idx_customer_consents_customer ON public.customer_consents(customer_id);
CREATE INDEX idx_data_access_logs_customer ON public.data_access_logs(customer_id);
CREATE INDEX idx_data_access_logs_created ON public.data_access_logs(created_at DESC);
CREATE INDEX idx_data_deletion_requests_status ON public.data_deletion_requests(status);
CREATE INDEX idx_data_deletion_requests_customer ON public.data_deletion_requests(customer_id);

-- Trigger for updated_at on customer_consents
CREATE TRIGGER update_customer_consents_updated_at
  BEFORE UPDATE ON public.customer_consents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for updated_at on data_retention_policies
CREATE TRIGGER update_data_retention_policies_updated_at
  BEFORE UPDATE ON public.data_retention_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();