-- Unified, queue-driven, multi-channel ingest pipeline for BizzyBee
-- Uses Postgres state machine + Supabase Queues (PGMQ)

begin;

create extension if not exists pgcrypto;
create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public.bb_try_timestamptz(p_value text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;

  return p_value::timestamptz;
exception
  when others then
    return null;
end;
$$;

create or replace function public.bb_norm_identifier(p_type text, p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_type text := lower(coalesce(p_type, 'other'));
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
  v_digits text;
begin
  if v_value is null then
    return null;
  end if;

  if v_type = 'email' then
    return lower(v_value);
  end if;

  if v_type in ('phone', 'whatsapp', 'sms') then
    v_digits := regexp_replace(v_value, '[^0-9+]', '', 'g');
    if v_digits like '00%' then
      v_digits := '+' || substring(v_digits from 3);
    end if;
    if v_digits !~ '^\+' then
      v_digits := '+' || regexp_replace(v_digits, '[^0-9]', '', 'g');
    end if;
    v_digits := regexp_replace(v_digits, '[^0-9+]', '', 'g');
    if length(v_digits) < 8 then
      return lower(v_value);
    end if;
    return v_digits;
  end if;

  return lower(v_value);
end;
$$;

create table if not exists public.pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  config_id uuid,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'facebook', 'voice')),
  mode text not null check (mode in ('onboarding', 'backfill', 'live')),
  params jsonb not null default '{}'::jsonb,
  state text not null default 'running' check (state in ('running', 'paused', 'failed', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_heartbeat_at timestamptz not null default now(),
  metrics jsonb not null default '{}'::jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pipeline_runs_workspace_idx
  on public.pipeline_runs (workspace_id, started_at desc);

create index if not exists pipeline_runs_state_idx
  on public.pipeline_runs (state, channel, mode);

create table if not exists public.pipeline_incidents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  severity text not null check (severity in ('info', 'warning', 'error', 'critical')),
  scope text not null,
  error text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists pipeline_incidents_open_idx
  on public.pipeline_incidents (workspace_id, resolved_at, created_at desc);

create table if not exists public.customer_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  identifier_type text not null check (identifier_type in ('email', 'phone', 'whatsapp', 'facebook', 'other')),
  identifier_value text not null,
  identifier_value_norm text not null,
  verified boolean not null default false,
  source_channel text,
  created_at timestamptz not null default now(),
  unique (workspace_id, identifier_type, identifier_value_norm)
);

create index if not exists customer_identities_customer_idx
  on public.customer_identities (customer_id);

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'facebook', 'voice')),
  config_id uuid not null,
  external_id text not null,
  thread_id text not null,
  direction text not null check (direction in ('inbound', 'outbound')),
  from_identifier text not null,
  from_name text,
  to_identifier text not null,
  subject text,
  body text,
  body_html text,
  "timestamp" timestamptz not null,
  is_read boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  raw_payload jsonb,
  status text not null default 'received' check (status in ('received', 'materialized', 'classified', 'decided', 'drafted', 'failed')),
  last_error text,
  materialized_customer_id uuid references public.customers(id) on delete set null,
  materialized_conversation_id uuid references public.conversations(id) on delete set null,
  materialized_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel, config_id, external_id)
);

create index if not exists message_events_run_idx
  on public.message_events (run_id, status, updated_at);

create index if not exists message_events_workspace_status_idx
  on public.message_events (workspace_id, status, updated_at);

create table if not exists public.conversation_refs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  channel text not null check (channel in ('email', 'whatsapp', 'sms', 'facebook', 'voice')),
  config_id uuid not null,
  external_thread_id text not null,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (workspace_id, channel, config_id, external_thread_id)
);

create index if not exists conversation_refs_conversation_idx
  on public.conversation_refs (conversation_id);

create table if not exists public.pipeline_job_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  run_id uuid references public.pipeline_runs(id) on delete set null,
  queue_name text not null,
  job_payload jsonb not null,
  outcome text not null check (outcome in ('processed', 'requeued', 'deadlettered', 'discarded', 'failed')),
  error text,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_job_audit_run_idx
  on public.pipeline_job_audit (run_id, created_at desc);

