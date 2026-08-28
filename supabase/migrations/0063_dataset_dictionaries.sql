-- =====================================================================
-- Cyrix KPI  ·  0063  ·  Publish the zone and district lists
--
-- BEMMP scopes an account to a zone, or to some districts, and the lists
-- it offers come from the loaded export's own dictionaries: districts are
-- a property of the data, and a hard-coded fourteen goes stale the day a
-- contract gains one. That is the right call and this does not change it.
--
-- What it does change is where the lists can be read. Today they exist
-- only inside a 5 MB binary artifact that has to be downloaded and parsed
-- before anybody can see them, which is why area scope is the one thing
-- the shared administration screen cannot offer: making SW Admin fetch and
-- decode a ticket export to populate two dropdowns is not a trade worth
-- making.
--
-- So the publish records them beside the pointer it already writes. Two
-- text arrays, a few hundred bytes, written by the same upsert — and the
-- dictionaries stay derived from the data rather than declared anywhere.
-- Any app with a database connection can then ask what the zones are.
--
-- Nullable rather than defaulted to '{}': a row published before this
-- migration genuinely does not know, and that is different from a contract
-- having no zones. A reader can tell "not recorded" from "none".
-- =====================================================================

alter table dataset add column if not exists zones     text[];
alter table dataset add column if not exists districts text[];

comment on column dataset.zones is
  'Zone names from the published export''s dictionary. Null on rows '
  'published before the dictionaries were recorded — not the same as none.';
comment on column dataset.districts is
  'District names from the published export''s dictionary, for the area '
  'scope picker. Null means not recorded rather than empty.';


-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  n integer;
begin
  select count(*) into n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'dataset'
    and column_name in ('zones', 'districts')
    and data_type = 'ARRAY';
  if n <> 2 then
    raise exception 'Expected zones and districts as arrays on dataset, found %', n;
  end if;

  -- The existing policies must still cover the new columns: they are
  -- row-level, so this is really asking that nobody has replaced them with
  -- a column list while this migration was being written.
  if not exists (
    select 1 from pg_policies
    where tablename = 'dataset' and policyname = 'dataset_read'
  ) then
    raise exception 'dataset_read is missing; the new columns would be unreadable';
  end if;

  raise notice '0063 self-test passed (dataset carries its dictionaries)';
end $selftest$;
