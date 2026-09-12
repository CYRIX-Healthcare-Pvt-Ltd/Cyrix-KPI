-- =====================================================================
-- Cyrix KPI  ·  0126  ·  A change says how far back it goes
--
-- Two questions were being answered by one silent default.
--
-- Assigning a template to somebody who already has a KPI: 0123 brought
-- their rows to the template and then refreshed the open months only, so
-- anything filed kept what it was assessed on. Reasonable, and never
-- asked — a manager correcting a KPI that was wrong from April wants the
-- opposite, which is the whole reason those corrections have been coming
-- through a script.
--
-- Editing a template that people are already on: there was no way to do
-- it at all. The rows changed and the twenty-three people carrying them
-- did not.
--
-- One vocabulary for both, because it is the same question:
--
--   forward  Open months take the new rows. Filed months keep what they
--            were assessed on. The default, and what 0123 did.
--   keep     Every month takes the new rows, and what people typed
--            survives wherever the KRA survives. Scores recomputed.
--   clean    Every month takes the new rows with nothing filled in.
--
-- And a push is never silent. Every assignment touched gets an audit
-- row, and the owner's own manager is told: my_notifications gains
-- template_pushed, which is news rather than work, so it can be
-- dismissed. Nobody is asked to approve it — a manager fixing their own
-- team's KPI is the person who would have been asked.
-- =====================================================================


