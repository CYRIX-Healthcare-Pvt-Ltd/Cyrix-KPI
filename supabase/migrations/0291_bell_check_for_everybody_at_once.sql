-- =====================================================================
-- Cyrix KPI  ·  0291  ·  The 5-minute bell check works everybody out at once
--
-- The user, 12 Nov ("fix push bell check"): push_bell_due ran about 5 s every
-- 5 minutes and sometimes hit the 8 s limit (9 % of all database time since
-- 27 Aug). It asked my_notifications() once for each of the 774 people with
-- a phone (774 × ~7 ms = 5.2 s). bell_notifications_all() gives the same
-- lines — the same 13 rules as my_notifications, the same dismissed filter —
-- for everybody in one pass; push_bell_due reads them from there.
-- my_notifications stays for the app's own bell; a rule changed there is
-- changed here too.
-- =====================================================================

create or replace function public.bell_notifications_all(p_ids uuid[])
returns table (employee_id uuid, kind text, n int, latest timestamptz)
language sql stable security definer set search_path = public as $$
with fy as (
  select code, now() - interval '30 days' as news_since from financial_years where is_current
),
ppl as (
  select e.id, fy.code as fy, fy.news_since,
         exists (select 1 from user_roles ur where ur.employee_id = e.id and ur.role in ('hr_admin', 'super_admin')) as hr,
         exists (select 1 from user_roles ur where ur.employee_id = e.id and ur.role = 'sw_admin') as sw
  from employees e cross join fy
  where e.id = any (p_ids) and e.is_active
),
ctx as (
  select id, fy, news_since, hr, (sw and not hr) as sw_only, not hr and not (sw and not hr) as appraised from ppl
),
asg as (
  select distinct on (a.employee_id) a.employee_id, a.status, a.approved_at, a.submitted_at, a.updated_at
  from kpi_assignments a join ctx on ctx.id = a.employee_id and a.financial_year = ctx.fy
  where a.status in ('draft', 'pending_approval', 'active', 'rejected')
  order by a.employee_id, a.created_at desc
),
-- Who sits above the owner of a template pushed in the last 30 days (downline_of, read upwards, 12 levels).
pushed as (
  select al.id, al.created_at, t.owner_id
  from audit_log al join kpi_templates t on t.id = al.entity_id
  where al.action = 'template_pushed' and al.entity_type = 'kpi_template' and al.created_at > now() - interval '30 days'
),
up as (
  with recursive u as (
    select o.owner_id, e.reporting_manager_id as boss, 1 as depth
    from (select distinct owner_id from pushed) o join employees e on e.id = o.owner_id
    where e.reporting_manager_id is not null
    union all
    select u.owner_id, e.reporting_manager_id, u.depth + 1
    from u join employees e on e.id = u.boss
    where u.depth < 12 and e.reporting_manager_id is not null
  )
  select distinct owner_id, boss from u
),
hr_records as (
  select count(*)::int n, max(created_at) latest from (
    select created_at from record_deletion_requests where status = 'pending_hr'
    union all
    select created_at from kpi_revision_requests where status = 'pending_hr') r
),
hr_leavers as (
  select count(*)::int n, max(created_at) latest from tm_removal_requests where status = 'pending'
),
facts as (
  select ctx.id, 'kpi_rejected'::text as kind, 1 as n, coalesce(a.updated_at, a.submitted_at) as latest
  from ctx join asg a on a.employee_id = ctx.id
  where ctx.appraised and a.status = 'rejected'

  union all
  select ctx.id, 'kpi_approved', 1, a.approved_at
  from ctx join asg a on a.employee_id = ctx.id
  where ctx.appraised and a.status = 'active' and a.approved_at > ctx.news_since

  union all
  select ctx.id, 'month_returned', count(*)::int, max(coalesce(s.returned_at, s.updated_at))
  from ctx join kpi_submissions s on s.employee_id = ctx.id and s.financial_year = ctx.fy and s.status = 'returned'
  where ctx.appraised group by ctx.id

  union all
  select ctx.id, 'month_scored', count(*)::int, max(coalesce(s.manager_scored_at, s.updated_at))
  from ctx join kpi_submissions s on s.employee_id = ctx.id and s.financial_year = ctx.fy
   and s.status in ('scored', 'finalized') and coalesce(s.manager_scored_at, s.updated_at) > ctx.news_since
  where ctx.appraised group by ctx.id

  union all
  select ctx.id, 'score_query_answered', count(*)::int, max(q.answered_at)
  from ctx join kpi_score_queries q on q.employee_id = ctx.id and q.status = 'answered' and q.answered_at > ctx.news_since
  where ctx.appraised group by ctx.id

  union all
  select ctx.id, 'support_answered', count(*)::int, max(t.answered_at)
  from ctx join support_tickets t on t.employee_id = ctx.id and t.status = 'answered' and t.answered_at > ctx.news_since
  group by ctx.id

  union all
  select ctx.id, 'approvals', count(*)::int, max(coalesce(a.submitted_at, a.updated_at))
  from ctx join employees tm on tm.reporting_manager_id = ctx.id and tm.is_active
  join kpi_assignments a on a.employee_id = tm.id and a.financial_year = ctx.fy and a.status = 'pending_approval'
  where ctx.appraised group by ctx.id

  union all
  select ctx.id, 'scoring', count(*)::int, max(coalesce(s.self_submitted_at, s.updated_at))
  from ctx join employees tm on tm.reporting_manager_id = ctx.id and tm.is_active
  join kpi_submissions s on s.employee_id = tm.id and s.status = 'submitted'
  where ctx.appraised group by ctx.id

  union all
  select ctx.id, 'score_query', count(*)::int, max(q.raised_at)
  from ctx join employees tm on tm.reporting_manager_id = ctx.id and tm.is_active
  join kpi_score_queries q on q.employee_id = tm.id and q.status = 'open'
  where ctx.appraised group by ctx.id

  union all
  select ctx.id, 'records_manager', count(*)::int, max(r.created_at)
  from ctx
  join (select employee_id, created_at from record_deletion_requests where status = 'pending_manager'
        union all
        select employee_id, created_at from kpi_revision_requests where status = 'pending_manager') r on true
  join employees tm on tm.id = r.employee_id and tm.reporting_manager_id = ctx.id
  where ctx.appraised group by ctx.id

  union all
  select ctx.id, 'records_hr', h.n, h.latest from ctx cross join hr_records h where ctx.hr and h.n > 0

  union all
  select ctx.id, 'leavers', l.n, l.latest from ctx cross join hr_leavers l where ctx.hr and l.n > 0

  union all
  select ctx.id, 'template_pushed', count(*)::int, max(p.created_at)
  from ctx join pushed p on exists (select 1 from up where up.owner_id = p.owner_id and up.boss = ctx.id)
  where ctx.appraised and p.created_at > ctx.news_since group by ctx.id
)
select f.id, f.kind, f.n, f.latest
from facts f
left join notification_reads nr on nr.kind = f.kind and nr.employee_id = f.id
where f.latest is not null
  and (nr.dismissed_at is null or f.latest > nr.dismissed_at)
