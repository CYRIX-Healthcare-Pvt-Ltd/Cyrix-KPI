-- =====================================================================
-- Cyrix KPI  ·  0064  ·  Spare: asking to delete a spare, and to remap it
--
-- Two things an engineer needs and could not ask for.
--
-- A spare gets tagged in error, or the physical item leaves — and there
-- was no way to say so short of a project manager finding it in the list
-- and deleting it outright. And a QR sticker tears. The spare is still
-- there, still the same unit with the same history; only the label on it
-- is gone, and a new sticker means a new code. Re-tagging from scratch
-- would create a second record of one physical item and orphan the first.
--
-- Both go through the approval flow that already exists rather than a new
-- one beside it. `edit_requests` gains a `kind`, and that is the whole
-- mechanism: the pending badge, the reviewer's screen, the row-level
-- security and the single resolve RPC all carry on working, and a
-- reviewer sees one queue rather than three.
--
-- Deleting is a soft delete, and it has to be. `equipment_history` and
-- `edit_requests` both cascade from `equipment`, so removing the row
-- would take the item's whole history with it *and* the approval that
-- authorised the removal — the record would delete the evidence of its
-- own deletion. An asset register that cannot say what happened to an
-- asset is not one. So the row stays, marked, and leaves the lists.
--
-- Remapping keeps the same row and moves `qr_value`. Everything hanging
-- off that row — the item mapping, the custom fields, the images, the
-- history — comes with it, which is the point: it is the same spare, and
-- the audit trail should say so rather than starting again.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────
-- What kind of thing is being asked for
-- ─────────────────────────────────────────────────────────────
-- Defaulted to 'edit', so every request written before this migration —
-- and every insert from an app that has not been redeployed yet — keeps
-- meaning exactly what it meant.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'request_kind') then
    create type request_kind as enum ('edit', 'delete', 'remap');
  end if;
end $$;

alter table edit_requests
  add column if not exists kind request_kind not null default 'edit';

comment on column edit_requests.kind is
  'What the request asks for. edit: proposed_changes is a field diff. '
  'remap: proposed_changes carries the new qr_value. delete: the spare '
  'is retired on approval.';

create index if not exists edit_requests_pending_idx
  on edit_requests (equipment_id) where status = 'pending';

-- ─────────────────────────────────────────────────────────────
-- Retired, not erased
-- ─────────────────────────────────────────────────────────────
alter table equipment
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references profiles(id);

comment on column equipment.deleted_at is
  'Set when a delete request is approved. The row stays so its history '
  'and the approval that retired it survive; every list filters on this '
  'being null.';

-- The lists all ask the same question — the live spares at a facility —
-- so the index only covers rows that can answer it.
create index if not exists equipment_live_idx
  on equipment (facility_id) where deleted_at is null;

-- qr_value stays unique across every row, deleted ones included. A torn
-- sticker's code is not reissued, and a scan of a retired spare should
-- find the retired spare rather than nothing at all.

-- ─────────────────────────────────────────────────────────────
-- The history can now describe two more things happening
-- ─────────────────────────────────────────────────────────────
alter table equipment_history drop constraint if exists equipment_history_action_check;
alter table equipment_history add constraint equipment_history_action_check
  check (action in ('created', 'updated', 'remapped', 'deleted'));

-- ─────────────────────────────────────────────────────────────
-- One resolve, three outcomes
-- ─────────────────────────────────────────────────────────────
-- Still the only way an edit_requests row's status changes, and still the
-- only thing granted to `authenticated` — which is what keeps "a manager
-- approved this" true rather than merely recorded.
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
  if not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve requests';
  end if;

  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request was already resolved';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;

  -- Nothing further happens to a spare that has already been retired.
  -- Without this, a delete request raised before another was approved
  -- would quietly re-stamp deleted_at with a later date and a different
  -- reviewer, rewriting when and by whom it went.
  if eq.deleted_at is not null then
    raise exception 'This spare has already been deleted';
  end if;

  -- Checked before the status moves, not after. A remap onto a code
  -- another spare already carries has to fail as a rejected action, not
  -- as a request marked approved with nothing applied behind it.
  if approve and req.kind = 'remap' then
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

  if req.kind = 'edit' then
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

    -- After the change, not before: the new code is what decides the link.
    if req.proposed_changes ? 'custom_fields' then
      update equipment
        set bluestar_item_id = public.bluestar_item_for_tag(req.equipment_id)
        where id = req.equipment_id;
    end if;

    -- performed_by stays the requester (they made the change); approved_by
    -- records the reviewer who let it through.
    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (req.equipment_id, 'updated', req.proposed_changes, req.requested_by, auth.uid());

  elsif req.kind = 'remap' then
    update equipment set
      qr_value = new_qr,
      updated_by = auth.uid(),
      updated_at = now()
    where id = req.equipment_id;

    -- Both codes, because the old one is the only way to recognise this
    -- as the unit that used to carry the sticker somebody threw away.
    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (
      req.equipment_id,
      'remapped',
      jsonb_build_object('qr_value', jsonb_build_object('from', eq.qr_value, 'to', new_qr)),
      req.requested_by,
      auth.uid()
    );

  elsif req.kind = 'delete' then
    update equipment set
      deleted_at = now(),
      deleted_by = auth.uid(),
      updated_by = auth.uid(),
      updated_at = now()
    where id = req.equipment_id;

    -- The reason travels with the request, so whatever the engineer wrote
    -- is what the history shows.
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

notify pgrst, 'reload schema';

-- =====================================================================
-- Self-test
-- =====================================================================
do $selftest$
declare
  probe uuid;
  labels text[];
  def text;
  n integer;
begin
  select array_agg(enumlabel::text order by enumsortorder) into labels
  from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'request_kind';
  if labels is distinct from array['edit', 'delete', 'remap'] then
    raise exception 'request_kind is %, expected edit/delete/remap', labels;
  end if;

  select count(*) into n from information_schema.columns
  where table_schema = 'public' and table_name = 'equipment'
    and column_name in ('deleted_at', 'deleted_by');
  if n <> 2 then
    raise exception 'Expected deleted_at and deleted_by on equipment, found %', n;
  end if;

  -- Every request that already existed has to still read as an edit, or a
  -- queue of pending edits would silently become a queue of deletions.
  if exists (select 1 from edit_requests where kind <> 'edit') then
    raise exception 'Existing requests did not default to edit';
  end if;

  -- Exercise the widened constraint rather than reading its definition:
  -- the point is that these two values can actually be written.
  select id into probe from equipment limit 1;
  if probe is not null then
    insert into equipment_history (equipment_id, action, changes)
    values (probe, 'remapped', '{"selftest": true}'::jsonb),
           (probe, 'deleted',  '{"selftest": true}'::jsonb);
    delete from equipment_history
    where equipment_id = probe and changes ? 'selftest';
    if exists (select 1 from equipment_history where changes ? 'selftest') then
      raise exception 'Self-test rows were not cleaned up';
    end if;
  end if;

  -- The resolve function must actually branch, not just compile.
  select pg_get_functiondef(oid) into def from pg_proc
  where proname = 'resolve_edit_request'
    and pronamespace = 'public'::regnamespace
  limit 1;
  if def not like '%remapped%' or def not like '%deleted_at = now()%' then
    raise exception 'resolve_edit_request is missing the remap or delete branch';
  end if;

  raise notice '0064 self-test passed (spare delete and remap requests)';
end $selftest$;
