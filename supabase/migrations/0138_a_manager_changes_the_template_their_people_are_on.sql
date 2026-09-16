-- =====================================================================
-- Cyrix KPI  ·  0138  ·  A manager changes the template their people are on
--
-- Afsal keeps "Specialist Engineer" and his division is on it. Manish,
-- who reports to Afsal, has six of those people and wants two rows
-- different for his own team. He could see the template — his people are
-- on it, which is what puts it on his screen — and could do nothing with
-- it: "Only the manager who keeps a template can change it".
--
-- So he can change it now, and changing somebody else's does not touch
-- theirs. Saving takes his own version of it: same name, his to keep, and
-- his own people move onto it. Afsal's is untouched and so is everybody
-- else on it. Afsal then sees two on his screen — his own, and Manish's,
-- which the screen names for the manager who keeps it.
--
-- And when the two come back to the same rows, whichever side moves them
-- there, they stop being two. The version is merged into the one it came
-- from, everybody lands back on a single template, and the name goes back
-- to being just the name. That is the merge in both directions: Manish
-- reverting his rows, or Afsal adopting them.
--
-- Nobody's KPI changes in a merge. The rows have to be identical for it
-- to happen at all, which is what merge_template_into refuses without.
--
-- push_template_change at the end is the live definition read back with
-- pg_get_functiondef, with the merge call spliced in before its return.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Which template a version came from.
--
-- Not the same as source_template_id on a KPI: that says where somebody's
-- rows came from. This says where a TEMPLATE came from, which is what
-- makes a merge back into it safe to do automatically — it only ever
-- happens between a version and the one template it was taken from.
-- ON DELETE SET NULL, like every other link to this table, so removing
-- an original never takes a working template with it.
-- ---------------------------------------------------------------------
alter table kpi_templates
  add column if not exists forked_from uuid references kpi_templates(id) on delete set null;

create index if not exists idx_templates_forked_from
  on kpi_templates (forked_from) where forked_from is not null;

-- ---------------------------------------------------------------------
-- The rows of a template, as one string.
--
-- The same formula as kpi_shape over the same four fields, so a template
-- and a KPI made from it produce the same shape, and "is this still the
-- same rows" is one comparison wherever it is asked.
-- ---------------------------------------------------------------------
create or replace function public.template_shape(p_template_id uuid)
returns text
language sql stable security definer set search_path to 'public'
as $fn$
  select md5(string_agg(
    lower(btrim(ti.kra)) || '|' || ti.weightage || '|' || ti.scoring_rule
      || '|' || coalesce(ti.rule_params::text, '{}'),
    ';' order by lower(btrim(ti.kra)), ti.weightage))
  from kpi_template_items ti
  where ti.template_id = p_template_id
    and ti.section = 'job_role'
$fn$;