-- ---------------------------------------------------------------------
-- One assignment, brought to one template.
--
-- The worker both entry points share, so "assign to twenty people" and
-- "push an edit to twenty people" cannot drift apart.
-- ---------------------------------------------------------------------
create or replace function public.sync_assignment_to_template(
  p_assignment_id uuid,
  p_template_id   uuid,
  p_mode          text default 'forward'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a       kpi_assignments%rowtype;
  s       record;
  touched integer := 0;
begin
  if p_mode not in ('forward', 'keep', 'clean') then
    raise exception 'Unknown mode "%"', p_mode;
  end if;

  select * into a from kpi_assignments where id = p_assignment_id;
  if not found then raise exception 'Assignment not found'; end if;

  -- The definition columns are guarded against end users; this is the
  -- KPI itself arriving, which is the one thing that may move them.
  perform set_config('cyrix.system_write', 'on', true);

  /* ---- the assignment's own rows ---------------------------------- */
  update kpi_assignment_items ai
  set kpi_description = ti.kpi_description,
      weightage       = ti.weightage,
      target_value    = ti.target_value,
      target_unit     = ti.target_unit,
      scoring_rule    = ti.scoring_rule,
      rule_params     = ti.rule_params,
      alternates      = ti.alternates,
      sort_order      = ti.sort_order
  from kpi_template_items ti
  where ai.assignment_id = p_assignment_id
    and ai.section = 'job_role'
    and ti.template_id = p_template_id
    and ti.section = 'job_role'
    and lower(btrim(ai.kra)) = lower(btrim(ti.kra));

  insert into kpi_assignment_items (
    assignment_id, section, kra, kpi_description, weightage,
    target_value, target_unit, scoring_rule, rule_params, alternates, sort_order)
  select p_assignment_id, ti.section, ti.kra, ti.kpi_description, ti.weightage,
         ti.target_value, ti.target_unit, ti.scoring_rule, ti.rule_params,
         ti.alternates, ti.sort_order
  from kpi_template_items ti
  where ti.template_id = p_template_id
    and ti.section = 'job_role'
    and not exists (
      select 1 from kpi_assignment_items ai
      where ai.assignment_id = p_assignment_id
        and ai.section = 'job_role'
        and lower(btrim(ai.kra)) = lower(btrim(ti.kra)));

  delete from kpi_assignment_items ai
  where ai.assignment_id = p_assignment_id
    and ai.section = 'job_role'
    and not exists (
      select 1 from kpi_template_items ti
      where ti.template_id = p_template_id
        and ti.section = 'job_role'
        and lower(btrim(ti.kra)) = lower(btrim(ai.kra)));

  -- The core values block is the company's, not the template's.
  perform apply_standard_core_values(p_assignment_id);

  /*
    And the link to it, on every month, in every mode.

    apply_standard_core_values deletes the assignment's core row and
    writes a fresh one, so its id changes — and kpi_submission_items
    points at that id ON DELETE SET NULL. Every filed month therefore
    came out of here with its core-values row severed from the KPI,
    which is the exact damage this function exists to avoid, caused by
    the one call that looked harmless.

    Relinking is not a content change: the row is the same row, and
    nothing about what was assessed moves. So it runs for filed months
    too, where it also repairs whatever earlier uploads severed.
  */
  -- Aliased sm, not s: s is the loop's record variable below and a
  -- plpgsql variable shadows a table alias of the same name.
  update kpi_submission_items si
  set assignment_item_id = ai.id
  from kpi_assignment_items ai, kpi_submissions sm
  where sm.assignment_id = p_assignment_id
    and si.submission_id = sm.id
    and si.section = 'core_values'
    and ai.assignment_id = p_assignment_id
    and ai.section = 'core_values'
    and si.assignment_item_id is distinct from ai.id;

  /* ---- and the months --------------------------------------------- */
  if p_mode = 'forward' then
    -- Draft and returned only. Exactly what refresh_open_submissions
    -- has always done, and it relinks as it goes.
    touched := coalesce(refresh_open_submissions(p_assignment_id), 0);
  else
    for s in
      select id, status from kpi_submissions where assignment_id = p_assignment_id
    loop
      if p_mode = 'clean' then
        -- Nothing filled in: the month starts again on the new KPI.
        delete from kpi_submission_items
        where submission_id = s.id and section = 'job_role';
      end if;

      -- Matched by KRA, so a row that survives the edit keeps its
      -- figures, its monthly target and its link.
      update kpi_submission_items si
      set assignment_item_id = ai.id,
          kpi_description    = ai.kpi_description,
          weightage          = ai.weightage,
          target_unit        = ai.target_unit,
          scoring_rule       = ai.scoring_rule,
          rule_params        = ai.rule_params,
          sort_order         = ai.sort_order
      from kpi_assignment_items ai
      where si.submission_id = s.id
        and si.section = 'job_role'
        and ai.assignment_id = p_assignment_id
        and ai.section = 'job_role'
        and lower(btrim(si.kra)) = lower(btrim(ai.kra));

      insert into kpi_submission_items (
        submission_id, assignment_item_id, section, kra, kpi_description,
        weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
      select s.id, ai.id, ai.section, ai.kra, ai.kpi_description, ai.weightage,
             ai.target_value, ai.target_unit, ai.scoring_rule, ai.rule_params,
             ai.sort_order
      from kpi_assignment_items ai
      where ai.assignment_id = p_assignment_id
        and ai.section = 'job_role'
        and not exists (
          select 1 from kpi_submission_items si
          where si.submission_id = s.id
            and si.section = 'job_role'
            and lower(btrim(si.kra)) = lower(btrim(ai.kra)));

      delete from kpi_submission_items si
      where si.submission_id = s.id
        and si.section = 'job_role'
        and not exists (
          select 1 from kpi_assignment_items ai
          where ai.assignment_id = p_assignment_id
            and ai.section = 'job_role'
            and lower(btrim(ai.kra)) = lower(btrim(si.kra)));

      perform recompute_submission_totals(s.id);
      touched := touched + 1;
    end loop;
  end if;

  perform set_config('cyrix.system_write', 'off', true);
  return touched;
end $$;

comment on function public.sync_assignment_to_template(uuid, uuid, text) is
  'Brings one assignment to one template. forward = open months only; '
  'keep = every month, figures survive; clean = every month, nothing '
  'filled in. See migration 0126.';


-- ---------------------------------------------------------------------
-- Assigning, now with the same choice.
-- ---------------------------------------------------------------------
create or replace function public.apply_template_to(
  p_template_id uuid,
  p_codes       text[],
  p_fy          text default null,
  p_starts_from date default null,
  p_mode        text default 'forward'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid := current_employee_id();
  fy        text := coalesce(p_fy, (select f.code from financial_years f where f.is_current));
  fy_from   date;
  tpl       kpi_templates%rowtype;
  job_total numeric;
  raw       text;
  code_in   text;
  emp       record;
  a         kpi_assignments%rowtype;
  v         record;
  was_new   boolean;
  prior     text;
  results   jsonb := '[]'::jsonb;
  n_done    int := 0;
  n_skip    int := 0;
begin
  if me is null then
    raise exception 'Only a signed-in employee can assign a template';
  end if;
  if p_mode not in ('forward', 'keep', 'clean') then
    raise exception 'Unknown mode "%"', p_mode;
  end if;

  select f.starts_on into fy_from from financial_years f where f.code = fy;
  if fy_from is null then raise exception 'No financial year called %', fy; end if;

  select * into tpl from kpi_templates where id = p_template_id;
  if not found or tpl.status <> 'active' then
    raise exception 'That template no longer exists';
  end if;
  if not can_use_template(p_template_id) then
    raise exception 'That template is not yours to assign';
  end if;

  select coalesce(sum(weightage), 0) into job_total
  from kpi_template_items
  where template_id = p_template_id and section = 'job_role';
  if job_total <= 0 then
    raise exception 'That template has no job role rows to assign';
  end if;

  foreach raw in array coalesce(p_codes, '{}'::text[]) loop
    code_in := upper(btrim(coalesce(raw, '')));
    continue when code_in = '';

    select e.id, e.ecode, e.full_name, e.is_active, e.date_of_joining
      into emp
    from employees e
    where upper(btrim(e.ecode)) = code_in
    limit 1;

    if not found then
      results := results || jsonb_build_object(
        'code', code_in, 'status', 'skipped', 'detail', 'No employee has that code');
      n_skip := n_skip + 1;
      continue;
    end if;
    if not emp.is_active then
      results := results || jsonb_build_object(
        'code', emp.ecode, 'name', emp.full_name, 'status', 'skipped',
        'detail', 'Not an active employee');
      n_skip := n_skip + 1;
      continue;
    end if;
    if not (is_in_my_downline(emp.id) or is_hr_admin()) then
      results := results || jsonb_build_object(
        'code', emp.ecode, 'name', emp.full_name, 'status', 'skipped',
        'detail', 'Not in your team');
      n_skip := n_skip + 1;
      continue;
    end if;

    select * into a
    from kpi_assignments
    where employee_id = emp.id and financial_year = fy
    limit 1;

    /*
      One list, two different things happening in it.

      A list of twenty codes after a reshuffle is half new joiners and
      half people whose KPI is being corrected, and "assigned" against
      both of them hides the half that matters: a replacement changed
      something that already existed. So each row says which it was, and
      names the template it came off.
    */
    was_new := not found;
    prior := null;
    if found and a.source_template_id is not null and a.source_template_id <> p_template_id then
      select t.name into prior from kpi_templates t where t.id = a.source_template_id;
    end if;

    if not found then
      insert into kpi_assignments (
        employee_id, financial_year, status, source_template_id,
        job_role_weight, core_values_weight, esms_weight, starts_from,
        submitted_at, submitted_by, approved_at, approved_by)
      values (
        emp.id, fy, 'active', p_template_id,
        job_total, 100 - job_total, 0,
        coalesce(
          p_starts_from,
          greatest(fy_from, date_trunc('month', emp.date_of_joining)::date),
          fy_from),
        now(), me, now(), me)
      returning * into a;
    else
      update kpi_assignments
      set status             = 'active',
          source_template_id = p_template_id,
          job_role_weight    = job_total,
          core_values_weight = 100 - job_total - kpi_assignments.esms_weight,
          starts_from        = coalesce(p_starts_from, kpi_assignments.starts_from, fy_from),
          approved_at        = coalesce(kpi_assignments.approved_at, now()),
          approved_by        = coalesce(kpi_assignments.approved_by, me),
          rejection_reason   = null
      where id = a.id
      returning * into a;
    end if;

    perform sync_assignment_to_template(a.id, p_template_id, p_mode);

    select * into v from validate_assignment(a.id);

    perform log_audit('kpi_assignment', a.id, 'template_applied',
      jsonb_build_object(
        'template', tpl.name, 'template_id', p_template_id, 'mode', p_mode,
        'rows', (select count(*) from kpi_assignment_items
                 where assignment_id = a.id and section = 'job_role')));

    results := results || jsonb_build_object(
      'code', emp.ecode,
      'name', emp.full_name,
      'status', case when v.ok then 'assigned' else 'assigned_with_warning' end,
      'detail', case when v.ok then null else v.message end,
      'was', case when was_new then 'new' else 'replaced' end,
      'replaced', prior,
      'starts_from', to_char(a.starts_from, 'Mon-YY'),
      'filed_months', (
        select count(*) from kpi_submissions s
        where s.employee_id = emp.id and s.financial_year = fy
          and s.status <> 'draft'),
      /*
        Filed months left holding rows the KPI no longer carries.

        In forward mode a month that has been assessed keeps exactly what
        it was assessed on — and if the new template does not have those
        KRAs, the assignment row behind each of them is gone, so the
        month's link to the KPI goes with it. The month is still right;
        it is a record of an agreement that no longer exists. Counted and
        returned rather than left for somebody to find, because the
        answer to it is a decision — "all months" would rewrite those
        rows instead.
      */
      'kept_own_rows', (
        select count(distinct s.id) from kpi_submissions s
        join kpi_submission_items si on si.submission_id = s.id
        where s.employee_id = emp.id and s.financial_year = fy
          and s.status <> 'draft'
          and si.section = 'job_role'
          and si.assignment_item_id is null));
    n_done := n_done + 1;
  end loop;

  return jsonb_build_object(
    'financial_year', fy, 'template', tpl.name, 'mode', p_mode,
    'assigned', n_done, 'skipped', n_skip, 'results', results);
end $$;

grant execute on function public.apply_template_to(uuid, text[], text, date, text) to authenticated;


-- ---------------------------------------------------------------------
-- Editing a template, and pushing it to the people already on it.
-- ---------------------------------------------------------------------
create or replace function public.push_template_change(
  p_template_id uuid,
  p_name        text,
  p_rows        jsonb,
  p_mode        text default 'forward'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid := current_employee_id();
  tpl     kpi_templates%rowtype;
  a       record;
  people  int := 0;
  months  int := 0;
  saved   uuid;
begin
  if p_mode not in ('template_only', 'forward', 'keep', 'clean') then
    raise exception 'Unknown mode "%"', p_mode;
  end if;

  select * into tpl from kpi_templates where id = p_template_id;
  if not found then raise exception 'That template no longer exists'; end if;
  if not (tpl.owner_id = me or is_hr_admin()) then
    raise exception 'Only the manager who keeps a template can change it';
  end if;

  -- The rows and the name, through the same door the editor uses: it
  -- owns the name length, the duplicate-name check and the row shape.
  saved := save_team_template(p_name, tpl.financial_year, p_rows, p_template_id);

  if p_mode <> 'template_only' then
    for a in
      select ka.id, ka.employee_id
      from kpi_assignments ka
      where ka.source_template_id = p_template_id
        and ka.financial_year = tpl.financial_year
        and ka.status in ('active', 'pending_approval')
    loop
      months := months + coalesce(
        sync_assignment_to_template(a.id, p_template_id, p_mode), 0);
      people := people + 1;
      perform log_audit('kpi_assignment', a.id, 'template_pushed',
        jsonb_build_object('template', p_name, 'template_id', p_template_id,
                           'mode', p_mode));
    end loop;
  end if;

  -- One row against the template itself, which is what the owner's
  -- manager is told about. Written even when nobody was on it, so the
  -- trail shows the edit as well as its reach.
  perform log_audit('kpi_template', p_template_id, 'template_pushed',
    jsonb_build_object('template', p_name, 'mode', p_mode,
                       'people', people, 'months', months));

  return jsonb_build_object(
    'template', p_name, 'mode', p_mode, 'people', people, 'months', months);
end $$;

comment on function public.push_template_change(uuid, text, jsonb, text) is
  'Saves a template and pushes it to everybody on it. template_only '
  'changes nothing for them; forward, keep and clean are as '
  'sync_assignment_to_template. Audited per person, and the owner''s '
  'manager is told. See migration 0126.';

grant execute on function public.push_template_change(uuid, text, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- Archiving one, which is what "delete" means here.
-- ---------------------------------------------------------------------
create or replace function public.archive_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me    uuid := current_employee_id();
  tpl   kpi_templates%rowtype;
  still int;
begin
  select * into tpl from kpi_templates where id = p_template_id;
  if not found then raise exception 'That template no longer exists'; end if;
  if not (tpl.owner_id = me or is_hr_admin()) then
    raise exception 'Only the manager who keeps a template can remove it';
  end if;

  select count(*) into still
  from kpi_assignments
  where source_template_id = p_template_id
    and financial_year = tpl.financial_year
    and status in ('active', 'pending_approval');

  update kpi_templates set status = 'archived' where id = p_template_id;

  perform log_audit('kpi_template', p_template_id, 'archived',
    jsonb_build_object('template', tpl.name, 'people_keeping_it', still));

  -- Nobody's KPI changes. The rows were copied onto them when it was
  -- assigned, and taking the template away does not take those back.
  return jsonb_build_object('template', tpl.name, 'people_keeping_it', still);
end $$;

grant execute on function public.archive_template(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- The owner's manager is told.
--
-- Both bodies are the live definitions read back with
-- pg_get_functiondef, with one splice each: a union-all branch in the
-- facts CTE, and one more kind in the list of things that may be
-- dismissed. Nothing else retyped.
-- ---------------------------------------------------------------------
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

  union all
  -- A template kept by somebody below me was changed and pushed onto
  -- the people carrying it. News, not work: nobody is being asked to
  -- approve it, and the reason it is here at all is that a weightage
  -- can move on twenty-three KPIs without the level above noticing.
  select 'template_pushed', count(*)::int, max(al.created_at)
  from ctx
  join audit_log al
    on al.action = 'template_pushed' and al.entity_type = 'kpi_template'
  join kpi_templates t on t.id = al.entity_id
  where not ctx.hr and not ctx.sw_only
    and al.created_at > ctx.news_since
    and t.owner_id in (select d from downline_of(ctx.me_id) as d)
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

grant execute on function public.my_notifications() to authenticated;


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
                    'support_answered', 'template_pushed') then
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

grant execute on function public.dismiss_notification(text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test: the three modes do what their names say, on a template
-- nobody is on, inside a transaction that is about to be rolled back by
-- the migration runner if anything here raises.
-- ---------------------------------------------------------------------
do $$
declare
  fy     text := (select f.code from financial_years f where f.is_current);
  bad    int;
begin
  -- The modes are the only vocabulary, and both entry points share it.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'sync_assignment_to_template') then
    raise exception 'the shared worker is not there';
  end if;

  -- Nothing may have been left linked to a template that no longer
  -- exists: archive keeps the rows and the link, which is the point.
  select count(*) into bad
  from kpi_assignments a
  where a.source_template_id is not null
    and not exists (select 1 from kpi_templates t where t.id = a.source_template_id);
  if bad > 0 then
    raise exception '% assignment(s) point at a template that is gone', bad;
  end if;

  if position('template_pushed' in pg_get_functiondef('public.my_notifications'::regproc)) = 0 then
    raise exception 'the manager is not told about a push';
  end if;
  if position('template_pushed' in pg_get_functiondef('public.dismiss_notification'::regproc)) = 0 then
    raise exception 'the push notice cannot be dismissed';
  end if;

  raise notice '0126 self-test passed (one worker, three modes, archive keeps the link, the manager is told)';
end $$;