alter table public.conversations
  add column if not exists last_inbound_message_id uuid,
  add column if not exists last_inbound_message_at timestamptz,
  add column if not exists last_classified_message_id uuid,
  add column if not exists last_classify_enqueued_message_id uuid,
  add column if not exists last_draft_message_id uuid,
  add column if not exists last_draft_enqueued_message_id uuid;

alter table public.messages
  add column if not exists external_id text,
  add column if not exists external_thread_id text,
  add column if not exists config_id uuid;

create unique index if not exists messages_conversation_external_id_uidx
  on public.messages (conversation_id, external_id)
  where external_id is not null;

create index if not exists messages_external_thread_idx
  on public.messages (external_thread_id);

create or replace function public.bb_queue_send(
  queue_name text,
  message jsonb,
  delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  v_msg_id bigint;
begin
  select pgmq.send(queue_name, message, greatest(delay_seconds, 0))
    into v_msg_id;
  return v_msg_id;
end;
$$;

create or replace function public.bb_queue_send_batch(
  queue_name text,
  messages jsonb[],
  delay_seconds integer default 0
)
returns bigint[]
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
declare
  v_ids bigint[] := '{}'::bigint[];
  v_message jsonb;
  v_msg_id bigint;
begin
  if messages is null or array_length(messages, 1) is null then
    return v_ids;
  end if;

  foreach v_message in array messages loop
    v_msg_id := public.bb_queue_send(queue_name, v_message, delay_seconds);
    v_ids := array_append(v_ids, v_msg_id);
  end loop;

  return v_ids;
end;
$$;

create or replace function public.bb_queue_read(
  queue_name text,
  vt_seconds integer,
  n integer
)
returns table (
  msg_id bigint,
  read_ct integer,
  enqueued_at timestamptz,
  vt timestamptz,
  message jsonb
)
language plpgsql
security definer
set search_path = public, pgmq, pg_catalog
as $$
begin
  return query
  select
    r.msg_id,
    r.read_ct,
    r.enqueued_at,
    r.vt,
    r.message
  from pgmq.read(queue_name, greatest(vt_seconds, 1), greatest(n, 1)) as r(
    msg_id bigint,
    read_ct integer,
    enqueued_at timestamptz,
    vt timestamptz,
    message jsonb
  );
end;
$$;

create or replace function public.bb_queue_delete(
  queue_name text,
  msg_id bigint
)
returns boolean
language sql
security definer
set search_path = public, pgmq, pg_catalog
as $$
  select pgmq.delete(queue_name, msg_id);
$$;

create or replace function public.bb_queue_archive(
  queue_name text,
  msg_id bigint
)
returns boolean
language sql
security definer
set search_path = public, pgmq, pg_catalog
as $$
  select pgmq.archive(queue_name, msg_id);
$$;

create or replace function public.bb_record_incident(
  p_workspace_id uuid,
  p_run_id uuid,
  p_severity text,
  p_scope text,
  p_error text,
  p_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.pipeline_incidents (
    workspace_id,
    run_id,
    severity,
    scope,
    error,
    context
  )
  values (
    p_workspace_id,
    p_run_id,
    case
      when p_severity in ('info', 'warning', 'error', 'critical') then p_severity
      else 'error'
    end,
    coalesce(nullif(btrim(p_scope), ''), 'pipeline'),
    coalesce(nullif(btrim(p_error), ''), 'Unknown pipeline incident'),
    coalesce(p_context, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.bb_touch_pipeline_run(
  p_run_id uuid,
  p_metrics_patch jsonb default '{}'::jsonb,
  p_state text default null,
  p_last_error text default null,
  p_mark_completed boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_run_id is null then
    return;
  end if;

  update public.pipeline_runs
  set
    last_heartbeat_at = now(),
    metrics = coalesce(public.pipeline_runs.metrics, '{}'::jsonb) || coalesce(p_metrics_patch, '{}'::jsonb),
    state = case
      when p_state in ('running', 'paused', 'failed', 'completed') then p_state
      else public.pipeline_runs.state
    end,
    last_error = coalesce(p_last_error, public.pipeline_runs.last_error),
    completed_at = case
      when p_mark_completed then coalesce(public.pipeline_runs.completed_at, now())
      else public.pipeline_runs.completed_at
    end,
    updated_at = now()
  where id = p_run_id;
end;
$$;

create or replace function public.bb_ingest_unified_messages(
  p_workspace_id uuid,
  p_config_id uuid,
  p_run_id uuid,
  p_channel text,
  p_messages jsonb
)
returns table (
  received_count integer,
  enqueued_count integer,
  run_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_received_count integer := 0;
  v_enqueued_count integer := 0;
  v_jobs jsonb[] := '{}'::jsonb[];
  v_row record;
begin
  if p_messages is null or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'p_messages must be a JSON array';
  end if;

  if p_channel not in ('email', 'whatsapp', 'sms', 'facebook', 'voice') then
    raise exception 'unsupported channel: %', p_channel;
  end if;

  for v_row in
    with payload as (
      select
        item,
        nullif(btrim(item->>'external_id'), '') as external_id,
        nullif(btrim(item->>'thread_id'), '') as thread_id,
        lower(coalesce(nullif(btrim(item->>'direction'), ''), 'inbound')) as direction,
        nullif(btrim(item->>'from_identifier'), '') as from_identifier,
        nullif(btrim(item->>'from_name'), '') as from_name,
        nullif(btrim(item->>'to_identifier'), '') as to_identifier,
        nullif(btrim(item->>'subject'), '') as subject,
        nullif(item->>'body', '') as body,
        nullif(item->>'body_html', '') as body_html,
        coalesce(public.bb_try_timestamptz(item->>'timestamp'), now()) as message_ts,
        case
          when lower(coalesce(item->>'is_read', '')) in ('true', 'false')
            then (item->>'is_read')::boolean
          else true
        end as is_read,
        coalesce(item->'metadata', '{}'::jsonb) as metadata,
        item->'raw_payload' as raw_payload
      from jsonb_array_elements(p_messages) as item
    ),
    valid as (
      select *
      from payload
      where external_id is not null
        and thread_id is not null
        and from_identifier is not null
        and to_identifier is not null
        and direction in ('inbound', 'outbound')
    ),
    upserted as (
      insert into public.message_events (
        workspace_id,
        run_id,
        channel,
        config_id,
        external_id,
        thread_id,
        direction,
        from_identifier,
        from_name,
        to_identifier,
        subject,
        body,
        body_html,
        "timestamp",
        is_read,
        metadata,
        raw_payload,
        status,
        updated_at
      )
      select
        p_workspace_id,
        p_run_id,
        p_channel,
        p_config_id,
        v.external_id,
        v.thread_id,
        v.direction,
        v.from_identifier,
        v.from_name,
        v.to_identifier,
        v.subject,
        v.body,
        v.body_html,
        v.message_ts,
        v.is_read,
        coalesce(v.metadata, '{}'::jsonb),
        v.raw_payload,
        'received',
        now()
      from valid v
      on conflict (workspace_id, channel, config_id, external_id)
      do update
      set
        run_id = coalesce(excluded.run_id, message_events.run_id),
        thread_id = excluded.thread_id,
        direction = excluded.direction,
        from_identifier = excluded.from_identifier,
        from_name = coalesce(excluded.from_name, message_events.from_name),
        to_identifier = excluded.to_identifier,
        subject = coalesce(excluded.subject, message_events.subject),
        body = coalesce(excluded.body, message_events.body),
        body_html = coalesce(excluded.body_html, message_events.body_html),
        "timestamp" = excluded."timestamp",
        is_read = excluded.is_read,
        metadata = coalesce(excluded.metadata, message_events.metadata),
        raw_payload = coalesce(excluded.raw_payload, message_events.raw_payload),
        status = case
          when message_events.status in ('materialized', 'classified', 'decided', 'drafted')
            then message_events.status
          else 'received'
        end,
        last_error = null,
        updated_at = now()
      returning id, status
    )
    select * from upserted
  loop
    v_received_count := v_received_count + 1;

    if v_row.status = 'received' then
      v_jobs := array_append(
        v_jobs,
        jsonb_build_object(
          'job_type', 'MATERIALIZE',
          'event_id', v_row.id,
          'workspace_id', p_workspace_id,
          'run_id', p_run_id,
          'channel', p_channel,
          'config_id', p_config_id
        )
      );
    end if;
  end loop;

  if array_length(v_jobs, 1) is not null then
    perform public.bb_queue_send_batch('bb_ingest_jobs', v_jobs, 0);
    v_enqueued_count := array_length(v_jobs, 1);
  end if;

  return query
  select v_received_count, v_enqueued_count, p_run_id;
end;
$$;

create or replace function public.bb_materialize_event(
  p_event_id uuid
)
returns table (
  did_work boolean,
  workspace_id uuid,
  run_id uuid,
  channel text,
  config_id uuid,
  conversation_id uuid,
  message_id uuid,
  needs_classify boolean,
  target_message_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.message_events%rowtype;
  v_identifier_type text;
  v_counterparty_identifier text;
  v_counterparty_norm text;
  v_customer_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
  v_last_inbound_message_id uuid;
  v_last_classified_message_id uuid;
  v_last_classify_enqueued_message_id uuid;
  v_needs_classify boolean := false;
  v_target_message_id uuid;
  v_initial_status text;
begin
  select *
    into v_event
  from public.message_events
  where id = p_event_id
  for update;

  if not found then
    raise exception 'message_event % not found', p_event_id;
  end if;

  workspace_id := v_event.workspace_id;
  run_id := v_event.run_id;
  channel := v_event.channel;
  config_id := v_event.config_id;
  conversation_id := v_event.materialized_conversation_id;
  message_id := v_event.materialized_message_id;
  needs_classify := false;
  target_message_id := null;

  if v_event.status in ('materialized', 'classified', 'decided', 'drafted')
    and v_event.materialized_message_id is not null then
    did_work := false;
    return next;
    return;
  end if;

  did_work := true;

  v_identifier_type := case v_event.channel
    when 'email' then 'email'
    when 'whatsapp' then 'phone'
    when 'sms' then 'phone'
    when 'facebook' then 'facebook'
    else 'other'
  end;

  if v_event.direction = 'inbound' then
    v_counterparty_identifier := v_event.from_identifier;
  else
    v_counterparty_identifier := v_event.to_identifier;
  end if;

  v_counterparty_norm := public.bb_norm_identifier(v_identifier_type, v_counterparty_identifier);
  if v_counterparty_norm is null then
    v_counterparty_norm := format('unknown:%s:%s', v_event.channel, v_event.external_id);
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format('bb_identity:%s:%s:%s', v_event.workspace_id, v_identifier_type, v_counterparty_norm),
      0
    )
  );

  select ci.customer_id
    into v_customer_id
  from public.customer_identities ci
  where ci.workspace_id = v_event.workspace_id
    and ci.identifier_type = v_identifier_type
    and ci.identifier_value_norm = v_counterparty_norm
  limit 1;

  if v_customer_id is null then
    insert into public.customers (
      workspace_id,
      name,
      email,
      phone,
      preferred_channel,
      created_at
    )
    values (
      v_event.workspace_id,
      coalesce(v_event.from_name, nullif(v_counterparty_identifier, ''), 'Unknown Customer'),
      case when v_identifier_type = 'email' then v_counterparty_norm else null end,
      case when v_identifier_type in ('phone', 'whatsapp') then v_counterparty_norm else null end,
      v_event.channel,
      now()
    )
    returning id into v_customer_id;

    insert into public.customer_identities (
      workspace_id,
      customer_id,
      identifier_type,
      identifier_value,
      identifier_value_norm,
      verified,
      source_channel
    )
    values (
      v_event.workspace_id,
      v_customer_id,
      v_identifier_type,
      v_counterparty_identifier,
      v_counterparty_norm,
      false,
      v_event.channel
    )
    on conflict (workspace_id, identifier_type, identifier_value_norm)
    do update
      set
        identifier_value = excluded.identifier_value,
        verified = customer_identities.verified or excluded.verified,
        source_channel = coalesce(customer_identities.source_channel, excluded.source_channel)
    returning customer_id into v_customer_id;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      format('bb_thread:%s:%s:%s:%s', v_event.workspace_id, v_event.channel, v_event.config_id, v_event.thread_id),
      0
    )
  );

  select cr.conversation_id
    into v_conversation_id
  from public.conversation_refs cr
  where cr.workspace_id = v_event.workspace_id
    and cr.channel = v_event.channel
    and cr.config_id = v_event.config_id
    and cr.external_thread_id = v_event.thread_id
  limit 1;

  if v_conversation_id is null then
    v_initial_status := case
      when v_event.direction = 'inbound' and coalesce(v_event.is_read, true) = false then 'new'
      else 'open'
    end;

    insert into public.conversations (
      workspace_id,
      customer_id,
      external_conversation_id,
      title,
      channel,
      status,
      created_at,
      updated_at
    )
    values (
      v_event.workspace_id,
      v_customer_id,
      v_event.thread_id,
      coalesce(v_event.subject, 'Conversation ' || v_event.thread_id),
      v_event.channel,
      v_initial_status,
      now(),
      now()
    )
    returning id into v_conversation_id;

    insert into public.conversation_refs (
      workspace_id,
      channel,
      config_id,
      external_thread_id,
      conversation_id
    )
    values (
      v_event.workspace_id,
      v_event.channel,
      v_event.config_id,
      v_event.thread_id,
      v_conversation_id
    )
    on conflict (workspace_id, channel, config_id, external_thread_id)
    do update
      set conversation_id = conversation_refs.conversation_id
    returning conversation_id into v_conversation_id;
  else
    update public.conversations
      set
        customer_id = coalesce(public.conversations.customer_id, v_customer_id),
        updated_at = now()
    where id = v_conversation_id;
  end if;

  insert into public.messages (
    conversation_id,
    actor_type,
    actor_name,
    direction,
    channel,
    body,
    is_internal,
    raw_payload,
    created_at,
    external_id,
    external_thread_id,
    config_id
  )
  values (
    v_conversation_id,
    case when v_event.direction = 'inbound' then 'customer' else 'agent' end,
    coalesce(
      v_event.from_name,
      v_event.from_identifier,
      'Unknown'
    ),
    v_event.direction,
    v_event.channel,
    coalesce(v_event.body, ''),
    false,
    coalesce(v_event.raw_payload, jsonb_build_object('metadata', v_event.metadata)),
    coalesce(v_event."timestamp", now()),
    v_event.external_id,
    v_event.thread_id,
    v_event.config_id
  )
  on conflict (conversation_id, external_id)
  do update
    set
      body = coalesce(excluded.body, messages.body),
      raw_payload = coalesce(messages.raw_payload, excluded.raw_payload),
      channel = excluded.channel
  returning id into v_message_id;

  if v_event.direction = 'inbound' then
    update public.conversations
      set
        last_inbound_message_id = v_message_id,
        last_inbound_message_at = coalesce(v_event."timestamp", now()),
        status = case
          when public.conversations.status in ('escalated', 'resolved') then public.conversations.status
          when coalesce(v_event.is_read, true) = false then 'new'
          else 'open'
        end,
        updated_at = now()
    where id = v_conversation_id;
  else
    update public.conversations
      set updated_at = now()
    where id = v_conversation_id;
  end if;

  select
    c.last_inbound_message_id,
    c.last_classified_message_id,
    c.last_classify_enqueued_message_id
  into
    v_last_inbound_message_id,
    v_last_classified_message_id,
    v_last_classify_enqueued_message_id
  from public.conversations c
  where c.id = v_conversation_id
  for update;

  if v_event.direction = 'inbound'
    and v_last_inbound_message_id is not null
    and v_last_inbound_message_id is distinct from v_last_classified_message_id
    and v_last_classify_enqueued_message_id is distinct from v_last_inbound_message_id then

    update public.conversations
      set last_classify_enqueued_message_id = v_last_inbound_message_id,
          updated_at = now()
    where id = v_conversation_id;

    perform public.bb_queue_send(
      'bb_classify_jobs',
      jsonb_build_object(
        'job_type', 'CLASSIFY',
        'workspace_id', v_event.workspace_id,
        'run_id', v_event.run_id,
        'config_id', v_event.config_id,
        'channel', v_event.channel,
        'event_id', v_event.id,
        'conversation_id', v_conversation_id,
        'target_message_id', v_last_inbound_message_id
      ),
      0
    );

    v_needs_classify := true;
    v_target_message_id := v_last_inbound_message_id;
  end if;

  update public.message_events
    set
      materialized_customer_id = v_customer_id,
      materialized_conversation_id = v_conversation_id,
      materialized_message_id = v_message_id,
      status = 'materialized',
      last_error = null,
      updated_at = now()
  where id = v_event.id;

  workspace_id := v_event.workspace_id;
  run_id := v_event.run_id;
  channel := v_event.channel;
  config_id := v_event.config_id;
  conversation_id := v_conversation_id;
  message_id := v_message_id;
  needs_classify := v_needs_classify;
  target_message_id := v_target_message_id;

  return next;
end;
$$;

create or replace function public.bb_queue_visible_count(p_queue_name text)
returns bigint
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_table regclass;
  v_count bigint := 0;
begin
  v_table := to_regclass(format('pgmq.%I', 'q_' || p_queue_name));
  if v_table is null then
    return 0;
  end if;

  execute format('select count(*)::bigint from %s where vt <= now()', v_table)
    into v_count;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.bb_user_in_workspace(p_workspace_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_has_access boolean := false;
begin
  if auth.role() = 'service_role' then
    return true;
  end if;

  if v_uid is null then
    return false;
  end if;

  if to_regclass('public.workspace_members') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspace_members'
        and column_name = 'user_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspace_members
           where workspace_id = $1 and user_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspace_members'
        and column_name = 'member_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspace_members
           where workspace_id = $1 and member_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;
  end if;

  if to_regclass('public.workspaces') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspaces'
        and column_name = 'owner_id'
    ) then
      execute
        'select exists (
           select 1
           from public.workspaces
           where id = $1 and owner_id = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'workspaces'
        and column_name = 'created_by'
    ) then
      execute
        'select exists (
           select 1
           from public.workspaces
           where id = $1 and created_by = $2
         )'
      into v_has_access
      using p_workspace_id, v_uid;

      if v_has_access then
        return true;
      end if;
    end if;
  end if;

  return false;
end;
$$;

create or replace function public.bb_trigger_worker(
  p_url_secret_name text,
  p_body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_anon_key text;
  v_worker_token text;
  v_request_id bigint;
begin
  select ds.decrypted_secret
    into v_url
  from vault.decrypted_secrets ds
  where ds.name = p_url_secret_name
  limit 1;

  if v_url is null then
    raise exception 'Missing Vault secret: %', p_url_secret_name;
  end if;

  select ds.decrypted_secret
    into v_anon_key
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_anon_key'
  limit 1;

  if v_anon_key is null then
    raise exception 'Missing Vault secret: bb_worker_anon_key';
  end if;

  select ds.decrypted_secret
    into v_worker_token
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_token'
  limit 1;

  if v_worker_token is null then
    raise exception 'Missing Vault secret: bb_worker_token';
  end if;

  select net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'Authorization', 'Bearer ' || v_anon_key,
      'x-bb-worker-token', v_worker_token
    ),
    body := coalesce(p_body, '{}'::jsonb)
  )
  into v_request_id;

  return v_request_id;
