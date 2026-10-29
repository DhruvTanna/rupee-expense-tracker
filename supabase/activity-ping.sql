-- Public, read-only heartbeat for Supabase Free projects.
-- Returns only a boolean and does not read or change tracker data.
create or replace function public.activity_ping()
returns boolean
language sql
volatile
as $$
  select pg_catalog.clock_timestamp() is not null;
$$;

-- Allow the public app health check while keeping the function's scope harmless.
revoke all on function public.activity_ping() from public;
grant execute on function public.activity_ping() to anon;
