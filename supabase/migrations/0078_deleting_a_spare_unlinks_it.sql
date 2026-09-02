-- Deleting a tagged spare gives its client item back.
--
-- 0077 stopped a deleted spare being counted, which fixed what the item
-- master displayed. The link itself was still on the row: the spare went
-- on naming a client item and a Cyrix item, and only the filters kept
-- that out of sight. A retired unit is not mapped to anything -- the
-- sticker is off, the part is gone -- so the link goes when it does.
--
-- A trigger rather than the two places that delete. A spare is retired
-- from the tagged list by a manager and by resolve_edit_request approving
-- somebody's request, and one of those is TypeScript and the other is
-- plpgsql. Clearing the link in both means writing it twice and keeping
-- two copies honest; the row can only change one way, so the rule lives
-- with the row.
--
-- BEFORE UPDATE so `new` is edited on the way through. An AFTER trigger
-- would need a second UPDATE against the row it was just fired for, which
-- fires the trigger again.
create or replace function public.spare_unlink_on_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Only the moment of retiring. Every other update to a deleted row --
  -- and the row stays updatable -- must leave this alone, or a second
  -- edit would write another unlink for a link that is already gone.
  if new.deleted_at is null or old.deleted_at is not null then
    return new;
  end if;

  -- Recorded where every other mapping change is recorded, with a null
  -- destination, which is what this table already means by unlinked. The
  -- spare's own history gets its 'deleted' entry from the caller; this is
  -- the catalogue's side of the same event, and it is the reason the
  -- item's tagged count went down.
  if old.cyrix_item_code is not null or old.bluestar_item_id is not null then
    insert into bluestar_item_mapping_history (
      bluestar_item_id, equipment_id, bluestar_item_code,
      from_cyrix_item_code, from_cyrix_item_name,
      to_cyrix_item_code, to_cyrix_item_name, performed_by
    )
    values (
      old.bluestar_item_id,
      old.id,
      (select item_code from bluestar_item_master where id = old.bluestar_item_id),
      old.cyrix_item_code,
      old.cyrix_item_name,
      null,
      null,
      coalesce(new.deleted_by, auth.uid())
    );
  end if;

  new.bluestar_item_id := null;
  new.cyrix_item_code := null;
  new.cyrix_item_name := null;
  return new;
end;
$function$;

drop trigger if exists equipment_unlink_on_delete on public.equipment;
create trigger equipment_unlink_on_delete
  before update on public.equipment
  for each row
  execute function public.spare_unlink_on_delete();

-- Retired spares are not remapped either.
--
-- resolve_edit_request refuses a request against a deleted spare. The
-- direct path -- a manager, purchase or admin changing the Cyrix item
-- without asking anybody -- did not check, so the one route that skips
-- approval was also the one that could quietly re-link something that had
-- been retired, and now unlinked. No screen offers a deleted spare to
-- change; this is so nothing else has to remember that.
--
-- The rest of this function is 0075's definition unchanged.
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
  if eq.deleted_at is not null then
    raise exception 'This spare has been deleted';
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