end;
$$;

create or replace function public.bb_unschedule_pipeline_crons()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_removed integer := 0;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'bb_pipeline_worker_import',
      'bb_pipeline_worker_ingest',
      'bb_pipeline_worker_classify',
      'bb_pipeline_worker_draft',
      'bb_pipeline_supervisor'
    )
  loop
    perform cron.unschedule(v_job.jobid);
    v_removed := v_removed + 1;
  end loop;

  return v_removed;
end;
$$;

create or replace function public.bb_schedule_pipeline_crons()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bb_unschedule_pipeline_crons();

  perform cron.schedule(
    'bb_pipeline_worker_import',
    '10 seconds',
    'select public.bb_trigger_worker(''bb_worker_import_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_ingest',
    '10 seconds',
    'select public.bb_trigger_worker(''bb_worker_ingest_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_classify',
    '10 seconds',
    'select public.bb_trigger_worker(''bb_worker_classify_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_worker_draft',
    '25 seconds',
    'select public.bb_trigger_worker(''bb_worker_draft_url'')'
  );

  perform cron.schedule(
    'bb_pipeline_supervisor',
    '2 minutes',
    'select public.bb_trigger_worker(''bb_worker_supervisor_url'')'
  );
end;
$$;

do $$
begin
  begin
    perform pgmq.create('bb_import_jobs');
  exception when others then
    raise notice 'Queue bb_import_jobs create skipped: %', sqlerrm;
  end;

  begin
    perform pgmq.create('bb_ingest_jobs');
  exception when others then
    raise notice 'Queue bb_ingest_jobs create skipped: %', sqlerrm;
  end;

  begin
    perform pgmq.create('bb_classify_jobs');
  exception when others then
    raise notice 'Queue bb_classify_jobs create skipped: %', sqlerrm;
  end;

  begin
    perform pgmq.create('bb_draft_jobs');
  exception when others then
    raise notice 'Queue bb_draft_jobs create skipped: %', sqlerrm;
  end;

  begin
    perform pgmq.create('bb_deadletter_jobs');
  exception when others then
    raise notice 'Queue bb_deadletter_jobs create skipped: %', sqlerrm;
  end;
