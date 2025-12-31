export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      allowed_webhook_ips: {
        Row: {
          created_at: string | null
          description: string | null
          enabled: boolean | null
          id: string
          ip_address: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          ip_address: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          ip_address?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "allowed_webhook_ips_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_context: {
        Row: {
          active_insurance_claim: boolean | null
          active_stripe_case: boolean | null
          automation_level: string | null
          business_type: string | null
          company_logo_url: string | null
          company_name: string | null
          created_at: string | null
          custom_flags: Json | null
          email_domain: string | null
          id: string
          industry_faqs_copied: number | null
          is_hiring: boolean | null
          knowledge_base_completed_at: string | null
          knowledge_base_started_at: string | null
          knowledge_base_status: string | null
          service_area: string | null
          updated_at: string | null
          website_faqs_generated: number | null
          website_url: string | null
          workspace_id: string | null
        }
        Insert: {
          active_insurance_claim?: boolean | null
          active_stripe_case?: boolean | null
          automation_level?: string | null
          business_type?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string | null
          custom_flags?: Json | null
          email_domain?: string | null
          id?: string
          industry_faqs_copied?: number | null
          is_hiring?: boolean | null
          knowledge_base_completed_at?: string | null
          knowledge_base_started_at?: string | null
          knowledge_base_status?: string | null
          service_area?: string | null
          updated_at?: string | null
          website_faqs_generated?: number | null
          website_url?: string | null
          workspace_id?: string | null
        }
        Update: {
          active_insurance_claim?: boolean | null
          active_stripe_case?: boolean | null
          automation_level?: string | null
          business_type?: string | null
          company_logo_url?: string | null
          company_name?: string | null
          created_at?: string | null
          custom_flags?: Json | null
          email_domain?: string | null
          id?: string
          industry_faqs_copied?: number | null
          is_hiring?: boolean | null
          knowledge_base_completed_at?: string | null
          knowledge_base_started_at?: string | null
          knowledge_base_status?: string | null
          service_area?: string | null
          updated_at?: string | null
          website_faqs_generated?: number | null
          website_url?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_context_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      business_facts: {
        Row: {
          category: string
          created_at: string | null
          external_id: number | null
          fact_key: string
          fact_value: string
          id: string
          metadata: Json | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          external_id?: number | null
          fact_key: string
          fact_value: string
          id?: string
          metadata?: Json | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          external_id?: number | null
          fact_key?: string
          fact_value?: string
          id?: string
          metadata?: Json | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_facts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_faq_candidates: {
        Row: {
          answer: string
          category: string | null
          created_at: string | null
          id: string
          job_id: string
          merged_into_faq_id: string | null
          question: string
          site_id: string | null
          source_domain: string | null
          status: string
          workspace_id: string
        }
        Insert: {
          answer: string
          category?: string | null
          created_at?: string | null
          id?: string
          job_id: string
          merged_into_faq_id?: string | null
          question: string
          site_id?: string | null
          source_domain?: string | null
          status?: string
          workspace_id: string
        }
        Update: {
          answer?: string
          category?: string | null
          created_at?: string | null
          id?: string
          job_id?: string
          merged_into_faq_id?: string | null
          question?: string
          site_id?: string | null
          source_domain?: string | null
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_faq_candidates_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "competitor_research_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_faq_candidates_merged_into_faq_id_fkey"
            columns: ["merged_into_faq_id"]
            isOneToOne: false
            referencedRelation: "faq_database"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_faq_candidates_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "competitor_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_faq_candidates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_research_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_scraping_domain: string | null
          error_message: string | null
          exclude_domains: string[] | null
          faqs_added: number | null
          faqs_generated: number | null
          id: string
          niche_query: string
          service_area: string | null
          sites_approved: number | null
          sites_discovered: number | null
          sites_scraped: number | null
          started_at: string | null
          status: string
          target_count: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_scraping_domain?: string | null
          error_message?: string | null
          exclude_domains?: string[] | null
          faqs_added?: number | null
          faqs_generated?: number | null
          id?: string
          niche_query: string
          service_area?: string | null
          sites_approved?: number | null
          sites_discovered?: number | null
          sites_scraped?: number | null
          started_at?: string | null
          status?: string
          target_count?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_scraping_domain?: string | null
          error_message?: string | null
          exclude_domains?: string[] | null
          faqs_added?: number | null
          faqs_generated?: number | null
          id?: string
          niche_query?: string
          service_area?: string | null
          sites_approved?: number | null
          sites_discovered?: number | null
          sites_scraped?: number | null
          started_at?: string | null
          status?: string
          target_count?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_research_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_sites: {
        Row: {
          content_extracted: string | null
          created_at: string | null
          description: string | null
          domain: string
          faqs_generated: number | null
          id: string
          is_directory: boolean | null
          job_id: string
          pages_scraped: number | null
          rejection_reason: string | null
          scraped_at: string | null
          status: string
          title: string | null
          url: string
          workspace_id: string
        }
        Insert: {
          content_extracted?: string | null
          created_at?: string | null
          description?: string | null
          domain: string
          faqs_generated?: number | null
          id?: string
          is_directory?: boolean | null
          job_id: string
          pages_scraped?: number | null
          rejection_reason?: string | null
          scraped_at?: string | null
          status?: string
          title?: string | null
          url: string
          workspace_id: string
        }
        Update: {
          content_extracted?: string | null
          created_at?: string | null
          description?: string | null
          domain?: string
          faqs_generated?: number | null
          id?: string
          is_directory?: boolean | null
          job_id?: string
          pages_scraped?: number | null
          rejection_reason?: string | null
          scraped_at?: string | null
          status?: string
          title?: string | null
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competitor_sites_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "competitor_research_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_sites_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          ai_confidence: number | null
          ai_draft_response: string | null
          ai_message_count: number | null
          ai_reason_for_escalation: string | null
          ai_resolution_summary: string | null
          ai_sentiment: string | null
          assigned_to: string | null
          auto_handled_at: string | null
          auto_responded: boolean | null
          batch_group: string | null
          category: string | null
          channel: string
          cognitive_load: string | null
          confidence: number | null
          conversation_type: string | null
          created_at: string | null
          csat_requested_at: string | null
          csat_responded_at: string | null
          customer_id: string | null
          customer_satisfaction: number | null
          decision_bucket: string | null
          email_classification: string | null
          embedding: string | null
          escalated_at: string | null
          evidence: Json | null
          external_conversation_id: string | null
          extracted_entities: Json | null
          final_response: string | null
          first_response_at: string | null
          flags: Json | null
          human_edited: boolean | null
          id: string
          is_escalated: boolean | null
          lane: string | null
          led_to_booking: boolean | null
          message_count: number | null
          metadata: Json | null
          mode: string | null
          needs_embedding: boolean | null
          needs_review: boolean | null
          priority: string | null
          requires_reply: boolean | null
          resolved_at: string | null
          review_outcome: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          risk_level: string | null
          sla_due_at: string | null
          sla_status: string | null
          sla_target_minutes: number | null
          snoozed_until: string | null
          status: string | null
          suggested_actions: string[] | null
          summary_for_human: string | null
          thread_context: Json | null
          title: string | null
          triage_confidence: number | null
          triage_reasoning: string | null
          updated_at: string | null
          urgency: string | null
          urgency_reason: string | null
          why_this_needs_you: string | null
          workspace_id: string | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_draft_response?: string | null
          ai_message_count?: number | null
          ai_reason_for_escalation?: string | null
          ai_resolution_summary?: string | null
          ai_sentiment?: string | null
          assigned_to?: string | null
          auto_handled_at?: string | null
          auto_responded?: boolean | null
          batch_group?: string | null
          category?: string | null
          channel: string
          cognitive_load?: string | null
          confidence?: number | null
          conversation_type?: string | null
          created_at?: string | null
          csat_requested_at?: string | null
          csat_responded_at?: string | null
          customer_id?: string | null
          customer_satisfaction?: number | null
          decision_bucket?: string | null
          email_classification?: string | null
          embedding?: string | null
          escalated_at?: string | null
          evidence?: Json | null
          external_conversation_id?: string | null
          extracted_entities?: Json | null
          final_response?: string | null
          first_response_at?: string | null
          flags?: Json | null
          human_edited?: boolean | null
          id?: string
          is_escalated?: boolean | null
          lane?: string | null
          led_to_booking?: boolean | null
          message_count?: number | null
          metadata?: Json | null
          mode?: string | null
          needs_embedding?: boolean | null
          needs_review?: boolean | null
          priority?: string | null
          requires_reply?: boolean | null
          resolved_at?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string | null
          sla_due_at?: string | null
          sla_status?: string | null
          sla_target_minutes?: number | null
          snoozed_until?: string | null
          status?: string | null
          suggested_actions?: string[] | null
          summary_for_human?: string | null
          thread_context?: Json | null
          title?: string | null
          triage_confidence?: number | null
          triage_reasoning?: string | null
          updated_at?: string | null
          urgency?: string | null
          urgency_reason?: string | null
          why_this_needs_you?: string | null
          workspace_id?: string | null
        }
        Update: {
          ai_confidence?: number | null
          ai_draft_response?: string | null
          ai_message_count?: number | null
          ai_reason_for_escalation?: string | null
          ai_resolution_summary?: string | null
          ai_sentiment?: string | null
          assigned_to?: string | null
          auto_handled_at?: string | null
          auto_responded?: boolean | null
          batch_group?: string | null
          category?: string | null
          channel?: string
          cognitive_load?: string | null
          confidence?: number | null
          conversation_type?: string | null
          created_at?: string | null
          csat_requested_at?: string | null
          csat_responded_at?: string | null
          customer_id?: string | null
          customer_satisfaction?: number | null
          decision_bucket?: string | null
          email_classification?: string | null
          embedding?: string | null
          escalated_at?: string | null
          evidence?: Json | null
          external_conversation_id?: string | null
          extracted_entities?: Json | null
          final_response?: string | null
          first_response_at?: string | null
          flags?: Json | null
          human_edited?: boolean | null
          id?: string
          is_escalated?: boolean | null
          lane?: string | null
          led_to_booking?: boolean | null
          message_count?: number | null
          metadata?: Json | null
          mode?: string | null
          needs_embedding?: boolean | null
          needs_review?: boolean | null
          priority?: string | null
          requires_reply?: boolean | null
          resolved_at?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          risk_level?: string | null
          sla_due_at?: string | null
          sla_status?: string | null
          sla_target_minutes?: number | null
          snoozed_until?: string | null
          status?: string | null
          suggested_actions?: string[] | null
          summary_for_human?: string | null
          thread_context?: Json | null
          title?: string | null
          triage_confidence?: number | null
          triage_reasoning?: string | null
          updated_at?: string | null
          urgency?: string | null
          urgency_reason?: string | null
          why_this_needs_you?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_consents: {
        Row: {
          channel: string
          consent_date: string | null
          consent_given: boolean | null
          consent_method: string | null
          created_at: string | null
          customer_id: string | null
          id: string
          lawful_basis: string | null
          notes: string | null
          purpose: string | null
          updated_at: string | null
          withdrawn_date: string | null
        }
        Insert: {
          channel: string
          consent_date?: string | null
          consent_given?: boolean | null
          consent_method?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          lawful_basis?: string | null
          notes?: string | null
          purpose?: string | null
          updated_at?: string | null
          withdrawn_date?: string | null
        }
        Update: {
          channel?: string
          consent_date?: string | null
          consent_given?: boolean | null
          consent_method?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          lawful_basis?: string | null
          notes?: string | null
          purpose?: string | null
          updated_at?: string | null
          withdrawn_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_consents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          balance: number | null
          created_at: string | null
          custom_fields: Json | null
          customer_id: string | null
          email: string | null
          embedding: string | null
          frequency: string | null
          id: string
          last_updated: string | null
          name: string | null
          next_appointment: string | null
          notes: string | null
          payment_method: string | null
          phone: string | null
          preferred_channel: string | null
          price: number | null
          schedule_code: string | null
          status: string | null
          tier: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          address?: string | null
          balance?: number | null
          created_at?: string | null
          custom_fields?: Json | null
          customer_id?: string | null
          email?: string | null
          embedding?: string | null
          frequency?: string | null
          id?: string
          last_updated?: string | null
          name?: string | null
          next_appointment?: string | null
          notes?: string | null
          payment_method?: string | null
          phone?: string | null
          preferred_channel?: string | null
          price?: number | null
          schedule_code?: string | null
          status?: string | null
          tier?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          address?: string | null
          balance?: number | null
          created_at?: string | null
          custom_fields?: Json | null
          customer_id?: string | null
          email?: string | null
          embedding?: string | null
          frequency?: string | null
          id?: string
          last_updated?: string | null
          name?: string | null
          next_appointment?: string | null
          notes?: string | null
          payment_method?: string | null
          phone?: string | null
          preferred_channel?: string | null
          price?: number | null
          schedule_code?: string | null
          status?: string | null
          tier?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      data_access_logs: {
        Row: {
          action: string
          conversation_id: string | null
          created_at: string | null
          customer_id: string | null
          id: string
          ip_address: string | null
          metadata: Json | null
          new_value: Json | null
          previous_value: Json | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          conversation_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_value?: Json | null
          previous_value?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          conversation_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          new_value?: Json | null
          previous_value?: Json | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_access_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_access_logs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_access_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_deletion_requests: {
        Row: {
          completed_at: string | null
          customer_id: string | null
          deletion_type: string | null
          id: string
          notes: string | null
          reason: string | null
          requested_at: string | null
          requested_by: string | null
          reviewed_at: string | null
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          customer_id?: string | null
          deletion_type?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          requested_at?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          customer_id?: string | null
          deletion_type?: string | null
          id?: string
          notes?: string | null
          reason?: string | null
          requested_at?: string | null
          requested_by?: string | null
          reviewed_at?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_deletion_requests_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_deletion_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      data_retention_policies: {
        Row: {
          anonymize_instead_of_delete: boolean | null
          auto_delete_enabled: boolean | null
          created_at: string | null
          exclude_vip_customers: boolean | null
          id: string
          retention_days: number
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          anonymize_instead_of_delete?: boolean | null
          auto_delete_enabled?: boolean | null
          created_at?: string | null
          exclude_vip_customers?: boolean | null
          id?: string
          retention_days?: number
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          anonymize_instead_of_delete?: boolean | null
          auto_delete_enabled?: boolean | null
          created_at?: string | null
          exclude_vip_customers?: boolean | null
          id?: string
          retention_days?: number
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_retention_policies_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_edits: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          edit_distance: number | null
          edit_type: string | null
          edited_draft: string
          id: string
          original_draft: string
          workspace_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          edit_distance?: number | null
          edit_type?: string | null
          edited_draft: string
          id?: string
          original_draft: string
          workspace_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          edit_distance?: number | null
          edit_type?: string | null
          edited_draft?: string
          id?: string
          original_draft?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_edits_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_edits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_provider_configs: {
        Row: {
          access_token: string | null
          access_token_encrypted: string | null
          account_id: string
          aliases: string[] | null
          automation_level: string | null
          connected_at: string | null
          created_at: string | null
          email_address: string
          encryption_key_id: string | null
          id: string
          import_mode: string | null
          inbound_emails_found: number | null
          last_sync_at: string | null
          outbound_emails_found: number | null
          provider: string
          subscription_expires_at: string | null
          subscription_id: string | null
          sync_completed_at: string | null
          sync_error: string | null
          sync_progress: number | null
          sync_stage: string | null
          sync_started_at: string | null
          sync_status: string | null
          sync_total: number | null
          threads_linked: number | null
          updated_at: string | null
          voice_profile_status: string | null
          workspace_id: string
        }
        Insert: {
          access_token?: string | null
          access_token_encrypted?: string | null
          account_id: string
          aliases?: string[] | null
          automation_level?: string | null
          connected_at?: string | null
          created_at?: string | null
          email_address: string
          encryption_key_id?: string | null
          id?: string
          import_mode?: string | null
          inbound_emails_found?: number | null
          last_sync_at?: string | null
          outbound_emails_found?: number | null
          provider: string
          subscription_expires_at?: string | null
          subscription_id?: string | null
          sync_completed_at?: string | null
          sync_error?: string | null
          sync_progress?: number | null
          sync_stage?: string | null
          sync_started_at?: string | null
          sync_status?: string | null
          sync_total?: number | null
          threads_linked?: number | null
          updated_at?: string | null
          voice_profile_status?: string | null
          workspace_id: string
        }
        Update: {
          access_token?: string | null
          access_token_encrypted?: string | null
          account_id?: string
          aliases?: string[] | null
          automation_level?: string | null
          connected_at?: string | null
          created_at?: string | null
          email_address?: string
          encryption_key_id?: string | null
          id?: string
          import_mode?: string | null
          inbound_emails_found?: number | null
          last_sync_at?: string | null
          outbound_emails_found?: number | null
          provider?: string
          subscription_expires_at?: string | null
          subscription_id?: string | null
          sync_completed_at?: string | null
          sync_error?: string | null
          sync_progress?: number | null
          sync_stage?: string | null
          sync_started_at?: string | null
          sync_status?: string | null
          sync_total?: number | null
          threads_linked?: number | null
          updated_at?: string | null
          voice_profile_status?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_provider_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          company_address: string | null
          company_name: string | null
          company_phone: string | null
          company_website: string | null
          created_at: string | null
          from_name: string | null
          id: string
          logo_url: string | null
          reply_to_email: string | null
          signature_html: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          company_address?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string | null
          from_name?: string | null
          id?: string
          logo_url?: string | null
          reply_to_email?: string | null
          signature_html?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          company_address?: string | null
          company_name?: string | null
          company_phone?: string | null
          company_website?: string | null
          created_at?: string | null
          from_name?: string | null
          id?: string
          logo_url?: string | null
          reply_to_email?: string | null
          signature_html?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sync_jobs: {
        Row: {
          completed_at: string | null
          config_id: string
          created_at: string | null
          error_message: string | null
          id: string
          import_mode: string
          inbound_cursor: string | null
          inbound_processed: number | null
          last_batch_at: string | null
          sent_cursor: string | null
          sent_processed: number | null
          started_at: string | null
          status: string
          threads_linked: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          config_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          import_mode: string
          inbound_cursor?: string | null
          inbound_processed?: number | null
          last_batch_at?: string | null
          sent_cursor?: string | null
          sent_processed?: number | null
          started_at?: string | null
          status?: string
          threads_linked?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          config_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          import_mode?: string
          inbound_cursor?: string | null
          inbound_processed?: number | null
          last_batch_at?: string | null
          sent_cursor?: string | null
          sent_processed?: number | null
          started_at?: string | null
          status?: string
          threads_linked?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sync_jobs_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "email_provider_configs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_sync_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      escalated_messages: {
        Row: {
          channel: Database["public"]["Enums"]["message_channel"]
          conversation_context: Json | null
          created_at: string | null
          customer_identifier: string
          customer_name: string | null
          escalated_at: string | null
          id: string
          message_content: string
          metadata: Json | null
          n8n_workflow_id: string | null
          priority: string | null
          responded_at: string | null
          status: Database["public"]["Enums"]["message_status"] | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["message_channel"]
          conversation_context?: Json | null
          created_at?: string | null
          customer_identifier: string
          customer_name?: string | null
          escalated_at?: string | null
          id?: string
          message_content: string
          metadata?: Json | null
          n8n_workflow_id?: string | null
          priority?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["message_channel"]
          conversation_context?: Json | null
          created_at?: string | null
          customer_identifier?: string
          customer_name?: string | null
          escalated_at?: string | null
          id?: string
          message_content?: string
          metadata?: Json | null
          n8n_workflow_id?: string | null
          priority?: string | null
          responded_at?: string | null
          status?: Database["public"]["Enums"]["message_status"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "escalated_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_database: {
        Row: {
          answer: string
          archived: boolean | null
          category: string
          created_at: string | null
          embedding: string | null
          enabled: boolean | null
          external_id: number | null
          generation_source: string | null
          id: string
          is_active: boolean | null
          is_industry_standard: boolean | null
          is_own_content: boolean | null
          keywords: string[] | null
          priority: number | null
          question: string
          source_company: string | null
          source_url: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          answer: string
          archived?: boolean | null
          category: string
          created_at?: string | null
          embedding?: string | null
          enabled?: boolean | null
          external_id?: number | null
          generation_source?: string | null
          id?: string
          is_active?: boolean | null
          is_industry_standard?: boolean | null
          is_own_content?: boolean | null
          keywords?: string[] | null
          priority?: number | null
          question: string
          source_company?: string | null
          source_url?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          answer?: string
          archived?: boolean | null
          category?: string
          created_at?: string | null
          embedding?: string | null
          enabled?: boolean | null
          external_id?: number | null
          generation_source?: string | null
          id?: string
          is_active?: boolean | null
          is_industry_standard?: boolean | null
          is_own_content?: boolean | null
          keywords?: string[] | null
          priority?: number | null
          question?: string
          source_company?: string | null
          source_url?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "faq_database_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      gmail_channel_configs: {
        Row: {
          access_token: string | null
          access_token_encrypted: string | null
          connected_at: string | null
          created_at: string | null
          email_address: string
          encryption_key_id: string | null
          history_id: string | null
          id: string
          import_mode: string | null
          last_sync_at: string | null
          refresh_token: string | null
          refresh_token_encrypted: string | null
          token_expires_at: string | null
          updated_at: string | null
          watch_expiration: string | null
          workspace_id: string | null
        }
        Insert: {
          access_token?: string | null
          access_token_encrypted?: string | null
          connected_at?: string | null
          created_at?: string | null
          email_address: string
          encryption_key_id?: string | null
          history_id?: string | null
          id?: string
          import_mode?: string | null
          last_sync_at?: string | null
          refresh_token?: string | null
          refresh_token_encrypted?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          watch_expiration?: string | null
          workspace_id?: string | null
        }
        Update: {
          access_token?: string | null
          access_token_encrypted?: string | null
          connected_at?: string | null
          created_at?: string | null
          email_address?: string
          encryption_key_id?: string | null
          history_id?: string | null
          id?: string
          import_mode?: string | null
          last_sync_at?: string | null
          refresh_token?: string | null
          refresh_token_encrypted?: string | null
          token_expires_at?: string | null
          updated_at?: string | null
          watch_expiration?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gmail_channel_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_faq_templates: {
        Row: {
          answer: string
          category: string | null
          created_at: string | null
          embedding: string | null
          id: string
          industry_type: string
          is_active: boolean | null
          metadata: Json | null
          question: string
          tags: string[] | null
          updated_at: string | null
        }
        Insert: {
          answer: string
          category?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          industry_type: string
          is_active?: boolean | null
          metadata?: Json | null
          question: string
          tags?: string[] | null
          updated_at?: string | null
        }
        Update: {
          answer?: string
          category?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          industry_type?: string
          is_active?: boolean | null
          metadata?: Json | null
          question?: string
          tags?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      message_responses: {
        Row: {
          agent_id: string | null
          created_at: string | null
          id: string
          message_id: string
          response_content: string
          sent_to_n8n: boolean | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          id?: string
          message_id: string
          response_content: string
          sent_to_n8n?: boolean | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          id?: string
          message_id?: string
          response_content?: string
          sent_to_n8n?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "message_responses_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "escalated_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_type: string
          attachments: Json | null
          body: string
          channel: string
          conversation_id: string | null
          created_at: string | null
          direction: string
          id: string
          is_internal: boolean | null
          raw_payload: Json | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_type: string
          attachments?: Json | null
          body: string
          channel: string
          conversation_id?: string | null
          created_at?: string | null
          direction: string
          id?: string
          is_internal?: boolean | null
          raw_payload?: Json | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_type?: string
          attachments?: Json | null
          body?: string
          channel?: string
          conversation_id?: string | null
          created_at?: string | null
          direction?: string
          id?: string
          is_internal?: boolean | null
          raw_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string | null
          id: string
          summary_channels: string[] | null
          summary_email: string | null
          summary_enabled: boolean | null
          summary_phone: string | null
          summary_times: string[] | null
          timezone: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          summary_channels?: string[] | null
          summary_email?: string | null
          summary_enabled?: boolean | null
          summary_phone?: string | null
          summary_times?: string[] | null
          timezone?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          summary_channels?: string[] | null
          summary_email?: string | null
          summary_enabled?: boolean | null
          summary_phone?: string | null
          summary_times?: string[] | null
          timezone?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string | null
          id: string
          is_read: boolean | null
          metadata: Json | null
          title: string
          type: string
          user_id: string | null
          workspace_id: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          title: string
          type?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          title?: string
          type?: string
          user_id?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      price_list: {
        Row: {
          affects_package: boolean | null
          applies_to_properties: string[] | null
          base_price: number | null
          bedrooms: string | null
          category: string | null
          created_at: string | null
          currency: string | null
          customer_count: number | null
          description: string | null
          external_id: number | null
          id: string
          is_active: boolean | null
          metadata: Json | null
          per_unit: boolean | null
          price_max: number | null
          price_min: number | null
          price_range: string | null
          price_typical: number | null
          property_type: string | null
          rule_priority: number | null
          service_code: string | null
          service_name: string
          unit: string | null
          updated_at: string | null
          window_price_max: number | null
          window_price_min: number | null
          workspace_id: string | null
        }
        Insert: {
          affects_package?: boolean | null
          applies_to_properties?: string[] | null
          base_price?: number | null
          bedrooms?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          customer_count?: number | null
          description?: string | null
          external_id?: number | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          per_unit?: boolean | null
          price_max?: number | null
          price_min?: number | null
          price_range?: string | null
          price_typical?: number | null
          property_type?: string | null
          rule_priority?: number | null
          service_code?: string | null
          service_name: string
          unit?: string | null
          updated_at?: string | null
          window_price_max?: number | null
          window_price_min?: number | null
          workspace_id?: string | null
        }
        Update: {
          affects_package?: boolean | null
          applies_to_properties?: string[] | null
          base_price?: number | null
          bedrooms?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          customer_count?: number | null
          description?: string | null
          external_id?: number | null
          id?: string
          is_active?: boolean | null
          metadata?: Json | null
          per_unit?: boolean | null
          price_max?: number | null
          price_min?: number | null
          price_range?: string | null
          price_typical?: number | null
          property_type?: string | null
          rule_priority?: number | null
          service_code?: string | null
          service_name?: string
          unit?: string | null
          updated_at?: string | null
          window_price_max?: number | null
          window_price_min?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "price_list_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      security_incidents: {
        Row: {
          affected_customers: Json | null
          affected_records_count: number | null
          created_at: string | null
          description: string | null
          detected_at: string | null
          id: string
          incident_type: string
          notification_sent_at: string | null
          remediation_steps: string | null
          reported_at: string | null
          reported_by: string | null
          resolved_at: string | null
          severity: string | null
          status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          affected_customers?: Json | null
          affected_records_count?: number | null
          created_at?: string | null
          description?: string | null
          detected_at?: string | null
          id?: string
          incident_type: string
          notification_sent_at?: string | null
          remediation_steps?: string | null
          reported_at?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          severity?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          affected_customers?: Json | null
          affected_records_count?: number | null
          created_at?: string | null
          description?: string | null
          detected_at?: string | null
          id?: string
          incident_type?: string
          notification_sent_at?: string | null
          remediation_steps?: string | null
          reported_at?: string | null
          reported_by?: string | null
          resolved_at?: string | null
          severity?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_incidents_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_incidents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sender_behaviour_stats: {
        Row: {
          avg_response_time_minutes: number | null
          created_at: string | null
          id: string
          ignored_count: number | null
          ignored_rate: number | null
          last_interaction_at: string | null
          replied_count: number | null
          reply_rate: number | null
          sender_domain: string
          sender_email: string | null
          suggested_bucket: string | null
          total_messages: number | null
          updated_at: string | null
          vip_score: number | null
          workspace_id: string | null
        }
        Insert: {
          avg_response_time_minutes?: number | null
          created_at?: string | null
          id?: string
          ignored_count?: number | null
          ignored_rate?: number | null
          last_interaction_at?: string | null
          replied_count?: number | null
          reply_rate?: number | null
          sender_domain: string
          sender_email?: string | null
          suggested_bucket?: string | null
          total_messages?: number | null
          updated_at?: string | null
          vip_score?: number | null
          workspace_id?: string | null
        }
        Update: {
          avg_response_time_minutes?: number | null
          created_at?: string | null
          id?: string
          ignored_count?: number | null
          ignored_rate?: number | null
          last_interaction_at?: string | null
          replied_count?: number | null
          reply_rate?: number | null
          sender_domain?: string
          sender_email?: string | null
          suggested_bucket?: string | null
          total_messages?: number | null
          updated_at?: string | null
          vip_score?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sender_behaviour_stats_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sender_rules: {
        Row: {
          automation_level: string | null
          confidence_adjustment: number | null
          created_at: string | null
          created_from_correction: string | null
          default_classification: string
          default_lane: string | null
          default_requires_reply: boolean | null
          hit_count: number | null
          id: string
          is_active: boolean | null
          override_classification: string | null
          override_keywords: string[] | null
          override_requires_reply: boolean | null
          sender_pattern: string
          skip_llm: boolean | null
          tone_preference: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          automation_level?: string | null
          confidence_adjustment?: number | null
          created_at?: string | null
          created_from_correction?: string | null
          default_classification: string
          default_lane?: string | null
          default_requires_reply?: boolean | null
          hit_count?: number | null
          id?: string
          is_active?: boolean | null
          override_classification?: string | null
          override_keywords?: string[] | null
          override_requires_reply?: boolean | null
          sender_pattern: string
          skip_llm?: boolean | null
          tone_preference?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          automation_level?: string | null
          confidence_adjustment?: number | null
          created_at?: string | null
          created_from_correction?: string | null
          default_classification?: string
          default_lane?: string | null
          default_requires_reply?: boolean | null
          hit_count?: number | null
          id?: string
          is_active?: boolean | null
          override_classification?: string | null
          override_keywords?: string[] | null
          override_requires_reply?: boolean | null
          sender_pattern?: string
          skip_llm?: boolean | null
          tone_preference?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sender_rules_created_from_correction_fkey"
            columns: ["created_from_correction"]
            isOneToOne: false
            referencedRelation: "triage_corrections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sender_rules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_configs: {
        Row: {
          first_response_minutes: number
          id: string
          pause_outside_hours: boolean | null
          priority: string
          workspace_id: string | null
        }
        Insert: {
          first_response_minutes: number
          id?: string
          pause_outside_hours?: boolean | null
          priority: string
          workspace_id?: string | null
        }
        Update: {
          first_response_minutes?: number
          id?: string
          pause_outside_hours?: boolean | null
          priority?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sla_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          details: Json | null
          error_message: string | null
          id: string
          records_fetched: number | null
          records_inserted: number | null
          records_unchanged: number | null
          records_updated: number | null
          started_at: string | null
          status: string | null
          sync_type: string
          tables_synced: string[]
          workspace_id: string | null
        }
        Insert: {
          completed_at?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          records_fetched?: number | null
          records_inserted?: number | null
          records_unchanged?: number | null
          records_updated?: number | null
          started_at?: string | null
          status?: string | null
          sync_type: string
          tables_synced: string[]
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string | null
          details?: Json | null
          error_message?: string | null
          id?: string
          records_fetched?: number | null
          records_inserted?: number | null
          records_unchanged?: number | null
          records_updated?: number | null
          started_at?: string | null
          status?: string | null
          sync_type?: string
          tables_synced?: string[]
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      system_prompts: {
        Row: {
          agent_type: string
          created_at: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          model: string | null
          name: string
          prompt: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          agent_type: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          model?: string | null
          name: string
          prompt: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          agent_type?: string
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          model?: string | null
          name?: string
          prompt?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "system_prompts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          body: string
          category: string | null
          created_at: string | null
          id: string
          name: string
          usage_count: number | null
          workspace_id: string | null
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string | null
          id?: string
          name: string
          usage_count?: number | null
          workspace_id?: string | null
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string | null
          id?: string
          name?: string
          usage_count?: number | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      triage_corrections: {
        Row: {
          conversation_id: string | null
          corrected_at: string | null
          corrected_by: string | null
          created_at: string | null
          id: string
          new_classification: string | null
          new_requires_reply: boolean | null
          original_classification: string | null
          original_requires_reply: boolean | null
          sender_domain: string | null
          sender_email: string | null
          subject_keywords: string[] | null
          workspace_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string | null
          id?: string
          new_classification?: string | null
          new_requires_reply?: boolean | null
          original_classification?: string | null
          original_requires_reply?: boolean | null
          sender_domain?: string | null
          sender_email?: string | null
          subject_keywords?: string[] | null
          workspace_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          corrected_at?: string | null
          corrected_by?: string | null
          created_at?: string | null
          id?: string
          new_classification?: string | null
          new_requires_reply?: boolean | null
          original_classification?: string | null
          original_requires_reply?: boolean | null
          sender_domain?: string | null
          sender_email?: string | null
          subject_keywords?: string[] | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "triage_corrections_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_corrections_corrected_by_fkey"
            columns: ["corrected_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "triage_corrections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      users: {
        Row: {
          created_at: string | null
          email: string
          id: string
          interface_mode: string | null
          is_online: boolean | null
          last_active_at: string | null
          name: string
          onboarding_completed: boolean | null
          onboarding_step: string | null
          status: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          email: string
          id: string
          interface_mode?: string | null
          is_online?: boolean | null
          last_active_at?: string | null
          name: string
          onboarding_completed?: boolean | null
          onboarding_step?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          interface_mode?: string | null
          is_online?: boolean | null
          last_active_at?: string | null
          name?: string
          onboarding_completed?: boolean | null
          onboarding_step?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_profiles: {
        Row: {
          analysis_status: string | null
          avg_response_length: number | null
          common_phrases: Json | null
          created_at: string | null
          emails_analyzed: number | null
          formality_score: number | null
          greeting_patterns: Json | null
          id: string
          last_analyzed_at: string | null
          outbound_emails_found: number | null
          sample_responses: Json | null
          signoff_patterns: Json | null
          tone_descriptors: string[] | null
          updated_at: string | null
          uses_emojis: boolean | null
          uses_exclamations: boolean | null
          workspace_id: string | null
        }
        Insert: {
          analysis_status?: string | null
          avg_response_length?: number | null
          common_phrases?: Json | null
          created_at?: string | null
          emails_analyzed?: number | null
          formality_score?: number | null
          greeting_patterns?: Json | null
          id?: string
          last_analyzed_at?: string | null
          outbound_emails_found?: number | null
          sample_responses?: Json | null
          signoff_patterns?: Json | null
          tone_descriptors?: string[] | null
          updated_at?: string | null
          uses_emojis?: boolean | null
          uses_exclamations?: boolean | null
          workspace_id?: string | null
        }
        Update: {
          analysis_status?: string | null
          avg_response_length?: number | null
          common_phrases?: Json | null
          created_at?: string | null
          emails_analyzed?: number | null
          formality_score?: number | null
          greeting_patterns?: Json | null
          id?: string
          last_analyzed_at?: string | null
          outbound_emails_found?: number | null
          sample_responses?: Json | null
          signoff_patterns?: Json | null
          tone_descriptors?: string[] | null
          updated_at?: string | null
          uses_emojis?: boolean | null
          uses_exclamations?: boolean | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          conversation_id: string | null
          created_at: string | null
          direction: string
          error_message: string | null
          id: string
          payload: Json | null
          response_payload: Json | null
          retry_count: number | null
          status_code: number | null
          webhook_url: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string | null
          direction: string
          error_message?: string | null
          id?: string
          payload?: Json | null
          response_payload?: Json | null
          retry_count?: number | null
          status_code?: number | null
          webhook_url?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string | null
          direction?: string
          error_message?: string | null
          id?: string
          payload?: Json | null
          response_payload?: Json | null
          retry_count?: number | null
          status_code?: number | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_channels: {
        Row: {
          automation_level: string | null
          channel: string
          config: Json | null
          created_at: string | null
          enabled: boolean | null
          id: string
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          automation_level?: string | null
          channel: string
          config?: Json | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          automation_level?: string | null
          channel?: string
          config?: Json | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_deletion_requests: {
        Row: {
          completed_at: string | null
          confirmed_at: string | null
          created_at: string | null
          export_completed: boolean | null
          export_url: string | null
          id: string
          reason: string | null
          requested_at: string | null
          requested_by: string
          scheduled_for: string | null
          status: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          export_completed?: boolean | null
          export_url?: string | null
          id?: string
          reason?: string | null
          requested_at?: string | null
          requested_by: string
          scheduled_for?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          confirmed_at?: string | null
          created_at?: string | null
          export_completed?: boolean | null
          export_url?: string | null
          id?: string
          reason?: string | null
          requested_at?: string | null
          requested_by?: string
          scheduled_for?: string | null
          status?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_deletion_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_deletion_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_gdpr_settings: {
        Row: {
          company_address: string | null
          company_legal_name: string | null
          created_at: string | null
          custom_privacy_policy: string | null
          data_protection_officer_email: string | null
          dpa_accepted_at: string | null
          dpa_accepted_by: string | null
          dpa_version: string | null
          id: string
          privacy_policy_url: string | null
          sub_processors: Json | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          company_address?: string | null
          company_legal_name?: string | null
          created_at?: string | null
          custom_privacy_policy?: string | null
          data_protection_officer_email?: string | null
          dpa_accepted_at?: string | null
          dpa_accepted_by?: string | null
          dpa_version?: string | null
          id?: string
          privacy_policy_url?: string | null
          sub_processors?: Json | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          company_address?: string | null
          company_legal_name?: string | null
          created_at?: string | null
          custom_privacy_policy?: string | null
          data_protection_officer_email?: string | null
          dpa_accepted_at?: string | null
          dpa_accepted_by?: string | null
          dpa_version?: string | null
          id?: string
          privacy_policy_url?: string | null
          sub_processors?: Json | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_gdpr_settings_dpa_accepted_by_fkey"
            columns: ["dpa_accepted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_gdpr_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          business_days: number[] | null
          business_hours_end: string | null
          business_hours_start: string | null
          business_type: string | null
          core_services: string[] | null
          created_at: string | null
          hiring_mode: boolean | null
          id: string
          name: string
          slug: string
          timezone: string | null
          vip_domains: string[] | null
        }
        Insert: {
          business_days?: number[] | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          business_type?: string | null
          core_services?: string[] | null
          created_at?: string | null
          hiring_mode?: boolean | null
          id?: string
          name: string
          slug: string
          timezone?: string | null
          vip_domains?: string[] | null
        }
        Update: {
          business_days?: number[] | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          business_type?: string | null
          core_services?: string[] | null
          created_at?: string | null
          hiring_mode?: boolean | null
          id?: string
          name?: string
          slug?: string
          timezone?: string | null
          vip_domains?: string[] | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      decrypt_token: {
        Args: { encrypted_token: string; secret: string }
        Returns: string
      }
      encrypt_token: {
        Args: { secret: string; token: string }
        Returns: string
      }
      get_my_workspace_id: { Args: never; Returns: string }
      get_sent_conversations: {
        Args: { p_limit?: number; p_offset?: number; p_user_id: string }
        Returns: {
          ai_reason_for_escalation: string
          assigned_to: string
          category: string
          channel: string
          created_at: string
          customer_id: string
          id: string
          priority: string
          sla_due_at: string
          sla_status: string
          snoozed_until: string
          status: string
          summary_for_human: string
          title: string
          updated_at: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      match_conversations: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
        }
        Returns: {
          ai_response: string
          confidence: number
          customer_satisfaction: number
          final_response: string
          human_edited: boolean
          id: string
          led_to_booking: boolean
          mode: string
          similarity: number
          text: string
        }[]
      }
      match_faqs_with_priority: {
        Args: {
          match_count?: number
          match_threshold?: number
          p_workspace_id: string
          query_embedding: string
        }
        Returns: {
          answer: string
          category: string
          id: string
          is_own_content: boolean
          priority: number
          question: string
          similarity: number
        }[]
      }
      user_has_workspace_access: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "reviewer"
      message_channel: "sms" | "whatsapp" | "email" | "phone" | "webchat"
      message_status: "pending" | "in_progress" | "responded" | "escalated"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "manager", "reviewer"],
      message_channel: ["sms", "whatsapp", "email", "phone", "webchat"],
      message_status: ["pending", "in_progress", "responded", "escalated"],
    },
  },
} as const
