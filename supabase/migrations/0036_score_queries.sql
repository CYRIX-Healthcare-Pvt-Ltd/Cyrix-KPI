-- =====================================================================
-- Cyrix KPI  ·  0036  ·  Querying a score
--
-- Until now the manager's score was the end of the conversation. The
-- team member could read it and could ask for the whole month to be
-- deleted, and there was nothing in between — no way to say "I do not
-- understand row three" or "the repeat-call figure is wrong" short of
-- asking for the record to be destroyed.
--
-- So: a query. Raised by the team member, against named rows, once, and
-- only inside a window that starts when the manager first scores.
--
-- Four rules, all enforced here rather than in the app, because each one
-- is the kind that gets argued about afterwards:
--
--   ONCE       one query per month, by unique index. Not "the UI hides
--              the button" — a second call fails.
--   WINDOW     seven days from manager_scored_at, frozen onto the row at
--              the moment it is raised, so changing the setting later
--              cannot retrospectively close or reopen anything.
--   NAMED      at least one row, and every row must belong to this
--              month. A query against everything is a complaint; a query
--              against row three is a question somebody can answer.
--   HONEST     whether the score actually moved is computed from a
--              snapshot taken at raise time, not asserted by the person
--              who moved it.
--
-- An open query blocks finalisation. That is the whole point of raising
-- one before the month is locked, and if the month is already locked the
-- query reopens it to 'scored' — the manager cannot answer a question
-- about a score they are no longer permitted to change.
--
-- Evidence is deleted once the window has closed and the query is
-- answered. Nothing more can happen to the month at that point, so the
-- attachment has served its purpose and is somebody's document sitting
-- in a bucket.
-- =====================================================================

insert into app_settings (key, value, description) values
  ('score_query_window',
   '{"days": 7}'::jsonb,
   'Days after the manager first scores a month during which the team member may query it. One query per month.')
on conflict (key) do nothing;


-- ---------------------------------------------------------------------
-- 1. The tables
-- ---------------------------------------------------------------------
create table if not exists kpi_score_queries (
  id                 uuid primary key default gen_random_uuid(),
  submission_id      uuid not null references kpi_submissions(id) on delete cascade,
  employee_id        uuid not null references employees(id),
  manager_id         uuid references employees(id),
  raised_at          timestamptz not null default now(),
  /** Frozen at raise time. The setting may move; this may not. */
  window_closes_at   timestamptz not null,
  status             text not null default 'open'
                       check (status in ('open', 'answered')),
  employee_note      text,
  /** The manager's total when the query was raised, to compare against. */
  mgr_total_at_raise numeric(6,2),
  answered_at        timestamptz,
  answered_by        uuid references employees(id),
  manager_response   text,
  /** Computed on answering, not claimed. */
  score_changed      boolean not null default false,
  evidence_purged_at timestamptz,
  created_at         timestamptz not null default now()
);

-- Once per month, and the reason the app never has to check.
create unique index if not exists kpi_score_queries_one_per_submission
  on kpi_score_queries (submission_id);
create index if not exists kpi_score_queries_manager
  on kpi_score_queries (manager_id, status);
create index if not exists kpi_score_queries_employee
  on kpi_score_queries (employee_id);

create table if not exists kpi_score_query_points (
  id            uuid primary key default gen_random_uuid(),
  query_id      uuid not null references kpi_score_queries(id) on delete cascade,
  item_id       uuid not null references kpi_submission_items(id) on delete cascade,
  /**
   * Which of the two things this is. The team member says up front
   * whether they need it explained or think it is wrong, because those
   * need different answers and a manager reading a list of ticks cannot
   * tell them apart.
   */
  kind          text not null check (kind in ('clarification', 'disagreement')),
  note          text,
  /** Storage object path, null when nothing was attached. */
  evidence_path text,
  evidence_name text,
  created_at    timestamptz not null default now()
);

create unique index if not exists kpi_score_query_points_unique
  on kpi_score_query_points (query_id, item_id);

