-- =====================================================================
-- Cyrix KPI  ·  0037  ·  A face on the record
--
-- Stored on the employee row as a base64 data URL rather than in a
-- bucket. That is the right call here and would be the wrong one at any
-- size: the picture is 128px square and about 5 KB, every screen that
-- shows a person already selects their row, and a bucket would mean a
-- signed URL per face on a list of sixteen. Small enough to travel with
-- the data it belongs to.
--
-- The column is capped hard, because "text" and "somebody pastes a 4 MB
-- photo" are otherwise the same thing, and the team list would start
-- costing megabytes.
--
-- Nothing here tries to decide whether the picture is appropriate. The
-- app rejects what is obviously not a photograph; a person decides the
-- rest, and that person is the reporting manager, who is looking at
-- their team's faces on My Team every month anyway. A removal carries a
-- reason and the reason is shown to the person, on the screen where
-- they would go to upload another one — a picture that vanishes with no
-- explanation is how somebody concludes the app is broken.
-- =====================================================================

alter table employees
  add column if not exists avatar                text,
  add column if not exists avatar_updated_at     timestamptz,
  add column if not exists avatar_removed_at     timestamptz,
  add column if not exists avatar_removed_by     uuid references employees(id),
  add column if not exists avatar_removed_reason text;

-- ~64 KB of base64 is about a 45 KB image: far more than a 128px square
-- needs, and far less than a phone photo. A row that cannot be oversized
-- is a team list that cannot quietly become slow.
alter table employees drop constraint if exists employees_avatar_size;
alter table employees add constraint employees_avatar_size
  check (avatar is null or length(avatar) <= 65536);

alter table employees drop constraint if exists employees_avatar_format;
alter table employees add constraint employees_avatar_format
  check (avatar is null or avatar like 'data:image/jpeg;base64,%');

comment on column employees.avatar is
  'A 128px square JPEG as a base64 data URL, compressed in the browser. '
  'Capped at 64KB by constraint — see set_my_avatar().';


-- ---------------------------------------------------------------------
-- Setting your own.
--
-- A definer function rather than an RLS policy on employees: the table
-- holds reporting lines and job roles, and opening it to self-update so
-- that one column can be written is how somebody ends up able to change
-- who they report to.
-- ---------------------------------------------------------------------
create or replace function set_my_avatar(p_data text)
returns void
language plpgsql volatile security definer set search_path = public as $$
declare
  me uuid := current_employee_id();
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if p_data is not null then
    if p_data not like 'data:image/jpeg;base64,%' then
      raise exception 'That is not a photo this app made — try picking the file again';
    end if;
    if length(p_data) > 65536 then
      raise exception 'That picture is too large even after compressing';
    end if;
  end if;

  update employees
  set avatar                = p_data,
      avatar_updated_at     = case when p_data is null then null else now() end,
      -- Uploading a new one answers the removal. Leaving the reason
      -- behind would keep telling somebody off for a picture they have
      -- already replaced.
      avatar_removed_at     = null,
      avatar_removed_by     = null,
      avatar_removed_reason = null
  where id = me;
end $$;

grant execute on function set_my_avatar(text) to authenticated;


-- ---------------------------------------------------------------------
-- Taking somebody else's down.
-- ---------------------------------------------------------------------
create or replace function remove_avatar(p_employee_id uuid, p_reason text)
returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not (manages_employee(p_employee_id) or is_hr_admin()) then
    raise exception 'Only their reporting manager or HR can remove a photo';
  end if;

  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'Say why — they are told the reason, and "no reason" is not one';
  end if;

  update employees
  set avatar                = null,
      avatar_updated_at     = null,
      avatar_removed_at     = now(),
      avatar_removed_by     = current_employee_id(),
      avatar_removed_reason = trim(p_reason)
  where id = p_employee_id;
end $$;

grant execute on function remove_avatar(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- Self-test.
-- ---------------------------------------------------------------------
do $$
declare
  emp    uuid;
  ok     boolean := false;
  failed text;
begin
  select id into emp from employees where is_active limit 1;
  if emp is null then
    raise notice '0037 self-test skipped — no employees';
    return;
  end if;

  -- The format constraint rejects anything that is not one of ours.
  begin
    update employees set avatar = 'https://example.com/me.png' where id = emp;
    failed := 'a URL was accepted as a photo';
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    update employees set avatar = null where id = emp;
    raise exception '%', coalesce(failed, 'the format constraint did not fire');
  end if;

  -- And the size cap.
  ok := false;
  begin
    update employees
    set avatar = 'data:image/jpeg;base64,' || repeat('A', 70000)
    where id = emp;
    failed := 'a 70KB photo was accepted';
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    update employees set avatar = null where id = emp;
    raise exception '%', coalesce(failed, 'the size constraint did not fire');
  end if;

  -- A small, well-formed one goes in, and comes back out.
  update employees
  set avatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
  where id = emp;
  if (select avatar from employees where id = emp) is null then
    raise exception 'a valid photo did not save';
  end if;

  update employees
  set avatar = null, avatar_updated_at = null
  where id = emp;

  raise notice
    '0037 self-test passed — photos are capped at 64KB and must be a '
    'JPEG data URL this app produced';
end $$;
