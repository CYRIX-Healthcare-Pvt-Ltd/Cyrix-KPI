-- Nobody could use Spare, because nobody had been given a warehouse.
--
-- has_facility_access() answered "is this warehouse one of yours?" by
-- looking for a row in user_facilities. That table is empty: none of the
-- 1,148 profiles has a single grant. So the answer was no, for everyone,
-- for every warehouse -- and that function is the USING and WITH CHECK
-- behind equipment_insert, equipment_select and equipment_pm_admin_update.
--
-- An engineer could not tag a spare, could not see one, could not edit
-- one. 0071 restored it for admins by making is_admin() pass; this is the
-- same failure for everybody who is not one.
--
-- Granting all 1,148 people every warehouse would fix today and break
-- again the next time somebody joins, because the fix would be a row
-- somebody has to remember to write. So the rule is inverted instead:
-- listing warehouses against a person restricts them to those, and
-- listing none restricts them to nothing. Access is opt-in, which is
-- how it has actually been used -- one warehouse, everyone works in it --
-- and a new starter can tag a spare on their first day without anybody
-- provisioning them.
--
-- This widens who can reach a spare, and deliberately. It is not the only
-- thing standing between an engineer and somebody else's work:
-- taggedCreatorIds() still scopes the tagged list to what you created,
-- or to your reports if you manage them, and edit, remap, delete and
-- mapping all still need an approval from someone senior. Warehouse was
-- never carrying that weight; it was only ever meant to divide sites,
-- and while it was empty it divided nothing while blocking everything.
create or replace function public.has_facility_access(target_facility uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select is_admin()
    or not exists (
      select 1 from user_facilities uf where uf.user_id = auth.uid()
    )
    or exists (
      select 1 from user_facilities uf
      where uf.user_id = auth.uid() and uf.facility_id = target_facility
    );
$function$;

notify pgrst, 'reload schema';
