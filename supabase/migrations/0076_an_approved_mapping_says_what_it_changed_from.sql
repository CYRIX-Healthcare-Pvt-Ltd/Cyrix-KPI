-- An approved mapping change now says what it changed from.
--
-- 0075 gave a direct change a from/to entry on the spare's own history.
-- The approval path still wrote proposed_changes straight through, which
-- carries only the code being moved to -- so the two paths recorded the
-- same event in two shapes, and the approved one read as though the spare
-- had never been mapped before.
--
-- Only the one insert in the mapping branch changes. The rest of this
-- function is its current definition, replayed unchanged: it is a long
-- function and the surrounding branches -- edit, remap, delete -- are not
-- what is being fixed.
--
-- `eq` is read at the top of the function, before apply_cyrix_mapping
-- runs, so it still holds the values being moved away from. The new name
-- is looked up rather than carried, because apply_cyrix_mapping is called
-- with `perform` and its return -- the updated row -- is discarded.

CREATE OR REPLACE FUNCTION public.resolve_edit_request(request_id uuid, approve boolean, note text DEFAULT NULL::text)
 RETURNS edit_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  req edit_requests;
  eq equipment;
  new_qr text;
  clash uuid;
begin
  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request was already resolved';
  end if;

  -- Who may clear this depends on what it asks for. A mapping request is
  -- purchasing's decision as much as a manager's; everything else is not.
  if req.kind::text = 'mapping' then
    if not can_approve_mapping() then
      raise exception 'Only a manager, purchase or an admin can resolve this';
    end if;
  elsif not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve requests';
  end if;

  select * into eq from equipment where id = req.equipment_id;
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
    select id into clash from equipment
      where qr_value = new_qr and id <> req.equipment_id;
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
    update equipment set
      deleted_at = now(),
      deleted_by = auth.uid(),
      updated_by = auth.uid(),
      updated_at = now()
    where id = req.equipment_id;

    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (
      req.equipment_id,
      'deleted',
      coalesce(req.proposed_changes, '{}'::jsonb),
      req.requested_by,
      auth.uid()
    );
  end if;

  return req;
end;
$function$
;

notify pgrst, 'reload schema';
