-- Pipeline fixes: UK phone normalization, data backfills, customer merge
-- Run AFTER 20260221150000_unified_pipeline.sql

begin;

-- ============================================================
-- FIX 1: UK phone normalization (0 → +44)
-- The original bb_norm_identifier turns 07700900123 into +07700900123
-- which is invalid E.164. This fix handles UK national format.
-- ============================================================

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

    -- International prefix with 00
    if v_digits like '00%' then
      v_digits := '+' || substring(v_digits from 3);
    end if;

    -- UK national format: 07... → +447...
    if v_digits like '0%' and length(v_digits) >= 10 and length(v_digits) <= 12 then
      v_digits := '+44' || substring(v_digits from 2);
    end if;

    -- Ensure + prefix for any remaining digits-only values
    if v_digits !~ '^\+' then
      v_digits := '+' || regexp_replace(v_digits, '[^0-9]', '', 'g');
    end if;

    -- Clean any stray non-digit/non-plus chars
    v_digits := regexp_replace(v_digits, '[^0-9+]', '', 'g');

    -- Too short to be a real phone number — return as-is
    if length(v_digits) < 8 then
      return lower(v_value);
    end if;

    return v_digits;
  end if;

  return lower(v_value);
end;
$$;

-- ============================================================
-- FIX 2: Backfill customer_identities from existing customers
-- Without this, the new pipeline creates duplicate customers
-- because it can't find existing ones in the lookup table.
-- ============================================================

-- Backfill email identities
insert into public.customer_identities (
  workspace_id, customer_id, identifier_type,
  identifier_value, identifier_value_norm,
  verified, source_channel
)
select
  c.workspace_id,
  c.id,
  'email',
  c.email,
  public.bb_norm_identifier('email', c.email),
  true,
  'email'
from public.customers c
where c.email is not null
  and btrim(c.email) != ''
  and public.bb_norm_identifier('email', c.email) is not null
on conflict (workspace_id, identifier_type, identifier_value_norm)
do nothing;

-- Backfill phone identities
insert into public.customer_identities (
  workspace_id, customer_id, identifier_type,
  identifier_value, identifier_value_norm,
  verified, source_channel
)
select
  c.workspace_id,
  c.id,
  'phone',
  c.phone,
  public.bb_norm_identifier('phone', c.phone),
  true,
  'email'
from public.customers c
where c.phone is not null
  and btrim(c.phone) != ''
  and public.bb_norm_identifier('phone', c.phone) is not null
on conflict (workspace_id, identifier_type, identifier_value_norm)
do nothing;

-- ============================================================
-- FIX 3: Backfill conversation_refs from existing conversations
-- Without this, the pipeline creates duplicate conversations.
-- ============================================================

insert into public.conversation_refs (
  workspace_id, channel, config_id,
  external_thread_id, conversation_id
)
select
  c.workspace_id,
  coalesce(c.channel, 'email'),
  coalesce(
    c.config_id,
    (select epc.id from public.email_provider_configs epc
     where epc.workspace_id = c.workspace_id limit 1)
  ),
  c.external_conversation_id,
  c.id
from public.conversations c
where c.external_conversation_id is not null
  and btrim(c.external_conversation_id) != ''
  and coalesce(
    c.config_id,
    (select epc.id from public.email_provider_configs epc
     where epc.workspace_id = c.workspace_id limit 1)
  ) is not null
on conflict (workspace_id, channel, config_id, external_thread_id)
do nothing;

-- ============================================================
-- FIX 4: Customer merge function (cross-channel identity unification)
-- Merges customer B ("loser") into customer A ("winner").
-- Needed before WhatsApp integration, useful now for dedup.
-- ============================================================

create or replace function public.bb_merge_customers(
  p_workspace_id uuid,
  p_winner_id uuid,
  p_loser_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_moved_identities int := 0;
  v_moved_conversations int := 0;
begin
  -- Safety checks
  if p_winner_id = p_loser_id then
    return jsonb_build_object('error', 'winner and loser are the same customer');
  end if;

  if not exists (select 1 from customers where id = p_winner_id and workspace_id = p_workspace_id) then
    return jsonb_build_object('error', 'winner customer not found');
  end if;

  if not exists (select 1 from customers where id = p_loser_id and workspace_id = p_workspace_id) then
    return jsonb_build_object('error', 'loser customer not found');
  end if;

  -- Move identities from loser to winner (skip duplicates)
  with moved as (
    update customer_identities
    set customer_id = p_winner_id
    where customer_id = p_loser_id
      and workspace_id = p_workspace_id
      and not exists (
        select 1 from customer_identities ci2
        where ci2.workspace_id = p_workspace_id
          and ci2.customer_id = p_winner_id
          and ci2.identifier_type = customer_identities.identifier_type
          and ci2.identifier_value_norm = customer_identities.identifier_value_norm
      )
    returning id
  )
  select count(*) into v_moved_identities from moved;

  -- Delete duplicate identities that couldn't move
  delete from customer_identities
  where customer_id = p_loser_id
    and workspace_id = p_workspace_id;

  -- Move conversations from loser to winner
  with moved as (
    update conversations
    set customer_id = p_winner_id, updated_at = now()
    where customer_id = p_loser_id
      and workspace_id = p_workspace_id
    returning id
  )
  select count(*) into v_moved_conversations from moved;

  -- Copy useful fields from loser to winner (fill gaps only)
  update customers set
    name = coalesce(customers.name, loser.name),
    email = coalesce(customers.email, loser.email),
    phone = coalesce(customers.phone, loser.phone),
    notes = case
      when loser.notes is not null and customers.notes is not null
        then customers.notes || E'\n[Merged] ' || loser.notes
      else coalesce(customers.notes, loser.notes)
    end,
    updated_at = now()
  from (select * from customers where id = p_loser_id) as loser
  where customers.id = p_winner_id;

  -- Delete the loser
  delete from customers where id = p_loser_id and workspace_id = p_workspace_id;

  return jsonb_build_object(
    'ok', true,
    'winner_id', p_winner_id,
    'loser_id', p_loser_id,
    'moved_identities', v_moved_identities,
    'moved_conversations', v_moved_conversations
  );
end;
$$;

-- Restrict merge to service_role only
revoke all on function public.bb_merge_customers(uuid, uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.bb_merge_customers(uuid, uuid, uuid)
  to service_role;

-- ============================================================
-- Verification queries (run these after migration to confirm)
-- ============================================================
-- SELECT count(*) FROM customer_identities;
-- SELECT count(*) FROM conversation_refs;
-- SELECT bb_norm_identifier('phone', '07700900123');  -- should return +447700900123
-- SELECT bb_norm_identifier('phone', '00447700900123');  -- should return +447700900123
-- SELECT bb_norm_identifier('email', 'Test@Example.COM');  -- should return test@example.com

commit;
