-- =====================================================================
-- Cyrix KPI  ·  0027  ·  Clearing a notification
--
-- Nothing in the tray could be cleared. For the things asking something
-- of you that is correct — an approval waiting is not a message, it is a
-- job, and it clears by being done. But "Your KPI has been approved" is
-- news, read once and then finished, and it was sitting there for the
-- full thirty days before it aged out.
--
-- So: news can be dismissed, work cannot. The rule lives here rather
-- than in the app, because "you may not hide outstanding work" is not a
-- presentation choice — a client calling the RPC directly has to meet it
-- too.
--
-- Dismissal is a timestamp, not a flag. Clear "a month was scored" today
-- and next month's score still raises it, because that is a newer event
-- and not the one that was dismissed.
-- =====================================================================

alter table notification_reads
  add column if not exists dismissed_at timestamptz;

comment on column notification_reads.dismissed_at is
  'Notifications of this kind older than this are hidden. Only ever set '
  'for the informational kinds — see dismiss_notification().';


create or replace function dismiss_notification(p_kind text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
begin
  if me is null then return; end if;

  -- The only two that are purely informational. Everything else is a
  -- queue, and a queue you can dismiss is a queue that gets forgotten.
  if p_kind not in ('kpi_approved', 'month_scored') then
    raise exception
      '"%" is outstanding work, not a message. It clears when it is done.',
      p_kind;
  end if;

  insert into notification_reads (employee_id, kind, read_at, dismissed_at)
  values (me, p_kind, now(), now())
  on conflict (employee_id, kind) do update
    set dismissed_at = excluded.dismissed_at,
        read_at      = excluded.read_at;
end $$;

grant execute on function dismiss_notification(text) to authenticated;

comment on function dismiss_notification(text) is
  'Hides an informational notification. Refuses for anything that '
  'represents outstanding work.';


-- ---------------------------------------------------------------------
-- The feed skips what has been dismissed.
--
-- Identical to 0023 apart from the last two lines. Repeated in full
-- rather than patched, because a function body is replaced whole and a
-- reader comparing the two should be able to see every difference.
-- ---------------------------------------------------------------------
create or replace function my_notifications()
returns table (kind text, n integer, latest timestamptz, unread boolean)
language sql stable security definer set search_path = public as $$
with me as (
  select e.id
  from employees e
  where e.auth_user_id = auth.uid() and e.is_active
),
ctx as (
  select
    (select id from me)                                as me_id,
    fy.code                                            as fy,
    now() - interval '30 days'                         as news_since,
    is_hr_admin()                                      as hr,
    is_sw_admin() and not is_hr_admin()                as sw_only
  from financial_years fy
  where fy.is_current
),
asg as (
  select a.status, a.approved_at, a.submitted_at, a.updated_at
  from kpi_assignments a, ctx
  where a.employee_id = ctx.me_id
    and a.financial_year = ctx.fy
    and a.status in ('draft', 'pending_approval', 'active', 'rejected')
  order by a.created_at desc
  limit 1
),
facts as (
  select 'kpi_rejected'::text as kind, 1 as n,
         (select coalesce(updated_at, submitted_at) from asg) as latest
  from ctx
  where ctx.me_id is not null and not ctx.hr and not ctx.sw_only
    and (select status from asg) = 'rejected'

  union all
  select 'kpi_approved', 1, (select approved_at from asg)
  from ctx
  where ctx.me_id is not null and not ctx.hr and not ctx.sw_only
    and (select status from asg) = 'active'
    and (select approved_at from asg) > ctx.news_since

  union all
  select 'month_returned', count(*)::int, max(coalesce(s.returned_at, s.updated_at))
  from ctx
  join kpi_submissions s
    on s.employee_id = ctx.me_id and s.financial_year = ctx.fy
   and s.status = 'returned'
  where not ctx.hr and not ctx.sw_only
  having count(*) > 0

  union all
  select 'month_scored', count(*)::int, max(coalesce(s.manager_scored_at, s.updated_at))
  from ctx
  join kpi_submissions s
    on s.employee_id = ctx.me_id and s.financial_year = ctx.fy
   and s.status in ('scored', 'finalized')
   and coalesce(s.manager_scored_at, s.updated_at) > ctx.news_since
  where not ctx.hr and not ctx.sw_only
  having count(*) > 0

  union all
  select 'approvals', count(*)::int, max(coalesce(a.submitted_at, a.updated_at))
  from ctx
  join employees tm on tm.reporting_manager_id = ctx.me_id and tm.is_active
  join kpi_assignments a
    on a.employee_id = tm.id and a.financial_year = ctx.fy
   and a.status = 'pending_approval'
  where not ctx.hr and not ctx.sw_only
  having count(*) > 0

  union all
  select 'scoring', count(*)::int, max(coalesce(s.self_submitted_at, s.updated_at))
  from ctx
  join employees tm on tm.reporting_manager_id = ctx.me_id and tm.is_active
  join kpi_submissions s on s.employee_id = tm.id and s.status = 'submitted'
  where not ctx.hr and not ctx.sw_only
  having count(*) > 0

  union all
  select 'records_manager', count(*)::int, max(r.created_at)
  from ctx
  join (
    select employee_id, created_at from record_deletion_requests
    where status = 'pending_manager'
    union all
    select employee_id, created_at from kpi_revision_requests
    where status = 'pending_manager'
  ) r on true
  join employees tm on tm.id = r.employee_id and tm.reporting_manager_id = ctx.me_id
  where not ctx.hr and not ctx.sw_only
  having count(*) > 0

  union all
  select 'records_hr', count(*)::int, max(r.created_at)
  from ctx
  join (
    select created_at from record_deletion_requests where status = 'pending_hr'
    union all
    select created_at from kpi_revision_requests where status = 'pending_hr'
  ) r on true
  where ctx.hr
  having count(*) > 0

  union all
  select 'leavers', count(*)::int, max(rr.created_at)
  from ctx
  join tm_removal_requests rr on rr.status = 'pending'
  where ctx.hr
  having count(*) > 0
)
select
  f.kind,
  f.n,
  f.latest,
  f.latest > coalesce(nr.read_at, '-infinity'::timestamptz) as unread
from facts f
left join notification_reads nr
  on nr.kind = f.kind
 and nr.employee_id = (select me_id from ctx)
where f.latest is not null
  -- Dismissed, and nothing newer of this kind has happened since.
  and (nr.dismissed_at is null or f.latest > nr.dismissed_at)
order by f.latest desc;
$$;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  uid     uuid;
  emp     uuid;
  fy      text;
  aid     uuid;
  before  int;
  after   int;
  refused boolean := false;
begin
  select code into fy from financial_years where is_current;

  -- Somebody with a login, a manager, no admin role and no live KPI, so
  -- one can be built and approved for them.
  select e.auth_user_id, e.id into uid, emp from employees e
  where e.auth_user_id is not null and e.is_active
    and e.reporting_manager_id is not null
    and e.id not in (select employee_id from user_roles)
    and e.id not in (select distinct reporting_manager_id from employees
                     where reporting_manager_id is not null)
    and not exists (
      select 1 from kpi_assignments ka
      where ka.employee_id = e.id and ka.financial_year = fy
        and ka.status in ('draft','pending_approval','active'))
  limit 1;

  if uid is null then
    raise notice '0027 self-test skipped — no free employee to build one on';
    return;
  end if;

  insert into kpi_assignments (employee_id, financial_year, status, approved_at)
  values (emp, fy, 'active', now()) returning id into aid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role','authenticated')::text, true);

  select count(*) into before from my_notifications() where kind = 'kpi_approved';
  if before <> 1 then
    raise exception 'expected the approval to show, got % row(s)', before;
  end if;

  perform dismiss_notification('kpi_approved');
  select count(*) into after from my_notifications() where kind = 'kpi_approved';
  if after <> 0 then
    raise exception 'the notification survived being cleared';
  end if;

  -- Work may not be dismissed, whatever the caller asks for.
  begin
    perform dismiss_notification('approvals');
  exception when others then
    refused := true;
  end;
  if not refused then
    raise exception 'outstanding work was allowed to be dismissed';
  end if;

  -- A newer event of the same kind must come back.
  --
  -- Stamped from outside the employee's own session on purpose: an
  -- approved KPI is not theirs to edit, so under RLS this update matches
  -- no rows and reports no error — which is how the first version of
  -- this test managed to fail against working code.
  reset role;
  update kpi_assignments
  set approved_at = now() + interval '1 second' where id = aid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role','authenticated')::text, true);
  set local role authenticated;

  select count(*) into after from my_notifications() where kind = 'kpi_approved';
  if after <> 1 then
    raise exception 'a newer event stayed hidden behind an old dismissal';
  end if;

  reset role;

  delete from notification_reads where employee_id = emp;
  delete from kpi_assignments where id = aid;

  raise notice
    '0027 self-test passed — news clears, a newer one of the same kind '
    'comes back, and work refuses to be cleared';
end $$;
