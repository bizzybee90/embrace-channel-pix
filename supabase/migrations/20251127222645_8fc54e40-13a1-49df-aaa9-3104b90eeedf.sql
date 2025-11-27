-- =====================================================
-- Phase 2: Database Schema Upgrades
-- =====================================================

-- 2A. Upgrade customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_id text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS next_appointment date;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS frequency text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS schedule_code text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS balance numeric DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_updated timestamptz DEFAULT now();

-- Add unique constraint and indexes for customers
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_customer_id ON customers(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_next_appointment ON customers(next_appointment) WHERE next_appointment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);
CREATE INDEX IF NOT EXISTS idx_customers_embedding ON customers USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL;

-- 2B. Upgrade faq_database table
ALTER TABLE faq_database ADD COLUMN IF NOT EXISTS external_id bigint;
ALTER TABLE faq_database ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE faq_database ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
ALTER TABLE faq_database ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE faq_database ADD COLUMN IF NOT EXISTS is_mac_specific boolean DEFAULT false;
ALTER TABLE faq_database ADD COLUMN IF NOT EXISTS is_industry_standard boolean DEFAULT false;
ALTER TABLE faq_database ADD COLUMN IF NOT EXISTS source_company text;

-- Add unique constraint and indexes for faq_database
CREATE UNIQUE INDEX IF NOT EXISTS idx_faq_external_id ON faq_database(external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_faq_is_active ON faq_database(is_active);
CREATE INDEX IF NOT EXISTS idx_faq_enabled ON faq_database(enabled);
CREATE INDEX IF NOT EXISTS idx_faq_mac_specific ON faq_database(is_mac_specific);
CREATE INDEX IF NOT EXISTS idx_faq_industry_standard ON faq_database(is_industry_standard);
CREATE INDEX IF NOT EXISTS idx_faq_db_embedding ON faq_database USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100) WHERE embedding IS NOT NULL;

-- 2C. Upgrade price_list table
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS external_id integer;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS service_code text;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS property_type text;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS bedrooms text;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS price_typical numeric(8,2);
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS price_min numeric(8,2);
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS price_max numeric(8,2);
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS window_price_min numeric(8,2);
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS window_price_max numeric(8,2);
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS applies_to_properties text[];
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS rule_priority integer DEFAULT 0;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS customer_count integer DEFAULT 0;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS affects_package boolean DEFAULT false;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS per_unit boolean DEFAULT false;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;

-- Add unique constraint and indexes for price_list
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_list_external_id ON price_list(external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_list_service_code_unique ON price_list(service_code) WHERE service_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_list_category_idx ON price_list(category);
CREATE INDEX IF NOT EXISTS idx_price_list_property_bedrooms ON price_list(property_type, bedrooms);
CREATE INDEX IF NOT EXISTS idx_price_list_is_active ON price_list(is_active);
CREATE INDEX IF NOT EXISTS idx_price_list_rule_priority ON price_list(rule_priority DESC);

-- 2D. Upgrade business_facts table
ALTER TABLE business_facts ADD COLUMN IF NOT EXISTS external_id bigint;

-- Add unique constraint for business_facts
CREATE UNIQUE INDEX IF NOT EXISTS idx_business_facts_external_id ON business_facts(external_id) WHERE external_id IS NOT NULL;

-- 2E. Create sync_logs table
CREATE TABLE IF NOT EXISTS sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id),
  sync_type text NOT NULL,
  tables_synced text[] NOT NULL,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  status text DEFAULT 'running',
  records_fetched integer DEFAULT 0,
  records_inserted integer DEFAULT 0,
  records_updated integer DEFAULT 0,
  records_unchanged integer DEFAULT 0,
  error_message text,
  details jsonb DEFAULT '{}'
);

-- Add indexes for sync_logs
CREATE INDEX IF NOT EXISTS idx_sync_logs_workspace ON sync_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_started_at ON sync_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_logs_status ON sync_logs(status);

-- Enable RLS on sync_logs
ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- Create policies for sync_logs
CREATE POLICY "Users can view workspace sync logs"
  ON sync_logs FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "System can insert sync logs"
  ON sync_logs FOR INSERT
  WITH CHECK (true);