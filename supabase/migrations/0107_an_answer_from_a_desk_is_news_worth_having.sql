-- =====================================================================
-- Cyrix KPI  ·  0107  ·  An answer from a desk is news worth having
--
-- Management: when HR or Software answers a support question, the person
-- who asked is told, the same way they are told when a manager answers a
-- query about their scoring.
--
-- Raising a question already put a badge on somebody else's screen; the
-- answer put nothing on theirs. They found out by going back and looking,
-- which means the ones who did not go back and look never found out at
-- all -- and a desk that answers into silence gets asked again.
--
-- Both functions below are the LIVE definitions with one edit each,
-- taken from pg_get_functiondef and diffed to prove nothing else moved.
-- Nothing here is retyped from memory.
--
-- The new line carries no "not hr and not sw_only" guard, unlike every
-- other personal notification. Those guards exist because the two admin
-- logins are not appraised, so KPI news is noise to them. A support
-- ticket is the one personal thing those accounts genuinely have.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.my_notifications()
 RETURNS TABLE(kind text, n integer, latest timestamp with time zone, unread boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  select 'score_query_answered', count(*)::int, max(q.answered_at)
  from ctx
  join kpi_score_queries q
    on q.employee_id = ctx.me_id and q.status = 'answered'
   and q.answered_at > ctx.news_since
  where not ctx.hr and not ctx.sw_only
  having count(*) > 0

  -- A desk has answered something they asked.
  --
  -- Deliberately without the "not hr and not sw_only" guard every other
  -- personal line carries. Those exist because the admin logins are not
  -- appraised, so a KPI notification is noise to them -- but a support
  -- ticket is the one personal thing those accounts really do have, and
  -- an HR Admin who asks Software a question should hear the answer.
  union all
  select 'support_answered', count(*)::int, max(t.answered_at)
  from ctx
  join support_tickets t
    on t.employee_id = ctx.me_id and t.status = 'answered'
   and t.answered_at > ctx.news_since
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
  select 'score_query', count(*)::int, max(q.raised_at)
  from ctx
  join employees tm on tm.reporting_manager_id = ctx.me_id and tm.is_active
  join kpi_score_queries q on q.employee_id = tm.id and q.status = 'open'
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
  and (nr.dismissed_at is null or f.latest > nr.dismissed_at)
order by f.latest desc;
$function$
;

CREATE OR REPLACE FUNCTION public.dismiss_notification(p_kind text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := current_employee_id();
begin
  if me is null then return; end if;

  -- The informational ones. Everything else is a queue, and a queue you
  -- can dismiss is a queue that gets forgotten. An answered query joins
  -- the list: it is news about something already finished.
  if p_kind not in ('kpi_approved', 'month_scored', 'score_query_answered',
                    'support_answered') then
    raise exception
      '"%" is outstanding work, not a message. It clears when it is done.',
      p_kind;
  end if;

  insert into notification_reads (employee_id, kind, read_at, dismissed_at)
  values (me, p_kind, now(), now())
  on conflict (employee_id, kind) do update
    set dismissed_at = excluded.dismissed_at,
        read_at      = excluded.read_at;
end $function$
;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  emp_auth uuid;
  emp_id   uuid;
  tid      uuid;
  found    int;
  refused  boolean;
begin
  select auth_user_id, id into emp_auth, emp_id from employees where ecode = 'E8888';
  if emp_auth is null then
    raise notice '0107 self-test skipped (E8888 has no login)';
    return;
  end if;

  -- An answered ticket for them, just now. `status` is generated from
  -- answered_at ('open' while null), so setting it directly is refused
  -- and setting the timestamp is what makes it answered.
  insert into support_tickets (employee_id, desk, employee_note,
                               response, answered_at)
  values (emp_id, 'hr', 'probe question', 'probe answer', now())
  returning id into tid;

  perform set_config('request.jwt.claims',
    json_build_object('sub', emp_auth, 'role', 'authenticated')::text, true);

  select count(*)::int into found
  from my_notifications() where kind = 'support_answered';
  if found <> 1 then
    raise exception 'expected a support_answered notification, got %', found;
  end if;

  -- And it can be dismissed, because it is news rather than work.
  perform dismiss_notification('support_answered');

  -- While a queue still cannot be.
  refused := false;
  begin
    perform dismiss_notification('leavers');
  exception when others then
    if sqlerrm like '%outstanding work%' then refused := true; else raise; end if;
  end;
  if not refused then raise exception 'a queue was dismissable'; end if;

  raise notice '0107 self-test passed (answer shows, dismissable, queue is not)';
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
