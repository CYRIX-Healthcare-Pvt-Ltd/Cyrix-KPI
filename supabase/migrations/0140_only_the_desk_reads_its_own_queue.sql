-- =====================================================================
-- Cyrix KPI  ·  0140  ·  Only the desk reads its own queue
--
-- pending_admin_work (0139) is security definer and was granted to
-- authenticated, on the reasoning that every row in it is already on the
-- admin's own screen. That reasoning is about the admin. Anybody signed
-- in could call it and read every support question in the company,
-- including what people wrote in them — which is the opposite of what
-- the grant was for.
--
-- The rows are the same; who may ask for them is now checked inside the
-- function. HR's queue for HR, the software desk's for SW admin, and
-- everything for a direct database connection, which is a migration or
-- the service role and is trusted anyway -- that is the path the round-up
-- mail takes.
--
-- Anybody else gets an empty list rather than an error: this is asked by
-- a screen, and a screen that says "nothing is waiting" to somebody with
-- no desk is telling them the truth about their own.
-- =====================================================================

create or replace function public.pending_admin_work(p_desk text)
returns table (
  kind        text,
  source_id   uuid,
  who         text,
  headline    text,
  detail      text,
  waiting_since timestamptz
)
language sql stable security definer set search_path to 'public'
as $fn$
  with allowed as (
    select
      -- No end user is a direct connection: a migration, an admin script,
      -- or the service role the round-up mail runs as.
      auth.uid() is null
      or (p_desk = 'hr' and is_hr_admin())
      or (p_desk = 'sw' and is_sw_admin())
      as ok
  ),
  named as (
    select e.id, e.full_name || ' (' || e.ecode || ')' as label from employees e
  )
  select 'support',
         t.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' has asked a question',
         left(coalesce(t.employee_note, ''), 300),
         coalesce(t.raised_at, t.created_at)
  from support_tickets t
  left join named n on n.id = t.employee_id
  where (select ok from allowed)
    and t.status = 'open'
    and t.desk = case when p_desk = 'sw' then 'software' else 'hr' end

  union all
  -- Everything below is HR's. The software desk staffs one queue.
  select 'leaver',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' has been flagged as having left',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from tm_removal_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending'

  union all
  select 'record',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' wants a month removed',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from record_deletion_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending_hr'

  union all
  select 'revision',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' wants their KPI reopened',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from kpi_revision_requests r
  left join named n on n.id = r.employee_id
  where (select ok from allowed) and p_desk = 'hr' and r.status = 'pending_hr'

  order by 6
$fn$;

-- ---------------------------------------------------------------------
-- Self-test: an ordinary employee sees nothing, HR sees HR's queue.
-- ---------------------------------------------------------------------
do $test$
declare
  plain    uuid;
  hr_user  uuid;
  n_direct int;
  n_plain  int;
  n_hr     int;
begin
  select count(*) into n_direct from pending_admin_work('hr');

  select e.auth_user_id into hr_user
  from employees e join user_roles r on r.employee_id = e.id
  where r.role = 'hr_admin' and e.auth_user_id is not null limit 1;

  select e.auth_user_id into plain
  from employees e
  where e.auth_user_id is not null
    and not exists (select 1 from user_roles r where r.employee_id = e.id)
  limit 1;

  if plain is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', plain, 'role', 'authenticated')::text, true);
    select count(*) into n_plain from pending_admin_work('hr');
    perform set_config('request.jwt.claims', '', true);
    if n_plain <> 0 then
      raise exception 'somebody with no desk read % row(s) of HR''s queue', n_plain;
    end if;
  end if;

  if hr_user is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', hr_user, 'role', 'authenticated')::text, true);
    select count(*) into n_hr from pending_admin_work('hr');
    perform set_config('request.jwt.claims', '', true);
    if n_hr <> n_direct then
      raise exception 'HR sees % of the % rows waiting on them', n_hr, n_direct;
    end if;
  end if;

  raise notice '0140 self-test passed (% waiting on HR; nobody else can read it)', n_direct;
end $test$;
