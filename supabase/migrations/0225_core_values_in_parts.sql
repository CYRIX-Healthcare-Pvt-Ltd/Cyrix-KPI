/*
  0225 — core values in parts (Ajith sir, through the user, 28 Oct: "under each core value he needs like this,
  and that average score is score of the core value").

  On a KPI where the team member rates their own core values (0214), each core value is rated in parts: Speed of
  Response and Building Relationships on colleagues, clients and the cross functional team; Trust, Care and
  Continuous Learning on the lines of his sheet. The team member rates every part, writes the two learning goals
  each month, and keeps one comment per core value. The manager rates every part too. A core value's score is the
  average of its parts' points, stored on core_value_ratings as self_points and manager_points, and everything
  that scored a core value from its one rating now takes those points when they are there.

  Every month not yet scored by the manager on such a KPI gets the parts now, and a submitted one goes back to
  draft for the team member to rate the parts and send it again (the user: "revert to draft, which ajith hasnt
  scored"). Scored and finalised months keep the one rating per core value they were scored on.
*/

-- ---------------------------------------------------------------------------------------------------------------
-- The parts, one list for the company; a month keeps its own copy of the wording.
create table if not exists core_value_parts (
  id            uuid primary key default gen_random_uuid(),
  core_value_id uuid not null references core_value_definitions(id) on delete cascade,
  label         text not null,
  -- A learning goal: the team member writes the goal itself each month, then rates it.
  is_goal       boolean not null default false,
  sort_order    int not null default 0,
  is_active     boolean not null default true
);
alter table core_value_parts enable row level security;
drop policy if exists core_value_parts_read on core_value_parts;
create policy core_value_parts_read on core_value_parts for select to authenticated using (true);
drop policy if exists core_value_parts_write on core_value_parts;
create policy core_value_parts_write on core_value_parts for all to authenticated
  using (is_hr_admin() or is_sw_admin()) with check (is_hr_admin() or is_sw_admin());
revoke all on core_value_parts from anon;

insert into core_value_parts (core_value_id, label, is_goal, sort_order)
select d.id, p.label, p.goal, p.n
from core_value_definitions d
join (values
  ('Speed of Response',      'Colleagues',                                         false, 1),
  ('Speed of Response',      'Clients',                                            false, 2),
  ('Speed of Response',      'Cross functional team',                              false, 3),
  ('Building Relationships', 'Colleagues',                                         false, 1),
  ('Building Relationships', 'Clients',                                            false, 2),
  ('Building Relationships', 'Cross functional team',                              false, 3),
  ('Trust',                  'Disciplined punctuality',                            false, 1),
  ('Trust',                  'Deliver as promised. No excuses',                    false, 2),
  ('Trust',                  'Walking the talk; Do what I say',                    false, 3),
  ('Trust',                  'Celebrate achievements',                             false, 4),
  ('Trust',                  'Treat others with dignity & respect',                false, 5),
  ('Care',                   'Actively listening to the customers and colleagues', false, 1),
  ('Care',                   'Providing constructive feedback with empathy',       false, 2),
  ('Continuous Learning',    'Learning goal 1',                                    true,  1),
  ('Continuous Learning',    'Learning goal 2',                                    true,  2)
) as p(cv, label, goal, n) on p.cv = d.name
where not exists (select 1 from core_value_parts);

-- ---------------------------------------------------------------------------------------------------------------
-- A month's ratings of the parts, under the core value row they average into.
create table if not exists core_value_part_ratings (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references kpi_submissions(id) on delete cascade,
  rating_id      uuid not null references core_value_ratings(id) on delete cascade,
  part_id        uuid references core_value_parts(id) on delete set null,
  label          text not null,
  is_goal        boolean not null default false,
  sort_order     int not null default 0,
  goal           text,
  self_rating    text references rating_scale(label),
  manager_rating text references rating_scale(label),
  unique (rating_id, part_id)
);
create index if not exists idx_core_part_ratings_submission on core_value_part_ratings(submission_id);
alter table core_value_part_ratings enable row level security;
drop policy if exists core_part_ratings_read on core_value_part_ratings;
create policy core_part_ratings_read on core_value_part_ratings for select to authenticated using (
  exists (select 1 from kpi_submissions s where s.id = core_value_part_ratings.submission_id
          and (s.employee_id = current_employee_id() or manages_employee(s.employee_id) or is_hr_admin())));
