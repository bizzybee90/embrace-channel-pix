
-- ==================================================================
-- SECURITY HARDENING MIGRATION - Part 2 (RLS Policies)
-- ==================================================================

-- =========================
-- PART 3: Fix Permissive RLS Policies (with proper drops)
-- =========================

-- conversation_analytics - drop all existing policies first
DROP POLICY IF EXISTS "Service role can manage analytics" ON conversation_analytics;
DROP POLICY IF EXISTS "Service role has full access to analytics" ON conversation_analytics;
DROP POLICY IF EXISTS "Users can view analytics" ON conversation_analytics;
DROP POLICY IF EXISTS "Users can view their workspace analytics" ON conversation_analytics;
DROP POLICY IF EXISTS "Users can manage their workspace analytics" ON conversation_analytics;

CREATE POLICY "Users can view their workspace analytics"
ON conversation_analytics FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage their workspace analytics"
ON conversation_analytics FOR ALL
USING (workspace_id = get_my_workspace_id())
WITH CHECK (workspace_id = get_my_workspace_id());

-- conversation_pairs - drop all existing policies first
DROP POLICY IF EXISTS "Service role can manage conversation pairs" ON conversation_pairs;
DROP POLICY IF EXISTS "Users can view their workspace conversation pairs" ON conversation_pairs;
DROP POLICY IF EXISTS "Users can manage their workspace conversation pairs" ON conversation_pairs;

CREATE POLICY "Users can view their workspace conversation pairs"
ON conversation_pairs FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage their workspace conversation pairs"
ON conversation_pairs FOR ALL
USING (workspace_id = get_my_workspace_id())
WITH CHECK (workspace_id = get_my_workspace_id());

-- customer_insights - drop all existing policies first
DROP POLICY IF EXISTS "customer_insights_service_role" ON customer_insights;
DROP POLICY IF EXISTS "Users can view their workspace customer insights" ON customer_insights;
DROP POLICY IF EXISTS "Users can manage their workspace customer insights" ON customer_insights;

CREATE POLICY "Users can view their workspace customer insights"
ON customer_insights FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage their workspace customer insights"
ON customer_insights FOR ALL
USING (workspace_id = get_my_workspace_id())
WITH CHECK (workspace_id = get_my_workspace_id());

-- document_chunks - drop all existing policies first
DROP POLICY IF EXISTS "document_chunks_service_role" ON document_chunks;
DROP POLICY IF EXISTS "Users can view their workspace document chunks" ON document_chunks;
DROP POLICY IF EXISTS "Users can manage their workspace document chunks" ON document_chunks;

CREATE POLICY "Users can view their workspace document chunks"
ON document_chunks FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage their workspace document chunks"
ON document_chunks FOR ALL
USING (workspace_id = get_my_workspace_id())
WITH CHECK (workspace_id = get_my_workspace_id());

-- documents - drop all existing policies first
DROP POLICY IF EXISTS "documents_service_role" ON documents;
DROP POLICY IF EXISTS "Users can view their workspace documents" ON documents;
DROP POLICY IF EXISTS "Users can manage their workspace documents" ON documents;

CREATE POLICY "Users can view their workspace documents"
ON documents FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage their workspace documents"
ON documents FOR ALL
USING (workspace_id = get_my_workspace_id())
WITH CHECK (workspace_id = get_my_workspace_id());

-- =========================
-- PART 4: Add missing RLS policies for tenant isolation
-- =========================

-- gmail_channel_configs - drop all existing policies first
DROP POLICY IF EXISTS "Users can view their workspace gmail configs" ON gmail_channel_configs;
DROP POLICY IF EXISTS "Users can manage their workspace gmail configs" ON gmail_channel_configs;

CREATE POLICY "Users can view their workspace gmail configs"
ON gmail_channel_configs FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage their workspace gmail configs"
ON gmail_channel_configs FOR ALL
USING (workspace_id = get_my_workspace_id())
WITH CHECK (workspace_id = get_my_workspace_id());

