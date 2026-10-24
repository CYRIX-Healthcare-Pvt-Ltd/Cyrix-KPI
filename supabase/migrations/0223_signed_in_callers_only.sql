/*
  0223 — the database's functions answer signed-in callers only (the user, 24 Oct, on the advisor's "131 of 429
  definer functions callable with the anon key": "ok go ahead").

  The anon key ships inside every app's code, so anyone could call these functions without signing in. Each one
  checks who is asking and gave a stranger nothing, but no screen needs them before sign-in: every app signs in
  through Supabase Auth itself, Cyra's engine and the edge functions use the service role, cron runs as postgres.
  The one exception is email_hint, which the Forgot password page asks before anyone has signed in — it stays open,
  now by name rather than through public.

  1. Row rules written for everyone (to public) that call one of these functions are moved to signed-in users. A
     signed-out caller got no rows from them before (each function says no to a stranger), and gets none now —
     rather than a "permission denied" for the function inside the rule.
  2. Execute is granted by name to authenticated and service_role wherever they had it, then taken from public and
     anon. Signed-in users and the service role keep exactly what they had.
  3. New functions follow the same rule: not to public, not to anon; authenticated and service_role keep the
     Supabase defaults for schema public.

  Undo: supabase/undo/0223_signed_in_callers_only.undo.sql (written from the live database before this ran).
*/

do $$
declare p record;
begin
  for p in
    select pol.schemaname, pol.tablename, pol.policyname
    from pg_policies pol
    where pol.schemaname = 'public' and pol.roles = array['public']::name[]
      and exists (
        select 1 from pg_proc f
        where f.pronamespace = 'public'::regnamespace and f.proname <> 'email_hint'
          and has_function_privilege('anon', f.oid, 'execute')
          and coalesce(pol.qual, '') || ' ' || coalesce(pol.with_check, '') ~ ('\m' || f.proname || '\(')
      )
  loop
    execute format('alter policy %I on %I.%I to authenticated', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname,
      has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
      has_function_privilege('service_role', p.oid, 'execute') as service
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
  loop
    if f.signed_in then execute format('grant execute on function %s to authenticated', f.sig); end if;
    if f.service then execute format('grant execute on function %s to service_role', f.sig); end if;
    execute format('revoke execute on function %s from public', f.sig);
    if f.proname = 'email_hint' then
      execute format('grant execute on function %s to anon', f.sig);
    else
      execute format('revoke execute on function %s from anon', f.sig);
    end if;
  end loop;
end $$;

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
