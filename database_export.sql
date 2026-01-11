-- ============================================================================
-- BIZZYBEE DATABASE SCHEMA EXPORT
-- Generated: 2026-01-11
-- Total Tables: 64
-- Total RLS Policies: 148
-- ============================================================================

-- ============================================================================
-- EXTENSIONS (Enable these first in your new Supabase project)
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- CUSTOM TYPES (ENUMS)
-- ============================================================================
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'reviewer');
CREATE TYPE public.message_channel AS ENUM ('sms', 'whatsapp', 'email', 'phone', 'webchat');
CREATE TYPE public.message_status AS ENUM ('pending', 'in_progress', 'responded', 'escalated');

-- ============================================================================
-- TABLES
-- ============================================================================

-- Table: workspaces (core - must be created first due to FK dependencies)
CREATE TABLE public.workspaces (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  timezone text DEFAULT 'Europe/London',
  business_hours_start time WITHOUT TIME ZONE DEFAULT '09:00:00',
  business_hours_end time WITHOUT TIME ZONE DEFAULT '17:00:00',
  business_days integer[] DEFAULT '{1,2,3,4,5}',
  hiring_mode boolean DEFAULT false,
  business_type text,
  core_services text[],
  vip_domains text[],
  created_at timestamp with time zone DEFAULT now()
);