end;
$$;

create or replace view public.bb_open_incidents as
select
  pi.id,
  pi.workspace_id,
  pi.run_id,
  pi.severity,
  pi.scope,
  pi.error,
  pi.context,
  pi.created_at
from public.pipeline_incidents pi
where pi.resolved_at is null
order by pi.created_at desc;

create or replace view public.bb_stalled_events as
select
  me.id,
  me.workspace_id,
  me.run_id,
  me.channel,
  me.config_id,
  me.external_id,
  me.thread_id,
  me.status,
  me.created_at,
  me.updated_at,
  now() - me.updated_at as age
from public.message_events me
where (
    me.status = 'received' and me.updated_at < now() - interval '10 minutes'
  )
  or (
    me.status = 'materialized' and me.updated_at < now() - interval '10 minutes'
  )
  or (
    me.status = 'classified' and me.updated_at < now() - interval '10 minutes'
  )
order by me.updated_at asc;

create or replace view public.bb_pipeline_progress as
select
  pr.id as run_id,
  pr.workspace_id,
  pr.config_id,
  pr.channel,
  pr.mode,
  pr.state,
  pr.started_at,
  pr.completed_at,
  pr.last_heartbeat_at,
  now() - pr.last_heartbeat_at as heartbeat_age,
  count(me.id) as total_events,
  count(me.id) filter (where me.status = 'received') as received_events,
  count(me.id) filter (where me.status = 'materialized') as materialized_events,
  count(me.id) filter (where me.status = 'classified') as classified_events,
  count(me.id) filter (where me.status = 'decided') as decided_events,
  count(me.id) filter (where me.status = 'drafted') as drafted_events,
  count(me.id) filter (where me.status = 'failed') as failed_events,
  pr.metrics,
  pr.last_error