drop policy if exists core_part_ratings_update on core_value_part_ratings;
create policy core_part_ratings_update on core_value_part_ratings for update to authenticated using (
  exists (select 1 from kpi_submissions s where s.id = core_value_part_ratings.submission_id
          and s.status <> 'finalized'
          and ((s.employee_id = current_employee_id() and s.status in ('draft', 'returned'))
               or (manages_employee(s.employee_id) and s.status in ('submitted', 'scored'))
               or is_hr_admin())));
revoke all on core_value_part_ratings from anon;

-- The core value's score from its parts, on the 0-100 points scale its one rating used.
alter table core_value_ratings add column if not exists self_points numeric(7,4);
alter table core_value_ratings add column if not exists manager_points numeric(7,4);

create or replace function public.sync_core_value_parts()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare prev text := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
begin
  perform set_config('cyrix.system_write', 'on', true);
  update core_value_ratings r
     set self_points    = (select round(avg(rs.points), 4) from core_value_part_ratings p
                           join rating_scale rs on rs.label = p.self_rating where p.rating_id = r.id),
         manager_points = (select round(avg(rs.points), 4) from core_value_part_ratings p
                           join rating_scale rs on rs.label = p.manager_rating where p.rating_id = r.id)
   where r.id = coalesce(new.rating_id, old.rating_id);
  perform set_config('cyrix.system_write', prev, true);
  return null;
end $f$;
drop trigger if exists trg_core_parts_sync on core_value_part_ratings;
create trigger trg_core_parts_sync after insert or update or delete on core_value_part_ratings
  for each row execute function sync_core_value_parts();

-- Who may change what on a part: the same rules as the core value it belongs to.
create or replace function public.guard_core_part_columns()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare s kpi_submissions%rowtype; me uuid;
begin
  if system_write_active() or auth.uid() is null then return new; end if;
  if new.submission_id is distinct from old.submission_id or new.rating_id is distinct from old.rating_id
     or new.part_id is distinct from old.part_id or new.label is distinct from old.label
     or new.is_goal is distinct from old.is_goal or new.sort_order is distinct from old.sort_order then
    raise exception 'The parts of a core value are fixed for the month';
  end if;
  if is_hr_admin() then return new; end if;
  select * into s from kpi_submissions where id = new.submission_id;
  me := current_employee_id();
  if s.employee_id = me then
    if new.manager_rating is distinct from old.manager_rating then
      raise exception 'You cannot edit the manager rating';
    end if;
    if (new.self_rating is distinct from old.self_rating or new.goal is distinct from old.goal)
       and s.status not in ('draft', 'returned') then
      raise exception 'This month has been sent to your manager, so your core value ratings are locked';
    end if;
  elsif manages_employee(s.employee_id) then
    if s.status = 'submitted' and new.manager_rating is distinct from old.manager_rating
       and now() >= kpi_deadline_at(s.period_month, 'manager') then
      raise exception '%', kpi_deadline_message(s.period_month, 'manager');
    end if;
    if new.self_rating is distinct from old.self_rating or new.goal is distinct from old.goal then
      raise exception 'You cannot edit the team member''s self rating';
    end if;
    if s.status in ('scored', 'finalized') and old.manager_rating is not null and new.manager_rating is null then
      raise exception 'This month is already scored — a core value cannot be left unrated. Change the rating instead.';
    end if;
  else
    raise exception 'Not permitted';
  end if;
  return new;
end $f$;
drop trigger if exists trg_guard_core_parts on core_value_part_ratings;
create trigger trg_guard_core_parts before update on core_value_part_ratings
  for each row execute function guard_core_part_columns();

