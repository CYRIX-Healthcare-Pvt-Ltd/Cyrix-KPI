-- Deleting a spare removes it.
--
-- 0064 made deletion soft, to keep the record of what happened to a
-- physical asset: equipment_history and edit_requests both cascade from
-- equipment, so removing the row takes the spare's history and any
-- request about it too. That reasoning holds for a spare that was really
-- in a warehouse and has since gone.
--
-- It does not hold for the case this is actually used for. A tag added by
-- mistake -- wrong sticker, wrong code, a test -- has no history worth
-- keeping, and leaving the row behind means a spare that was deleted is
-- still there to be opened, still answers its URL, and still reads back
-- every field it was given. Deleted has to mean gone.
--
-- What survives: bluestar_item_mapping_history is ON DELETE SET NULL, so
-- the catalogue's record of which client item pointed at which Cyrix item
-- keeps its rows and simply stops naming the unit. What goes with the
-- row: that spare's equipment_history, and any edit request against it,
-- both by cascade -- which is the price of this and is the thing 0064 was
-- avoiding.

-- The unlink trigger from 0078 can no longer fire: it watched for
-- deleted_at being set, and nothing sets it now. Dropping the link is
-- moot when the row holding it is going.
drop trigger if exists equipment_unlink_on_delete on public.equipment;
drop function if exists public.spare_unlink_on_delete();

-- An approved delete request deletes.
--
-- Only the delete branch changes; the rest is the function's current
-- definition replayed. The history insert goes with the update: it would
-- be writing a row against an equipment_id that is about to cascade it
-- away in the same statement.
--
-- The request being resolved cascades too. `req` is a local copy read at
-- the top, so the function still returns what it did; the row is simply
-- no longer in the table, which is right -- it is a request about a spare
-- that no longer exists.
create or replace function public.resolve_edit_request(request_id uuid, approve boolean, note text default null::text)
returns edit_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  req edit_requests;
  eq equipment;
  new_qr text;
  clash uuid;
begin
  select * into req from edit_requests where id = request_id;
  if req is null then
    raise exception 'Request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request was already resolved';
  end if;

  if req.kind::text = 'mapping' then
    if not can_approve_mapping() then
      raise exception 'Only a manager, purchase or an admin can resolve this';
    end if;
  elsif not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve requests';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if eq is null then
    raise exception 'Spare not found';
  end if;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;
  if eq.deleted_at is not null then
    raise exception 'This spare has already been deleted';
  end if;

  if approve and req.kind::text = 'remap' then
    new_qr := nullif(btrim(req.proposed_changes->>'qr_value'), '');
    if new_qr is null then
      raise exception 'This remap request carries no new code';
    end if;
    select id into clash from equipment where qr_value = new_qr and id <> req.equipment_id;
    if clash is not null then
      raise exception 'That code is already on another spare';
    end if;
  end if;

  update edit_requests set
    status = case when approve then 'approved'::request_status else 'rejected'::request_status end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = note
  where id = request_id
  returning * into req;

  if not approve then
    return req;
  end if;

  if req.kind::text = 'edit' then
    update equipment set
      name = coalesce(req.proposed_changes->>'name', name),
      location = coalesce(req.proposed_changes->>'location', location),
      facility_id = coalesce((req.proposed_changes->>'facility_id')::uuid, facility_id),
      images = case when req.proposed_changes ? 'images'
        then (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(req.proposed_changes->'images') x)
        else images end,
      custom_fields = case when req.proposed_changes ? 'custom_fields'
        then coalesce(custom_fields, '{}'::jsonb) || (req.proposed_changes->'custom_fields')
        else custom_fields end,
      updated_by = auth.uid(),
      updated_at = now()
    where id = req.equipment_id;

    if req.proposed_changes ? 'custom_fields' then
      update equipment
        set bluestar_item_id = public.bluestar_item_for_tag(req.equipment_id)
        where id = req.equipment_id;
    end if;

    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (req.equipment_id, 'updated', req.proposed_changes, req.requested_by, auth.uid());

  elsif req.kind::text = 'mapping' then
    -- performed_by is the requester: they decided it, the reviewer let it
    -- through. The mapping history reads the same either way.
    perform apply_cyrix_mapping(
      req.equipment_id,
      nullif(req.proposed_changes->>'cyrix_item_code', ''),
      req.requested_by
    );

    -- From what to which, matching what a direct change records (0075).
    -- proposed_changes carries only the new code, and an entry naming one
    -- item reads as though the spare had never been mapped before. eq was
    -- read before apply_cyrix_mapping ran, so it still holds the old
    -- values; the new name is looked up because apply_cyrix_mapping's
    -- return was discarded.
    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (
      req.equipment_id,
      'updated',
      jsonb_build_object(
        'cyrix_item_code', jsonb_build_object(
          'from', eq.cyrix_item_code,
          'to', nullif(req.proposed_changes->>'cyrix_item_code', '')
        ),
        'cyrix_item_name', jsonb_build_object(
          'from', eq.cyrix_item_name,
          'to', (
            select item_name from cyrix_item_master
            where item_code = nullif(req.proposed_changes->>'cyrix_item_code', '')
          )
        )
      ),
      req.requested_by,
      auth.uid()
    );

  elsif req.kind::text = 'remap' then
    update equipment set
      qr_value = new_qr,
      updated_by = auth.uid(),
      updated_at = now()
    where id = req.equipment_id;

    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (
      req.equipment_id,
      'remapped',
      jsonb_build_object('qr_value', jsonb_build_object('from', eq.qr_value, 'to', new_qr)),
      req.requested_by,
      auth.uid()
    );

  elsif req.kind::text = 'delete' then
    -- Gone, not flagged. No history row is written: it would name an
    -- equipment_id that this same statement cascades away.
    delete from equipment where id = req.equipment_id;
  end if;

  return req;
end;
$function$;

-- Everything already soft-deleted goes now. These are tags added by
-- mistake that have been sitting behind a filter; they were never meant
-- to be kept, and leaving them would mean "deleted" carried on meaning
-- two different things depending on when it happened.
delete from public.equipment where deleted_at is not null;

notify pgrst, 'reload schema';
