-- A spare no longer has to name a warehouse.
--
-- facility_id was NOT NULL, so the tag form had to ask for a warehouse
-- before it could save anything, and it was the only question on that
-- form that could not be turned off. There is one warehouse, it was
-- created by mistake, and what identifies a spare is the code on it --
-- the client's item code says what the part is, the Cyrix QR says which
-- unit this one is. Neither needs a site to be picked first.
--
-- The column stays, and so does everything already filed against it.
-- Dropping it would take equipment_history's record of moves and the
-- user_facilities model with it, and a warehouse is a real thing to want
-- back the day there is a second one. It is simply not asked for.
alter table public.equipment
  alter column facility_id drop not null;

-- has_facility_access() is the USING and WITH CHECK on equipment_insert,
-- equipment_select and equipment_pm_admin_update. A null facility has to
-- pass it or a spare that names no warehouse cannot be saved or read --
-- which would be the NOT NULL constraint back again, wearing a policy.
--
-- Not filed anywhere is not the same as filed somewhere you may not go:
-- there is no site to be excluded from, so there is nothing to exclude.
create or replace function public.has_facility_access(target_facility uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select target_facility is null
    or is_admin()
    or not exists (
      select 1 from user_facilities uf where uf.user_id = auth.uid()
    )
    or exists (
      select 1 from user_facilities uf
      where uf.user_id = auth.uid() and uf.facility_id = target_facility
    );
$function$;

notify pgrst, 'reload schema';
