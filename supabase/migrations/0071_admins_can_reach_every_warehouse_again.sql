-- Admins lost every warehouse when admin stopped being a role.
--
-- 0069 moved administering Spare off the `user_role` enum and onto
-- `profiles.is_spare_admin`, and set those people's role to 'engineer' so
-- that granting somebody the keys no longer took their job away. Every
-- gate that asked "are you an admin" was rewritten to read the flag --
-- is_admin(), is_pm_or_admin(), can_approve_mapping() -- but this one was
-- missed, because it does not have "admin" in its name and reads the
-- column directly rather than calling is_admin().
--
-- So `role = 'admin'` went from being true for three people to being true
-- for nobody: 'admin' is still a value of the enum, so it compiles and
-- matches no row. The blanket access an admin had to every warehouse fell
-- back to whatever user_facilities happened to list for them, which for
-- both current admins is nothing at all.
--
-- That is not a cosmetic gap. has_facility_access() is the USING and
-- WITH CHECK on equipment_insert, equipment_select and
-- equipment_pm_admin_update, and it guards resolve_edit_request. An admin
-- could not tag a spare, see one, or approve a request against one.
--
-- is_admin() rather than the column again: one definition of what an
-- admin is, so the next migration that changes it cannot leave this
-- behind a second time.
create or replace function public.has_facility_access(target_facility uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select is_admin()
    or exists (
      select 1 from user_facilities uf
      where uf.user_id = auth.uid() and uf.facility_id = target_facility
    );
$function$;

notify pgrst, 'reload schema';
