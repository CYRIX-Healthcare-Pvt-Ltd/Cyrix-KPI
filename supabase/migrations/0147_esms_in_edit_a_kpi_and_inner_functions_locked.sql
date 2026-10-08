-- =====================================================================
-- Cyrix KPI · 0147 · ESMS in Edit a KPI; inner functions locked
--
-- The user, 8 Oct: "yes lock those functions and need in this edit option
-- to enable or disable esms also".
--
-- 1. Functions that run as the owner and check nobody, called by no app
--    (searched in KPI, Spare, BEMMP, Revive Lab, My Task, Travel and the
--    portal), and by nothing that runs as the caller: no app role may call
--    them any more. The owner's own functions still do.
-- 2. Two the KPI app does call, signed in: not without signing in.
-- 3. admin_edit_assignment takes p_esms (null leaves it as it is). On or
--    off is set_esms's change — the ESMS row and the 20 split between ESMS
--    and core values — made here without set_esms's draft-only rule, as
--    the software administrator's edit. From now on: the open months follow
--    (refresh_open_submissions). All months: every month gains or loses
--    its ESMS row and takes the new core value weights, and is rescored.
-- =====================================================================

revoke execute on function public.apply_cyrix_mapping(uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.apply_standard_core_values(uuid) from public, anon, authenticated;
revoke execute on function public.bluestar_code_field_key() from public, anon, authenticated;
revoke execute on function public.bluestar_item_for_tag(uuid) from public, anon, authenticated;
revoke execute on function public.downline_of(uuid) from public, anon, authenticated;
revoke execute on function public.kpi_shape(uuid) from public, anon, authenticated;
revoke execute on function public.merge_matching_forks(uuid) from public, anon, authenticated;
revoke execute on function public.merge_template_into(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.month_close_at(date) from public, anon, authenticated;
revoke execute on function public.refresh_open_submissions(uuid) from public, anon, authenticated;
revoke execute on function public.submission_close_at(uuid) from public, anon, authenticated;
revoke execute on function public.sync_assignment_to_template(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.template_shape(uuid) from public, anon, authenticated;

revoke execute on function public.open_submission(uuid, date) from public, anon;
revoke execute on function public.settle_due_submissions() from public, anon;
grant execute on function public.open_submission(uuid, date) to authenticated;
grant execute on function public.settle_due_submissions() to authenticated;

-- ---------------------------------------------------------------------
-- What the edit screen reads: whether ESMS is on.
-- ---------------------------------------------------------------------
create or replace function public.admin_kpi_for(p_ecode text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  e  employees%rowtype;
  a  kpi_assignments%rowtype;
  fy text := (select code from financial_years where is_current limit 1);
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can edit somebody''s KPI here';
  end if;
  select * into e from employees where upper(ecode) = upper(btrim(coalesce(p_ecode, '')));
  if not found then
    raise exception 'There is nobody with the code %', upper(btrim(coalesce(p_ecode, '')));
  end if;
  select * into a from kpi_assignments
   where employee_id = e.id and financial_year = fy and status in ('active', 'pending_approval')
   order by created_at desc limit 1;
  return jsonb_build_object(
    'fy', fy,
    'employee', jsonb_build_object('id', e.id, 'ecode', e.ecode, 'full_name', e.full_name,
                                   'designation', e.designation, 'is_active', e.is_active),
    'assignment', case when a.id is null then null else jsonb_build_object(
        'id', a.id, 'status', a.status, 'job_role_weight', a.job_role_weight,
        'esms', coalesce(a.esms_weight, 0) > 0,
        'template', (select name from kpi_templates where id = a.source_template_id)) end,
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sort_order)
                         from kpi_assignment_items i
                        where i.assignment_id = a.id and i.section = 'job_role'), '[]'::jsonb),
    'months', coalesce((select jsonb_object_agg(status, n)
                          from (select status, count(*)::int n from kpi_submissions
                                 where assignment_id = a.id group by status) x), '{}'::jsonb));
end $function$;

-- ---------------------------------------------------------------------
-- The edit, with ESMS on or off.
-- ---------------------------------------------------------------------
drop function if exists public.admin_edit_assignment(uuid, jsonb, text);

create or replace function public.admin_edit_assignment(p_assignment_id uuid, p_rows jsonb, p_mode text, p_esms boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a        kpi_assignments%rowtype;
  n        integer;
  total    numeric;
  job      numeric;
  twice    text;
  before   jsonb;
  months   integer;
  was_esms boolean;
  flip     boolean;
  cfg      jsonb;
  esms_wt  numeric;
  next_ord integer;
  prev     text;
  sm       record;
begin
  if not is_sw_admin() then
    raise exception 'Only the software administrator can edit somebody''s KPI here';
  end if;
  if coalesce(p_mode, '') not in ('forward', 'keep', 'clean') then
    raise exception 'Choose how far back the change goes';
  end if;
  select * into a from kpi_assignments where id = p_assignment_id for update;
  if not found then raise exception 'That KPI no longer exists'; end if;
  if a.status not in ('active', 'pending_approval') then
    raise exception 'Only a KPI in use can be edited here';
  end if;

  select count(*), coalesce(sum(coalesce((r ->> 'weightage')::numeric, 0)), 0) into n, total
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where btrim(coalesce(r ->> 'kra', '')) <> '';
  if n = 0 then raise exception 'A KPI needs at least one row'; end if;
  job := coalesce(a.job_role_weight, 80);
  if total <> job then
    raise exception 'The Job Role rows add up to %, and they must make %', trim_scale(total) || '%', trim_scale(job) || '%';
  end if;
  select min(btrim(r ->> 'kra')) into twice
    from jsonb_array_elements(p_rows) r
   where btrim(coalesce(r ->> 'kra', '')) <> ''
   group by lower(btrim(r ->> 'kra')) having count(*) > 1 limit 1;
  if twice is not null then
    raise exception 'Two rows are both called "%" — give each its own name', twice;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('kra', kra, 'weightage', weightage, 'target_value', target_value,
                                               'target_unit', target_unit, 'scoring_rule', scoring_rule)
                            order by sort_order), '[]'::jsonb)
    into before
    from kpi_assignment_items where assignment_id = a.id and section = 'job_role';

  was_esms := coalesce(a.esms_weight, 0) > 0;
  flip := p_esms is not null and p_esms <> was_esms;

  prev := coalesce(nullif(current_setting('cyrix.system_write', true), ''), 'off');
  perform set_config('cyrix.system_write', 'on', true);

  -- ESMS on or off: set_esms's own change, before the rows, so the core
  -- values the sync restamps come out at the new weight.
  if flip then
    select value into cfg from app_settings where key = 'esms_row';
    if cfg is null then raise exception 'No esms_row configured in app_settings'; end if;
    esms_wt := (cfg ->> 'weightage')::numeric;
    delete from kpi_assignment_items where assignment_id = a.id and section = 'esms';
    update kpi_assignments
       set esms_weight        = case when p_esms then esms_wt else 0 end,
           core_values_weight = case when p_esms then 20 - esms_wt else 20 end
     where id = a.id;
    if p_esms then
      select coalesce(max(sort_order), 0) + 1 into next_ord from kpi_assignment_items where assignment_id = a.id;
      insert into kpi_assignment_items (
        assignment_id, section, kra, kpi_description, weightage, target_value, target_unit, scoring_rule, rule_params, sort_order)
      values (a.id, 'esms', cfg ->> 'kra', cfg ->> 'kpi_description', esms_wt,
              (cfg ->> 'target_value')::numeric, 'score', cfg ->> 'scoring_rule', '{}'::jsonb, next_ord);
    end if;
  end if;

  months := coalesce(sync_assignment_to_rows(a.id, p_rows, p_mode), 0);

  -- All months: each gains or loses its ESMS row, takes the new core value
  -- weights, and is scored again. (From now on, the open months already have.)
  if flip and p_mode <> 'forward' then
    perform set_config('cyrix.system_write', 'on', true);
    for sm in select id from kpi_submissions where assignment_id = a.id loop
      delete from kpi_submission_items
       where submission_id = sm.id and section = 'esms'
         and not exists (select 1 from kpi_assignment_items ai where ai.assignment_id = a.id and ai.section = 'esms');
      insert into kpi_submission_items (
        submission_id, assignment_item_id, section, kra, kpi_description, weightage, target_value, target_unit,
        scoring_rule, rule_params, sort_order)
      select sm.id, ai.id, 'esms', ai.kra, ai.kpi_description, ai.weightage, ai.target_value, ai.target_unit,
             ai.scoring_rule, ai.rule_params, ai.sort_order
        from kpi_assignment_items ai
       where ai.assignment_id = a.id and ai.section = 'esms'
         and not exists (select 1 from kpi_submission_items si where si.submission_id = sm.id and si.section = 'esms');
      update kpi_submission_items si
         set weightage = ai.weightage, assignment_item_id = ai.id
        from kpi_assignment_items ai
       where si.submission_id = sm.id and si.section = 'core_values'
         and ai.assignment_id = a.id and ai.section = 'core_values'
         and lower(btrim(ai.kra)) = lower(btrim(si.kra));
      perform recompute_submission_totals(sm.id);
    end loop;
  end if;

  perform set_config('cyrix.system_write', prev, true);
  update kpi_assignments set updated_at = now() where id = a.id;

  perform log_audit('kpi_assignment', a.id, 'admin_edited',
    jsonb_build_object('mode', p_mode, 'months', months, 'before', before, 'after', p_rows,
                       'esms', case when flip then jsonb_build_object('from', was_esms, 'to', p_esms) end));
  return jsonb_build_object('months', months, 'mode', p_mode, 'esms', case when flip then p_esms else was_esms end);
end $function$;
revoke execute on function public.admin_edit_assignment(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.admin_edit_assignment(uuid, jsonb, text, boolean) to authenticated;
