-- =====================================================================
-- Cyrix KPI  ·  0067  ·  The mapping log has never written a row
--
-- `apply_cyrix_mapping` — and `set_tag_cyrix_mapping` before it, since
-- 0058 — inserts into bluestar_item_mapping_history naming a `barcode`
-- column that table does not have. Any attempt to change a spare's Cyrix
-- item would have raised, and the table holds zero rows, which is what
-- that looks like from the outside: nobody has changed a mapping since
-- the schema landed, so nobody has hit it.
--
-- It surfaced now because 0066 gave the mapping an approval path and the
-- test for that approval path exercised the insert for the first time.
--
-- Two faults, not one. `barcode` does not exist; and bluestar_item_id is
-- NOT NULL while the function deliberately writes a null row for a tag
-- with no catalogue item behind it. The second is the more interesting:
-- an unlinked tag being pointed at a Cyrix item is still somebody
-- deciding what a spare is, and it is exactly the case a log is for. The
-- column gives way, not the record.
-- =====================================================================

alter table bluestar_item_mapping_history
  alter column bluestar_item_id drop not null;

comment on column bluestar_item_mapping_history.bluestar_item_id is
  'Null when the spare had no catalogue item behind it. The mapping still '
  'happened and is still recorded — this column says what it was linked '
  'to, not whether the change is worth keeping.';

-- Same body, minus the column that was never there.
create or replace function public.apply_cyrix_mapping(
  p_equipment_id uuid,
  code text,
  actor uuid
) returns equipment
language plpgsql
security definer
set search_path = public as $$
declare
  eq equipment;
  cyx cyrix_item_master;
  new_name text;
begin
  select * into eq from equipment where id = p_equipment_id for update;
  if eq is null then
    raise exception 'Spare not found';
  end if;

  if code is not null then
    select * into cyx from cyrix_item_master where item_code = code;
    if cyx is null then
      raise exception 'Cyrix item % not found', code;
    end if;
    new_name := cyx.item_name;
  end if;

  -- Nothing to record when nothing moved.
  if eq.cyrix_item_code is not distinct from code then
    return eq;
  end if;

  insert into bluestar_item_mapping_history (
    bluestar_item_id, equipment_id, bluestar_item_code,
    from_cyrix_item_code, from_cyrix_item_name,
    to_cyrix_item_code, to_cyrix_item_name, performed_by
  )
  select eq.bluestar_item_id, eq.id, b.item_code,
         eq.cyrix_item_code, eq.cyrix_item_name,
         code, new_name, actor
  from bluestar_item_master b where b.id = eq.bluestar_item_id
  union all
  -- An unlinked tag still records its mapping change; there is just no
  -- catalogue row to name alongside it.
  select null, eq.id, null,
         eq.cyrix_item_code, eq.cyrix_item_name,
         code, new_name, actor
  where eq.bluestar_item_id is null;

  update equipment
  set cyrix_item_code = code, cyrix_item_name = new_name
  where id = p_equipment_id
  returning * into eq;

  return eq;
end;
$$;

notify pgrst, 'reload schema';

-- =====================================================================
-- Self-test
-- =====================================================================
-- This one runs the function for real rather than reading its source,
-- because reading the source is exactly what would have missed the bug:
-- it looked entirely correct.
do $selftest$
declare
  probe uuid;
  target text;
  before_code text;
  wrote integer;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='bluestar_item_mapping_history'
      and column_name='barcode'
  ) then
    raise exception 'barcode exists after all — this migration is built on a wrong reading';
  end if;

  select id, cyrix_item_code into probe, before_code
  from equipment where deleted_at is null limit 1;
  select item_code into target
  from cyrix_item_master
  where item_code is distinct from before_code limit 1;

  if probe is null or target is null then
    raise notice '0067: no spare or no catalogue item to exercise; structure checked only';
  else
    perform apply_cyrix_mapping(probe, target, null);

    select count(*) into wrote from bluestar_item_mapping_history
    where equipment_id = probe and to_cyrix_item_code = target;
    if wrote = 0 then
      raise exception 'the mapping log still writes nothing';
    end if;

    -- Put the spare back exactly as it was, and take the two log rows
    -- with it. A self-test must not leave a decision behind that nobody
    -- made.
    perform apply_cyrix_mapping(probe, before_code, null);
    delete from bluestar_item_mapping_history where equipment_id = probe;

    if (select cyrix_item_code from equipment where id = probe) is distinct from before_code then
      raise exception 'self-test failed to restore the spare';
    end if;
  end if;

  raise notice '0067 self-test passed (the mapping log writes, including for an unlinked tag)';
end $selftest$;
