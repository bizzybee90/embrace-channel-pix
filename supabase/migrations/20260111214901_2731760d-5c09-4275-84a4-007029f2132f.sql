-- System logs table for error tracking
CREATE TABLE IF NOT EXISTS public.system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL DEFAULT 'info',
  function_name TEXT,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  stack_trace TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_system_logs_level ON public.system_logs(level, created_at DESC);
CREATE INDEX idx_system_logs_function ON public.system_logs(function_name, created_at DESC);
CREATE INDEX idx_system_logs_workspace ON public.system_logs(workspace_id, created_at DESC);

-- API usage tracking table
CREATE TABLE IF NOT EXISTS public.api_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  function_name TEXT,
  tokens_used INTEGER DEFAULT 0,
  requests INTEGER DEFAULT 1,
  cost_estimate DECIMAL(10,6) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_api_usage_provider ON public.api_usage(provider, created_at DESC);
CREATE INDEX idx_api_usage_workspace ON public.api_usage(workspace_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage ENABLE ROW LEVEL SECURITY;

-- RLS policies - allow authenticated users to read (admin check in app)
CREATE POLICY "Authenticated users can read system logs"
  ON public.system_logs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read api usage"
  ON public.api_usage FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to insert (from edge functions)
CREATE POLICY "Service role can insert system logs"
  ON public.system_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Service role can insert api usage"
  ON public.api_usage FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Aggregate view for dashboard
CREATE OR REPLACE VIEW public.api_usage_summary AS
SELECT 
  provider,
  DATE_TRUNC('hour', created_at) as hour,
  SUM(requests) as total_requests,
  SUM(tokens_used) as total_tokens,
  SUM(cost_estimate) as total_cost
FROM public.api_usage
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY provider, DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;