comment on table kpi_score_queries is
  'A team member questioning a manager''s scoring of one month. One per '
  'month, inside a window that opens when the manager first scores.';


-- ---------------------------------------------------------------------
-- 2. Who can see what
--
-- The team member, their manager and HR. Not SW Admin: a query names a
-- score and argues about it, which is appraisal content.
--
-- Read-only through RLS for everybody. Every write goes through the
-- functions below, because every write has a rule attached to it.
-- ---------------------------------------------------------------------
alter table kpi_score_queries       enable row level security;
alter table kpi_score_query_points  enable row level security;

drop policy if exists score_queries_read on kpi_score_queries;
create policy score_queries_read on kpi_score_queries for select to authenticated
using (
  employee_id = current_employee_id()
  or manages_employee(employee_id)
  or is_hr_admin()
);

drop policy if exists score_query_points_read on kpi_score_query_points;
create policy score_query_points_read on kpi_score_query_points
for select to authenticated
using (exists (
  select 1 from kpi_score_queries q
  where q.id = query_id
    and (q.employee_id = current_employee_id()
         or manages_employee(q.employee_id)
         or is_hr_admin())
));

grant select on kpi_score_queries, kpi_score_query_points to authenticated;


-- ---------------------------------------------------------------------
-- 3. Raising one
-- ---------------------------------------------------------------------
create or replace function raise_score_query(
  p_submission_id uuid,
  p_note          text,
  /** [{"item_id": uuid, "kind": "clarification"|"disagreement",
        "note": text, "evidence_path": text, "evidence_name": text}] */
  p_points        jsonb
)
returns kpi_score_queries
language plpgsql volatile security definer set search_path = public as $$
declare
  s        kpi_submissions%rowtype;
  me       uuid := current_employee_id();
  days     int;
  closes   timestamptz;
  q        kpi_score_queries%rowtype;
  n_points int;
  n_alien  int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'That month was not found'; end if;

  if s.employee_id is distinct from me then
    raise exception 'Only the person the month belongs to can query it';
  end if;

  if s.manager_scored_at is null
     or s.status not in ('scored', 'finalized') then
    raise exception
      'You can only query a month your manager has scored (current: %)', s.status;
  end if;

  select coalesce((value->>'days')::int, 7) into days
  from app_settings where key = 'score_query_window';
  days := coalesce(days, 7);
  closes := s.manager_scored_at + make_interval(days => days);

  if now() > closes then
    raise exception
      'The % days to query this month ran out on %',
      days, to_char(closes at time zone 'Asia/Kolkata', 'DD Mon YYYY');
  end if;

  if exists (select 1 from kpi_score_queries where submission_id = p_submission_id) then
    raise exception 'This month has already been queried once';
  end if;

  -- At least one row, and every row has to be a row of THIS month.
  -- Without the second check a caller could name somebody else's item id
  -- and quietly attach their argument to a stranger's score.
  select count(*) into n_points
  from jsonb_array_elements(coalesce(p_points, '[]'::jsonb));
  if n_points = 0 then
    raise exception 'Tick at least one row you want looked at';
  end if;

  select count(*) into n_alien
  from jsonb_array_elements(p_points) pt
  where not exists (
    select 1 from kpi_submission_items i
    where i.id = (pt->>'item_id')::uuid
      and i.submission_id = p_submission_id
  );
  if n_alien > 0 then
    raise exception 'One of those rows is not part of this month';
  end if;

  insert into kpi_score_queries (
    submission_id, employee_id, manager_id, window_closes_at,
    employee_note, mgr_total_at_raise
  ) values (
    p_submission_id, me,
    (select reporting_manager_id from employees where id = me),
    closes, nullif(trim(coalesce(p_note, '')), ''), s.mgr_total_score
  )
  returning * into q;

  insert into kpi_score_query_points (
    query_id, item_id, kind, note, evidence_path, evidence_name)
  select
    q.id,
    (pt->>'item_id')::uuid,
    coalesce(nullif(pt->>'kind', ''), 'clarification'),
    nullif(trim(coalesce(pt->>'note', '')), ''),
    nullif(trim(coalesce(pt->>'evidence_path', '')), ''),
    nullif(trim(coalesce(pt->>'evidence_name', '')), '')
  from jsonb_array_elements(p_points) pt;

  -- A finalised month cannot be edited, so a query against one would be
  -- a question the manager is forbidden from acting on. Raising it puts
  -- the month back where the manager can work.
  if s.status = 'finalized' then
    update kpi_submissions
    set status = 'scored', finalized_at = null
    where id = p_submission_id;
  end if;

  return q;
