-- Adding a warehouse is administration, the same as changing or removing
-- one.
--
-- facilities_admin_update and facilities_admin_delete both required
-- is_admin(). facilities_insert asked only that you were signed in and
-- that you named yourself as the creator -- so any engineer could create
-- a warehouse, and then neither rename nor remove the thing they had just
-- made. It went straight into the picker every engineer sees, and only an
-- admin could take it back out.
--
-- The creator check stays. It is what records who added a warehouse, and
-- dropping it would let one person file a warehouse under another's name.
-- Only the admin test is added alongside it.
--
-- Written to be re-runnable: `create policy` has no `if not exists`, so
-- the drop comes first and this file can be applied twice.
drop policy if exists facilities_insert on public.facilities;

create policy facilities_insert on public.facilities
  for insert
  with check (is_admin() and created_by = auth.uid());

-- PostgREST caches the schema; a policy change it has not seen is applied
-- by the database regardless, but the reload keeps the two in step.
notify pgrst, 'reload schema';
