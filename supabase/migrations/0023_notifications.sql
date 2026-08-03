-- =====================================================================
-- Cyrix KPI  ·  0023  ·  "What is waiting on me?"
--
-- The nav badges already say a number, but only next to a tab you have
-- to already know to look at. A manager sees a 3 and has to guess what
-- the three are.
--
-- ONE RULE decides what belongs here: a notification is raised when
-- somebody else's action put the ball in your court. Never for your own
-- state. "Your KPI is with your manager" is not news to the person who
-- just sent it, and the dashboard already says so on the way in — two
-- places telling you the same thing is how a notification tray becomes
-- something people stop opening. So:
--
--   E1427 submits a KPI          ->  E1337 is notified
--   E1337 approves it            ->  E1427 is notified
--   E1427 has not set one up     ->  nobody is notified
--
-- Derived, not stored: there is no event log to keep in step with
-- reality, so a notification cannot outlive the thing it is about.
-- Approve the KPI and the row is simply not returned next time.
--
-- What IS stored is "I have seen this", one row per person per kind, so
-- the unread count clears on one device and stays cleared on the next.
-- The marker is a high-water mark rather than a per-item flag, which is
-- what makes the count behave: clearing three of four approvals does not
-- re-notify, a fourth person submitting does.
--
-- Deliberately returns facts and not sentences. Wording and routes are
-- the app's, and a copy change should not need a migration.
-- =====================================================================

create table if not exists notification_reads (
  employee_id uuid not null references employees(id) on delete cascade,
  kind        text not null,
  read_at     timestamptz not null default now(),
  primary key (employee_id, kind)
);

alter table notification_reads enable row level security;

-- Yours and nobody else's, in both directions — a read marker names what
-- you have been told about, which is not a thing your manager needs.
drop policy if exists notification_reads_own on notification_reads;
create policy notification_reads_own on notification_reads for all to authenticated
using (employee_id = current_employee_id())
with check (employee_id = current_employee_id());

grant select, insert, update, delete on notification_reads to authenticated;


-- ---------------------------------------------------------------------
-- The feed.
--
-- security definer because it counts across a manager's whole team and
-- across every open request, and does it in one round trip. Everything
-- is scoped to current_employee_id() by hand rather than by RLS, which
-- is the same bargain my_pending_record_requests() already makes, and
-- the only thing that leaves the function is counts and timestamps.
--
-- Who gets what mirrors the nav exactly, because a notification that
-- points at a tab you do not have is worse than no notification:
--   SW Admin (and not HR)  nothing — logins are their whole remit
--   HR                     the two queues that stop at HR
--   everyone else          what their manager has done to their record,
--                          plus their team's work if anyone reports to
--                          them
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
    -- Being told is not the same as being asked. Something your manager
    -- did to your record is worth knowing about for a few weeks and
    -- then it is just your record; something waiting on YOU stays until
    -- it is done. This is the shelf life of the first kind.
    now() - interval '30 days'                         as news_since,
    is_hr_admin()                                      as hr,
    is_sw_admin() and not is_hr_admin()                as sw_only
  from financial_years fy
  where fy.is_current
),
-- The one assignment that is still live this year. Rejected counts as
-- live: the row stays put and goes back to the person to fix.
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
  -- ---- what your manager did to your KPI ------------------------------
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

  -- ---- what your manager did to your months ---------------------------
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

  -- ---- what your team is waiting on you for ---------------------------
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

  -- Deletions and revisions are different subjects with the same two
  -- stages, and the Records screen shows them together, so they count
  -- together here too.
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

  -- ---- what has reached HR --------------------------------------------
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
order by f.latest desc;
$$;

grant execute on function my_notifications() to authenticated;

comment on function my_notifications() is
  'Everything somebody else has put in the signed-in person''s court, as '
  'counts and timestamps. Never their own state — the dashboard says '
  'that. Derived from live state, so a notification cannot outlive its '
  'cause. The app owns the wording and the links.';


-- ---------------------------------------------------------------------
-- Opening the panel is reading it.
--
-- Stamps every kind the caller can currently see, so the badge clears in
-- one call and stays clear until something newer arrives.
-- ---------------------------------------------------------------------
create or replace function mark_notifications_read()
returns integer
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
  n  integer;