-- Table: users
CREATE TABLE public.users (
  id uuid NOT NULL PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  name text NOT NULL,
  email text NOT NULL,
  status text DEFAULT 'available',
  is_online boolean DEFAULT false,
  last_active_at timestamp with time zone,
  onboarding_completed boolean DEFAULT false,
  onboarding_step text DEFAULT 'welcome',
  interface_mode text DEFAULT 'focus',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: user_roles
CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Table: customers
CREATE TABLE public.customers (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  name text,
  email text,
  phone text,
  preferred_channel text,
  tier text DEFAULT 'regular',
  notes text,
  customer_id text,
  address text,
  frequency text,
  schedule_code text,
  status text DEFAULT 'active',
  payment_method text,
  next_appointment date,
  price numeric,
  balance numeric DEFAULT 0,
  custom_fields jsonb DEFAULT '{}',
  embedding vector,
  last_updated timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: conversations
CREATE TABLE public.conversations (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  customer_id uuid REFERENCES public.customers(id),
  external_conversation_id text,
  title text,
  summary_for_human text,
  channel text NOT NULL,
  category text DEFAULT 'other',
  priority text DEFAULT 'medium',
  status text DEFAULT 'new',
  ai_confidence numeric,
  ai_sentiment text,
  ai_reason_for_escalation text,
  ai_draft_response text,
  ai_resolution_summary text,
  final_response text,
  assigned_to uuid REFERENCES public.users(id),
  sla_target_minutes integer DEFAULT 240,
  sla_due_at timestamp with time zone,
  sla_status text DEFAULT 'safe',
  first_response_at timestamp with time zone,
  resolved_at timestamp with time zone,
  snoozed_until timestamp with time zone,
  is_escalated boolean DEFAULT false,
  escalated_at timestamp with time zone,
  message_count integer DEFAULT 0,
  ai_message_count integer DEFAULT 0,
  human_edited boolean DEFAULT false,
  auto_responded boolean DEFAULT false,
  auto_handled_at timestamp with time zone,
  confidence numeric,
  customer_satisfaction integer,
  csat_requested_at timestamp with time zone,
  csat_responded_at timestamp with time zone,
  led_to_booking boolean DEFAULT false,
  needs_embedding boolean,
  needs_review boolean DEFAULT false,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  review_outcome text,
  requires_reply boolean DEFAULT true,
  email_classification text,
  urgency text DEFAULT 'medium',
  urgency_reason text,
  extracted_entities jsonb DEFAULT '{}',
  suggested_actions text[] DEFAULT '{}',
  triage_reasoning text,
  triage_confidence numeric,
  thread_context jsonb DEFAULT '{}',
  decision_bucket text DEFAULT 'wait',
  why_this_needs_you text,
  cognitive_load text DEFAULT 'low',
  risk_level text DEFAULT 'none',
  conversation_type text DEFAULT 'ai_handled',
  mode text DEFAULT 'ai',
  lane text,
  batch_group text,
  source_id text,
  flags jsonb DEFAULT '{}',
  evidence jsonb,
  embedding vector,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: messages
CREATE TABLE public.messages (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_id uuid,
  actor_name text,
  direction text NOT NULL,
  channel text NOT NULL,
  body text NOT NULL,
  is_internal boolean DEFAULT false,
  external_id text,
  attachments jsonb DEFAULT '[]',
  raw_payload jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: templates
CREATE TABLE public.templates (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  name text NOT NULL,
  category text,
  body text NOT NULL,
  usage_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: sla_configs
CREATE TABLE public.sla_configs (
  id uuid NOT NULL DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  priority text NOT NULL,
  first_response_minutes integer NOT NULL,
  pause_outside_hours boolean DEFAULT true
);

-- Table: business_context
CREATE TABLE public.business_context (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid UNIQUE REFERENCES public.workspaces(id),
  company_name text,
  company_logo_url text,
  email_domain text,
  business_type text,
  website_url text,
  service_area text,
  automation_level text DEFAULT 'safe',
  is_hiring boolean DEFAULT false,
  active_stripe_case boolean DEFAULT false,
  active_insurance_claim boolean DEFAULT false,
  custom_flags jsonb DEFAULT '{}',
  knowledge_base_status text DEFAULT 'pending',
  knowledge_base_started_at timestamp with time zone,
  knowledge_base_completed_at timestamp with time zone,
  industry_faqs_copied integer DEFAULT 0,
  website_faqs_generated integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: business_profile
CREATE TABLE public.business_profile (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id),
  business_name text NOT NULL,
  industry text,
  tagline text,
  service_area text,
  services jsonb DEFAULT '[]',
  service_radius_miles integer,
  usps jsonb DEFAULT '[]',
  price_summary text,
  pricing_model text,
  phone text,
  email text,
  website text,
  address text,
  tone text,
  tone_description text,
  cancellation_policy text,
  guarantee text,
  payment_methods text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: business_facts
CREATE TABLE public.business_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  category text NOT NULL,
  fact_key text NOT NULL,
  fact_value text NOT NULL,
  external_id bigint,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: price_list
CREATE TABLE public.price_list (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  service_name text NOT NULL,
  description text,
  category text,
  base_price numeric,
  price_typical numeric,
  price_min numeric,
  price_max numeric,
  window_price_min numeric,
  window_price_max numeric,
  price_range text,
  currency text DEFAULT 'GBP',
  unit text,
  service_code text,
  property_type text,
  bedrooms text,
  applies_to_properties text[],
  rule_priority integer DEFAULT 0,
  customer_count integer DEFAULT 0,
  affects_package boolean DEFAULT false,
  per_unit boolean DEFAULT false,
  is_active boolean DEFAULT true,
  external_id integer,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: faqs
CREATE TABLE public.faqs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  question text NOT NULL,
  answer text NOT NULL,
  category text DEFAULT 'General',
  source text DEFAULT 'manual',
  embedding vector,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: faq_database
CREATE TABLE public.faq_database (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  category text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  keywords text[] DEFAULT '{}',
  source_company text,
  source_url text,
  source_business text,
  generation_source text DEFAULT 'manual',
  priority integer DEFAULT 0,
  is_active boolean DEFAULT true,
  enabled boolean DEFAULT true,
  is_own_content boolean DEFAULT false,
  is_industry_standard boolean DEFAULT false,
  archived boolean DEFAULT false,
  relevance_score double precision,
  original_faq_id uuid,
  refined_at timestamp with time zone,
  embedding vector,
  external_id bigint,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: industry_faq_templates
CREATE TABLE public.industry_faq_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  industry_type text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  tags text[],
  metadata jsonb DEFAULT '{}',
  is_active boolean DEFAULT true,
  embedding vector,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: email_provider_configs
CREATE TABLE public.email_provider_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  provider text NOT NULL,
  account_id text NOT NULL,
  email_address text NOT NULL,
  access_token text,
  access_token_encrypted bytea,
  refresh_token text,
  encryption_key_id text DEFAULT 'v1',
  token_expires_at timestamp with time zone,
  subscription_id text,
  subscription_expires_at timestamp with time zone,
  import_mode text DEFAULT 'new_only',
  automation_level text DEFAULT 'draft_only',
  aliases text[] DEFAULT '{}',
  sync_status text DEFAULT 'pending',
  sync_stage text DEFAULT 'pending',
  sync_progress integer DEFAULT 0,
  sync_total integer DEFAULT 0,
  sync_error text,
  sync_started_at timestamp with time zone,
  sync_completed_at timestamp with time zone,
  last_sync_at timestamp with time zone,
  inbound_emails_found integer DEFAULT 0,
  outbound_emails_found integer DEFAULT 0,
  inbound_total integer DEFAULT 0,
  outbound_total integer DEFAULT 0,
  threads_linked integer DEFAULT 0,
  active_job_id uuid,
  voice_profile_status text DEFAULT 'pending',
  connected_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: gmail_channel_configs
CREATE TABLE public.gmail_channel_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  email_address text NOT NULL,
  access_token text,
  access_token_encrypted bytea,
  refresh_token text,
  refresh_token_encrypted bytea,
  encryption_key_id text DEFAULT 'v1',
  token_expires_at timestamp with time zone,
  history_id text,
  watch_expiration timestamp with time zone,
  import_mode text DEFAULT 'new_only',
  last_sync_at timestamp with time zone,
  connected_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: email_settings
CREATE TABLE public.email_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  from_name text,
  reply_to_email text,
  signature_html text,
  logo_url text,
  company_name text,
  company_phone text,
  company_website text,
  company_address text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: raw_emails
CREATE TABLE public.raw_emails (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  external_id text NOT NULL,
  thread_id text,
  from_email text NOT NULL,
  from_name text,
  to_email text,
  to_name text,
  subject text,
  body_text text,
  body_html text,
  folder text,
  email_type text,
  lane text,
  received_at timestamp with time zone,
  has_attachments boolean DEFAULT false,
  status text DEFAULT 'pending',
  processed boolean DEFAULT false,
  processing_started_at timestamp with time zone,
  processing_completed_at timestamp with time zone,
  retry_count integer DEFAULT 0,
  error_message text,
  classification jsonb,
  confidence double precision,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: email_import_queue
CREATE TABLE public.email_import_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  config_id uuid NOT NULL REFERENCES public.email_provider_configs(id),
  job_id uuid,
  external_id text NOT NULL,
  thread_id text NOT NULL,
  direction text NOT NULL,
  from_email text,
  from_name text,
  to_emails text[],
  subject text,
  body text,
  body_html text,
  received_at timestamp with time zone,
  is_noise boolean DEFAULT false,
  noise_reason text,
  has_body boolean DEFAULT false,
  status text DEFAULT 'scanned',
  error_message text,
  fetched_at timestamp with time zone,
  processed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: email_import_progress
CREATE TABLE public.email_import_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id),
  run_id uuid DEFAULT gen_random_uuid(),
  current_phase text DEFAULT 'connecting',
  phase1_status text DEFAULT 'pending',
  phase2_status text DEFAULT 'pending',
  phase3_status text DEFAULT 'pending',
  current_import_folder text DEFAULT 'SENT',
  emails_received integer DEFAULT 0,
  emails_classified integer DEFAULT 0,
  emails_failed integer DEFAULT 0,
  conversations_found integer DEFAULT 0,
  conversations_with_replies integer DEFAULT 0,
  pairs_analyzed integer DEFAULT 0,
  sent_email_count integer DEFAULT 0,
  inbox_email_count integer DEFAULT 0,
  estimated_total_emails integer,
  estimated_minutes integer,
  voice_profile_complete boolean DEFAULT false,
  playbook_complete boolean DEFAULT false,
  sent_import_complete boolean DEFAULT false,
  inbox_import_complete boolean DEFAULT false,
  aurinko_next_page_token text,
  sent_next_page_token text,
  inbox_next_page_token text,
  resume_after timestamp with time zone,
  last_error text,
  paused_reason text,
  started_at timestamp with time zone,
  phase1_completed_at timestamp with time zone,
  phase2_completed_at timestamp with time zone,
  phase3_completed_at timestamp with time zone,
  estimated_completion_at timestamp with time zone,
  last_import_batch_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: email_import_jobs
CREATE TABLE public.email_import_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  config_id uuid NOT NULL REFERENCES public.email_provider_configs(id),
  status text NOT NULL DEFAULT 'queued',
  import_mode text DEFAULT 'last_1000',
  inbox_emails_scanned integer DEFAULT 0,
  sent_emails_scanned integer DEFAULT 0,
  total_threads_found integer DEFAULT 0,
  conversation_threads integer DEFAULT 0,
  bodies_fetched integer DEFAULT 0,
  bodies_skipped integer DEFAULT 0,
  messages_created integer DEFAULT 0,
  checkpoint jsonb DEFAULT '{}',
  heartbeat_at timestamp with time zone DEFAULT now(),
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  error_message text,
  error_details jsonb,
  retry_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: email_sync_jobs
CREATE TABLE public.email_sync_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  config_id uuid NOT NULL REFERENCES public.email_provider_configs(id),
  status text NOT NULL DEFAULT 'queued',
  import_mode text NOT NULL,
  inbound_processed integer DEFAULT 0,
  sent_processed integer DEFAULT 0,
  threads_linked integer DEFAULT 0,
  inbound_cursor text,
  sent_cursor text,
  error_message text,
  last_batch_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: email_thread_analysis
CREATE TABLE public.email_thread_analysis (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  job_id uuid,
  thread_id text NOT NULL,
  inbound_count integer DEFAULT 0,
  outbound_count integer DEFAULT 0,
  total_count integer DEFAULT 0,
  is_conversation boolean DEFAULT false,
  is_noise_thread boolean DEFAULT false,
  needs_body_fetch boolean DEFAULT false,
  bodies_fetched boolean DEFAULT false,
  conversation_created boolean DEFAULT false,
  conversation_id uuid,
  first_inbound_id text,
  first_outbound_id text,
  latest_inbound_id text,
  latest_outbound_id text,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: email_fetch_retries
CREATE TABLE public.email_fetch_retries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  job_id uuid,
  external_id text NOT NULL,
  attempt_count integer DEFAULT 1,
  max_attempts integer DEFAULT 3,
  last_status_code integer,
  last_error text,
  next_retry_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: email_pairs
CREATE TABLE public.email_pairs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  conversation_id uuid REFERENCES public.conversations(id),
  inbound_message_id uuid REFERENCES public.messages(id),
  inbound_received_at timestamp with time zone,
  outbound_message_id uuid REFERENCES public.messages(id),
  outbound_sent_at timestamp with time zone,
  response_time_minutes integer,
  response_word_count integer,
  response_has_question boolean DEFAULT false,
  response_has_price boolean DEFAULT false,
  response_has_cta boolean DEFAULT false,
  led_to_booking boolean,
  led_to_reply boolean,
  quality_score double precision,
  inbound_from text,
  inbound_subject text,
  inbound_body text,
  outbound_body text,
  category text,
  subcategory text,
  sentiment_inbound text,
  sentiment_outbound text,
  embedding vector,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: conversation_pairs
CREATE TABLE public.conversation_pairs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  conversation_id uuid REFERENCES public.conversations(id),
  inbound_message_id uuid NOT NULL REFERENCES public.messages(id),
  outbound_message_id uuid NOT NULL REFERENCES public.messages(id),
  inbound_type text,
  inbound_body text,
  outbound_body text,
  reply_time_hours double precision,
  reply_length integer,
  received_at timestamp with time zone,
  analyzed_in_phase3 boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: voice_profiles
CREATE TABLE public.voice_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid UNIQUE REFERENCES public.workspaces(id),
  tone text,
  greeting_style text,
  signoff_style text,
  greeting_patterns jsonb DEFAULT '[]',
  signoff_patterns jsonb DEFAULT '[]',
  common_phrases jsonb DEFAULT '[]',
  sample_responses jsonb DEFAULT '[]',
  formality_score integer DEFAULT 50,
  warmth_level integer DEFAULT 5,
  directness_level integer DEFAULT 5,
  avg_response_length integer DEFAULT 0,
  avg_sentences integer DEFAULT 3,
  avg_words_per_sentence double precision DEFAULT 12,
  average_length integer,
  uses_emojis boolean DEFAULT false,
  uses_exclamations boolean DEFAULT false,
  exclamation_frequency double precision DEFAULT 0.1,
  emoji_frequency text DEFAULT 'never',
  avoided_words text[] DEFAULT '{}',
  price_mention_style text DEFAULT 'direct',
  booking_confirmation_style text,
  objection_handling_style text,
  response_patterns jsonb DEFAULT '{}',
  ignore_patterns jsonb DEFAULT '{}',
  reply_triggers jsonb DEFAULT '{}',
  personality_traits jsonb,
  example_responses jsonb,
  examples jsonb,
  examples_count integer DEFAULT 0,
  learnings text[] DEFAULT '{}',
  tone_descriptors text[] DEFAULT '{}',
  emails_analyzed integer DEFAULT 0,
  outbound_emails_found integer DEFAULT 0,
  total_pairs_analyzed integer DEFAULT 0,
  response_rate_percent double precision,
  avg_response_time_minutes integer,
  style_confidence double precision DEFAULT 0,
  analysis_status text DEFAULT 'pending',
  last_analyzed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: sender_rules
CREATE TABLE public.sender_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  sender_pattern text NOT NULL,
  default_classification text NOT NULL,
  default_lane text,
  default_requires_reply boolean DEFAULT false,
  override_classification text,
  override_keywords text[],
  override_requires_reply boolean,
  confidence_adjustment double precision DEFAULT 0,
  automation_level text DEFAULT 'auto',
  tone_preference text DEFAULT 'keep_current',
  skip_llm boolean DEFAULT false,
  is_active boolean DEFAULT true,
  hit_count integer DEFAULT 0,
  created_from_correction uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: sender_behaviour_stats
CREATE TABLE public.sender_behaviour_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  sender_email text NOT NULL,
  sender_domain text,
  total_messages integer DEFAULT 0,
  replied_count integer DEFAULT 0,
  ignored_count integer DEFAULT 0,
  reply_rate numeric,
  ignored_rate numeric,
  avg_response_time_minutes numeric,
  vip_score numeric DEFAULT 0,
  last_interaction_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: triage_corrections
CREATE TABLE public.triage_corrections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  conversation_id uuid REFERENCES public.conversations(id),
  original_classification text,
  new_classification text,
  original_requires_reply boolean,
  new_requires_reply boolean,
  sender_email text,
  sender_domain text,
  subject_keywords text[],
  corrected_by uuid REFERENCES public.users(id),
  corrected_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now()
);

-- Table: correction_examples
CREATE TABLE public.correction_examples (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  conversation_id uuid REFERENCES public.conversations(id),
  original_draft text NOT NULL,
  edited_draft text NOT NULL,
  analysis text,
  learnings jsonb DEFAULT '[]',
  created_at timestamp with time zone DEFAULT now()
);

-- Table: draft_edits
CREATE TABLE public.draft_edits (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  conversation_id uuid REFERENCES public.conversations(id),
  original_draft text NOT NULL,
  edited_draft text NOT NULL,
  edit_type text DEFAULT 'manual',
  edit_distance double precision DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: learned_responses
CREATE TABLE public.learned_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  email_category text,
  trigger_phrases text[] DEFAULT '{}',
  response_pattern text,
  example_response text,
  success_indicators jsonb DEFAULT '{}',
  times_used integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: few_shot_examples
CREATE TABLE public.few_shot_examples (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  email_pair_id uuid REFERENCES public.email_pairs(id),
  category text NOT NULL,
  inbound_text text,
  outbound_text text,
  selection_reason text,
  quality_score double precision,
  rank_in_category integer,
  embedding vector,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: response_playbook
CREATE TABLE public.response_playbook (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id),
  playbook jsonb NOT NULL,
  decision_patterns jsonb,
  timing_patterns jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: response_feedback
CREATE TABLE public.response_feedback (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  message_id uuid REFERENCES public.messages(id),
  conversation_id uuid REFERENCES public.conversations(id),
  ai_draft text,
  final_response text,
  scenario_type text,
  ai_confidence double precision,
  was_edited boolean DEFAULT false,
  edit_distance double precision,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: ignored_emails
CREATE TABLE public.ignored_emails (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  inbound_message_id uuid REFERENCES public.messages(id),
  from_domain text,
  subject_pattern text,
  ignore_reason text,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: inbox_insights
CREATE TABLE public.inbox_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  total_emails_analyzed integer DEFAULT 0,
  total_outbound_analyzed integer DEFAULT 0,
  emails_by_category jsonb DEFAULT '{}',
  emails_by_sender_domain jsonb DEFAULT '{}',
  common_inquiry_types jsonb DEFAULT '[]',
  avg_response_time_hours numeric,
  response_rate_percent numeric,
  peak_email_hours jsonb DEFAULT '[]',
  patterns_learned integer DEFAULT 0,
  learning_phases_completed jsonb DEFAULT '{}',
  analyzed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: conversation_analytics
CREATE TABLE public.conversation_analytics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  total_conversations integer DEFAULT 0,
  conversations_with_replies integer DEFAULT 0,
  total_pairs integer DEFAULT 0,
  avg_reply_time_hours double precision,
  reply_rate double precision,
  avg_reply_length double precision,
  by_type jsonb,
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: escalated_messages
CREATE TABLE public.escalated_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  channel message_channel NOT NULL,
  customer_name text,
  customer_identifier text NOT NULL,
  message_content text NOT NULL,
  priority text DEFAULT 'medium',
  conversation_context jsonb,
  status message_status DEFAULT 'pending',
  n8n_workflow_id text,
  metadata jsonb,
  escalated_at timestamp with time zone DEFAULT now(),
  responded_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: message_responses
CREATE TABLE public.message_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES public.escalated_messages(id),
  response_content text NOT NULL,
  agent_id uuid REFERENCES public.users(id),
  sent_to_n8n boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: notifications
CREATE TABLE public.notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  user_id uuid REFERENCES public.users(id),
  type text NOT NULL DEFAULT 'ai_summary',
  title text NOT NULL,
  body text NOT NULL,
  is_read boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now()
);

-- Table: notification_preferences
CREATE TABLE public.notification_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid UNIQUE REFERENCES public.workspaces(id),
  summary_enabled boolean DEFAULT true,
  summary_times time[] DEFAULT ARRAY['08:00:00'::time, '12:00:00'::time, '18:00:00'::time],
  summary_channels text[] DEFAULT ARRAY['in_app'],
  summary_email text,
  summary_phone text,
  timezone text DEFAULT 'Europe/London',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: system_prompts
CREATE TABLE public.system_prompts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  name text NOT NULL,
  agent_type text NOT NULL,
  prompt text NOT NULL,
  model text DEFAULT 'claude-sonnet-4-20250514',
  is_default boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: workspace_channels
CREATE TABLE public.workspace_channels (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  channel text NOT NULL,
  enabled boolean DEFAULT false,
  automation_level text DEFAULT 'draft_only',
  config jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: allowed_webhook_ips
CREATE TABLE public.allowed_webhook_ips (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  ip_address text NOT NULL,
  description text,
  enabled boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: webhook_logs
CREATE TABLE public.webhook_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid REFERENCES public.conversations(id),
  direction text NOT NULL,
  webhook_url text,
  payload jsonb,
  response_payload jsonb,
  status_code integer,
  error_message text,
  retry_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: sync_logs
CREATE TABLE public.sync_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  sync_type text NOT NULL,
  tables_synced text[] NOT NULL,
  status text DEFAULT 'running',
  records_fetched integer DEFAULT 0,
  records_inserted integer DEFAULT 0,
  records_updated integer DEFAULT 0,
  records_unchanged integer DEFAULT 0,
  error_message text,
  details jsonb DEFAULT '{}',
  started_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone
);

-- Table: import_progress
CREATE TABLE public.import_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  status text NOT NULL DEFAULT 'idle',
  current_step text,
  total_emails integer DEFAULT 0,
  processed_emails integer DEFAULT 0,
  error text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Table: make_progress
CREATE TABLE public.make_progress (
  workspace_id uuid NOT NULL PRIMARY KEY REFERENCES public.workspaces(id),
  status text DEFAULT 'idle',
  emails_imported integer DEFAULT 0,
  emails_classified integer DEFAULT 0,
  emails_total integer DEFAULT 0,
  voice_profile_complete boolean DEFAULT false,
  error_message text,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: onboarding_progress
CREATE TABLE public.onboarding_progress (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid UNIQUE REFERENCES public.workspaces(id),
  email_import_status text DEFAULT 'pending',
  email_import_progress integer DEFAULT 0,
  email_import_count integer DEFAULT 0,
  thread_matching_status text DEFAULT 'pending',
  thread_matching_progress integer DEFAULT 0,
  pairs_matched integer DEFAULT 0,
  categorization_status text DEFAULT 'pending',
  categorization_progress integer DEFAULT 0,
  pairs_categorized integer DEFAULT 0,
  style_analysis_status text DEFAULT 'pending',
  few_shot_status text DEFAULT 'pending',
  response_rate_percent double precision,
  avg_response_time_hours double precision,
  top_categories jsonb DEFAULT '[]',
  ignored_email_count integer DEFAULT 0,
  started_at timestamp with time zone,
  estimated_completion_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: competitor_research_jobs
CREATE TABLE public.competitor_research_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  niche_query text NOT NULL,
  industry text,
  location text,
  service_area text,
  radius_miles integer DEFAULT 20,
  target_count integer DEFAULT 100,
  status text NOT NULL DEFAULT 'queued',
  search_queries jsonb DEFAULT '[]',
  exclude_domains text[] DEFAULT ARRAY['yell.com', 'checkatrade.com', 'bark.com', 'trustpilot.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'maps.google.com', 'yelp.com', 'gumtree.com', 'freeindex.co.uk', 'cylex-uk.co.uk', 'hotfrog.co.uk', 'thebestof.co.uk'],
  sites_discovered integer DEFAULT 0,
  sites_validated integer DEFAULT 0,
  sites_approved integer DEFAULT 0,
  sites_scraped integer DEFAULT 0,
  pages_scraped integer DEFAULT 0,
  faqs_extracted integer DEFAULT 0,
  faqs_after_dedup integer DEFAULT 0,
  faqs_refined integer DEFAULT 0,
  faqs_embedded integer DEFAULT 0,
  faqs_generated integer DEFAULT 0,
  faqs_added integer DEFAULT 0,
  current_scraping_domain text,
  error_message text,
  checkpoint jsonb DEFAULT '{}',
  heartbeat_at timestamp with time zone DEFAULT now(),
  retry_count integer DEFAULT 0,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: competitor_sites
CREATE TABLE public.competitor_sites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.competitor_research_jobs(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  domain text NOT NULL,
  url text NOT NULL,
  title text,
  description text,
  business_name text,
  address text,
  city text,
  postcode text,
  phone text,
  place_id text,
  rating double precision,
  review_count integer,
  latitude double precision,
  longitude double precision,
  distance_miles double precision,
  is_directory boolean DEFAULT false,
  is_valid boolean,
  status text NOT NULL DEFAULT 'discovered',
  rejection_reason text,
  validation_reason text,
  domain_type text,
  discovery_source text DEFAULT 'google_places',
  discovery_query text,
  scrape_status text DEFAULT 'pending',
  scrape_error text,
  pages_scraped integer DEFAULT 0,
  faqs_generated integer DEFAULT 0,
  total_words integer DEFAULT 0,
  has_faq_page boolean DEFAULT false,
  has_pricing_page boolean DEFAULT false,
  content_extracted text,
  discovered_at timestamp with time zone DEFAULT now(),
  scraped_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(workspace_id, url)
);

-- Table: competitor_pages
CREATE TABLE public.competitor_pages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  site_id uuid NOT NULL REFERENCES public.competitor_sites(id),
  url text NOT NULL,
  page_type text,
  title text,
  content text,
  word_count integer DEFAULT 0,
  faqs_extracted boolean DEFAULT false,
  faq_count integer DEFAULT 0,
  scraped_at timestamp with time zone DEFAULT now(),
  UNIQUE(workspace_id, url)
);

-- Table: competitor_faqs_raw
CREATE TABLE public.competitor_faqs_raw (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  job_id uuid REFERENCES public.competitor_research_jobs(id),
  site_id uuid REFERENCES public.competitor_sites(id),
  page_id uuid REFERENCES public.competitor_pages(id),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  source_url text,
  source_business text,
  is_duplicate boolean DEFAULT false,
  duplicate_of uuid REFERENCES public.competitor_faqs_raw(id),
  similarity_score double precision,
  is_refined boolean DEFAULT false,
  refined_faq_id uuid REFERENCES public.faq_database(id),
  embedding vector,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: competitor_faq_candidates
CREATE TABLE public.competitor_faq_candidates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.competitor_research_jobs(id),
  site_id uuid REFERENCES public.competitor_sites(id),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  question text NOT NULL,
  answer text NOT NULL,
  category text,
  source_domain text,
  status text NOT NULL DEFAULT 'pending',
  merged_into_faq_id uuid REFERENCES public.faq_database(id),
  created_at timestamp with time zone DEFAULT now()
);

-- Table: customer_consents
CREATE TABLE public.customer_consents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  channel text NOT NULL,
  purpose text DEFAULT 'customer_service',
  lawful_basis text DEFAULT 'consent',
  consent_given boolean DEFAULT false,
  consent_date timestamp with time zone,
  consent_method text,
  withdrawn_date timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: data_access_logs
CREATE TABLE public.data_access_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id),
  customer_id uuid REFERENCES public.customers(id),
  conversation_id uuid REFERENCES public.conversations(id),
  action text NOT NULL,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb,
  ip_address text,
  user_agent text,
  created_at timestamp with time zone DEFAULT now()
);

-- Table: data_deletion_requests
CREATE TABLE public.data_deletion_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id uuid REFERENCES public.customers(id),
  requested_by uuid REFERENCES public.users(id),
  deletion_type text DEFAULT 'full',
  reason text,
  notes text,
  status text DEFAULT 'pending',
  requested_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone,
  completed_at timestamp with time zone
);

-- Table: data_retention_policies
CREATE TABLE public.data_retention_policies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid UNIQUE REFERENCES public.workspaces(id),
  retention_days integer NOT NULL DEFAULT 365,
  auto_delete_enabled boolean DEFAULT false,
  anonymize_instead_of_delete boolean DEFAULT true,
  exclude_vip_customers boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: security_incidents
CREATE TABLE public.security_incidents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES public.workspaces(id),
  incident_type text NOT NULL,
  description text,
  severity text DEFAULT 'medium',
  status text DEFAULT 'detected',
  affected_records_count integer DEFAULT 0,
  affected_customers jsonb DEFAULT '[]',
  remediation_steps text,
  reported_by uuid REFERENCES public.users(id),
  detected_at timestamp with time zone DEFAULT now(),
  reported_at timestamp with time zone,
  notification_sent_at timestamp with time zone,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: workspace_gdpr_settings
CREATE TABLE public.workspace_gdpr_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id),
  company_legal_name text,
  company_address text,
  data_protection_officer_email text,
  privacy_policy_url text,
  custom_privacy_policy text,
  dpa_version text DEFAULT 'v1.0',
  dpa_accepted_at timestamp with time zone,
  dpa_accepted_by uuid REFERENCES public.users(id),
  sub_processors jsonb DEFAULT '[]',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Table: workspace_deletion_requests
CREATE TABLE public.workspace_deletion_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
  requested_by uuid NOT NULL REFERENCES public.users(id),
  reason text,
  status text DEFAULT 'pending',
  export_completed boolean DEFAULT false,
  export_url text,
  requested_at timestamp with time zone DEFAULT now(),
  scheduled_for timestamp with time zone,
  confirmed_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Business facts indexes
CREATE INDEX idx_business_facts_workspace_id ON public.business_facts(workspace_id);
CREATE INDEX idx_business_facts_category ON public.business_facts(category);
CREATE UNIQUE INDEX idx_business_facts_external_id ON public.business_facts(external_id) WHERE external_id IS NOT NULL;

-- Competitor research indexes
CREATE INDEX idx_competitor_research_jobs_workspace ON public.competitor_research_jobs(workspace_id);
CREATE INDEX idx_competitor_research_jobs_status ON public.competitor_research_jobs(status);
CREATE INDEX idx_competitor_sites_workspace ON public.competitor_sites(workspace_id);
CREATE INDEX idx_competitor_pages_workspace ON public.competitor_pages(workspace_id);
CREATE INDEX idx_competitor_pages_site ON public.competitor_pages(site_id);
CREATE INDEX idx_competitor_pages_type ON public.competitor_pages(page_type);
CREATE INDEX idx_competitor_faq_candidates_job ON public.competitor_faq_candidates(job_id);
CREATE INDEX idx_raw_faqs_workspace ON public.competitor_faqs_raw(workspace_id);
CREATE INDEX idx_raw_faqs_job ON public.competitor_faqs_raw(job_id);
CREATE INDEX idx_raw_faqs_duplicate ON public.competitor_faqs_raw(is_duplicate) WHERE is_duplicate = false;
CREATE INDEX idx_raw_faqs_refined ON public.competitor_faqs_raw(is_refined) WHERE is_refined = false;
CREATE INDEX idx_raw_faqs_embedding ON public.competitor_faqs_raw(embedding) WHERE embedding IS NOT NULL;

-- Conversations and messages indexes
CREATE INDEX idx_conversations_workspace ON public.conversations(workspace_id);
CREATE INDEX idx_conversations_customer ON public.conversations(customer_id);
CREATE INDEX idx_conversations_status ON public.conversations(status);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id);
CREATE INDEX idx_messages_created_at ON public.messages(created_at);

-- Email import indexes
CREATE INDEX idx_email_import_queue_workspace ON public.email_import_queue(workspace_id);
CREATE INDEX idx_email_import_queue_job ON public.email_import_queue(job_id);
CREATE INDEX idx_email_import_queue_thread ON public.email_import_queue(thread_id);
CREATE INDEX idx_email_thread_analysis_job ON public.email_thread_analysis(job_id);
CREATE INDEX idx_email_thread_analysis_workspace ON public.email_thread_analysis(workspace_id);

-- ============================================================================
-- DATABASE FUNCTIONS
-- ============================================================================

-- Function: get_my_workspace_id
CREATE OR REPLACE FUNCTION public.get_my_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT workspace_id 
  FROM public.users 
  WHERE id = auth.uid()
  LIMIT 1
$$;

-- Function: user_has_workspace_access
CREATE OR REPLACE FUNCTION public.user_has_workspace_access(_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND workspace_id = _workspace_id
  )
$$;

-- Function: has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
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

-- Function: handle_new_user (trigger function)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
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

-- Function: update_updated_at_column (trigger function)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Function: encrypt_token
CREATE OR REPLACE FUNCTION public.encrypt_token(token text, secret text)
RETURNS bytea
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF token IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_encrypt(token, secret);
END;
$$;

-- Function: decrypt_token
CREATE OR REPLACE FUNCTION public.decrypt_token(encrypted_token bytea, secret text)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF encrypted_token IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_decrypt(encrypted_token, secret);
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

-- Function: increment_emails_received
CREATE OR REPLACE FUNCTION public.increment_emails_received(p_workspace_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO email_import_progress (workspace_id, emails_received, current_phase, started_at)
  VALUES (p_workspace_id, 1, 'importing', NOW())
  ON CONFLICT (workspace_id) 
  DO UPDATE SET 
    emails_received = email_import_progress.emails_received + 1,
    current_phase = CASE 
      WHEN email_import_progress.current_phase = 'connecting' THEN 'importing'
      ELSE email_import_progress.current_phase
    END,
    started_at = COALESCE(email_import_progress.started_at, NOW()),
    updated_at = NOW();
END;
$$;

-- Function: mark_noise_emails
CREATE OR REPLACE FUNCTION public.mark_noise_emails(p_workspace_id uuid, p_job_id uuid)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_marked INT;
BEGIN
  UPDATE email_import_queue SET
    is_noise = TRUE,
    noise_reason = CASE
      WHEN from_email LIKE '%noreply%' THEN 'noreply'
      WHEN from_email LIKE '%no-reply%' THEN 'noreply'
      WHEN from_email LIKE '%@stripe.com' THEN 'payment_notification'
      WHEN from_email LIKE '%@paypal.com' THEN 'payment_notification'
      WHEN from_email LIKE '%@indeed.com' THEN 'job_board'
      WHEN from_email LIKE '%@linkedin.com' THEN 'job_board'
      WHEN from_email LIKE '%@facebook.com' THEN 'social_notification'
      WHEN from_email LIKE '%@twitter.com' THEN 'social_notification'
      WHEN from_email LIKE '%@mailchimp.com' THEN 'newsletter'
      WHEN from_email LIKE '%newsletter%' THEN 'newsletter'
      WHEN from_email LIKE 'mailer-daemon%' THEN 'system'
      ELSE 'other_noise'
    END,
    status = 'skipped'
  WHERE workspace_id = p_workspace_id
    AND job_id = p_job_id
    AND is_noise = FALSE
    AND (
      from_email LIKE '%noreply%' OR from_email LIKE '%no-reply%'
      OR from_email LIKE '%@stripe.com' OR from_email LIKE '%@paypal.com'
      OR from_email LIKE '%@indeed.com' OR from_email LIKE '%@linkedin.com'
      OR from_email LIKE '%@facebook.com' OR from_email LIKE '%@twitter.com'
      OR from_email LIKE '%@mailchimp.com' OR from_email LIKE '%newsletter%'
      OR from_email LIKE 'mailer-daemon%'
    );
  GET DIAGNOSTICS v_marked = ROW_COUNT;
  RETURN v_marked;
END;
$$;

-- Function: analyze_email_threads
CREATE OR REPLACE FUNCTION public.analyze_email_threads(p_workspace_id uuid, p_job_id uuid)
RETURNS TABLE(threads_analyzed int, conversation_threads int, noise_threads int)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_threads_analyzed INT;
  v_conversation_threads INT;
  v_noise_threads INT;
BEGIN
  DELETE FROM email_thread_analysis WHERE job_id = p_job_id;
  
  INSERT INTO email_thread_analysis (
    workspace_id, job_id, thread_id, inbound_count, outbound_count, total_count,
    is_conversation, is_noise_thread, first_inbound_id, first_outbound_id,
    latest_inbound_id, latest_outbound_id, needs_body_fetch
  )
  SELECT 
    p_workspace_id, p_job_id, eq.thread_id,
    COUNT(*) FILTER (WHERE eq.direction = 'inbound'),
    COUNT(*) FILTER (WHERE eq.direction = 'outbound'),
    COUNT(*),
    (COUNT(*) FILTER (WHERE eq.direction = 'inbound') > 0 
     AND COUNT(*) FILTER (WHERE eq.direction = 'outbound') > 0),
    (COUNT(*) FILTER (WHERE eq.is_noise = FALSE) = 0),
    MIN(eq.external_id) FILTER (WHERE eq.direction = 'inbound'),
    MIN(eq.external_id) FILTER (WHERE eq.direction = 'outbound'),
    MAX(eq.external_id) FILTER (WHERE eq.direction = 'inbound'),
    MAX(eq.external_id) FILTER (WHERE eq.direction = 'outbound'),
    (COUNT(*) FILTER (WHERE eq.direction = 'inbound') > 0 
     AND COUNT(*) FILTER (WHERE eq.direction = 'outbound') > 0
     AND COUNT(*) FILTER (WHERE eq.is_noise = FALSE) > 0)
  FROM email_import_queue eq
  WHERE eq.workspace_id = p_workspace_id AND eq.job_id = p_job_id
  GROUP BY eq.thread_id;
  
  SELECT COUNT(*) INTO v_threads_analyzed FROM email_thread_analysis WHERE job_id = p_job_id;
  SELECT COUNT(*) INTO v_conversation_threads FROM email_thread_analysis WHERE job_id = p_job_id AND is_conversation = TRUE;
  SELECT COUNT(*) INTO v_noise_threads FROM email_thread_analysis WHERE job_id = p_job_id AND is_noise_thread = TRUE;
  
  UPDATE email_import_jobs SET
    total_threads_found = v_threads_analyzed,
    conversation_threads = v_conversation_threads,
    updated_at = NOW()
  WHERE id = p_job_id;
  
  RETURN QUERY SELECT v_threads_analyzed, v_conversation_threads, v_noise_threads;
END;
$$;

-- Function: find_duplicate_faqs
CREATE OR REPLACE FUNCTION public.find_duplicate_faqs(
  p_workspace_id uuid, 
  p_job_id uuid, 
  p_similarity_threshold double precision DEFAULT 0.95
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_duplicates_found INT := 0;
  v_faq RECORD;
  v_match RECORD;
BEGIN
  FOR v_faq IN 
    SELECT id, embedding, created_at
    FROM competitor_faqs_raw 
    WHERE workspace_id = p_workspace_id 
      AND job_id = p_job_id
      AND is_duplicate = FALSE
      AND embedding IS NOT NULL
    ORDER BY created_at ASC
  LOOP
    SELECT id, 1 - (embedding <=> v_faq.embedding) as similarity
    INTO v_match
    FROM competitor_faqs_raw
    WHERE workspace_id = p_workspace_id
      AND job_id = p_job_id
      AND id != v_faq.id
      AND created_at < v_faq.created_at
      AND is_duplicate = FALSE
      AND embedding IS NOT NULL
      AND 1 - (embedding <=> v_faq.embedding) > p_similarity_threshold
    ORDER BY similarity DESC
    LIMIT 1;
    
    IF v_match.id IS NOT NULL THEN
      UPDATE competitor_faqs_raw SET
        is_duplicate = TRUE,
        duplicate_of = v_match.id,
        similarity_score = v_match.similarity
      WHERE id = v_faq.id;
      
      v_duplicates_found := v_duplicates_found + 1;
    END IF;
  END LOOP;
  
  RETURN v_duplicates_found;
END;
$$;

-- Function: match_faqs_with_priority
CREATE OR REPLACE FUNCTION public.match_faqs_with_priority(
  query_embedding vector,
  p_workspace_id uuid,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  question text,
  answer text,
  category text,
  is_own_content boolean,
  priority integer,
  similarity double precision
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id,
    f.question,
    f.answer,
    f.category,
    COALESCE(f.is_own_content, false) as is_own_content,
    COALESCE(f.priority, 5) as priority,
    1 - (f.embedding <=> query_embedding) as similarity
  FROM public.faq_database f
  WHERE f.workspace_id = p_workspace_id
    AND f.embedding IS NOT NULL
    AND f.is_active = true
    AND 1 - (f.embedding <=> query_embedding) > match_threshold
  ORDER BY 
    COALESCE(f.is_own_content, false) DESC,
    COALESCE(f.priority, 5) DESC,
    (f.embedding <=> query_embedding) ASC
  LIMIT match_count;
END;
$$;

-- Function: search_faqs_with_priority
CREATE OR REPLACE FUNCTION public.search_faqs_with_priority(
  p_workspace_id uuid,
  p_embedding vector,
  p_match_threshold double precision DEFAULT 0.7,
  p_match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  question text,
  answer text,
  category text,
  priority integer,
  similarity double precision
)
LANGUAGE sql
SET search_path = public
AS $$
  SELECT 
    f.id,
    f.question,
    f.answer,
    f.category,
    COALESCE(f.priority, 5) as priority,
    1 - (f.embedding <=> p_embedding) as similarity
  FROM faq_database f
  WHERE f.workspace_id = p_workspace_id
    AND f.is_active = TRUE
    AND f.embedding IS NOT NULL
    AND 1 - (f.embedding <=> p_embedding) > p_match_threshold
  ORDER BY 
    COALESCE(f.priority, 5) DESC,
    similarity DESC
  LIMIT p_match_count;
$$;

-- Function: match_conversations
CREATE OR REPLACE FUNCTION public.match_conversations(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.7,
  match_count integer DEFAULT 5
)
RETURNS TABLE(
  id uuid,
  text text,
  ai_draft_response text,
  final_response text,
  human_edited boolean,
  led_to_booking boolean,
  customer_satisfaction integer,
  mode text,
  confidence numeric,
  similarity double precision
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    COALESCE(c.summary_for_human, c.title, '') as text,
    c.ai_draft_response,
    c.final_response,
    c.human_edited,
    c.led_to_booking,
    c.customer_satisfaction,
    c.mode,
    c.confidence,
    1 - (c.embedding <=> query_embedding) as similarity
  FROM public.conversations c
  WHERE c.embedding IS NOT NULL
    AND 1 - (c.embedding <=> query_embedding) > match_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Function: get_sent_conversations
CREATE OR REPLACE FUNCTION public.get_sent_conversations(
  p_user_id uuid,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid,
  title text,
  status text,
  priority text,
  category text,
  channel text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  sla_due_at timestamp with time zone,
  sla_status text,
  summary_for_human text,
  ai_reason_for_escalation text,
  customer_id uuid,
  assigned_to uuid,
  snoozed_until timestamp with time zone
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (c.id)
    c.id,
    c.title,
    c.status,
    c.priority,
    c.category,
    c.channel,
    c.created_at,
    c.updated_at,
    c.sla_due_at,
    c.sla_status,
    c.summary_for_human,
    c.ai_reason_for_escalation,
    c.customer_id,
    c.assigned_to,
    c.snoozed_until
  FROM conversations c
  INNER JOIN messages m ON m.conversation_id = c.id
  WHERE m.actor_id = p_user_id
    AND m.direction = 'outbound'
    AND m.is_internal = false
  ORDER BY c.id, c.created_at DESC
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- Function: get_research_job_stats
CREATE OR REPLACE FUNCTION public.get_research_job_stats(p_job_id uuid)
RETURNS TABLE(
  status text,
  sites_discovered integer,
  sites_validated integer,
  sites_scraped integer,
  pages_scraped integer,
  faqs_extracted integer,
  faqs_after_dedup integer,
  faqs_refined integer,
  progress_percent integer
)
LANGUAGE sql
SET search_path = public
AS $$
  SELECT 
    j.status,
    COALESCE(j.sites_discovered, 0),
    COALESCE(j.sites_validated, 0),
    COALESCE(j.sites_scraped, 0),
    COALESCE(j.pages_scraped, 0),
    COALESCE(j.faqs_extracted, 0),
    COALESCE(j.faqs_after_dedup, 0),
    COALESCE(j.faqs_refined, 0),
    CASE 
      WHEN j.status = 'completed' THEN 100
      WHEN j.status = 'discovering' THEN 10
      WHEN j.status = 'validating' THEN 20
      WHEN j.status = 'scraping' THEN 30 + LEAST(20, COALESCE(j.sites_scraped, 0))
      WHEN j.status = 'extracting' THEN 50 + LEAST(15, COALESCE(j.faqs_extracted, 0) / 50)
      WHEN j.status = 'deduplicating' THEN 70
      WHEN j.status = 'refining' THEN 75 + LEAST(15, COALESCE(j.faqs_refined, 0) / 20)
      WHEN j.status = 'embedding' THEN 95
      ELSE 0
    END as progress_percent
  FROM competitor_research_jobs j
  WHERE j.id = p_job_id;
$$;

-- Function: nuclear_reset (dangerous - use with caution)
CREATE OR REPLACE FUNCTION public.nuclear_reset(p_workspace_id uuid, p_confirm text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_confirm != 'CONFIRM_NUCLEAR_RESET' THEN
    RAISE EXCEPTION 'Invalid confirmation code';
  END IF;

  TRUNCATE TABLE
    public.messages,
    public.conversation_pairs,
    public.email_pairs,
    public.conversations,
    public.customers,
    public.raw_emails,
    public.email_import_queue,
    public.email_import_progress,
    public.email_import_jobs,
    public.email_fetch_retries,
    public.email_sync_jobs,
    public.sync_logs
  RESTART IDENTITY CASCADE;

  UPDATE public.email_provider_configs
  SET sync_status = 'pending',
      sync_stage = NULL,
      sync_progress = 0,
      sync_total = 0,
      inbound_emails_found = 0,
      outbound_emails_found = 0,
      inbound_total = 0,
      outbound_total = 0,
      threads_linked = 0,
      sync_started_at = NULL,
      sync_completed_at = NULL,
      sync_error = NULL,
      last_sync_at = NULL,
      active_job_id = NULL
  WHERE workspace_id = p_workspace_id;

  RETURN jsonb_build_object(
    'success', true,
    'wiped', true
  );
END;
$$;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Trigger: Create user profile on auth signup
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update timestamps triggers (add to tables as needed)
CREATE OR REPLACE TRIGGER update_users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_business_context_updated_at
  BEFORE UPDATE ON public.business_context
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER update_voice_profiles_updated_at
  BEFORE UPDATE ON public.voice_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sla_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_context ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_database ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.industry_faq_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_provider_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_channel_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raw_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_import_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_import_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_thread_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_fetch_retries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_pairs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sender_behaviour_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.triage_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correction_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_edits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learned_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.few_shot_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_playbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ignored_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbox_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escalated_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allowed_webhook_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.make_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_research_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_faqs_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_faq_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.security_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_gdpr_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_deletion_requests ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Workspaces policies
CREATE POLICY "Users can view their workspace"
  ON public.workspaces FOR SELECT
  USING (id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

-- Users policies
CREATE POLICY "Users can view workspace members"
  ON public.users FOR SELECT
  USING ((id = auth.uid()) OR (workspace_id = get_my_workspace_id()));

CREATE POLICY "Users can update their own profile"
  ON public.users FOR UPDATE
  USING (id = auth.uid());

-- User roles policies
CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage all roles"
  ON public.user_roles FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Customers policies
CREATE POLICY "Users can view workspace customers"
  ON public.customers FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can create customers"
  ON public.customers FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update workspace customers"
  ON public.customers FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Conversations policies
CREATE POLICY "Users can view workspace conversations"
  ON public.conversations FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can create conversations"
  ON public.conversations FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update workspace conversations"
  ON public.conversations FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Messages policies
CREATE POLICY "Users can view conversation messages"
  ON public.messages FOR SELECT
  USING (conversation_id IN (
    SELECT id FROM conversations 
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ));

CREATE POLICY "Users can create messages"
  ON public.messages FOR INSERT
  WITH CHECK (conversation_id IN (
    SELECT id FROM conversations 
    WHERE workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid())
  ));

-- Templates policies
CREATE POLICY "Users can view workspace templates"
  ON public.templates FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can create templates"
  ON public.templates FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

-- SLA configs policies
CREATE POLICY "Users can view workspace SLA configs"
  ON public.sla_configs FOR SELECT
  USING (workspace_id IN (SELECT workspace_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Managers can manage SLA configs"
  ON public.sla_configs FOR ALL
  USING (has_role(auth.uid(), 'manager') OR has_role(auth.uid(), 'admin'));

-- Business context policies
CREATE POLICY "Users can view workspace business context"
  ON public.business_context FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace business context"
  ON public.business_context FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- Business profile policies
CREATE POLICY "Users can view business profile in their workspace"
  ON public.business_profile FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can manage business profile in their workspace"
  ON public.business_profile FOR ALL
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role full access to business_profile"
  ON public.business_profile FOR ALL
  USING (auth.role() = 'service_role');

-- Business facts policies
CREATE POLICY "Users can view workspace business facts"
  ON public.business_facts FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage business facts"
  ON public.business_facts FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Price list policies
CREATE POLICY "Users can view workspace pricing"
  ON public.price_list FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage pricing"
  ON public.price_list FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- FAQs policies
CREATE POLICY "Users can view workspace FAQs"
  ON public.faqs FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can create FAQs"
  ON public.faqs FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update workspace FAQs"
  ON public.faqs FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can delete workspace FAQs"
  ON public.faqs FOR DELETE
  USING (user_has_workspace_access(workspace_id));

-- FAQ database policies
CREATE POLICY "Users can view workspace FAQs"
  ON public.faq_database FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage FAQs"
  ON public.faq_database FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Industry FAQ templates policies
CREATE POLICY "Anyone can read industry templates"
  ON public.industry_faq_templates FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage templates"
  ON public.industry_faq_templates FOR ALL
  USING (auth.role() = 'service_role');

-- Email provider configs policies
CREATE POLICY "Users can view workspace email configs"
  ON public.email_provider_configs FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace email configs"
  ON public.email_provider_configs FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- Gmail channel configs policies
CREATE POLICY "Users can view workspace gmail configs"
  ON public.gmail_channel_configs FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace gmail configs"
  ON public.gmail_channel_configs FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- Email settings policies
CREATE POLICY "Users can view workspace email settings"
  ON public.email_settings FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace email settings"
  ON public.email_settings FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- Raw emails policies
CREATE POLICY "Users can view workspace raw emails"
  ON public.raw_emails FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Service role can manage raw emails"
  ON public.raw_emails FOR ALL
  USING (true);

-- Email import queue policies
CREATE POLICY "Users can view their workspace email queue"
  ON public.email_import_queue FOR SELECT
  USING (workspace_id = get_my_workspace_id());

-- Email import progress policies
CREATE POLICY "Users can view import progress"
  ON public.email_import_progress FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage import progress"
  ON public.email_import_progress FOR ALL
  USING (true);

-- Email import jobs policies
CREATE POLICY "Users can view their workspace import jobs"
  ON public.email_import_jobs FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can create import jobs in their workspace"
  ON public.email_import_jobs FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update their workspace import jobs"
  ON public.email_import_jobs FOR UPDATE
  USING (workspace_id = get_my_workspace_id());

-- Email sync jobs policies
CREATE POLICY "Users can view their workspace sync jobs"
  ON public.email_sync_jobs FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace sync jobs"
  ON public.email_sync_jobs FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace sync jobs"
  ON public.email_sync_jobs FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Email thread analysis policies
CREATE POLICY "Users can view their workspace thread analysis"
  ON public.email_thread_analysis FOR SELECT
  USING (workspace_id = get_my_workspace_id());

-- Email fetch retries policies
CREATE POLICY "Users can view their workspace email retries"
  ON public.email_fetch_retries FOR SELECT
  USING (workspace_id = get_my_workspace_id());

-- Email pairs policies
CREATE POLICY "Users can view email pairs in their workspace"
  ON public.email_pairs FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage email pairs"
  ON public.email_pairs FOR ALL
  USING (true);

-- Conversation pairs policies
CREATE POLICY "Service role can manage conversation pairs"
  ON public.conversation_pairs FOR ALL
  USING (true);

-- Voice profiles policies
CREATE POLICY "Users can view workspace voice profile"
  ON public.voice_profiles FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace voice profile"
  ON public.voice_profiles FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- Sender rules policies
CREATE POLICY "Users can view workspace sender rules"
  ON public.sender_rules FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace sender rules"
  ON public.sender_rules FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- Sender behaviour stats policies
CREATE POLICY "Users can view workspace sender stats"
  ON public.sender_behaviour_stats FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Authenticated users can view workspace sender stats"
  ON public.sender_behaviour_stats FOR SELECT
  USING ((auth.uid() IS NOT NULL) AND (workspace_id = get_my_workspace_id()));

-- Triage corrections policies
CREATE POLICY "Users can view workspace triage corrections"
  ON public.triage_corrections FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can create triage corrections"
  ON public.triage_corrections FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

-- Correction examples policies
CREATE POLICY "Users can view workspace corrections"
  ON public.correction_examples FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can create corrections"
  ON public.correction_examples FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can update workspace corrections"
  ON public.correction_examples FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Draft edits policies
CREATE POLICY "Users can view workspace draft edits"
  ON public.draft_edits FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can create draft edits"
  ON public.draft_edits FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

-- Learned responses policies
CREATE POLICY "Users can view their workspace learned responses"
  ON public.learned_responses FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace learned responses"
  ON public.learned_responses FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace learned responses"
  ON public.learned_responses FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Few shot examples policies
CREATE POLICY "Users can view few shot examples in their workspace"
  ON public.few_shot_examples FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage few shot examples"
  ON public.few_shot_examples FOR ALL
  USING (true);

-- Response playbook policies
CREATE POLICY "Users can view playbook"
  ON public.response_playbook FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage playbook"
  ON public.response_playbook FOR ALL
  USING (true);

-- Response feedback policies
CREATE POLICY "Users can view their workspace feedback"
  ON public.response_feedback FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace feedback"
  ON public.response_feedback FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

-- Ignored emails policies
CREATE POLICY "Users can view ignored emails in their workspace"
  ON public.ignored_emails FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage ignored emails"
  ON public.ignored_emails FOR ALL
  USING (true);

-- Inbox insights policies
CREATE POLICY "Users can view their workspace inbox insights"
  ON public.inbox_insights FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace inbox insights"
  ON public.inbox_insights FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace inbox insights"
  ON public.inbox_insights FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Conversation analytics policies
CREATE POLICY "Users can view analytics"
  ON public.conversation_analytics FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage analytics"
  ON public.conversation_analytics FOR ALL
  USING (true);

-- Escalated messages policies
CREATE POLICY "Users can view workspace escalations"
  ON public.escalated_messages FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can create workspace escalations"
  ON public.escalated_messages FOR INSERT
  WITH CHECK (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can update workspace escalations"
  ON public.escalated_messages FOR UPDATE
  USING (workspace_id = get_my_workspace_id());

-- Message responses policies
CREATE POLICY "Users can view responses for workspace messages"
  ON public.message_responses FOR SELECT
  USING (message_id IN (
    SELECT id FROM escalated_messages WHERE workspace_id = get_my_workspace_id()
  ));

CREATE POLICY "Users can create responses for workspace messages"
  ON public.message_responses FOR INSERT
  WITH CHECK (message_id IN (
    SELECT id FROM escalated_messages WHERE workspace_id = get_my_workspace_id()
  ));

-- Notifications policies
CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING ((workspace_id = get_my_workspace_id()) OR (user_id = auth.uid()));

CREATE POLICY "Users can create notifications in their workspace"
  ON public.notifications FOR INSERT
  WITH CHECK ((workspace_id = get_my_workspace_id()) OR (user_id = auth.uid()));

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING ((workspace_id = get_my_workspace_id()) OR (user_id = auth.uid()));

-- Notification preferences policies
CREATE POLICY "Users can view workspace notification preferences"
  ON public.notification_preferences FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Users can manage workspace notification preferences"
  ON public.notification_preferences FOR ALL
  USING (workspace_id = get_my_workspace_id());

-- System prompts policies
CREATE POLICY "Users can view workspace prompts only"
  ON public.system_prompts FOR SELECT
  USING (((workspace_id IS NOT NULL) AND user_has_workspace_access(workspace_id)) 
         OR ((workspace_id IS NULL) AND has_role(auth.uid(), 'admin')));

CREATE POLICY "Users can create prompts in their workspace"
  ON public.system_prompts FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update prompts in their workspace"
  ON public.system_prompts FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can delete prompts in their workspace"
  ON public.system_prompts FOR DELETE
  USING (user_has_workspace_access(workspace_id));

-- Workspace channels policies
CREATE POLICY "Users can view workspace channels"
  ON public.workspace_channels FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage channels"
  ON public.workspace_channels FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Allowed webhook IPs policies
CREATE POLICY "Users can view workspace allowed IPs"
  ON public.allowed_webhook_ips FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage allowed IPs"
  ON public.allowed_webhook_ips FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Webhook logs policies
CREATE POLICY "Users can view their workspace webhook logs"
  ON public.webhook_logs FOR SELECT
  USING (conversation_id IN (
    SELECT id FROM conversations WHERE workspace_id = get_my_workspace_id()
  ));

-- Sync logs policies
CREATE POLICY "Users can view their workspace sync logs"
  ON public.sync_logs FOR SELECT
  USING (workspace_id = get_my_workspace_id());

-- Import progress policies
CREATE POLICY "Users can view their workspace import progress"
  ON public.import_progress FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace import progress"
  ON public.import_progress FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace import progress"
  ON public.import_progress FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Make progress policies
CREATE POLICY "Users can view their workspace progress"
  ON public.make_progress FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace progress"
  ON public.make_progress FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace progress"
  ON public.make_progress FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Onboarding progress policies
CREATE POLICY "Users can view onboarding progress in their workspace"
  ON public.onboarding_progress FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role can manage onboarding progress"
  ON public.onboarding_progress FOR ALL
  USING (true);

-- Competitor research jobs policies
CREATE POLICY "Users can view their workspace competitor jobs"
  ON public.competitor_research_jobs FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert their workspace competitor jobs"
  ON public.competitor_research_jobs FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update their workspace competitor jobs"
  ON public.competitor_research_jobs FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

-- Competitor sites policies
CREATE POLICY "Users can view their workspace competitor sites"
  ON public.competitor_sites FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can manage their workspace competitor sites"
  ON public.competitor_sites FOR ALL
  USING (user_has_workspace_access(workspace_id));

-- Competitor pages policies
CREATE POLICY "Users can view pages in their workspace"
  ON public.competitor_pages FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert pages in their workspace"
  ON public.competitor_pages FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update pages in their workspace"
  ON public.competitor_pages FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role full access to competitor_pages"
  ON public.competitor_pages FOR ALL
  USING (auth.role() = 'service_role');

-- Competitor FAQs raw policies
CREATE POLICY "Users can view raw faqs in their workspace"
  ON public.competitor_faqs_raw FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can insert raw faqs in their workspace"
  ON public.competitor_faqs_raw FOR INSERT
  WITH CHECK (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can update raw faqs in their workspace"
  ON public.competitor_faqs_raw FOR UPDATE
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Service role full access to competitor_faqs_raw"
  ON public.competitor_faqs_raw FOR ALL
  USING (auth.role() = 'service_role');

-- Competitor FAQ candidates policies
CREATE POLICY "Users can view their workspace faq candidates"
  ON public.competitor_faq_candidates FOR SELECT
  USING (user_has_workspace_access(workspace_id));

CREATE POLICY "Users can manage their workspace faq candidates"
  ON public.competitor_faq_candidates FOR ALL
  USING (user_has_workspace_access(workspace_id));

-- Customer consents policies
CREATE POLICY "Users can view workspace customer consents"
  ON public.customer_consents FOR SELECT
  USING (customer_id IN (
    SELECT id FROM customers WHERE workspace_id = get_my_workspace_id()
  ));

CREATE POLICY "Users can manage workspace customer consents"
  ON public.customer_consents FOR ALL
  USING (customer_id IN (
    SELECT id FROM customers WHERE workspace_id = get_my_workspace_id()
  ));

-- Data access logs policies
CREATE POLICY "Admins can view workspace access logs"
  ON public.data_access_logs FOR SELECT
  USING (has_role(auth.uid(), 'admin') AND (
    (customer_id IN (SELECT id FROM customers WHERE workspace_id = get_my_workspace_id()))
    OR (conversation_id IN (SELECT id FROM conversations WHERE workspace_id = get_my_workspace_id()))
    OR (user_id = auth.uid())
  ));

-- Data deletion requests policies
CREATE POLICY "Users can view workspace deletion requests"
  ON public.data_deletion_requests FOR SELECT
  USING (customer_id IN (
    SELECT id FROM customers WHERE workspace_id = get_my_workspace_id()
  ));

CREATE POLICY "Users can create deletion requests"
  ON public.data_deletion_requests FOR INSERT
  WITH CHECK (customer_id IN (
    SELECT id FROM customers WHERE workspace_id = get_my_workspace_id()
  ));

CREATE POLICY "Admins can update deletion requests"
  ON public.data_deletion_requests FOR UPDATE
  USING (has_role(auth.uid(), 'admin'));

-- Data retention policies policies
CREATE POLICY "Users can view workspace retention policy"
  ON public.data_retention_policies FOR SELECT
  USING (workspace_id = get_my_workspace_id());

CREATE POLICY "Admins can manage retention policies"
  ON public.data_retention_policies FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Security incidents policies
CREATE POLICY "Admins can view workspace security incidents"
  ON public.security_incidents FOR SELECT
  USING ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin') 
         AND ((workspace_id IS NULL) OR (workspace_id = get_my_workspace_id())));

CREATE POLICY "Admins can manage security incidents"
  ON public.security_incidents FOR ALL
  USING ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin'))
  WITH CHECK ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin'));

-- Workspace GDPR settings policies
CREATE POLICY "Users can view their workspace GDPR settings"
  ON public.workspace_gdpr_settings FOR SELECT
  USING ((auth.uid() IS NOT NULL) AND (workspace_id = get_my_workspace_id()));

CREATE POLICY "Admins can manage workspace GDPR settings"
  ON public.workspace_gdpr_settings FOR ALL
  USING ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin') AND (workspace_id = get_my_workspace_id()))
  WITH CHECK ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin') AND (workspace_id = get_my_workspace_id()));

-- Workspace deletion requests policies
CREATE POLICY "Admins can view workspace deletion requests"
  ON public.workspace_deletion_requests FOR SELECT
  USING ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin') AND (workspace_id = get_my_workspace_id()));

CREATE POLICY "Admins can create workspace deletion requests"
  ON public.workspace_deletion_requests FOR INSERT
  WITH CHECK ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin') AND (workspace_id = get_my_workspace_id()));

CREATE POLICY "Admins can update workspace deletion requests"
  ON public.workspace_deletion_requests FOR UPDATE
  USING ((auth.uid() IS NOT NULL) AND has_role(auth.uid(), 'admin') AND (workspace_id = get_my_workspace_id()));

-- ============================================================================
-- TABLE ROW COUNTS (as of export)
-- ============================================================================
-- All tables currently have 0 rows except:
-- - sync_logs: 1 row
-- - conversation_analytics: 1 row (sample data)
-- 
-- Total tables: 64
-- Total RLS policies: 148
-- ============================================================================

-- ============================================================================
-- NOTES FOR MIGRATION
-- ============================================================================
-- 1. Enable the 'uuid-ossp', 'pgcrypto', and 'vector' extensions before running
-- 2. The 'vector' extension is for pgvector embeddings
-- 3. The auth.users trigger requires the auth schema (Supabase built-in)
-- 4. You may need to adjust the auth.uid() and auth.role() functions for your setup
-- 5. Service role policies use (auth.role() = 'service_role') for backend access
-- 6. Some policies reference get_my_workspace_id() and user_has_workspace_access()
--    which are helper functions that must exist before the policies
-- ============================================================================