$$;
revoke all on function public.bell_notifications_all(uuid[]) from public, anon, authenticated;
grant execute on function public.bell_notifications_all(uuid[]) to service_role;

create or replace function public.push_bell_due()
returns table (employee_id uuid, kind text, n integer, detail text)
language plpgsql security definer set search_path to 'public' as $function$
declare
  r  record;
  f  record;
  st push_bell_state%rowtype;
  kinds text[];
  ids uuid[];
begin
  -- Revive Lab, worked out once for everybody.
  drop table if exists _rw;
  create temp table _rw on commit drop as select * from revive_waiting_now();

  ids := array(select distinct e.id from push_subscriptions s join employees e on e.id = s.employee_id
               where e.is_active and e.auth_user_id is not null);
  -- KPI's own bell lines, worked out once for everybody (0291: 774 one-by-one calls took 5 s).
  drop table if exists _nt;
  create temp table _nt on commit drop as select * from bell_notifications_all(ids);
  create index on _nt (employee_id);

  for r in select x as id from unnest(ids) x
  loop
    kinds := '{}';
    for f in
      select x.kind, x.n, x.latest, null::text as detail from _nt x where x.employee_id = r.id
      union all
      select 'revive', count(distinct w.ticket_id)::int, max(w.at),
             (select string_agg(y.code || ' · ' || y.why, ', ' order by y.at desc)
              from (select * from _rw z where z.employee_id = r.id order by z.at desc limit 3) y)
      from _rw w where w.employee_id = r.id
      having count(*) > 0
      union all
      select 'revive_team', count(*)::int, max(t.created_at),
             (select split_part(m.full_name, ' ', 1) || ' raised ' || tt.code || coalesce(' · ' || nullif(tt.spare_name, ''), '')
              from revive_tickets tt join employees m on m.id = tt.raised_by
              where m.reporting_manager_id = r.id and tt.created_at > now() - interval '30 days'
              order by tt.created_at desc limit 1)
      from revive_tickets t join employees m on m.id = t.raised_by
      where m.reporting_manager_id = r.id and t.created_at > now() - interval '30 days'
      having count(*) > 0
      union all
      -- My Task (0220): what the manager did on this person's tasks, not opened yet — a task assigned, a reminder…
      select 'tasks', count(distinct e.task_id)::int, max(e.at),
             (select split_part(coalesce(b.full_name, 'Your manager'), ' ', 1) || ' ' || case e2.kind
                when 'assigned' then 'assigned you' when 'reminder' then 'sent a reminder on' when 'sent_back' then 'sent back'
                when 'approved' then 'approved' when 'reopened' then 'reopened' when 'due' then 'changed the due date of'
                when 'criticality' then 'changed how critical' when 'comment' then 'commented on'
                when 'progress' then coalesce(e2.note, 'updated progress') || ' on' when 'done' then 'completed' else 'changed' end
              || ' · ' || t2.title
              from task_events e2 join task_items t2 on t2.id = e2.task_id left join employees b on b.id = e2.by_id
              where t2.employee_id = r.id and e2.seen_at is null and (t2.assigned_by is null or ((t2.release_on + time '09:00') at time zone 'Asia/Kolkata') <= now()) and e2.by_id is distinct from r.id and e2.kind in ('assigned', 'reminder', 'sent_back', 'approved', 'reopened', 'due', 'criticality', 'comment')
              order by e2.at desc limit 1)
      from task_events e join task_items t on t.id = e.task_id
      where t.employee_id = r.id and e.seen_at is null and (t.assigned_by is null or ((t.release_on + time '09:00') at time zone 'Asia/Kolkata') <= now()) and e.by_id is distinct from r.id and e.kind in ('assigned', 'reminder', 'sent_back', 'approved', 'reopened', 'due', 'criticality', 'comment')
      having count(*) > 0
      union all
      -- …and, to the manager who assigned a task, the person's progress, completion and comments on it.
      select 'tasks_team', count(distinct e.task_id)::int, max(e.at),
             (select split_part(coalesce(b.full_name, 'Your manager'), ' ', 1) || ' ' || case e2.kind
                when 'assigned' then 'assigned you' when 'reminder' then 'sent a reminder on' when 'sent_back' then 'sent back'
                when 'approved' then 'approved' when 'reopened' then 'reopened' when 'due' then 'changed the due date of'
                when 'criticality' then 'changed how critical' when 'comment' then 'commented on'
                when 'progress' then coalesce(e2.note, 'updated progress') || ' on' when 'done' then 'completed' else 'changed' end
              || ' · ' || t2.title
              from task_events e2 join task_items t2 on t2.id = e2.task_id left join employees b on b.id = e2.by_id
              where t2.assigned_by = r.id and e2.by_id = t2.employee_id and e2.seen_at is null and e2.kind in ('progress', 'done', 'comment')
              order by e2.at desc limit 1)
      from task_events e join task_items t on t.id = e.task_id
      where t.assigned_by = r.id and e.by_id = t.employee_id and e.seen_at is null and e.kind in ('progress', 'done', 'comment')
      having count(*) > 0
    loop
      kinds := kinds || f.kind;
      select * into st from push_bell_state b where b.employee_id = r.id and b.kind = f.kind;
      if not found
         or f.n > st.n
         or coalesce(f.latest, '-infinity') > coalesce(st.latest, '-infinity') then
        employee_id := r.id; kind := f.kind; n := f.n; detail := f.detail;
        return next;
      end if;
      insert into push_bell_state as b (employee_id, kind, n, latest)
      values (r.id, f.kind, f.n, f.latest)
      on conflict on constraint push_bell_state_pkey do update set n = excluded.n, latest = excluded.latest;
    end loop;
    delete from push_bell_state b where b.employee_id = r.id and not (b.kind = any (kinds));
  end loop;
end $function$;
revoke execute on function public.push_bell_due() from public, anon, authenticated;
grant execute on function public.push_bell_due() to service_role;
