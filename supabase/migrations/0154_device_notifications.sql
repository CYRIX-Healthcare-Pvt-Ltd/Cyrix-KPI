-- =====================================================================
-- Cyrix KPI  ·  0154  ·  Notifications on the phone and the desktop
--
-- The user, 10 Oct: notifications even when the page is closed; HR and SW
-- Admin can type a message and send it — to everyone, one person by
-- E-code, a manager and everybody under them, a function or a
-- department; a reminder every day from three days before a last day;
-- and whatever shows in the bell also arrives on the device.
--
-- Web Push. A device that allowed it is stored against the person signed
-- in when they allowed it (push_subscriptions); signing out removes it.
-- The push function (supabase/functions/push) encrypts and sends.
--
-- The bell is not a stored list — my_notifications() works it out live
-- for whoever is asking. So push_bell_due() asks it as each person with a
-- device, remembers what it last saw (push_bell_state), and hands back
-- only what has arrived or grown since. A device's first registration
-- records the bell as it stands, so allowing notifications does not send
-- the whole bell at once.
--
-- Two timers, which is why pg_cron and pg_net are switched on here (the
-- mail round-up in notify-hr waits for a browser to ask; a reminder is
-- for exactly the people who are not opening the app):
--   every 5 minutes   the bell
--   09:30 IST daily   last-day reminders
-- The function is called with a key kept in the vault (push_reminder_key)
-- and in the function's secrets, never in this file.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

insert into app_settings (key, value, description) values
  ('push_public_key',
   '"BHu9tDoOJPgdJXO_uVdMgu-NV0I_sbEHXs-oept5LelkF81zJpJZdUHdnlGXmIY5ZrWmMxFV_M9XoyBTk-JSuOQ"'::jsonb,
   'The VAPID public key a browser subscribes with (0154). The private half is a secret of the push function.')
on conflict (key) do update set value = excluded.value;


create table if not exists push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  employee_id   uuid not null references employees(id) on delete cascade,
  endpoint      text not null unique,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  last_sent_at  timestamptz,
  failures      int not null default 0
);
create index if not exists push_subscriptions_employee on push_subscriptions(employee_id);
alter table push_subscriptions enable row level security;
-- No policies: through the functions below only.

create table if not exists push_messages (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('manual', 'reminder')),
  title       text not null,
  body        text not null,
  url         text,
  target      jsonb,
  sent_by     uuid references employees(id) on delete set null,
  people      int,
  devices     int,
  delivered   int,
  failed      int,
  dedupe_key  text unique,
  created_at  timestamptz not null default now()
);
alter table push_messages enable row level security;
drop policy if exists push_messages_read on push_messages;
create policy push_messages_read on push_messages for select to authenticated
  using (is_hr_admin() or is_sw_admin());

create table if not exists push_bell_state (
  employee_id uuid not null references employees(id) on delete cascade,
  kind        text not null,
  n           int not null,
  latest      timestamptz,
  primary key (employee_id, kind)
);
alter table push_bell_state enable row level security;