from public.pipeline_runs pr
left join public.message_events me
  on me.run_id = pr.id
group by pr.id;

create or replace view public.bb_queue_depths as
select *
from (
  values
    ('bb_import_jobs'::text),
    ('bb_ingest_jobs'::text),
    ('bb_classify_jobs'::text),
    ('bb_draft_jobs'::text),
    ('bb_deadletter_jobs'::text)
) as q(queue_name)
cross join lateral (
  select public.bb_queue_visible_count(q.queue_name) as visible_messages
) depth;

create or replace view public.bb_needs_classification as
select
  c.id as conversation_id,
  c.workspace_id,
  c.channel,
  c.status,
  c.last_inbound_message_id,
  c.last_classified_message_id,
  c.last_classify_enqueued_message_id,
  c.updated_at
from public.conversations c
where c.last_inbound_message_id is not null
  and c.last_inbound_message_id is distinct from c.last_classified_message_id;

alter table public.customer_identities enable row level security;
alter table public.message_events enable row level security;
alter table public.conversation_refs enable row level security;
alter table public.pipeline_runs enable row level security;
alter table public.pipeline_incidents enable row level security;
alter table public.pipeline_job_audit enable row level security;

drop policy if exists customer_identities_select on public.customer_identities;
create policy customer_identities_select
  on public.customer_identities
  for select
  using (public.bb_user_in_workspace(workspace_id));

