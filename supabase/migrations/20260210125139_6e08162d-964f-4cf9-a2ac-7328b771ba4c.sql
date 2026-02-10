-- Fix Security Definer Views by making them use the querying user's permissions
-- This ensures RLS on underlying tables (messages, conversations, competitor_sites) is respected

-- Recreate training_pairs view with security_invoker = true
CREATE OR REPLACE VIEW public.training_pairs
WITH (security_invoker = true)
AS
SELECT inbound.id AS inbound_id,
    inbound.conversation_id,
    c.title AS subject,
    inbound.body AS customer_text,
    outbound.body AS owner_text,
    c.workspace_id,
    EXTRACT(epoch FROM outbound.created_at - inbound.created_at) / 3600::numeric AS response_hours
   FROM messages inbound
     JOIN messages outbound ON inbound.conversation_id = outbound.conversation_id
     JOIN conversations c ON inbound.conversation_id = c.id
  WHERE inbound.direction = 'inbound'::text AND outbound.direction = 'outbound'::text AND outbound.created_at > inbound.created_at AND outbound.created_at < (inbound.created_at + '3 days'::interval)
  ORDER BY outbound.created_at DESC;

-- Recreate competitor_market_intelligence view with security_invoker = true
CREATE OR REPLACE VIEW public.competitor_market_intelligence
WITH (security_invoker = true)
AS
SELECT job_id,
    count(*) AS total_competitors,
    count(*) FILTER (WHERE is_places_verified = true) AS verified_count,
    count(*) FILTER (WHERE discovery_source = 'google_places'::text) AS from_places,
    count(*) FILTER (WHERE discovery_source = 'google_serp'::text) AS from_serp,
    round(avg(distance_miles) FILTER (WHERE distance_miles IS NOT NULL)::numeric, 2) AS avg_distance,
    round(avg(rating) FILTER (WHERE rating IS NOT NULL)::numeric, 2) AS avg_rating,
    round(avg(reviews_count) FILTER (WHERE reviews_count IS NOT NULL), 0) AS avg_reviews,
    count(*) FILTER (WHERE priority_tier = 'high'::text) AS high_priority,
    count(*) FILTER (WHERE priority_tier = 'medium'::text) AS medium_priority,
    count(*) FILTER (WHERE priority_tier = 'low'::text) AS low_priority,
    round(avg(quality_score), 1) AS avg_quality_score
   FROM competitor_sites
  WHERE is_selected = true
  GROUP BY job_id;