begin
  if me is null then return 0; end if;

  insert into notification_reads (employee_id, kind, read_at)
  select me, x.kind, now() from my_notifications() x
  on conflict (employee_id, kind) do update set read_at = excluded.read_at;

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function mark_notifications_read() to authenticated;


-- ---------------------------------------------------------------------
-- Self-test, run as real accounts.
--
-- The rows it writes are deleted at the end rather than rolled back: the
-- migration runner commits the whole file as one transaction, so a
-- savepoint would not save us here.
-- ---------------------------------------------------------------------
do $$
declare
  tm_uid   uuid;
  mgr_uid  uuid;
  mgr_id   uuid;
  hr_uid   uuid;
  sw_uid   uuid;
  n_self   integer;
  n_mgr    integer;
  n_unread integer;
  n_hr_own integer;
  n_sw     integer;
begin
  -- Somebody with a manager, no reports and no admin role.
  select e.auth_user_id into tm_uid from employees e
  where e.auth_user_id is not null and e.is_active
    and e.reporting_manager_id is not null
    and e.id not in (select employee_id from user_roles)
    and e.id not in (select distinct reporting_manager_id from employees
                     where reporting_manager_id is not null)
  limit 1;

  -- A manager who actually has KPIs waiting, so there is something to
  -- assert about. Falls back to the largest team if nobody is pending.
  select e.auth_user_id, e.id into mgr_uid, mgr_id from employees e
  join employees t on t.reporting_manager_id = e.id and t.is_active
  left join kpi_assignments a
    on a.employee_id = t.id and a.status = 'pending_approval'
  where e.auth_user_id is not null and e.is_active
    and e.id not in (select employee_id from user_roles)
  group by e.auth_user_id, e.id
  order by count(a.id) desc, count(t.id) desc
  limit 1;

  select e.auth_user_id into hr_uid from employees e
  join user_roles ur on ur.employee_id = e.id
  where ur.role = 'hr_admin' limit 1;

  select e.auth_user_id into sw_uid from employees e
  join user_roles ur on ur.employee_id = e.id
  where ur.role = 'sw_admin'
    and e.id not in (select employee_id from user_roles
                     where role in ('hr_admin','super_admin'))
  limit 1;

  set local role authenticated;

  -- Nobody is ever notified about their own outstanding work. Whatever
  -- state this person happens to be in, none of it is news to them.
  perform set_config('request.jwt.claims',
    json_build_object('sub', tm_uid::text, 'role','authenticated')::text, true);

  select count(*) into n_self from my_notifications()
  where kind in ('kpi_missing', 'kpi_awaiting', 'month_todo');
  if n_self <> 0 then
    raise exception
      'a team member was notified about % of their own to-do item(s)', n_self;
  end if;

  -- A manager is told what their team is waiting on them for.
  perform set_config('request.jwt.claims',
    json_build_object('sub', mgr_uid::text, 'role','authenticated')::text, true);

  select count(*) into n_mgr from my_notifications();
  if n_mgr = 0 then
    raise exception 'the busiest manager in the company has nothing waiting';
  end if;

  -- Reading it clears the count without removing the entry: the work is
  -- still outstanding, you have just been told about it.
  perform mark_notifications_read();
  select count(*) filter (where unread), count(*)
    into n_unread, n_mgr
  from my_notifications();

  if n_unread <> 0 then
    raise exception 'reading left % of % still unread', n_unread, n_mgr;
  end if;
  if n_mgr = 0 then
    raise exception 'reading a notification made the work itself disappear';
  end if;

  -- HR is not appraised by the system, so none of the personal kinds and
  -- none of the manager ones.
  if hr_uid is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', hr_uid::text, 'role','authenticated')::text, true);
    select count(*) into n_hr_own from my_notifications()
    where kind not in ('records_hr', 'leavers');
    if n_hr_own <> 0 then
      raise exception 'HR was handed % notification(s) meant for the appraised',
        n_hr_own;
    end if;
  end if;

  -- SW Admin administers logins and nothing else.
  if sw_uid is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', sw_uid::text, 'role','authenticated')::text, true);
    select count(*) into n_sw from my_notifications();
    if n_sw <> 0 then
      raise exception 'SW Admin was given % notification(s)', n_sw;
    end if;
  end if;

  reset role;

  delete from notification_reads where employee_id = mgr_id;

  raise notice '0023 self-test passed — % kind(s) for the busiest manager, '
               'nothing self-addressed, read markers scoped and '
               'non-destructive', n_mgr;
end $$;