drop policy if exists customer_identities_service_write on public.customer_identities;
create policy customer_identities_service_write
  on public.customer_identities
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists message_events_select on public.message_events;
create policy message_events_select
  on public.message_events
  for select
  using (public.bb_user_in_workspace(workspace_id));

drop policy if exists message_events_service_write on public.message_events;
create policy message_events_service_write
  on public.message_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists conversation_refs_select on public.conversation_refs;
create policy conversation_refs_select
  on public.conversation_refs
  for select
  using (public.bb_user_in_workspace(workspace_id));

drop policy if exists conversation_refs_service_write on public.conversation_refs;
create policy conversation_refs_service_write
  on public.conversation_refs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists pipeline_runs_select on public.pipeline_runs;
create policy pipeline_runs_select
  on public.pipeline_runs
  for select
  using (public.bb_user_in_workspace(workspace_id));

drop policy if exists pipeline_runs_service_write on public.pipeline_runs;
create policy pipeline_runs_service_write
  on public.pipeline_runs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists pipeline_incidents_select on public.pipeline_incidents;
create policy pipeline_incidents_select
  on public.pipeline_incidents
  for select
  using (public.bb_user_in_workspace(workspace_id));

drop policy if exists pipeline_incidents_service_write on public.pipeline_incidents;
create policy pipeline_incidents_service_write
  on public.pipeline_incidents
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists pipeline_job_audit_select on public.pipeline_job_audit;
create policy pipeline_job_audit_select
  on public.pipeline_job_audit
  for select
  using (workspace_id is null or public.bb_user_in_workspace(workspace_id));