-- ---------------------------------------------------------------------
-- A device, for the person signed in on it.
-- ---------------------------------------------------------------------
create or replace function save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id();
begin
  if me is null then raise exception 'Sign in first'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'That is not a notification subscription';
  end if;

  insert into push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent)
  values (me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set employee_id = me, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, last_seen_at = now(), failures = 0;

  -- The bell as it stands now is not news to this device.
  insert into push_bell_state (employee_id, kind, n, latest)
  select me, f.kind, f.n, f.latest from my_notifications() f
  on conflict (employee_id, kind) do nothing;
end $$;

-- Signing out takes the device off the person.
create or replace function drop_push_subscription(p_endpoint text)
returns void
language sql security definer set search_path = public as $$
  delete from push_subscriptions where endpoint = p_endpoint and employee_id = current_employee_id()
$$;

grant execute on function save_push_subscription(text, text, text, text) to authenticated;
grant execute on function drop_push_subscription(text) to authenticated;


-- ---------------------------------------------------------------------
-- Who a message reaches: everyone; one person; a manager and everyone
-- under them, at any depth; a function; a department. Active people.
-- ---------------------------------------------------------------------
create or replace function push_audience(p_target jsonb)
returns table (employee_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  k text := p_target->>'kind';
  v text := btrim(coalesce(p_target->>'value', ''));
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR Admin or SW Admin can send notifications';
  end if;
  if k not in ('all', 'person', 'manager', 'function', 'department') then
    raise exception 'Choose who it goes to';
  end if;
  if k <> 'all' and v = '' then
    raise exception 'Say which one';
  end if;

  return query
  with recursive under(id) as (
    select e.id from employees e where k = 'manager' and upper(e.ecode) = upper(v)
    union
    select e.id from employees e join under u on e.reporting_manager_id = u.id
  )
  select e.id from employees e
  where e.is_active
    and (k = 'all'
      or (k = 'person' and upper(e.ecode) = upper(v))
      or (k = 'manager' and e.id in (select id from under))
      or (k = 'function' and e.function_name = v)
      or (k = 'department' and e.department = v));
end $$;

create or replace function push_audience_preview(p_target jsonb)
returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (select employee_id from push_audience(p_target))
  select jsonb_build_object(
    'people',  (select count(*) from a),
    'devices', (select count(*) from push_subscriptions s join a on a.employee_id = s.employee_id),
    'reachable', (select count(distinct s.employee_id) from push_subscriptions s join a on a.employee_id = s.employee_id),
    'name', case when p_target->>'kind' in ('person', 'manager')
                 then (select full_name from employees where upper(ecode) = upper(btrim(p_target->>'value')))
            end
  )
$$;

create or replace function push_audience_options()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_hr_admin() or is_sw_admin()) then
    raise exception 'Only HR Admin or SW Admin can send notifications';
  end if;
  return jsonb_build_object(
    'functions', (select coalesce(jsonb_agg(f order by f), '[]') from (
      select distinct function_name f from employees where is_active and coalesce(btrim(function_name), '') <> '') x),
    'departments', (select coalesce(jsonb_agg(d order by d), '[]') from (
      select distinct department d from employees where is_active and coalesce(btrim(department), '') <> '') y),
    'devices', (select count(*) from push_subscriptions),
    'people', (select count(distinct employee_id) from push_subscriptions)
  );
end $$;

grant execute on function push_audience(jsonb) to authenticated;
grant execute on function push_audience_preview(jsonb) to authenticated;
grant execute on function push_audience_options() to authenticated;


-- ---------------------------------------------------------------------
-- Today's reminders: from three days before a last day, to the last day,
-- the same message once a day (the user). Team members whose month is
-- not with their manager yet; managers with a month waiting to be scored.
-- ---------------------------------------------------------------------
create or replace function push_reminders_due()
returns table (employee_id uuid, side text, title text, body text, url text)
language plpgsql stable security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  m     date := date_trunc('month', today - interval '1 month')::date;
  tm_day  date := ((kpi_deadline_at(m, 'tm') at time zone 'Asia/Kolkata') - interval '1 day')::date;
  mgr_day date := ((kpi_deadline_at(m, 'manager') at time zone 'Asia/Kolkata') - interval '1 day')::date;
begin
  if tm_day is not null and today between tm_day - 3 and tm_day then
    return query
    select a.employee_id, 'tm'::text, 'Cyrix KPI reminder'::text,
           format('Submit your %s KPI by %s. After that it is scored 0.', to_char(m, 'Mon-YY'), to_char(tm_day, 'FMDD Mon')),
           '/kpi/submission/' || to_char(m, 'YYYY-MM-DD')
    from kpi_assignments a
    join employees e on e.id = a.employee_id and e.is_active
    join financial_years f on f.code = a.financial_year and m between f.starts_on and f.ends_on
    where a.status = 'active'
      and (a.starts_from is null or a.starts_from <= m)
      and not exists (select 1 from kpi_submissions s
                      where s.employee_id = a.employee_id and s.period_month = m
                        and s.status not in ('draft', 'returned'))
      and exists (select 1 from push_subscriptions p where p.employee_id = a.employee_id);
  end if;

  if mgr_day is not null and today between mgr_day - 3 and mgr_day then
    return query
    select distinct s.manager_id, 'manager'::text, 'Cyrix KPI reminder'::text,
           format('Score your team''s %s KPI by %s. After that their own score counts.', to_char(m, 'Mon-YY'), to_char(mgr_day, 'FMDD Mon')),
           '/kpi/team'::text
    from kpi_submissions s
    where s.period_month = m and s.status = 'submitted' and s.manager_id is not null
      and exists (select 1 from push_subscriptions p where p.employee_id = s.manager_id);
  end if;
end $$;


-- ---------------------------------------------------------------------
-- What has come into each person's bell since it was last looked at here.
-- ---------------------------------------------------------------------
create or replace function push_bell_due()
returns table (employee_id uuid, kind text, n int)
language plpgsql volatile security definer set search_path = public as $$
declare
  r  record;
  f  record;
  st push_bell_state%rowtype;
  kinds text[];
begin
  for r in
    select distinct e.id, e.auth_user_id
    from push_subscriptions s join employees e on e.id = s.employee_id
    where e.is_active and e.auth_user_id is not null
  loop
    -- my_notifications() answers for whoever is asking; ask as them.
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.auth_user_id, 'role', 'authenticated')::text, true);
    kinds := '{}';
    for f in select * from my_notifications() loop
      kinds := kinds || f.kind;
      select * into st from push_bell_state b where b.employee_id = r.id and b.kind = f.kind;
      if not found
         or f.n > st.n
         or coalesce(f.latest, '-infinity') > coalesce(st.latest, '-infinity') then
        employee_id := r.id; kind := f.kind; n := f.n;
        return next;
      end if;
      insert into push_bell_state as b (employee_id, kind, n, latest)
      values (r.id, f.kind, f.n, f.latest)
      on conflict on constraint push_bell_state_pkey do update set n = excluded.n, latest = excluded.latest;
    end loop;
    -- Gone from the bell: if it comes back, it is news again.
    delete from push_bell_state b where b.employee_id = r.id and not (b.kind = any (kinds));
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;

revoke execute on function push_reminders_due() from public, anon, authenticated;
revoke execute on function push_bell_due() from public, anon, authenticated;
grant execute on function push_reminders_due() to service_role;
grant execute on function push_bell_due() to service_role;


-- ---------------------------------------------------------------------
-- The timers.
-- ---------------------------------------------------------------------
create or replace function push_call(p_action text)
returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url     := 'https://emuvmihfbnndhbpsndvc.supabase.co/functions/v1/push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-key', (select decrypted_secret from vault.decrypted_secrets where name = 'push_reminder_key')),
    body    := jsonb_build_object('action', p_action),
    timeout_milliseconds := 60000)
$$;
revoke execute on function push_call(text) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('push-bell', 'push-reminders');
select cron.schedule('push-bell', '*/5 * * * *', $$select public.push_call('bell')$$);
-- 04:00 UTC is 09:30 in India.
select cron.schedule('push-reminders', '0 4 * * *', $$select public.push_call('reminders')$$);
