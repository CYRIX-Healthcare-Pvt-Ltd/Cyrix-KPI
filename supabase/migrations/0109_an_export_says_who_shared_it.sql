-- =====================================================================
-- Cyrix BEMMP  ·  0109  ·  An export says who shared it
--
-- Management: the upload panel names the person who shared each state's
-- export, so everybody can see whose copy they are working from.
--
-- The uuid was already being recorded in dataset.uploaded_by and there
-- was no way to turn it into a name: profile is readable only for your
-- own row (`id = auth.uid() or bemmp_is_admin()`), so every colleague's
-- id resolves to nothing. The meeting log has the same problem and
-- solves it with an RPC.
--
-- WHY THE NAME IS COPIED RATHER THAN LOOKED UP
--
-- An RPC would work and would be wrong here. "Who shared this export" is
-- a fact about a moment: the person's code and name as they were when
-- they pressed the button. Resolving it live means the label changes
-- when somebody is renamed, and empties when they leave the company --
-- which is exactly when you most want to know whose file this was.
--
-- It also costs nothing. The uploader can read their own profile, so the
-- two values travel with the publish that is already happening rather
-- than adding a lookup for every reader on every load.
--
-- Both are nullable. Everything published before this migration has no
-- name to show, and a row that predates the column is not an error.
-- =====================================================================

alter table dataset
  add column if not exists uploaded_by_code text,
  add column if not exists uploaded_by_name text;

comment on column dataset.uploaded_by_code is
  'The uploader''s employee code as it was when they shared it. Copied, '
  'not resolved -- see 0109.';
comment on column dataset.uploaded_by_name is
  'The uploader''s name as it was when they shared it.';

-- ---------------------------------------------------------------------
-- Backfill what can be known.
--
-- Only where the uuid still matches a profile. Anything else keeps its
-- null and shows as an unnamed upload, which is the truth rather than a
-- guess.
-- ---------------------------------------------------------------------
update dataset d
set uploaded_by_code = p.code,
    uploaded_by_name = p.full_name
from profile p
where p.id = d.uploaded_by
  and d.uploaded_by is not null
  and d.uploaded_by_name is null;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
-- ---------------------------------------------------------------------
do $test$
declare
  n_named int;
  n_total int;
  n_orphan int;
begin
  select count(*) into n_total from dataset;
  select count(*) into n_named from dataset where uploaded_by_name is not null;
  -- Rows whose uploader is recorded but no longer has a profile.
  select count(*) into n_orphan
  from dataset d
  where d.uploaded_by is not null
    and d.uploaded_by_name is null
    and not exists (select 1 from profile p where p.id = d.uploaded_by);

  -- Every row that CAN be named now is named.
  if exists (
    select 1 from dataset d join profile p on p.id = d.uploaded_by
    where d.uploaded_by_name is null
  ) then
    raise exception 'a dataset with a known uploader was left unnamed';
  end if;

  -- The columns take text and give it back.
  update dataset set uploaded_by_code = 'PROBE', uploaded_by_name = 'Probe Person'
  where state = (select state from dataset limit 1);
  if not exists (select 1 from dataset where uploaded_by_name = 'Probe Person') then
    raise exception 'the new columns did not hold what was written to them';
  end if;

  raise notice '0109 self-test passed (% of % datasets named, % with a departed uploader)',
    n_named, n_total, n_orphan;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