drop policy if exists pipeline_job_audit_service_write on public.pipeline_job_audit;
create policy pipeline_job_audit_service_write
  on public.pipeline_job_audit
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant usage on schema public to authenticated, service_role;

grant select on public.customer_identities to authenticated;
grant select on public.message_events to authenticated;
grant select on public.conversation_refs to authenticated;
grant select on public.pipeline_runs to authenticated;
grant select on public.pipeline_incidents to authenticated;
grant select on public.pipeline_job_audit to authenticated;

grant select on public.bb_open_incidents to authenticated;
grant select on public.bb_stalled_events to authenticated;
grant select on public.bb_pipeline_progress to authenticated;
grant select on public.bb_queue_depths to authenticated;
grant select on public.bb_needs_classification to authenticated;

grant all privileges on public.customer_identities to service_role;
grant all privileges on public.message_events to service_role;
grant all privileges on public.conversation_refs to service_role;
grant all privileges on public.pipeline_runs to service_role;
grant all privileges on public.pipeline_incidents to service_role;
grant all privileges on public.pipeline_job_audit to service_role;

revoke all on function public.bb_queue_send(text, jsonb, integer)
  from public, anon, authenticated;
revoke all on function public.bb_queue_send_batch(text, jsonb[], integer)
  from public, anon, authenticated;
