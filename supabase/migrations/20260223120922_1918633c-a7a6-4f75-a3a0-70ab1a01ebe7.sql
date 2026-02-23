-- Fix Security Definer Views by setting them to SECURITY INVOKER
-- This ensures views enforce RLS policies of the querying user, not the view creator

ALTER VIEW public.bb_open_incidents SET (security_invoker = true);
ALTER VIEW public.bb_stalled_events SET (security_invoker = true);
ALTER VIEW public.bb_pipeline_progress SET (security_invoker = true);
ALTER VIEW public.bb_queue_depths SET (security_invoker = true);
ALTER VIEW public.bb_needs_classification SET (security_invoker = true);