grant execute on function public.template_shape(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Two templates become one.
--
-- Everybody on the one being merged moves to the one it is merged into,
-- and the first is archived — archived, not deleted, so the trail of
-- where somebody's rows came from survives it (0126).
--
-- The guard is the whole safety of this: identical rows, or it refuses.
-- Moving somebody between two templates that say the same thing changes
-- nothing about their KPI, which is why this can run without asking.
-- ---------------------------------------------------------------------
create or replace function public.merge_template_into(p_from uuid, p_into uuid)
returns integer
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  a     kpi_templates%rowtype;
  b     kpi_templates%rowtype;
  moved integer := 0;
begin
  if p_from = p_into then raise exception 'A template cannot be merged into itself'; end if;

  select * into a from kpi_templates where id = p_from;
  if not found then raise exception 'The template being merged no longer exists'; end if;
  select * into b from kpi_templates where id = p_into;
  if not found then raise exception 'The template being merged into no longer exists'; end if;

  if template_shape(p_from) is null
     or template_shape(p_from) is distinct from template_shape(p_into) then
    raise exception 'Refusing to merge two templates whose rows are not identical';
  end if;

  update kpi_assignments
  set source_template_id = p_into
  where source_template_id = p_from;
  get diagnostics moved = row_count;

  update kpi_templates set status = 'archived' where id = p_from;

  perform log_audit('kpi_template', p_from, 'merged_into',
    jsonb_build_object('template', a.name, 'into', b.name, 'into_id', p_into,
                       'people_moved', moved));
  perform log_audit('kpi_template', p_into, 'merged_from',
    jsonb_build_object('template', b.name, 'from', a.name, 'from_id', p_from,
                       'people_moved', moved));

  return moved;
end $fn$;

-- ---------------------------------------------------------------------
-- Merge whatever now matches, in both directions.
--
-- Called after every template edit, from either side: versions taken of
-- this one that have come back to it, and — when this one is itself a
-- version — the original it may have just come back to.
--
-- The name has to match too. A version somebody renamed is a template
-- they meant to keep separate, and identical rows do not make it the same
-- thing; only the pair that reads as two of the same template merges.
-- ---------------------------------------------------------------------
create or replace function public.merge_matching_forks(p_template_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  tpl    kpi_templates%rowtype;
  org    kpi_templates%rowtype;
  f      kpi_templates%rowtype;
  n      integer := 0;
  moved  integer := 0;
begin
  select * into tpl from kpi_templates where id = p_template_id;
  if not found or tpl.status <> 'active' then
    return jsonb_build_object('templates', 0, 'people_moved', 0);
  end if;

  for f in
    select * from kpi_templates c
    where c.forked_from = p_template_id
      and c.status = 'active'
      and lower(btrim(c.name)) = lower(btrim(tpl.name))
      and template_shape(c.id) is not null
      and template_shape(c.id) = template_shape(p_template_id)
  loop
    moved := moved + merge_template_into(f.id, p_template_id);
    n := n + 1;
  end loop;

  if tpl.forked_from is not null then
    select * into org from kpi_templates
    where id = tpl.forked_from and status = 'active';
    if found
       and lower(btrim(org.name)) = lower(btrim(tpl.name))
       and template_shape(tpl.id) is not null
       and template_shape(tpl.id) = template_shape(org.id) then
      moved := moved + merge_template_into(tpl.id, org.id);
      n := n + 1;
    end if;
  end if;

  return jsonb_build_object('templates', n, 'people_moved', moved);
end $fn$;

-- ---------------------------------------------------------------------
-- The one door the Team templates editor now saves through.
--
-- Your own template: exactly what pressing Save always did. Somebody
-- else's that you can see: your own version of it, and your own people
-- move onto it. Everybody else stays where they are, including the people
-- the original manager keeps on it.
--
-- Whose people move is the whole of it: the ones below you. Not the
-- template's other users, who are not yours to change, and not your
-- colleagues' — the same line the rest of this screen draws.
-- ---------------------------------------------------------------------
create or replace function public.edit_visible_template(
  p_template_id uuid, p_name text, p_rows jsonb, p_mode text default 'forward')
returns jsonb
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  me     uuid := current_employee_id();
  src    kpi_templates%rowtype;
  fork   kpi_templates%rowtype;
  tgt    uuid;
  a      record;
  moved  integer := 0;
  people integer := 0;
  months integer := 0;
  merged jsonb;
begin
  if p_mode not in ('template_only', 'forward', 'keep', 'clean') then
    raise exception 'Unknown mode "%"', p_mode;
  end if;
  if me is null then
    raise exception 'Only a signed-in employee can change a template';
  end if;

  select * into src from kpi_templates where id = p_template_id;
  if not found or src.status <> 'active' then
    raise exception 'That template no longer exists';
  end if;

  -- Yours, or HR's own, through the door it always went through.
  if src.owner_id = me or is_hr_admin() then
    return push_template_change(p_template_id, p_name, p_rows, p_mode)
           || jsonb_build_object('forked', false);
  end if;

  if not can_use_template(p_template_id) then
    raise exception 'You can only change a template you can see';
  end if;

  -- One version each. Editing somebody else's twice changes the version
  -- you already have rather than collecting copies of it.
  select * into fork from kpi_templates
  where forked_from = p_template_id
    and owner_id = me
    and status = 'active'
    and coalesce(financial_year, src.financial_year) = src.financial_year
  limit 1;

  tgt := save_team_template(p_name, src.financial_year, p_rows, fork.id);
  if fork.id is null then
    update kpi_templates set forked_from = p_template_id where id = tgt;
  end if;

  -- Your own people come with you.
  update kpi_assignments ka
  set source_template_id = tgt
  where ka.source_template_id = p_template_id
    and ka.financial_year = src.financial_year
    and ka.status in ('active', 'pending_approval')
    and ka.employee_id in (select downline_of(me));
  get diagnostics moved = row_count;

  -- And everybody on your version gets the change, as far as you chose.
  if p_mode <> 'template_only' then
    for a in
      select ka.id from kpi_assignments ka
      where ka.source_template_id = tgt
        and ka.financial_year = src.financial_year
        and ka.status in ('active', 'pending_approval')
    loop
      months := months + coalesce(sync_assignment_to_template(a.id, tgt, p_mode), 0);
      people := people + 1;
      perform log_audit('kpi_assignment', a.id, 'template_pushed',
        jsonb_build_object('template', p_name, 'template_id', tgt, 'mode', p_mode));
    end loop;
  end if;

  perform log_audit('kpi_template', tgt, 'forked_from_template',
    jsonb_build_object('template', p_name, 'from', src.name, 'from_id', src.id,
                       'people_moved', moved, 'mode', p_mode));

  -- Saved as the same rows it came from? Then it was never a second
  -- template, and this puts everybody back on the one they came from.
  merged := merge_matching_forks(tgt);

  return jsonb_build_object(
    'template', p_name, 'mode', p_mode, 'forked', true,
    'people', people, 'months', months, 'moved', moved,
    'merged', (merged ->> 'templates')::int > 0,
    'merged_into', case when (merged ->> 'templates')::int > 0 then src.name end);
end $fn$;

grant execute on function public.edit_visible_template(uuid, text, jsonb, text) to authenticated;

CREATE OR REPLACE FUNCTION public.push_template_change(p_template_id uuid, p_name text, p_rows jsonb, p_mode text DEFAULT 'forward'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me      uuid := current_employee_id();
  tpl     kpi_templates%rowtype;
  a       record;
  people  int := 0;
  months  int := 0;
  saved   uuid;
  merged  jsonb;
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

  -- A version somebody below took of this template, which this edit has
  -- brought back to the same rows, is not a second template any more (0138).
  merged := merge_matching_forks(p_template_id);

  return jsonb_build_object(
    'template', p_name, 'mode', p_mode, 'people', people, 'months', months,
    'merged', merged);
end $function$
;

-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $test$
declare
  a_id uuid;
  b_id uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'kpi_templates'
      and column_name = 'forked_from'
  ) then
    raise exception 'kpi_templates has no forked_from';
  end if;

  if position('merge_matching_forks' in
              pg_get_functiondef('public.push_template_change'::regproc)) = 0 then
    raise exception 'push_template_change does not merge what now matches';
  end if;

  -- A template and a KPI made from it produce the same shape. Both the
  -- merge and the duplicate check rest on that being one formula.
  if exists (
    select 1
    from kpi_assignments ka
    join kpi_templates t on t.id = ka.source_template_id
    where ka.status = 'active'
      and template_shape(t.id) is not null
      and kpi_shape(ka.id) is not null
    limit 1
  ) then
    raise notice '0138: % of % linked KPI(s) still match their template exactly',
      (select count(*) from kpi_assignments ka
        join kpi_templates t on t.id = ka.source_template_id
        where ka.status = 'active' and kpi_shape(ka.id) = template_shape(t.id)),
      (select count(*) from kpi_assignments ka
        join kpi_templates t on t.id = ka.source_template_id
        where ka.status = 'active');
  end if;

  -- Merging refuses rows that are not identical.
  select id into a_id from kpi_templates where status = 'active' order by created_at limit 1;
  select id into b_id from kpi_templates
   where status = 'active' and id <> a_id
     and template_shape(id) is distinct from template_shape(a_id)
   order by created_at desc limit 1;
  if b_id is not null then
    begin
      perform merge_template_into(a_id, b_id);
      raise exception 'merge_template_into merged two templates it should have refused';
    exception when others then
      if sqlerrm not like 'Refusing to merge%' then raise; end if;
    end;
  end if;

  raise notice '0138 self-test passed (a version merges back only on identical rows)';
end $test$;