revoke all on function public.bb_queue_read(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.bb_queue_delete(text, bigint)
  from public, anon, authenticated;
revoke all on function public.bb_queue_archive(text, bigint)
  from public, anon, authenticated;

revoke all on function public.bb_materialize_event(uuid)
  from public, anon, authenticated;

revoke all on function public.bb_ingest_unified_messages(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;

revoke all on function public.bb_record_incident(uuid, uuid, text, text, text, jsonb)
  from public, anon, authenticated;

revoke all on function public.bb_touch_pipeline_run(uuid, jsonb, text, text, boolean)
  from public, anon, authenticated;

revoke all on function public.bb_trigger_worker(text, jsonb)
  from public, anon, authenticated;

revoke all on function public.bb_schedule_pipeline_crons()
  from public, anon, authenticated;

revoke all on function public.bb_unschedule_pipeline_crons()
  from public, anon, authenticated;

grant execute on function public.bb_queue_send(text, jsonb, integer) to service_role;
grant execute on function public.bb_queue_send_batch(text, jsonb[], integer) to service_role;
grant execute on function public.bb_queue_read(text, integer, integer) to service_role;
grant execute on function public.bb_queue_delete(text, bigint) to service_role;
grant execute on function public.bb_queue_archive(text, bigint) to service_role;
grant execute on function public.bb_materialize_event(uuid) to service_role;
grant execute on function public.bb_ingest_unified_messages(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.bb_record_incident(uuid, uuid, text, text, text, jsonb) to service_role;
grant execute on function public.bb_touch_pipeline_run(uuid, jsonb, text, text, boolean) to service_role;
grant execute on function public.bb_trigger_worker(text, jsonb) to service_role;
grant execute on function public.bb_schedule_pipeline_crons() to service_role;
grant execute on function public.bb_unschedule_pipeline_crons() to service_role;

grant execute on function public.bb_norm_identifier(text, text) to authenticated, service_role;
grant execute on function public.bb_queue_visible_count(text) to authenticated, service_role;
grant execute on function public.bb_user_in_workspace(uuid) to authenticated, service_role;

commit;
