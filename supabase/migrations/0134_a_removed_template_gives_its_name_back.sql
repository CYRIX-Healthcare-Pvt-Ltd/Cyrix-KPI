-- =====================================================================
-- Cyrix KPI  ·  0134  ·  A removed template gives its name back
--
-- 0126 turned delete into archive, so a removed template keeps its link
-- to the people who were on it. It also kept its name: E9999 removed
-- "MIS", then tried to save a KPI as "MIS" and was told "You already have
-- a template called MIS this year" — while the templates screen, which
-- only lists active ones, said she had none at all.
--
-- The name is held in two places and both counted archived rows: the
-- duplicate check in save_team_template, and the unique index behind it.
-- Both now look at active templates only.
-- =====================================================================

drop index if exists public.idx_templates_owner_name;

create unique index idx_templates_owner_name
  on public.kpi_templates (owner_id, financial_year, lower(btrim(name)))
  where owner_id is not null and status = 'active';

CREATE OR REPLACE FUNCTION public.save_team_template(p_name text, p_fy text, p_rows jsonb, p_template_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me      uuid := current_employee_id();
  clean   text := btrim(coalesce(p_name, ''));
  tpl     uuid := p_template_id;
  n       int;
begin
  if me is null then
    raise exception 'Only a signed-in employee can save a template';
  end if;
  if clean = '' then
    raise exception 'Give the template a name';
  end if;
  if length(clean) > 60 then
    raise exception 'That name is too long — 60 characters at most';
  end if;

  select count(*) into n from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb));
  if n = 0 then
    raise exception 'A template needs at least one row';
  end if;

  if exists (
    select 1 from kpi_templates t
    where t.owner_id = me
      and t.financial_year = p_fy
      and lower(btrim(t.name)) = lower(clean)
      -- A removed template is archived, not deleted, and must not keep
      -- its name out of use (0134).
      and t.status = 'active'
      and (tpl is null or t.id <> tpl)
  ) then
    raise exception 'You already have a template called "%" this year', clean;
  end if;

  if tpl is null then
    insert into kpi_templates (
      name, owner_id, created_by, financial_year, status, version, job_role_id
    ) values (clean, me, me, p_fy, 'active', 1, null)
    returning id into tpl;
  else
    update kpi_templates
    set name = clean, updated_at = now()
    where id = tpl and owner_id = me;
    if not found then
      raise exception 'That template is not yours to change';
    end if;
    delete from kpi_template_items where template_id = tpl;
  end if;

  insert into kpi_template_items (
    template_id, section, kra, kpi_description, weightage,
    target_value, target_unit, scoring_rule, rule_params, alternates, sort_order
  )
  select
    tpl,
    'job_role',
    btrim(r ->> 'kra'),
    nullif(btrim(coalesce(r ->> 'kpi_description', '')), ''),
    coalesce((r ->> 'weightage')::numeric, 0),
    nullif(r ->> 'target_value', '')::numeric,
    nullif(btrim(coalesce(r ->> 'target_unit', '')), ''),
    coalesce(nullif(r ->> 'scoring_rule', ''), 'higher_capped'),
    coalesce(r -> 'rule_params', '{}'::jsonb),
    -- Anything but an array is treated as none rather than refused: the
    -- check constraint would take the whole save down over a field the
    -- person filling in the form never sees.
    case when jsonb_typeof(r -> 'alternates') = 'array'
         then r -> 'alternates' else '[]'::jsonb end,
    row_number() over ()
  from jsonb_array_elements(p_rows) r
  where btrim(coalesce(r ->> 'kra', '')) <> '';

  return tpl;
end $function$
;

do $$
begin
  if position('t.status = ''active''' in pg_get_functiondef('public.save_team_template'::regproc)) = 0 then
    raise exception 'save_team_template still counts removed templates';
  end if;
  if (select indexdef from pg_indexes where indexname = 'idx_templates_owner_name')
     not like '%status%active%' then
    raise exception 'the unique index still holds removed templates'' names';
  end if;
  raise notice '0134 self-test passed (only an active template holds its name)';
end $$;
