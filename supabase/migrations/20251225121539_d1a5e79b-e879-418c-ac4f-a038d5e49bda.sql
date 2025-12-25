
-- Phase 1: Database Schema Updates for Multi-Tenant GDPR Compliance

-- 1. Workspace GDPR settings (DPA, privacy policy, sub-processors)
CREATE TABLE IF NOT EXISTS public.workspace_gdpr_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  dpa_accepted_at timestamptz,
  dpa_accepted_by uuid REFERENCES public.users(id),
  dpa_version text DEFAULT 'v1.0',
  privacy_policy_url text,
  custom_privacy_policy text,
  company_legal_name text,
  company_address text,
  data_protection_officer_email text,
  sub_processors jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Security incidents / breach notification log
CREATE TABLE IF NOT EXISTS public.security_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  detected_at timestamptz DEFAULT now(),
  reported_at timestamptz,
  incident_type text NOT NULL,
  affected_records_count int DEFAULT 0,
  affected_customers jsonb DEFAULT '[]'::jsonb,
  description text,
  remediation_steps text,
  notification_sent_at timestamptz,
  resolved_at timestamptz,
  status text DEFAULT 'detected',
  severity text DEFAULT 'medium',
  reported_by uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 3. Workspace deletion requests (for business customers leaving)
CREATE TABLE IF NOT EXISTS public.workspace_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES public.users(id),
  requested_at timestamptz DEFAULT now(),
  scheduled_for timestamptz, -- 30 days from request
  confirmed_at timestamptz,
  completed_at timestamptz,
  status text DEFAULT 'pending',
  reason text,
  export_completed boolean DEFAULT false,
  export_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Add lawful basis and purpose to customer_consents
ALTER TABLE public.customer_consents 
ADD COLUMN IF NOT EXISTS lawful_basis text DEFAULT 'consent',
ADD COLUMN IF NOT EXISTS purpose text DEFAULT 'customer_service';

-- 5. Add rectification audit columns to data_access_logs
ALTER TABLE public.data_access_logs
ADD COLUMN IF NOT EXISTS previous_value jsonb,
ADD COLUMN IF NOT EXISTS new_value jsonb;

-- Phase 2: Enable RLS and Create Policies

-- workspace_gdpr_settings RLS
ALTER TABLE public.workspace_gdpr_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace GDPR settings"
ON public.workspace_gdpr_settings FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage workspace GDPR settings"
ON public.workspace_gdpr_settings FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role) AND workspace_id = get_my_workspace_id())
WITH CHECK (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role) AND workspace_id = get_my_workspace_id());

-- security_incidents RLS
ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view workspace security incidents"
ON public.security_incidents FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role) AND (workspace_id IS NULL OR workspace_id = get_my_workspace_id()));

CREATE POLICY "Admins can manage security incidents"
ON public.security_incidents FOR ALL TO authenticated
USING (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role));

-- workspace_deletion_requests RLS
ALTER TABLE public.workspace_deletion_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view workspace deletion requests"
ON public.workspace_deletion_requests FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role) AND workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can create workspace deletion requests"
ON public.workspace_deletion_requests FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role) AND workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can update workspace deletion requests"
ON public.workspace_deletion_requests FOR UPDATE TO authenticated
USING (auth.uid() IS NOT NULL AND has_role(auth.uid(), 'admin'::app_role) AND workspace_id = get_my_workspace_id());

-- Fix sender_behaviour_stats critical security issue (drop overly permissive policy)
DROP POLICY IF EXISTS "System can manage sender stats" ON public.sender_behaviour_stats;

-- Create proper workspace-scoped policies for sender_behaviour_stats
CREATE POLICY "Authenticated users can view workspace sender stats"
ON public.sender_behaviour_stats FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL AND workspace_id = get_my_workspace_id());

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_workspace_gdpr_settings_workspace 
ON public.workspace_gdpr_settings(workspace_id);

CREATE INDEX IF NOT EXISTS idx_security_incidents_workspace 
ON public.security_incidents(workspace_id);

CREATE INDEX IF NOT EXISTS idx_security_incidents_status 
ON public.security_incidents(status);

CREATE INDEX IF NOT EXISTS idx_workspace_deletion_requests_workspace 
ON public.workspace_deletion_requests(workspace_id);

CREATE INDEX IF NOT EXISTS idx_workspace_deletion_requests_status 
ON public.workspace_deletion_requests(status);

-- Triggers for updated_at
CREATE TRIGGER update_workspace_gdpr_settings_updated_at
BEFORE UPDATE ON public.workspace_gdpr_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_security_incidents_updated_at
BEFORE UPDATE ON public.security_incidents
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_workspace_deletion_requests_updated_at
BEFORE UPDATE ON public.workspace_deletion_requests
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
