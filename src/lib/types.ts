export type AppRole = 'admin' | 'manager' | 'reviewer';

export type Priority = 'high' | 'medium' | 'low';
export type ConversationStatus = 'new' | 'open' | 'waiting_customer' | 'waiting_internal' | 'resolved' | 'closed';
export type Channel = 'sms' | 'whatsapp' | 'email' | 'web_chat';
export type SLAStatus = 'safe' | 'warning' | 'breached';
export type CustomerTier = 'vip' | 'regular' | 'trial' | 'prospect' | 'at_risk';
export type UserStatus = 'available' | 'away' | 'busy';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  business_hours_start: string;
  business_hours_end: string;
  business_days: number[];
  created_at: string;
}

export interface User {
  id: string;
  workspace_id: string;
  name: string;
  email: string;
  is_online: boolean;
  status: UserStatus;
  last_active_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRole {
  id: string;
  user_id: string;
  role: AppRole;
}

export interface Customer {
  id: string;
  workspace_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  preferred_channel: string | null;
  tier: CustomerTier;
  notes: string | null;
  custom_fields: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  workspace_id: string;
  customer_id: string;
  external_conversation_id: string | null;
  title: string | null;
  summary_for_human: string | null;
  channel: Channel;
  category: string;
  priority: Priority;
  status: ConversationStatus;
  ai_confidence: number | null;
  ai_sentiment: string | null;
  ai_reason_for_escalation: string | null;
  assigned_to: string | null;
  sla_target_minutes: number;
  sla_due_at: string | null;
  sla_status: SLAStatus;
  first_response_at: string | null;
  resolved_at: string | null;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  customer?: Customer;
  assigned_user?: User;
}

export interface Message {
  id: string;
  conversation_id: string;
  actor_type: 'customer' | 'ai_agent' | 'human_agent' | 'system';
  actor_id: string | null;
  actor_name: string | null;
  direction: 'inbound' | 'outbound';
  channel: Channel;
  body: string;
  is_internal: boolean;
  raw_payload: Record<string, any> | null;
  created_at: string;
}

export interface Template {
  id: string;
  workspace_id: string;
  name: string;
  category: string | null;
  body: string;
  usage_count: number;
  created_at: string;
}

export interface SLAConfig {
  id: string;
  workspace_id: string;
  priority: Priority;
  first_response_minutes: number;
  pause_outside_hours: boolean;
}
