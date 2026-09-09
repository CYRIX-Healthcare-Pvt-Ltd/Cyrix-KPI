-- =====================================================================
-- Cyrix KPI  ·  0112  ·  The meeting log says who, not just which code
--
-- Entry history shows "E641" against every change. In a meeting where
-- somebody asks who moved a ticket to Local Service, an employee code is
-- a lookup, and the person who has to do the lookup is the one who asked.
--
-- The function already resolves the uuid -- it exists to, because
-- `profile` is readable only for your own row and the browser therefore
-- cannot turn a colleague's id into anything. It was returning the code
-- and stopping one column short of the name.
--
-- Both are returned rather than the name alone: the code is what people
-- are addressed by in this company and what a search box takes, and a
-- name on its own is ambiguous the day there are two of them.
--
-- Nullable, because the join is a LEFT one and always was. A change made
-- by a service role, or by somebody whose profile has since gone, has no
-- name to give and reads as "System" the way it already did.
-- =====================================================================

-- Dropped and recreated, not replaced: adding a column changes the return
-- type, and Postgres refuses that in a CREATE OR REPLACE. Nothing depends
-- on this function in the database -- the browser calls it by name over
-- PostgREST -- so the drop costs a moment of a 404 on a screen nobody has
-- open mid-deploy, and the two statements are in one transaction anyway.
drop function if exists public.meeting_log(text, text);

create function public.meeting_log(p_state text, p_ticket text)
returns table(
  id bigint,
  column_name text,
  old_value text,
  new_value text,
  changed_at timestamptz,
  changed_by_code text,
  changed_by_name text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select h.id, h.column_name, h.old_value, h.new_value, h.changed_at,
         p.code, p.full_name
    from meeting_note_history h
    left join profile p on p.id = h.changed_by
   where h.state = p_state
     and h.ticket = p_ticket
     and in_scope (p_state)
   order by h.changed_at desc, h.id desc
   limit 500;
$function$;

-- ---------------------------------------------------------------------
-- Self-test, rolled back.
--
-- The function is SECURITY DEFINER and gated on in_scope(), which reads
-- auth.uid() -- null inside a migration, so calling it returns nothing
-- and proves nothing about the rows. What can be checked here is the
-- shape: that the new column exists and that it resolves for a change
-- whose author still has a profile.
-- ---------------------------------------------------------------------
do $test$
declare
  n_cols int;
  n_named int;
begin
  select count(*) into n_cols
  from information_schema.parameters
  where specific_schema = 'public'
    and specific_name in (
      select specific_name from information_schema.routines
      where routine_name = 'meeting_log' and routine_schema = 'public'
    )
    and parameter_name = 'changed_by_name';
  if n_cols < 1 then
    raise exception 'meeting_log does not return changed_by_name';
  end if;

  -- The join it depends on: history rows whose author has a profile.
  select count(*) into n_named
  from meeting_note_history h
  join profile p on p.id = h.changed_by
  where p.full_name is not null;

  raise notice '0112 self-test passed (% history rows can be named)', n_named;
  raise exception 'rollback the probe';
exception when others then
  if sqlerrm <> 'rollback the probe' then raise; end if;
end $test$;
