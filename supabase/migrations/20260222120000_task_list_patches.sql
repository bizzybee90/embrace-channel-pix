-- BizzyBee Task List Patches
-- Covers: Task 2 (training_reviewed), Task 6 (omnichannel), Task 7d (nightly cleanup)
-- Also: classification_corrections schema improvements, customer_insights unique constraint

begin;

-- ============================================================
-- Task 2: training_reviewed column on conversations
-- ============================================================

alter table public.conversations
  add column if not exists training_reviewed boolean default false;

-- ============================================================
-- Task 6: Ensure channel columns support webchat
-- The existing check constraints use ('email','whatsapp','sms','facebook','voice').
-- Add 'webchat' as a supported channel value.
-- ============================================================

-- Drop and recreate check constraints to add 'webchat'
-- message_events
do $$
begin
  alter table public.message_events
    drop constraint if exists message_events_channel_check;
  alter table public.message_events
    add constraint message_events_channel_check
    check (channel in ('email', 'whatsapp', 'sms', 'facebook', 'voice', 'webchat'));
exception when others then
  raise notice 'message_events channel check update skipped: %', sqlerrm;
end;
$$;

-- conversation_refs
do $$
begin
  alter table public.conversation_refs
    drop constraint if exists conversation_refs_channel_check;
  alter table public.conversation_refs
    add constraint conversation_refs_channel_check
    check (channel in ('email', 'whatsapp', 'sms', 'facebook', 'voice', 'webchat'));
exception when others then
  raise notice 'conversation_refs channel check update skipped: %', sqlerrm;
end;
$$;

-- pipeline_runs
do $$
begin
  alter table public.pipeline_runs
    drop constraint if exists pipeline_runs_channel_check;
  alter table public.pipeline_runs
    add constraint pipeline_runs_channel_check
    check (channel in ('email', 'whatsapp', 'sms', 'facebook', 'voice', 'webchat'));
exception when others then
  raise notice 'pipeline_runs channel check update skipped: %', sqlerrm;
end;
$$;

-- customer_identities
do $$
begin
  alter table public.customer_identities
    drop constraint if exists customer_identities_identifier_type_check;
  alter table public.customer_identities
    add constraint customer_identities_identifier_type_check
    check (identifier_type in ('email', 'phone', 'whatsapp', 'facebook', 'webchat', 'other'));
exception when others then
  raise notice 'customer_identities identifier_type check update skipped: %', sqlerrm;
end;
$$;

-- ============================================================
-- Classification corrections: add missing columns
-- ============================================================

alter table public.classification_corrections
  add column if not exists conversation_id uuid,
  add column if not exists sender_email text,
  add column if not exists subject text;

-- ============================================================
-- Customer insights: add unique constraint for upsert
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where indexname = 'customer_insights_customer_type_uidx'
  ) then
    create unique index customer_insights_customer_type_uidx
      on public.customer_insights (customer_id, insight_type);
  end if;
exception when others then
  raise notice 'customer_insights unique index skipped: %', sqlerrm;
end;
$$;

-- ============================================================
-- Task 7d: Nightly queue cleanup function + cron
-- ============================================================

-- Helper function to purge archived queue messages
create or replace function public.bb_purge_archived_queues()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_queue text;
  v_count bigint;
begin
  foreach v_queue in array array['bb_ingest_jobs', 'bb_classify_jobs', 'bb_draft_jobs'] loop
    begin
      -- Purge archived messages (processed/completed)
      select pgmq.purge_queue(v_queue) into v_count;
      v_result := v_result || jsonb_build_object(v_queue, coalesce(v_count, 0));
    exception when others then
      v_result := v_result || jsonb_build_object(v_queue, sqlerrm);
    end;
  end loop;

  return v_result;
end;
$$;

revoke all on function public.bb_purge_archived_queues()
  from public, anon, authenticated;
grant execute on function public.bb_purge_archived_queues()
  to service_role;

-- Schedule nightly cleanup at 3 AM UTC
do $$
begin
  -- Remove existing job if present
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'bb_nightly_queue_cleanup';
exception when others then
  null;
end;
$$;

do $$
begin
  perform cron.schedule(
    'bb_nightly_queue_cleanup',
    '0 3 * * *',
    'select public.bb_purge_archived_queues()'
  );
exception when others then
  raise notice 'nightly queue cleanup cron schedule skipped: %', sqlerrm;
end;
$$;

commit;
