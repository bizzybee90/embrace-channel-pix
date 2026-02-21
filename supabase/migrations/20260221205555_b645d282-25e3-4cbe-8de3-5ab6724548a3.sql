
begin;

-- Change 3: Instant worker wake-up for live messages
create or replace function public.bb_wake_worker(p_url_secret_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_anon_key text;
  v_worker_token text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds
  where ds.name = p_url_secret_name limit 1;

  if v_url is null then return; end if;

  select ds.decrypted_secret into v_anon_key
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_anon_key' limit 1;

  if v_anon_key is null then return; end if;

  select ds.decrypted_secret into v_worker_token
  from vault.decrypted_secrets ds
  where ds.name = 'bb_worker_token' limit 1;

  if v_worker_token is null then return; end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_anon_key,
      'Authorization', 'Bearer ' || v_anon_key,
      'x-bb-worker-token', v_worker_token
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.bb_wake_worker(text) from public, anon, authenticated;
grant execute on function public.bb_wake_worker(text) to service_role;

-- Update bb_ingest_unified_messages to wake worker for live messages
create or replace function public.bb_ingest_unified_messages(p_workspace_id uuid, p_config_id uuid, p_run_id uuid, p_channel text, p_messages jsonb)
returns table(received_count integer, enqueued_count integer, run_id uuid)
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
  if p_channel not in ('email','whatsapp','sms','facebook','voice') then
    raise exception 'unsupported channel: %', p_channel;
  end if;

  for v_row in
    with payload as (
      select item,
        nullif(btrim(item->>'external_id'),'') as external_id,
        nullif(btrim(item->>'thread_id'),'') as thread_id,
        lower(coalesce(nullif(btrim(item->>'direction'),''),'inbound')) as direction,
        nullif(btrim(item->>'from_identifier'),'') as from_identifier,
        nullif(btrim(item->>'from_name'),'') as from_name,
        nullif(btrim(item->>'to_identifier'),'') as to_identifier,
        nullif(btrim(item->>'subject'),'') as subject,
        nullif(item->>'body','') as body,
        nullif(item->>'body_html','') as body_html,
        coalesce(public.bb_try_timestamptz(item->>'timestamp'), now()) as message_ts,
        case when lower(coalesce(item->>'is_read','')) in ('true','false') then (item->>'is_read')::boolean else true end as is_read,
        coalesce(item->'metadata','{}'::jsonb) as metadata,
        item->'raw_payload' as raw_payload
      from jsonb_array_elements(p_messages) as item
    ),
    valid as (
      select * from payload
      where external_id is not null and thread_id is not null and from_identifier is not null and to_identifier is not null and direction in ('inbound','outbound')
    ),
    upserted as (
      insert into public.message_events (
        workspace_id, run_id, channel, config_id, external_id, thread_id, direction,
        from_identifier, from_name, to_identifier, subject, body, body_html,
        "timestamp", is_read, metadata, raw_payload, status, updated_at
      )
      select p_workspace_id, p_run_id, p_channel, p_config_id,
        v.external_id, v.thread_id, v.direction, v.from_identifier, v.from_name,
        v.to_identifier, v.subject, v.body, v.body_html, v.message_ts, v.is_read,
        coalesce(v.metadata,'{}'::jsonb), v.raw_payload, 'received', now()
      from valid v
      on conflict (workspace_id, channel, config_id, external_id)
      do update set
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
        status = case when message_events.status in ('materialized','classified','decided','drafted') then message_events.status else 'received' end,
        last_error = null,
        updated_at = now()
      returning id, status
    )
    select * from upserted
  loop
    v_received_count := v_received_count + 1;
    if v_row.status = 'received' then
      v_jobs := array_append(v_jobs, jsonb_build_object(
        'job_type','MATERIALIZE','event_id',v_row.id,
        'workspace_id',p_workspace_id,'run_id',p_run_id,
        'channel',p_channel,'config_id',p_config_id));
    end if;
  end loop;

  if array_length(v_jobs, 1) is not null then
    perform public.bb_queue_send_batch('bb_ingest_jobs', v_jobs, 0);
    v_enqueued_count := array_length(v_jobs, 1);
  end if;

  -- Wake up the ingest worker immediately for live messages (not bulk imports)
  if p_run_id is null then
    begin
      perform public.bb_wake_worker('bb_worker_ingest_url');
    exception when others then
      raise warning 'bb_wake_worker failed: %', SQLERRM;
    end;
  end if;

  return query select v_received_count, v_enqueued_count, p_run_id;
end;
$$;

-- Change 4: Nightly queue cleanup
create or replace function public.bb_cleanup_old_queue_jobs()
returns jsonb
language plpgsql
security definer
set search_path = public, pgmq
as $$
declare
  v_queues text[] := array[
    'bb_import_jobs', 'bb_ingest_jobs', 'bb_classify_jobs',
    'bb_draft_jobs', 'bb_deadletter_jobs'
  ];
  v_queue text;
  v_deleted bigint := 0;
  v_total bigint := 0;
  v_archive_table regclass;
begin
  foreach v_queue in array v_queues loop
    v_archive_table := to_regclass(format('pgmq.%I', 'a_' || v_queue));
    if v_archive_table is not null then
      execute format(
        'delete from %s where archived_at < now() - interval ''30 days''',
        v_archive_table
      );
      get diagnostics v_deleted = row_count;
      v_total := v_total + v_deleted;
    end if;
  end loop;

  delete from public.pipeline_job_audit
  where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  delete from public.pipeline_incidents
  where state = 'resolved'
    and resolved_at < now() - interval '90 days';
  get diagnostics v_deleted = row_count;
  v_total := v_total + v_deleted;

  return jsonb_build_object('deleted_total', v_total);
end;
$$;

revoke all on function public.bb_cleanup_old_queue_jobs()
  from public, anon, authenticated;
grant execute on function public.bb_cleanup_old_queue_jobs()
  to service_role;

select cron.schedule(
  'bb_nightly_queue_cleanup',
  '0 3 * * *',
  'select public.bb_cleanup_old_queue_jobs()'
);

commit;
