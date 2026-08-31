-- =====================================================================
-- Cyrix KPI  ·  0066  ·  Deciding what a spare is now takes two people
--
-- `set_tag_cyrix_mapping` was gated on warehouse access and nothing else,
-- so anybody who could see a spare could change which Cyrix item it is,
-- instantly. That is the one field on a tag that decides what the part
-- actually costs and what it is ordered against, and it was the only
-- field with no second pair of eyes on it — every other correction an
-- engineer makes goes to a manager, and this one did not.
--
-- Now: an engineer proposes it, and a manager, purchase or an admin
-- applies it. Purchase is in that list because deciding what a spare is
-- *is* purchasing's job — a request that only a project manager can clear
-- would queue behind the person least likely to know the answer.
--
-- Nothing is bypassed silently. Every applied change still writes the
-- bluestar_item_mapping_history row it always did, and the approved ones
-- now carry the reviewer beside the requester, so the log answers "who
-- decided this" and not merely "who typed it".
-- =====================================================================

-- ─────────────────────────────────────────────────────────────
-- Who may clear a mapping request
-- ─────────────────────────────────────────────────────────────
-- Separate from is_pm_or_admin() rather than widening it: purchase is
-- trusted with what a spare *is*, and with nothing else. Widening the
-- general check would have handed them approvals on warehouses, field
-- edits and deletions as a side effect of a naming decision.
create or replace function public.can_approve_mapping() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select role::text in ('project_manager', 'purchase', 'admin')
    from profiles where id = auth.uid()
  ), false);
$$;

grant execute on function public.can_approve_mapping() to authenticated;

comment on function public.can_approve_mapping() is
  'Mapping requests only. Purchase decides what a spare is, so it clears '
  'those and nothing else; every other kind of request stays with '
  'is_pm_or_admin().';

-- ─────────────────────────────────────────────────────────────
-- A fourth kind of request
-- ─────────────────────────────────────────────────────────────
alter type request_kind add value if not exists 'mapping';

-- ─────────────────────────────────────────────────────────────
-- The mapping itself, when it is allowed to happen at once
-- ─────────────────────────────────────────────────────────────
-- The write half of set_tag_cyrix_mapping, lifted out so the RPC and the
-- approval path share one implementation. Without this the two would drift
-- and the history would end up recorded twice, or not at all, depending on
-- which route the change took.
--
-- No permission check of its own on purpose: it is not granted to anyone.
-- Both callers below check first, and each checks a different thing.
create or replace function public.apply_cyrix_mapping(
  p_equipment_id uuid,
  code text,
  actor uuid
) returns equipment
language plpgsql
security definer
set search_path = public as $$
declare
  eq equipment;
  cyx cyrix_item_master;
  new_name text;
begin
  select * into eq from equipment where id = p_equipment_id;
  if eq is null then
    raise exception 'Spare not found';
  end if;

  if code is not null then
    select * into cyx from cyrix_item_master where item_code = code;
    if cyx is null then
      raise exception 'Cyrix item % not found', code;
    end if;
    new_name := cyx.item_name;
  end if;

  -- Nothing to record when nothing moved.
  if eq.cyrix_item_code is not distinct from code then
    return eq;
  end if;

  insert into bluestar_item_mapping_history (
    bluestar_item_id, equipment_id, barcode, bluestar_item_code,
    from_cyrix_item_code, from_cyrix_item_name,
    to_cyrix_item_code, to_cyrix_item_name, performed_by
  )
  select eq.bluestar_item_id, eq.id, b.barcode, b.item_code,
         eq.cyrix_item_code, eq.cyrix_item_name,
         code, new_name, actor
  from bluestar_item_master b where b.id = eq.bluestar_item_id
  union all
  select null, eq.id, null, null,
         eq.cyrix_item_code, eq.cyrix_item_name,
         code, new_name, actor
  where eq.bluestar_item_id is null;

  update equipment
  set cyrix_item_code = code, cyrix_item_name = new_name
  where id = p_equipment_id
  returning * into eq;

  return eq;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- The RPC an engineer can no longer use to decide this alone
-- ─────────────────────────────────────────────────────────────
-- The parameter names are the ones this function already had. `create or
-- replace` cannot rename them, and renaming would break every caller that
-- passes them by name through PostgREST.
create or replace function public.set_tag_cyrix_mapping(
  p_equipment_id uuid,
  p_cyrix_code text
) returns equipment
language plpgsql
security definer
set search_path = public as $$
declare
  eq equipment;
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

  return apply_cyrix_mapping(p_equipment_id, p_cyrix_code, auth.uid());
end;
$$;

grant execute on function public.set_tag_cyrix_mapping(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Resolving one, alongside the other three kinds
-- ─────────────────────────────────────────────────────────────
create or replace function public.resolve_edit_request(
  request_id uuid,
  approve boolean,
  note text default null
)
returns edit_requests
language plpgsql
security definer
set search_path = public as $$
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

    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (req.equipment_id, 'updated', req.proposed_changes, req.requested_by, auth.uid());

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
$$;

grant execute on function public.resolve_edit_request(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Purchase has to be able to see the queue it is expected to clear
-- ─────────────────────────────────────────────────────────────
-- The existing select policy shows a request to the person who filed it
-- and to is_pm_or_admin(). Purchase is neither, so without this it would
-- be asked to approve a list it could not read.
drop policy if exists "edit_requests_purchase_select" on edit_requests;
create policy "edit_requests_purchase_select" on edit_requests for select
  using (
    can_approve_mapping()
    and exists (
      select 1 from equipment e
      where e.id = edit_requests.equipment_id
        and has_facility_access(e.facility_id)
    )
  );

notify pgrst, 'reload schema';

-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  def text;
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'request_kind' and e.enumlabel = 'mapping'
  ) then
    raise exception 'request_kind is missing the mapping value';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'can_approve_mapping'
  ) then
    raise exception 'can_approve_mapping was not created';
  end if;

  -- The RPC must actually refuse now; a version without the check would
  -- leave the whole migration cosmetic.
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_tag_cyrix_mapping' limit 1;
  if def not like '%can_approve_mapping%' then
    raise exception 'set_tag_cyrix_mapping still lets anybody through';
  end if;

  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'resolve_edit_request' limit 1;
  if def not like '%apply_cyrix_mapping%' then
    raise exception 'resolve_edit_request has no mapping branch';
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'edit_requests' and policyname = 'edit_requests_purchase_select'
  ) then
    raise exception 'purchase cannot read the queue it has to clear';
  end if;

  raise notice '0066 self-test passed (a mapping change now takes two people)';
end $selftest$;
