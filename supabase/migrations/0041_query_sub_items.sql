-- =====================================================================
-- Cyrix KPI  ·  0041  ·  Which core value, not just "core values"
--
-- Core values are one scored row carrying five separate judgements. A
-- query against that row therefore says "I want to ask about my core
-- values score", which is true and useless — the manager cannot tell
-- whether the argument is about Trust or about Speed of Response, and
-- has to go and ask.
--
-- So a point may name the parts of its row it is actually about. Only
-- the core-values row has parts today; the column is general because a
-- KRA with named components would want exactly this and should not need
-- a second migration to get it.
--
-- Names rather than ids on purpose. A core value can be renamed or
-- retired, and a query is a record of what somebody said at the time —
-- resolving "Care" through a join two years later and finding it gone,
-- or worse renamed to something they never wrote, would be the wrong
-- kind of accurate.
-- =====================================================================

alter table kpi_score_query_points
  add column if not exists sub_items text[];

alter table kpi_score_query_points
  drop constraint if exists kpi_score_query_points_sub_items_len;
alter table kpi_score_query_points
  add constraint kpi_score_query_points_sub_items_len
  check (sub_items is null or array_length(sub_items, 1) <= 20);

comment on column kpi_score_query_points.sub_items is
  'The named parts of this row the query is about — the individual core '
  'values, for the core-values row. Stored as the names shown at the '
  'time, not as ids: this is a record of what somebody said.';


-- ---------------------------------------------------------------------
-- Carried through when the query is raised.
--
-- Identical to 0039 apart from the two lines that read and write
-- sub_items. Repeated whole, as every rewrite of this function has been,
-- so a reader comparing them can see every difference.
-- ---------------------------------------------------------------------
create or replace function raise_score_query(
  p_submission_id uuid,
  p_note          text,
  p_points        jsonb
)
returns kpi_score_queries
language plpgsql volatile security definer set search_path = public as $$
declare
  s        kpi_submissions%rowtype;
  me       uuid := current_employee_id();
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
      'You can only query a month your manager has reviewed (current: %)', s.status;
  end if;

  closes := submission_close_at(p_submission_id);
  if closes is not null and now() > closes then
    raise exception
      'This month closed on %',
      to_char(closes at time zone 'Asia/Kolkata', 'DD Mon YYYY');
  end if;

  if exists (select 1 from kpi_score_queries where submission_id = p_submission_id) then
    raise exception 'This month has already been queried once';
  end if;

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
    coalesce(closes, now() + interval '10 years'),
    nullif(trim(coalesce(p_note, '')), ''), s.mgr_total_score
  )
  returning * into q;

  insert into kpi_score_query_points (
    query_id, item_id, kind, note, sub_items, evidence_path, evidence_name)
  select
    q.id,
    (pt->>'item_id')::uuid,
    coalesce(nullif(pt->>'kind', ''), 'clarification'),
    nullif(trim(coalesce(pt->>'note', '')), ''),
    -- An empty list is null, not an empty array: "they named nothing"
    -- and "they named no parts" are the same fact and should look it.
    case when jsonb_typeof(pt->'sub_items') = 'array'
              and jsonb_array_length(pt->'sub_items') > 0
         then array(select jsonb_array_elements_text(pt->'sub_items'))
    end,
    nullif(trim(coalesce(pt->>'evidence_path', '')), ''),
    nullif(trim(coalesce(pt->>'evidence_name', '')), '')
  from jsonb_array_elements(p_points) pt;

  if s.status = 'finalized' then
    perform set_config('cyrix.system_write', 'on', true);
    update kpi_submissions
    set status = 'scored', finalized_at = null
    where id = p_submission_id;
    perform set_config('cyrix.system_write', 'off', true);
  end if;

  return q;
end $$;

grant execute on function raise_score_query(uuid, text, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  n   int;
  ok  boolean := false;
begin
  select count(*) into n from information_schema.columns
  where table_name = 'kpi_score_query_points' and column_name = 'sub_items';
  if n <> 1 then
    raise exception 'sub_items did not land on kpi_score_query_points';
  end if;

  -- The jsonb-to-array conversion the RPC relies on, checked directly:
  -- an array of names becomes a text[], and an empty one becomes null.
  if (select array(select jsonb_array_elements_text('["Care","Trust"]'::jsonb)))
     <> array['Care','Trust'] then
    raise exception 'named parts do not survive the jsonb conversion';
  end if;

  if (select case when jsonb_array_length('[]'::jsonb) > 0
                  then array(select jsonb_array_elements_text('[]'::jsonb)) end)
     is not null then
    raise exception 'an empty list should be null, not an empty array';
  end if;

  ok := true;
  if ok then
    raise notice
      '0041 self-test passed — a query point can name the parts of its row';
  end if;
end $$;
