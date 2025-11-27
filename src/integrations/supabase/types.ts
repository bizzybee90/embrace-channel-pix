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
      business_facts: {
        Row: {
          category: string
          created_at: string | null
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
      conversations: {
        Row: {
          ai_confidence: number | null
          ai_draft_response: string | null
          ai_message_count: number | null
          ai_reason_for_escalation: string | null
          ai_resolution_summary: string | null
          ai_sentiment: string | null
          assigned_to: string | null
          auto_responded: boolean | null
          category: string | null
          channel: string
          confidence: number | null
          conversation_type: string | null
          created_at: string | null
          customer_id: string | null
          customer_satisfaction: number | null
          embedding: string | null
          escalated_at: string | null
          external_conversation_id: string | null
          final_response: string | null
          first_response_at: string | null
          human_edited: boolean | null
          id: string
          is_escalated: boolean | null
          led_to_booking: boolean | null
          message_count: number | null
          metadata: Json | null
          mode: string | null
          needs_embedding: boolean | null
          priority: string | null
          resolved_at: string | null
          sla_due_at: string | null
          sla_status: string | null
          sla_target_minutes: number | null
          snoozed_until: string | null
          status: string | null
          summary_for_human: string | null
          title: string | null
          updated_at: string | null
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
          auto_responded?: boolean | null
          category?: string | null
          channel: string
          confidence?: number | null
          conversation_type?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_satisfaction?: number | null
          embedding?: string | null
          escalated_at?: string | null
          external_conversation_id?: string | null
          final_response?: string | null
          first_response_at?: string | null
          human_edited?: boolean | null
          id?: string
          is_escalated?: boolean | null
          led_to_booking?: boolean | null
          message_count?: number | null
          metadata?: Json | null
          mode?: string | null
          needs_embedding?: boolean | null
          priority?: string | null
          resolved_at?: string | null
          sla_due_at?: string | null
          sla_status?: string | null
          sla_target_minutes?: number | null
          snoozed_until?: string | null
          status?: string | null
          summary_for_human?: string | null
          title?: string | null
          updated_at?: string | null
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
          auto_responded?: boolean | null
          category?: string | null
          channel?: string
          confidence?: number | null
          conversation_type?: string | null
          created_at?: string | null
          customer_id?: string | null
          customer_satisfaction?: number | null
          embedding?: string | null
          escalated_at?: string | null
          external_conversation_id?: string | null
          final_response?: string | null
          first_response_at?: string | null
          human_edited?: boolean | null
          id?: string
          is_escalated?: boolean | null
          led_to_booking?: boolean | null
          message_count?: number | null
          metadata?: Json | null
          mode?: string | null
          needs_embedding?: boolean | null
          priority?: string | null
          resolved_at?: string | null
          sla_due_at?: string | null
          sla_status?: string | null
          sla_target_minutes?: number | null
          snoozed_until?: string | null
          status?: string | null
          summary_for_human?: string | null
          title?: string | null
          updated_at?: string | null
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
          notes: string | null
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
          notes?: string | null
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
          notes?: string | null
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
          created_at: string | null
          custom_fields: Json | null
          email: string | null
          id: string
          name: string | null
          notes: string | null
          phone: string | null
          preferred_channel: string | null
          tier: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          created_at?: string | null
          custom_fields?: Json | null
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          phone?: string | null
          preferred_channel?: string | null
          tier?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          created_at?: string | null
          custom_fields?: Json | null
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          phone?: string | null
          preferred_channel?: string | null
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
        }
        Relationships: []
      }
      faq_database: {
        Row: {
          answer: string
          category: string
          created_at: string | null
          id: string
          keywords: string[] | null
          priority: number | null
          question: string
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          answer: string
          category: string
          created_at?: string | null
          id?: string
          keywords?: string[] | null
          priority?: number | null
          question: string
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          answer?: string
          category?: string
          created_at?: string | null
          id?: string
          keywords?: string[] | null
          priority?: number | null
          question?: string
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
      price_list: {
        Row: {
          base_price: number | null
          created_at: string | null
          currency: string | null
          description: string | null
          id: string
          metadata: Json | null
          price_range: string | null
          service_name: string
          unit: string | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          base_price?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          price_range?: string | null
          service_name: string
          unit?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          base_price?: number | null
          created_at?: string | null
          currency?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          price_range?: string | null
          service_name?: string
          unit?: string | null
          updated_at?: string | null
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
          channel: string
          config: Json | null
          created_at: string | null
          enabled: boolean | null
          id: string
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          channel: string
          config?: Json | null
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
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
      workspaces: {
        Row: {
          business_days: number[] | null
          business_hours_end: string | null
          business_hours_start: string | null
          created_at: string | null
          id: string
          name: string
          slug: string
          timezone: string | null
        }
        Insert: {
          business_days?: number[] | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          created_at?: string | null
          id?: string
          name: string
          slug: string
          timezone?: string | null
        }
        Update: {
          business_days?: number[] | null
          business_hours_end?: string | null
          business_hours_start?: string | null
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
          timezone?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_my_workspace_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