end $$;

grant execute on function raise_score_query(uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Answering it
-- ---------------------------------------------------------------------
create or replace function answer_score_query(
  p_query_id uuid,
  p_response text
)
returns kpi_score_queries
language plpgsql volatile security definer set search_path = public as $$
declare
  q   kpi_score_queries%rowtype;
  s   kpi_submissions%rowtype;
  out kpi_score_queries%rowtype;
begin
  select * into q from kpi_score_queries where id = p_query_id;
  if not found then raise exception 'That query was not found'; end if;

  if not (manages_employee(q.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can answer this';
  end if;

  if q.status <> 'open' then
    raise exception 'That query has already been answered';
  end if;

  if nullif(trim(coalesce(p_response, '')), '') is null then
    raise exception 'Write a reply — a query closed in silence is not answered';
  end if;

  select * into s from kpi_submissions where id = q.submission_id;

  update kpi_score_queries
  set status           = 'answered',
      answered_at      = now(),
      answered_by      = current_employee_id(),
      manager_response = trim(p_response),
      -- Measured, not asserted. Whether the manager moved the score is a
      -- fact about the data, and the person who did or did not move it is
      -- the last person who should be recording it.
      score_changed    = (s.mgr_total_score is distinct from q.mgr_total_at_raise)
  where id = p_query_id
  returning * into out;

  return out;
end $$;

grant execute on function answer_score_query(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Finalisation waits for the answer
--
-- Identical to 0010's, plus the check. Repeated whole rather than
-- patched: a function body is replaced whole, and a reader comparing
-- the two should be able to see every difference.
-- ---------------------------------------------------------------------
create or replace function finalize_submission(p_submission_id uuid)
returns kpi_submissions
language plpgsql volatile security definer set search_path = public as $$
declare s kpi_submissions%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can finalise this';
  end if;
  if s.status <> 'scored' then
    raise exception 'Only a scored month can be finalised (current: %)', s.status;
  end if;

  -- Locking a month with an open question on it is how the question
  -- stops mattering.
  if exists (
    select 1 from kpi_score_queries q
    where q.submission_id = p_submission_id and q.status = 'open'
  ) then
    raise exception
      'This month has an open query. Answer it before finalising.';
  end if;

  update kpi_submissions
  set status = 'finalized', finalized_at = now()
  where id = p_submission_id
  returning * into s;
  return s;
end $$;

grant execute on function finalize_submission(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. What a screen needs to know, in one call
--
-- Whether the button should be there at all, and if not, why not. The
-- app could work most of this out, but then the rule would exist twice
-- and the copy explaining the refusal would drift from the refusal.
-- ---------------------------------------------------------------------
create or replace function score_query_state(p_submission_id uuid)
returns table (
  can_raise      boolean,
  reason         text,
  closes_at      timestamptz,
  days_left      numeric,
  window_days    int,
  existing_id    uuid,
  existing_status text
)
language plpgsql stable security definer set search_path = public as $$
declare
  s      kpi_submissions%rowtype;
  me     uuid := current_employee_id();
  days   int;
  closes timestamptz;
  q      kpi_score_queries%rowtype;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then return; end if;

  if not (s.employee_id = me or manages_employee(s.employee_id) or is_hr_admin()) then
    return;
  end if;

  select coalesce((value->>'days')::int, 7) into days
  from app_settings where key = 'score_query_window';
  days := coalesce(days, 7);

  select * into q from kpi_score_queries where submission_id = p_submission_id;
  closes := case when s.manager_scored_at is not null
                 then s.manager_scored_at + make_interval(days => days) end;

  return query select
    case
      when s.employee_id <> me then false
      when q.id is not null then false
      when s.manager_scored_at is null then false
      when now() > closes then false
      else true
    end,
    case
      when s.employee_id <> me then 'Only the person the month belongs to can query it'
      when q.id is not null then 'This month has already been queried'
      when s.manager_scored_at is null then 'Your manager has not scored this month yet'
      when now() > closes then 'The window to query this month has closed'
    end,
    closes,
    case when closes is not null
         then round(greatest(0, extract(epoch from (closes - now())) / 86400.0), 2)
    end,
    days,
    q.id,
    q.status;
end $$;

grant execute on function score_query_state(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 7. Evidence, and getting rid of it
--
-- A private bucket. The path is scoped by submission and query so a
-- policy can reason about it without parsing a filename.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'kpi-evidence', 'kpi-evidence', false, 5242880,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upload: the team member, into a folder named for their own month.
-- The path's first segment is the submission id, so "is this yours" is a
-- lookup rather than a guess.
drop policy if exists kpi_evidence_insert on storage.objects;
create policy kpi_evidence_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'kpi-evidence'
  and exists (
    select 1 from kpi_submissions s
    where s.id::text = (storage.foldername(name))[1]
      and s.employee_id = current_employee_id()
  )
);

-- Read: the same three people who can read the query itself.
drop policy if exists kpi_evidence_read on storage.objects;
create policy kpi_evidence_read on storage.objects for select to authenticated
using (
  bucket_id = 'kpi-evidence'
  and exists (
    select 1 from kpi_submissions s
    where s.id::text = (storage.foldername(name))[1]
      and (s.employee_id = current_employee_id()
           or manages_employee(s.employee_id)
           or is_hr_admin())
  )
);

-- Delete: whoever can read it. The purge below decides WHAT is deleted;
-- this only decides who is allowed to carry it out.
drop policy if exists kpi_evidence_delete on storage.objects;
create policy kpi_evidence_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'kpi-evidence'
  and exists (
    select 1 from kpi_submissions s
    where s.id::text = (storage.foldername(name))[1]
      and (s.employee_id = current_employee_id()
           or manages_employee(s.employee_id)
           or is_hr_admin())
  )
);

/**
 * The paths that are finished with.
 *
 * A query's evidence is dead once the window has closed AND the query
 * has been answered — at that point nothing further can happen to the
 * month, so the attachment is somebody's document sitting in a bucket
 * for no reason.
 *
 * Returns paths rather than deleting them, because removing a row from
 * storage.objects leaves the actual file behind; only the Storage API
 * takes both. The caller deletes, then calls mark_query_evidence_purged.
 */
create or replace function expired_query_evidence()
returns table (query_id uuid, path text)
language sql stable security definer set search_path = public as $$
  select p.query_id, p.evidence_path
  from kpi_score_query_points p
  join kpi_score_queries q on q.id = p.query_id
  where p.evidence_path is not null
    and q.evidence_purged_at is null
    and q.status = 'answered'
    and q.window_closes_at < now()
    and (manages_employee(q.employee_id) or is_hr_admin())
$$;

grant execute on function expired_query_evidence() to authenticated;

create or replace function mark_query_evidence_purged(p_query_ids uuid[])
returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  with done as (
    update kpi_score_queries q
    set evidence_purged_at = now()
    where q.id = any (p_query_ids)
      and q.evidence_purged_at is null
      and q.status = 'answered'
      and q.window_closes_at < now()
      and (manages_employee(q.employee_id) or is_hr_admin())
    returning q.id
  )
  select count(*) into n from done;

  -- The row keeps the file's name so the record still reads as
  -- "they attached repair-log.pdf", and loses the pointer, because the
  -- file is gone and a link to nothing is worse than no link.
  update kpi_score_query_points p
  set evidence_path = null
  where p.query_id = any (p_query_ids)
    and exists (select 1 from kpi_score_queries q
                where q.id = p.query_id and q.evidence_purged_at is not null);

  return n;
end $$;

grant execute on function mark_query_evidence_purged(uuid[]) to authenticated;


-- ---------------------------------------------------------------------
-- 8. The tray
--
-- Two new kinds. Identical to 0027 apart from them, repeated whole for
-- the same reason as before.
--
--   score_query           to the manager: somebody has questioned your
--                         scoring, and the month cannot close until you
--                         answer.
--   score_query_answered  to the team member: news, and dismissible.
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
  select 'score_query_answered', count(*)::int, max(q.answered_at)
  from ctx
  join kpi_score_queries q
    on q.employee_id = ctx.me_id and q.status = 'answered'
   and q.answered_at > ctx.news_since
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
$$;

create or replace function dismiss_notification(p_kind text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
begin
  if me is null then return; end if;

  -- The informational ones. Everything else is a queue, and a queue you
  -- can dismiss is a queue that gets forgotten. An answered query joins
  -- the list: it is news about something already finished.
  if p_kind not in ('kpi_approved', 'month_scored', 'score_query_answered') then
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


-- ---------------------------------------------------------------------
-- 9. Self-test.
--
-- Writes a real query and removes it, because the four rules above are
-- exactly the kind that read as correct and are not.
-- ---------------------------------------------------------------------
do $$
declare
  sub    kpi_submissions%rowtype;
  item   uuid;
  q      kpi_score_queries%rowtype;
  st     record;
  failed text;
begin
  select * into sub from kpi_submissions
  where status in ('scored', 'finalized') and manager_scored_at is not null
  order by manager_scored_at desc limit 1;

  if sub.id is null then
    raise notice '0036 self-test skipped — no scored month to query yet';
    return;
  end if;

  select id into item from kpi_submission_items
  where submission_id = sub.id order by sort_order limit 1;

  -- Raised directly rather than through the RPC: the RPC reads
  -- current_employee_id(), and this block is not signed in as anybody.
  insert into kpi_score_queries (
    submission_id, employee_id, manager_id, window_closes_at,
    employee_note, mgr_total_at_raise)
  values (
    sub.id, sub.employee_id, sub.manager_id,
    sub.manager_scored_at + interval '7 days',
    'self-test', sub.mgr_total_score)
  returning * into q;

  insert into kpi_score_query_points (query_id, item_id, kind, note)
  values (q.id, item, 'disagreement', 'self-test');

  -- ONCE: a second query against the same month must not be possible.
  begin
    insert into kpi_score_queries (submission_id, employee_id, window_closes_at)
    values (sub.id, sub.employee_id, now() + interval '7 days');
    failed := 'a month could be queried twice';
  exception when unique_violation then
    null;
  end;
  if failed is not null then
    delete from kpi_score_queries where id = q.id;
    raise exception '%', failed;
  end if;

  -- BLOCKS FINALISATION: only meaningful for a month that is scored
  -- rather than already final.
  if sub.status = 'scored' then
    begin
      perform finalize_submission(sub.id);
      failed := 'a month with an open query was finalised';
    exception
      when others then
        if sqlerrm not like '%open query%' then
          failed := 'finalising failed for the wrong reason: ' || sqlerrm;
        end if;
    end;
  end if;

  -- HONEST: the snapshot is what the answer compares against.
  if q.mgr_total_at_raise is distinct from sub.mgr_total_score then
    failed := coalesce(failed, 'the manager total was not snapshotted');
  end if;

  -- Nothing is expired yet, so nothing may be purged.
  if exists (select 1 from expired_query_evidence() where query_id = q.id) then
    failed := coalesce(failed, 'an open query''s evidence was already expiring');
  end if;

  delete from kpi_score_queries where id = q.id;

  if failed is not null then
    raise exception '%', failed;
  end if;

  raise notice
    '0036 self-test passed — one query per month, finalisation blocked '
    'while it is open, snapshot taken, evidence not yet expiring';
end $$;