-- security_incidents - sensitive table
DROP POLICY IF EXISTS "Users can view their workspace security incidents" ON security_incidents;
DROP POLICY IF EXISTS "Users can manage their workspace security incidents" ON security_incidents;

ALTER TABLE security_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their workspace security incidents"
ON security_incidents FOR SELECT
USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage their workspace security incidents"
ON security_incidents FOR ALL
USING (workspace_id = get_my_workspace_id())
WITH CHECK (workspace_id = get_my_workspace_id());

-- sync_logs
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their workspace sync logs" ON sync_logs;
CREATE POLICY "Users can view their workspace sync logs"
ON sync_logs FOR SELECT
USING (workspace_id = get_my_workspace_id());

-- system_logs
ALTER TABLE system_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their workspace system logs" ON system_logs;
CREATE POLICY "Users can view their workspace system logs"
ON system_logs FOR SELECT
USING (workspace_id = get_my_workspace_id());

-- =========================
-- PART 5: Make workspace_id NOT NULL on remaining tables
-- =========================

-- faq_database
DELETE FROM faq_database WHERE workspace_id IS NULL;
ALTER TABLE faq_database ALTER COLUMN workspace_id SET NOT NULL;

-- price_list
DELETE FROM price_list WHERE workspace_id IS NULL;
ALTER TABLE price_list ALTER COLUMN workspace_id SET NOT NULL;

-- response_feedback  
DELETE FROM response_feedback WHERE workspace_id IS NULL;
ALTER TABLE response_feedback ALTER COLUMN workspace_id SET NOT NULL;

-- ignored_emails
DELETE FROM ignored_emails WHERE workspace_id IS NULL;
ALTER TABLE ignored_emails ALTER COLUMN workspace_id SET NOT NULL;

-- few_shot_examples
DELETE FROM few_shot_examples WHERE workspace_id IS NULL;
ALTER TABLE few_shot_examples ALTER COLUMN workspace_id SET NOT NULL;

-- escalated_messages
DELETE FROM escalated_messages WHERE workspace_id IS NULL;
ALTER TABLE escalated_messages ALTER COLUMN workspace_id SET NOT NULL;

-- business_facts
DELETE FROM business_facts WHERE workspace_id IS NULL;
ALTER TABLE business_facts ALTER COLUMN workspace_id SET NOT NULL;

-- business_context
DELETE FROM business_context WHERE workspace_id IS NULL;
ALTER TABLE business_context ALTER COLUMN workspace_id SET NOT NULL;

-- api_usage
DELETE FROM api_usage WHERE workspace_id IS NULL;
ALTER TABLE api_usage ALTER COLUMN workspace_id SET NOT NULL;

-- automation_settings
DELETE FROM automation_settings WHERE workspace_id IS NULL;
ALTER TABLE automation_settings ALTER COLUMN workspace_id SET NOT NULL;

-- onboarding_progress
DELETE FROM onboarding_progress WHERE workspace_id IS NULL;
ALTER TABLE onboarding_progress ALTER COLUMN workspace_id SET NOT NULL;

-- notifications
DELETE FROM notifications WHERE workspace_id IS NULL;
ALTER TABLE notifications ALTER COLUMN workspace_id SET NOT NULL;

-- data_retention_policies
DELETE FROM data_retention_policies WHERE workspace_id IS NULL;
ALTER TABLE data_retention_policies ALTER COLUMN workspace_id SET NOT NULL;

-- workspace_channels
DELETE FROM workspace_channels WHERE workspace_id IS NULL;
ALTER TABLE workspace_channels ALTER COLUMN workspace_id SET NOT NULL;

-- system_prompts
DELETE FROM system_prompts WHERE workspace_id IS NULL;
ALTER TABLE system_prompts ALTER COLUMN workspace_id SET NOT NULL;

-- email_pairs
DELETE FROM email_pairs WHERE workspace_id IS NULL;
ALTER TABLE email_pairs ALTER COLUMN workspace_id SET NOT NULL;

-- allowed_webhook_ips
DELETE FROM allowed_webhook_ips WHERE workspace_id IS NULL;
ALTER TABLE allowed_webhook_ips ALTER COLUMN workspace_id SET NOT NULL;
