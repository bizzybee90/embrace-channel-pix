-- Fix Supabase linter warn findings (partial):
-- NOTE: pg_net does not support ALTER EXTENSION ... SET SCHEMA in this environment.

create schema if not exists extensions;

-- Move vector extension out of public if possible
DO $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'vector' and n.nspname = 'public'
  ) then
    execute 'alter extension vector set schema extensions';
  end if;
end $$;

-- Set fixed search_path for any remaining public functions missing it
DO $$
declare
  r record;
begin
  for r in
    select
      n.nspname as schema,
      p.proname as name,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %I.%I(%s) set search_path = public', r.schema, r.name, r.args);
  end loop;
end $$;

-- Replace always-true INSERT policies with scoped checks
DROP POLICY IF EXISTS "Service role can insert api usage" ON public.api_usage;
CREATE POLICY "Service role can insert api usage"
  ON public.api_usage
  FOR INSERT
  TO service_role
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role can insert system logs" ON public.system_logs;
CREATE POLICY "Service role can insert system logs"
  ON public.system_logs
  FOR INSERT
  TO service_role
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Users can create corrections" ON public.correction_examples;
CREATE POLICY "Users can create corrections"
  ON public.correction_examples
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.get_my_workspace_id());

DROP POLICY IF EXISTS "Users can create FAQs" ON public.faqs;
CREATE POLICY "Users can create FAQs"
  ON public.faqs
  FOR INSERT
  TO authenticated
  WITH CHECK (workspace_id = public.get_my_workspace_id());