-- Puts the parts on a month of a KPI that rates its own core values. The one rating a core value had stays where it
-- was, unused once its parts are rated: their points come first wherever a core value is scored.
create or replace function public.ensure_core_parts(p_submission_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $f$
declare prev text := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off'); n int;
begin
  if not exists (select 1 from kpi_submissions s join kpi_assignments a on a.id = s.assignment_id
                 where s.id = p_submission_id and a.core_self_rating) then
    return 0;
  end if;
  perform set_config('cyrix.system_write', 'on', true);
  insert into core_value_part_ratings (submission_id, rating_id, part_id, label, is_goal, sort_order)
  select r.submission_id, r.id, p.id, p.label, p.is_goal, p.sort_order
  from core_value_ratings r
  join core_value_parts p on p.core_value_id = r.core_value_id and p.is_active
  where r.submission_id = p_submission_id
    and not exists (select 1 from core_value_part_ratings x where x.rating_id = r.id)
  on conflict do nothing;
  get diagnostics n = row_count;
  perform set_config('cyrix.system_write', prev, true);
  return n;
end $f$;
revoke all on function public.ensure_core_parts(uuid) from public, anon, authenticated;


-- The core values in the order of Ajith sir's sheet, for everyone (the user, 28 Oct: "core value order is different
-- what you did, do same as in scnshot").
update core_value_definitions d set sort_order = o.n
from (values ('Speed of Response', 1), ('Building Relationships', 2), ('Trust', 3), ('Care', 4), ('Continuous Learning', 5)) as o(name, n)
where d.name = o.name;
-- Nobody sets a core value's points by hand: they come from its parts.
CREATE OR REPLACE FUNCTION public.guard_core_rating_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s  kpi_submissions%rowtype;
  me uuid;
begin
  if system_write_active() then
    return new;
  end if;

  -- No end user means a direct database connection: a migration, an admin
  -- script, or the service role. Those are trusted and bypass RLS anyway.
  -- An anonymous PostgREST caller never reaches here — every policy on this
  -- table is `to authenticated`, and anon holds no UPDATE grant.
  if auth.uid() is null then
    return new;
  end if;

  if new.self_points is distinct from old.self_points or new.manager_points is distinct from old.manager_points then
    raise exception 'A core value''s score comes from its parts';
  end if;

  select * into s from kpi_submissions where id = new.submission_id;
  if is_hr_admin() then return new; end if;
  me := current_employee_id();

  if s.employee_id = me then
    if new.manager_rating is distinct from old.manager_rating
       or new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager rating';
    end if;
    -- Their own rating and comment (0214), only while the month is theirs to fill in.
    if (new.self_rating is distinct from old.self_rating or new.self_remarks is distinct from old.self_remarks)
       and s.status not in ('draft', 'returned') then
      raise exception 'This month has been sent to your manager, so your core value ratings are locked';
    end if;
  elsif manages_employee(s.employee_id) then
    if s.status = 'submitted'
       and (new.manager_rating is distinct from old.manager_rating
            or new.manager_remarks is distinct from old.manager_remarks)
       and now() >= kpi_deadline_at(s.period_month, 'manager') then
      raise exception '%', kpi_deadline_message(s.period_month, 'manager');
    end if;
    if new.self_rating is distinct from old.self_rating or new.self_remarks is distinct from old.self_remarks then
      raise exception 'You cannot edit the team member''s self rating';
    end if;
    -- A rating cannot be taken back out of a month that has been scored.
    --
    -- submit_manager_scores refuses to submit with any core value
    -- unrated, which covers the way in. It does not cover the way back:
    -- a scored month is edited by saving rather than submitting, so
    -- clearing a rating there passes no check at all and simply lowers
    -- the core-values figure. Core values are 20 of the 100 and only the
    -- manager rates them, so blanking all five removes a fifth of
    -- somebody's month with nothing on screen or in the log saying it
    -- happened.
    if s.status in ('scored', 'finalized')
       and old.manager_rating is not null
       and new.manager_rating is null then
      raise exception
        'This month is already scored — a core value cannot be left unrated. Change the rating instead.';
    end if;
  else
    raise exception 'Not permitted';
  end if;
  return new;
end $function$;

-- A core value with parts scores its parts' average; one without, its rating, as before.
CREATE OR REPLACE FUNCTION public.sync_core_value_rollup()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  sid      uuid := coalesce(new.submission_id, old.submission_id);
  self_avg numeric;
  mgr_avg  numeric;
  -- Each core value's weight on this KPI (0214); none set means all equal, as before.
  w        jsonb;
  -- the mirror variable is gone; see below.
begin
  perform set_config('cyrix.system_write', 'on', true);

  select a.core_value_weights into w
  from kpi_submissions s join kpi_assignments a on a.id = s.assignment_id
  where s.id = sid;

  -- A weighted average on the same 0-100 points scale, so the row still reads as it did.
  select sum(coalesce(r.self_points, rs.points) * coalesce((w->>r.core_value_id::text)::numeric, 1))
         / nullif(sum(coalesce((w->>r.core_value_id::text)::numeric, 1)), 0) into self_avg
  from core_value_ratings r
  left join rating_scale rs on rs.label = r.self_rating
  where r.submission_id = sid and coalesce(r.self_points, rs.points) is not null;

  /*
    The manager's own ratings, always.

    There used to be a core_values_mirror_self setting that copied the
    employee's self rating into the manager's figure, for a period when
    managers were not rating core values at all. It is now exactly
    backwards: the employee does not rate them and the manager does, so
    switching it on would copy a rating that no longer exists, leave
    mgr_avg null, and take the whole 20-point block off every single
    person -- silently, because a null average reads as an unrated block
    rather than as an error.

    It was false, so nothing was broken. A setting whose only remaining
    effect is to break scoring for the entire company should not be one
    keystroke away, so the branch goes rather than the value being
    trusted to stay false.
  */
  select sum(coalesce(r.manager_points, rs.points) * coalesce((w->>r.core_value_id::text)::numeric, 1))
         / nullif(sum(coalesce((w->>r.core_value_id::text)::numeric, 1)), 0) into mgr_avg
  from core_value_ratings r
  left join rating_scale rs on rs.label = r.manager_rating
  where r.submission_id = sid and coalesce(r.manager_points, rs.points) is not null;

  update kpi_submission_items
  set self_achieved    = self_avg,
      manager_achieved = mgr_avg
  where submission_id = sid
    and section = 'core_values';

  perform set_config('cyrix.system_write', 'off', true);
  return null;
end $function$;

-- A new month of a KPI that rates its own core values opens with the parts.
CREATE OR REPLACE FUNCTION public.open_submission(p_employee_id uuid, p_period_month date)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s      kpi_submissions%rowtype;
  a      kpi_assignments%rowtype;
  fy     text;
  month1 date := date_trunc('month', p_period_month)::date;
begin
  select * into s from kpi_submissions
  where employee_id = p_employee_id and period_month = month1;
  if found then return s; end if;

  select code into fy from financial_years
  where month1 between starts_on and ends_on;
  if fy is null then
    raise exception 'No financial year covers %', month1;
  end if;

  select * into a from kpi_assignments
  where employee_id = p_employee_id and financial_year = fy and status = 'active';
  if not found then
    raise exception 'No approved KPI is in place for this employee for FY %', fy;
  end if;

  if a.starts_from is not null and month1 < a.starts_from then
    raise exception
      'This KPI starts from %, so % is not assessed.',
      to_char(a.starts_from, 'Mon-YY'), to_char(month1, 'Mon-YY');
  end if;

  insert into kpi_submissions (assignment_id, employee_id, manager_id,
                               financial_year, period_month, status)
  select a.id, p_employee_id, e.reporting_manager_id, fy, month1, 'draft'
  from employees e where e.id = p_employee_id
  returning * into s;

  insert into kpi_submission_items (
    submission_id, assignment_item_id, section, kra, kpi_description,
    weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
  select
    s.id, ai.id, ai.section, ai.kra, ai.kpi_description,
    ai.weightage,
    case when ai.section = 'job_role' then
      coalesce(
        (select pi.target_value
         from kpi_submission_items pi
         join kpi_submissions ps on ps.id = pi.submission_id
         where ps.employee_id = p_employee_id
           and ps.period_month < month1
           and pi.assignment_item_id = ai.id
         order by ps.period_month desc
         limit 1),
        ai.target_value)
    else
      ai.target_value
    end,
    ai.target_unit, ai.scoring_rule, ai.rule_params, ai.sort_order
  from kpi_assignment_items ai
  where ai.assignment_id = a.id;

  insert into core_value_ratings (submission_id, core_value_id)
  select s.id, cv.id from core_value_definitions cv where cv.is_active;
  perform ensure_core_parts(s.id);

  perform log_audit('kpi_submission', s.id, 'opened',
                    jsonb_build_object('period', month1));
  return s;
end $function$;

-- Every part rated, and both learning goals written, before the month goes to the manager.
CREATE OR REPLACE FUNCTION public.submit_self_assessment(p_submission_id uuid)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s       kpi_submissions%rowtype;
  missing int;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if s.employee_id <> current_employee_id() then
    raise exception 'You can only submit your own assessment';
  end if;
  if s.status not in ('draft','returned') then
    raise exception 'This month has already been submitted (current: %)', s.status;
  end if;

  -- The last day (0153): after it nothing more is entered for the month.
  if now() >= kpi_deadline_at(s.period_month, 'tm') then
    raise exception '%', kpi_deadline_message(s.period_month, 'tm');
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and self_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still have no achieved value', missing;
  end if;

  -- A KPI that asks the team member to rate their own core values (0214) needs every one rated,
  -- each with a comment. Any other KPI has no core-value gate: those are the manager's.
  if exists (select 1 from kpi_assignments a where a.id = s.assignment_id and a.core_self_rating) then
    select count(*) into missing from core_value_part_ratings
    where submission_id = p_submission_id and is_goal and nullif(btrim(coalesce(goal, '')), '') is null;
    if missing > 0 then
      raise exception '% learning goal(s) still need writing', missing;
    end if;
    select count(*) into missing from core_value_ratings r
    where r.submission_id = p_submission_id
      and ((r.self_rating is null and not exists (select 1 from core_value_part_ratings p where p.rating_id = r.id))
           or exists (select 1 from core_value_part_ratings p where p.rating_id = r.id and p.self_rating is null)
           or nullif(btrim(coalesce(r.self_remarks, '')), '') is null);
    if missing > 0 then
      raise exception '% core value(s) still need your rating and a comment', missing;
    end if;
  end if;

  -- Otherwise no core-value gate. Those moved to the manager, so there is nothing
  -- here for the employee to have missed.
  --
  -- This required every core_value_ratings.self_rating to be filled, and
  -- once the dropdown that filled them was taken off the form the check
  -- could not be satisfied by anybody. Every submission failed with
  -- "5 core value(s) have not been rated", naming a control the person
  -- could not see. The manager's ratings are checked when the MANAGER
  -- submits, which is where that judgement now lives.

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status = 'submitted', self_submitted_at = now()
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'self_submitted', '{}'::jsonb);
  return s;
end $function$;

-- The manager rates every part; a low average needs a reason as a low rating does.
CREATE OR REPLACE FUNCTION public.submit_manager_scores(p_submission_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS kpi_submissions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s        kpi_submissions%rowtype;
  missing  int;
  gap      numeric;
  who      text;
  -- Mirrored in the client as SCORE_CUT_POINTS. If one moves, move both.
  cut_at   constant numeric := 5;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can score this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'This month is not ready for scoring (current: %)', s.status;
  end if;

  -- The manager's last day (0153). A month already scored can still be
  -- revised while it is open (an answered query); a first score cannot.
  if s.status = 'submitted' and now() >= kpi_deadline_at(s.period_month, 'manager') then
    raise exception '%', kpi_deadline_message(s.period_month, 'manager');
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and manager_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still need a manager value', missing;
  end if;

  -- And the core values, which only the manager rates now.
  --
  -- Nothing checked this before, because the employee rated them and
  -- their own submit was gated on it. When core values moved to the
  -- manager that gate became unsatisfiable and was removed in 0100 --
  -- which left nobody required to fill them at all. An unrated block
  -- scores nothing, and core values are 20 of the 100, so a manager who
  -- simply did not scroll that far would take a fifth of somebody's
  -- month away without either of them seeing it happen.
  select count(*) into missing
  from core_value_ratings r
  where r.submission_id = p_submission_id
    and ((r.manager_rating is null and not exists (select 1 from core_value_part_ratings p where p.rating_id = r.id))
         or exists (select 1 from core_value_part_ratings p where p.rating_id = r.id and p.manager_rating is null));
  if missing > 0 then
    raise exception
      '% core value(s) still need your rating. They are worth 20%% of the score.',
      missing;
  end if;

  -- And a low one needs a reason.
  --
  -- Satisfactory and Poor are the bottom two of the five, and a core
  -- value is a judgement about how somebody conducts themselves rather
  -- than a figure they missed -- the score they can do least about
  -- without being told why. The reason is shown to them, which is the
  -- whole point of collecting it.
  --
  -- Read off rating_scale rather than compared against the words, so
  -- rewording a label does not silently switch the requirement off.
  select count(*) into missing
  from core_value_ratings r
  left join rating_scale rs on rs.label = r.manager_rating
  where r.submission_id = p_submission_id
    and coalesce(r.manager_points, rs.points) <= 40
    and coalesce(btrim(r.manager_remarks), '') = '';
  if missing > 0 then
    raise exception
      '% core value(s) rated Satisfactory or Poor need a reason. % will see it.',
      missing,
      coalesce((select split_part(full_name, ' ', 1) from employees where id = s.employee_id), 'They');
  end if;

  -- How far below their own assessment this lands.
  -- Compared on the rows BOTH of them assessed: job role and ESMS.
  --
  -- It used to be the two totals, which was like for like while the
  -- employee also rated core values. It is not any more -- their total
  -- is job role and ESMS, the manager's is that plus core values -- so
  -- the manager's figure is now almost always the LARGER of the two and
  -- the gap comes out negative. The safeguard that makes a manager
  -- explain a score well below somebody's own assessment had quietly
  -- stopped being able to fire at all.
  gap := case
    when s.self_job_role_score is null or s.mgr_job_role_score is null then null
    else (coalesce(s.self_job_role_score, 0) + coalesce(s.self_esms_score, 0))
       - (coalesce(s.mgr_job_role_score, 0)  + coalesce(s.mgr_esms_score, 0))
  end;

  if gap is not null and gap > cut_at then
    if p_reason is null or btrim(p_reason) = '' then
      select split_part(full_name, ' ', 1) into who
      from employees where id = s.employee_id;
      raise exception
        'Your score is % points below %''s own assessment on the rows you both filled in. Say why before you submit — they will see it.',
        round(gap, 1), coalesce(who, 'their');
    end if;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status            = 'scored',
      manager_scored_at = now(),
      -- Cleared when the gap closes. A manager who revises upward should
      -- not leave last version's explanation attached to a score it no
      -- longer describes.
      score_cut_reason  = case
        when gap is not null and gap > cut_at then btrim(p_reason)
        else nullif(btrim(coalesce(p_reason, '')), '')
      end
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'manager_scored',
                    jsonb_build_object('gap', gap,
                                       'explained', p_reason is not null));
  return s;
end $function$;

-- Back to draft clears the manager's part ratings too, and gives a month the parts it is missing.
CREATE OR REPLACE FUNCTION public.admin_kpi_to_draft(p_assignment_id uuid, p_months date[] DEFAULT NULL::date[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r      record;
  late   text;
  moved  text[] := '{}';
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can move a month back to draft';
  end if;

  -- Null is every month of the KPI; otherwise the months chosen.
  select string_agg(to_char(s.period_month, 'Mon-YY'), ', ' order by s.period_month) into late
  from kpi_submissions s
  where s.assignment_id = p_assignment_id and s.status <> 'draft'
    and (p_months is null or s.period_month = any (select date_trunc('month', m)::date from unnest(p_months) m))
    and now() >= kpi_deadline_at(s.period_month, 'tm');
  if late is not null then
    raise exception 'The last day to submit % has passed, so as a draft it would be scored 0. Move the last day later in Timing first.', late;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  for r in
    select s.id, s.period_month, s.status, s.mgr_total_score, s.final_total_score, s.deadline_outcome
    from kpi_submissions s
    where s.assignment_id = p_assignment_id and s.status <> 'draft'
      and (p_months is null or s.period_month = any (select date_trunc('month', m)::date from unnest(p_months) m))
    order by s.period_month
  loop
    update core_value_part_ratings set manager_rating = null where submission_id = r.id;
    update core_value_ratings set manager_rating = null, manager_remarks = null where submission_id = r.id;
    update kpi_submission_items set manager_achieved = null, manager_score = null, manager_remarks = null, final_score = null
     where submission_id = r.id;
    update kpi_score_queries
       set status = 'answered', answered_at = now(), answered_by = current_employee_id(),
           manager_response = 'The month went back to draft.', score_changed = false
     where submission_id = r.id and status = 'open';
    -- Again: a trigger above may have put it back.
    perform set_config('cyrix.system_write', 'on', true);
    update kpi_submissions
       set status = 'draft', self_submitted_at = null, manager_scored_at = null, finalized_at = null,
           returned_at = null, return_reason = null, manager_remarks = null, score_cut_reason = null,
           deadline_outcome = null, outcome_from_status = null
     where id = r.id;
    perform ensure_core_parts(r.id);
    perform set_config('cyrix.system_write', 'on', true);
    perform recompute_submission_totals(r.id);
    perform set_config('cyrix.system_write', 'on', true);
    perform log_audit('kpi_submission', r.id, 'sw_admin_to_draft', jsonb_build_object(
      'was', r.status, 'mgr_total', r.mgr_total_score, 'final_total', r.final_total_score, 'outcome', r.deadline_outcome));
    moved := moved || to_char(r.period_month, 'Mon-YY');
  end loop;
  perform set_config('cyrix.system_write', 'off', true);

  return jsonb_build_object('months', cardinality(moved), 'list', to_jsonb(moved));
end $function$;

-- Ticking or unticking self-rating puts the parts on, or takes them off, the months still being filled in.
CREATE OR REPLACE FUNCTION public.set_core_value_options(p_assignment_id uuid, p_self boolean, p_weights jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a kpi_assignments%rowtype; total numeric;
begin
  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'KPI not found'; end if;
  if not (a.employee_id = current_employee_id() or manages_employee(a.employee_id) or is_hr_admin() or is_sw_admin()) then
    raise exception 'Not permitted';
  end if;
  if p_weights is not null then
    select sum((v)::numeric) into total from jsonb_each_text(p_weights) as e(k, v);
    if total is null or abs(total - a.core_values_weight) > 0.01 then
      raise exception 'Core value weights must add up to %', a.core_values_weight || '%';
    end if;
  end if;
  update kpi_assignments set core_self_rating = coalesce(p_self, false), core_value_weights = p_weights where id = p_assignment_id;
  if coalesce(p_self, false) then
    perform ensure_core_parts(s.id) from kpi_submissions s where s.assignment_id = p_assignment_id and s.status in ('draft', 'returned');
  else
    perform set_config('cyrix.system_write', 'on', true);
    delete from core_value_part_ratings p using kpi_submissions s
     where s.id = p.submission_id and s.assignment_id = p_assignment_id and s.status in ('draft', 'returned');
    perform set_config('cyrix.system_write', 'off', true);
  end if;
  perform log_audit('kpi_assignment', p_assignment_id, 'core_value_options',
    jsonb_build_object('self', coalesce(p_self, false), 'weights', p_weights));
end $function$;

