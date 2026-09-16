-- =====================================================================
-- Cyrix KPI  ·  0139  ·  A queue that is waiting says so again
--
-- One email goes out when something arrives in an admin queue, and that
-- was the whole of it. Nothing said anything a second time, so a support
-- question raised on Friday and missed on Friday is a question nobody is
-- told about again — and the five sitting on the HR desk right now have
-- been there between one and five days with one email between them.
--
-- So there is a second kind of note: a daily round-up per desk of
-- everything that has been waiting more than a day, with how long each
-- has been waiting. Written to the same ledger, which is what stops it
-- going twice — the unique key is (kind, source_id), and a round-up's
-- source_id is the day it is for, so a second attempt on the same day
-- claims nothing and sends nothing.
--
-- The software desk gets its own. It was deliberately left out of the
-- first email (0106) because routing "I cannot sign in" into HR's inbox
-- helps nobody; it goes to SW admin's own address instead, which is the
-- one address that desk has.
-- =====================================================================

alter table admin_notifications
  drop constraint if exists admin_notifications_kind_check;

alter table admin_notifications
  add constraint admin_notifications_kind_check
  check (kind = any (array[
    -- One thing arriving, named for what it is.
    'support', 'leaver', 'record', 'revision',
    -- A day's round-up of everything still waiting on a desk.
    'digest_hr', 'digest_sw'
  ]));

-- ---------------------------------------------------------------------
-- What is waiting on a desk, and since when.
--
-- One list, so the screens, the round-up mail and anybody asking the
-- database directly are all counting the same rows by the same rule.
--
-- 'pending_manager' is deliberately not here. A record or a revision in
-- that state is waiting on somebody's manager, not on HR, and chasing HR
-- about it would be chasing the wrong person.
-- ---------------------------------------------------------------------
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
  with named as (
    select e.id, e.full_name || ' (' || e.ecode || ')' as label from employees e
  )
  -- Support questions, either desk.
  select 'support',
         t.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' has asked a question',
         left(coalesce(t.employee_note, ''), 300),
         coalesce(t.raised_at, t.created_at)
  from support_tickets t
  left join named n on n.id = t.employee_id
  where t.status = 'open'
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
  where p_desk = 'hr' and r.status = 'pending'

  union all
  select 'record',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' wants a month removed',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from record_deletion_requests r
  left join named n on n.id = r.employee_id
  where p_desk = 'hr' and r.status = 'pending_hr'

  union all
  select 'revision',
         r.id,
         coalesce(n.label, 'Somebody'),
         coalesce(n.label, 'Somebody') || ' wants their KPI reopened',
         left(coalesce(r.reason, ''), 300),
         r.created_at
  from kpi_revision_requests r
  left join named n on n.id = r.employee_id
  where p_desk = 'hr' and r.status = 'pending_hr'

  order by 6
$fn$;

-- Read by the round-up, which runs as the service role. Granted to
-- authenticated as well so a desk's own screen can count its backlog
-- without a second set of rules to keep in step -- the function returns
-- only what is waiting, and every row in it is already on that admin's
-- screen.
grant execute on function public.pending_admin_work(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $test$
declare
  hr_n int;
  sw_n int;
  oldest int;
begin
  select count(*) into hr_n from pending_admin_work('hr');
  select count(*) into sw_n from pending_admin_work('sw');
  select coalesce(max(extract(day from now() - waiting_since))::int, 0)
    into oldest from pending_admin_work('hr');

  -- A round-up kind is accepted, and claims only once for a given day.
  insert into admin_notifications (kind, source_id)
  values ('digest_hr', '00000000-0000-4000-8000-000000000139');
  begin
    insert into admin_notifications (kind, source_id)
    values ('digest_hr', '00000000-0000-4000-8000-000000000139');
    raise exception 'the ledger let a round-up be claimed twice';
  exception when unique_violation then
    null;
  end;
  delete from admin_notifications where source_id = '00000000-0000-4000-8000-000000000139';

  raise notice '0139 self-test passed (HR waiting: %, software waiting: %, oldest % days)',
    hr_n, sw_n, oldest;
end $test$;
