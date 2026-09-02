-- Changing a spare's Cyrix item left no trace on the spare.
--
-- Two histories exist, and they record different things.
-- bluestar_item_mapping_history is the catalogue's record: which client
-- item pointed at which Cyrix item, and when it moved.
-- equipment_history is the spare's own record, and it is what the History
-- dialog on a spare shows.
--
-- A change made through the approval flow reached both, because
-- resolve_edit_request() writes the equipment_history row itself -- with
-- the requester as performed_by and the approver as approved_by, which is
-- exactly the question "who asked, who allowed it" wants answered.
--
-- A change made directly -- by a manager, purchase, or an admin, who need
-- no approval -- went only to the mapping history. So the spare's own
-- History showed "Tagged" and nothing else, and the change appeared to
-- have gone unrecorded. It had not; it was filed somewhere else.
--
-- Written here rather than in apply_cyrix_mapping(), which both paths
-- call: putting it there would give the approval path a second row for
-- one change, one from resolve_edit_request and one from underneath it.
-- This is the direct path and only the direct path.
--
-- The old value is captured before the change, so the entry reads from
-- what to which rather than just naming the new item. describeChanges.ts
-- already renders a {from, to} pair that way; a bare value has nothing to
-- compare against and reads as though the spare had never been mapped
-- before.
create or replace function public.set_tag_cyrix_mapping(p_equipment_id uuid, p_cyrix_code text)
returns equipment
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  eq equipment;
  was_code text;
  was_name text;
  result equipment;
begin
  select * into eq from equipment where id = p_equipment_id;
  if eq is null then
    raise exception 'Spare not found';
  end if;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this warehouse';
  end if;

  -- The change of rule. An engineer files a request instead; the app
  -- does that, and the message is what tells it to.
  if not can_approve_mapping() then
    raise exception 'A manager or purchase has to approve a change of Cyrix item';
  end if;

  was_code := eq.cyrix_item_code;
  was_name := eq.cyrix_item_name;

  result := apply_cyrix_mapping(p_equipment_id, p_cyrix_code, auth.uid());

  -- Only when something actually moved. apply_cyrix_mapping returns the
  -- row untouched when the code it was given is the one already there,
  -- and a history of non-events is a history nobody reads.
  if result.cyrix_item_code is distinct from was_code then
    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (
      p_equipment_id,
      'updated',
      jsonb_build_object(
        'cyrix_item_code', jsonb_build_object('from', was_code, 'to', result.cyrix_item_code),
        'cyrix_item_name', jsonb_build_object('from', was_name, 'to', result.cyrix_item_name),
        -- Nobody approved this; the person who made it did not need one.
        -- Said plainly so an empty approved_by is not read as an approval
        -- that went missing.
        'direct', true
      ),
      auth.uid(),
      null
    );
  end if;

  return result;
end;
$function$;

notify pgrst, 'reload schema';
