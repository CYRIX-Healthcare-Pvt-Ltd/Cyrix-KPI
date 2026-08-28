-- =====================================================================
-- Cyrix KPI  ·  0058  ·  Spare Mapping moves in
--
-- The portal promises one sign-in. It could only ever deliver one per
-- Supabase project, and Spare was a second project — so clicking the
-- Spare tile asked for a password again. This brings Spare's schema
-- here so the session that opened the portal already works.
--
-- PART 1 below is Spare's own 32 migrations, in their original order and
-- otherwise unedited, with one substitution: its `app_settings` becomes
-- `spare_settings`. Both products defined a table by that name. Sharing
-- one would have meant Spare's admin policy governing rows KPI relies on
-- — tat_policy, month_close, force_password_change — so a Spare admin
-- could change how appraisals are scored. The rename is the whole of the
-- structural conflict between the two schemas; nothing else collides,
-- no function or type included.
--
-- Replaying the sequence rather than hand-merging it to a final state is
-- deliberate: this is the exact sequence that produced the schema Spare
-- runs against today, so there is no transcription to get wrong. It
-- creates some columns only to drop them again a few hundred lines
-- later. That is the point.
--
-- PART 2 makes HR's employee list the master record for who exists.
-- =====================================================================

-- =====================================================================
-- PART 1 · Spare Mapping's schema, replayed
-- =====================================================================


-- ─────────────────────────────────────────────────────────────
-- Spare 0001_init.sql
-- ─────────────────────────────────────────────────────────────
-- Blue Star: initial schema, RLS policies, and the edit-request approval RPC.
-- Apply with: supabase db push  (after `supabase link`), or paste into the
-- Supabase Dashboard SQL editor.

create extension if not exists pgcrypto;

create type user_role as enum ('engineer', 'project_manager', 'admin');
create type field_type as enum ('text', 'number', 'date', 'dropdown', 'textarea', 'boolean');
create type request_status as enum ('pending', 'approved', 'rejected');

-- ============================================================================
-- Tables
-- ============================================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  ecode text not null unique,
  full_name text not null,
  role user_role not null default 'engineer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  city text,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_facilities (
  user_id uuid not null references profiles(id) on delete cascade,
  facility_id uuid not null references facilities(id) on delete cascade,
  primary key (user_id, facility_id)
);

create table field_definitions (
  id uuid primary key default gen_random_uuid(),
  field_key text not null unique,
  label text not null,
  field_type field_type not null default 'text',
  options jsonb not null default '[]',
  required boolean not null default false,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table equipment (
  id uuid primary key default gen_random_uuid(),
  qr_value text not null unique,
  facility_id uuid not null references facilities(id),
  name text not null,
  location text not null,
  images text[] not null default '{}',
  custom_fields jsonb not null default '{}',
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_images_max3
    check (array_length(images, 1) is null or array_length(images, 1) <= 3)
);

create index equipment_facility_idx on equipment(facility_id);
create index equipment_qr_idx on equipment(qr_value);

create table edit_requests (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  requested_by uuid not null references profiles(id),
  proposed_changes jsonb not null,
  status request_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index edit_requests_equipment_idx on edit_requests(equipment_id);
create index edit_requests_status_idx on edit_requests(status);

create table spare_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- updated_at triggers
-- ============================================================================

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_touch before update on profiles
  for each row execute function public.touch_updated_at();
create trigger trg_facilities_touch before update on facilities
  for each row execute function public.touch_updated_at();
create trigger trg_field_definitions_touch before update on field_definitions
  for each row execute function public.touch_updated_at();
create trigger trg_equipment_touch before update on equipment
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- RLS helper functions (SECURITY DEFINER so they can read profiles/
-- user_facilities without recursive-policy issues)
-- ============================================================================

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false);
$$;

create or replace function public.is_pm_or_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('project_manager', 'admin') from profiles where id = auth.uid()), false);
$$;

create or replace function public.has_facility_access(target_facility uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select
    coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
    or exists (
      select 1 from user_facilities uf
      where uf.user_id = auth.uid() and uf.facility_id = target_facility
    );
$$;

create or replace function public.shares_facility_with(target_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_facilities a
    join user_facilities b on a.facility_id = b.facility_id
    where a.user_id = auth.uid() and b.user_id = target_user
  );
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================

alter table profiles enable row level security;
alter table facilities enable row level security;
alter table user_facilities enable row level security;
alter table field_definitions enable row level security;
alter table equipment enable row level security;
alter table edit_requests enable row level security;
alter table spare_settings enable row level security;

-- profiles: see your own row; admins see everyone; PMs see profiles that
-- share a facility with them (so they can label "requested by" in approvals).
create policy "profiles_select" on profiles for select
  using (id = auth.uid() or is_admin() or (is_pm_or_admin() and shares_facility_with(id)));
create policy "profiles_admin_insert" on profiles for insert with check (is_admin());
create policy "profiles_admin_update" on profiles for update using (is_admin()) with check (is_admin());
create policy "profiles_admin_delete" on profiles for delete using (is_admin());

-- facilities: any signed-in user can read the list; only admins manage it.
create policy "facilities_select" on facilities for select using (auth.uid() is not null);
create policy "facilities_admin_insert" on facilities for insert with check (is_admin());
create policy "facilities_admin_update" on facilities for update using (is_admin()) with check (is_admin());
create policy "facilities_admin_delete" on facilities for delete using (is_admin());

-- user_facilities: users can see their own assignments; admins manage all.
create policy "user_facilities_select" on user_facilities for select
  using (user_id = auth.uid() or is_admin());
create policy "user_facilities_admin_insert" on user_facilities for insert with check (is_admin());
create policy "user_facilities_admin_delete" on user_facilities for delete using (is_admin());

-- field_definitions: any signed-in user can read; only admins manage them.
create policy "field_definitions_select" on field_definitions for select using (auth.uid() is not null);
create policy "field_definitions_admin_insert" on field_definitions for insert with check (is_admin());
create policy "field_definitions_admin_update" on field_definitions for update using (is_admin()) with check (is_admin());
create policy "field_definitions_admin_delete" on field_definitions for delete using (is_admin());

-- equipment: readable/insertable ("claim a QR") by anyone with facility
-- access; only PM/admin can update directly; only admin can delete.
create policy "equipment_select" on equipment for select
  using (has_facility_access(facility_id));
create policy "equipment_insert" on equipment for insert
  with check (has_facility_access(facility_id) and created_by = auth.uid());
create policy "equipment_pm_admin_update" on equipment for update
  using (is_pm_or_admin() and has_facility_access(facility_id))
  with check (is_pm_or_admin() and has_facility_access(facility_id));
create policy "equipment_admin_delete" on equipment for delete using (is_admin());

-- edit_requests: engineers/PMs can file requests on equipment they can see
-- and read their own; PM/admin can read all requests for their facilities.
-- Status changes only happen through resolve_edit_request() below — there
-- is deliberately no client-facing UPDATE policy.
create policy "edit_requests_select" on edit_requests for select
  using (
    requested_by = auth.uid()
    or is_admin()
    or (is_pm_or_admin() and exists (
      select 1 from equipment e where e.id = edit_requests.equipment_id and has_facility_access(e.facility_id)
    ))
  );
create policy "edit_requests_insert" on edit_requests for insert
  with check (
    requested_by = auth.uid()
    and exists (
      select 1 from equipment e where e.id = edit_requests.equipment_id and has_facility_access(e.facility_id)
    )
  );

-- spare_settings: any signed-in user can read; only admins write.
create policy "app_settings_select" on spare_settings for select using (auth.uid() is not null);
create policy "app_settings_admin_insert" on spare_settings for insert with check (is_admin());
create policy "app_settings_admin_update" on spare_settings for update using (is_admin()) with check (is_admin());

-- ============================================================================
-- resolve_edit_request: the only way an edit_requests row's status changes.
-- Runs as SECURITY DEFINER so it can atomically flip the request and merge
-- the approved changes into the equipment row in one transaction.
-- ============================================================================

create or replace function public.resolve_edit_request(
  request_id uuid,
  approve boolean,
  note text default null
) returns edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req edit_requests;
  eq equipment;
begin
  if not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve edit requests';
  end if;

  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Edit request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This edit request was already resolved';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;

  update edit_requests set
    status = case when approve then 'approved'::request_status else 'rejected'::request_status end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = note
  where id = request_id
  returning * into req;

  if approve then
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
  end if;

  return req;
end;
$$;

grant execute on function public.resolve_edit_request(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Spare 0002_grants.sql
-- ─────────────────────────────────────────────────────────────
-- Blue Star: explicit table/function grants for the `authenticated` role.
-- This project's default privileges didn't extend to the tables created in
-- 0001_init.sql, so PostgREST was returning "permission denied" even though
-- RLS policies were in place. RLS still does the per-row filtering on top
-- of these — this just gives the role permission to attempt the query.
--
-- edit_requests deliberately has no UPDATE/DELETE grant here: the only
-- sanctioned way to change its status is resolve_edit_request(), which runs
-- SECURITY DEFINER and doesn't need the caller's own table grants.

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.facilities to authenticated;
grant select, insert, delete on public.user_facilities to authenticated;
grant select, insert, update, delete on public.field_definitions to authenticated;
grant select, insert, update, delete on public.equipment to authenticated;
grant select, insert on public.edit_requests to authenticated;
grant select, insert, update on public.spare_settings to authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_pm_or_admin() to authenticated;
grant execute on function public.has_facility_access(uuid) to authenticated;
grant execute on function public.shares_facility_with(uuid) to authenticated;
grant execute on function public.resolve_edit_request(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Spare 0003_image_fields_and_reporting.sql
-- ─────────────────────────────────────────────────────────────
-- Adds an 'image' custom field type (admin-configurable max count per
-- field) and an engineer -> project manager reporting relationship that
-- edit_requests visibility now also routes through.

alter type field_type add value if not exists 'image';

alter table field_definitions add column if not exists image_max_count integer;

alter table profiles add column if not exists reports_to uuid references profiles(id);

create index if not exists profiles_reports_to_idx on profiles(reports_to);

drop policy if exists "edit_requests_select" on edit_requests;
create policy "edit_requests_select" on edit_requests for select
  using (
    requested_by = auth.uid()
    or is_admin()
    or (is_pm_or_admin() and exists (
      select 1 from equipment e where e.id = edit_requests.equipment_id and has_facility_access(e.facility_id)
    ))
    or exists (
      select 1 from profiles p where p.id = edit_requests.requested_by and p.reports_to = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────
-- Spare 0004_service_role_grants.sql
-- ─────────────────────────────────────────────────────────────
-- This project's default privileges never extended to `service_role`
-- either (same root cause as 0002_grants.sql, discovered when
-- admin-create-user started failing with "permission denied for table
-- profiles" for the service_role client). service_role is meant to bypass
-- RLS entirely for trusted server-side use (our Edge Functions) — it
-- should always have full access, so this grant is intentionally broad,
-- unlike the narrowly-scoped `authenticated` grants in 0002.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Also set default privileges so *future* tables/functions don't need a
-- follow-up migration just to be reachable at all.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Spare 0005_facility_district_gps.sql
-- ─────────────────────────────────────────────────────────────
-- District (admin level between city and state, common in India) and
-- GPS coordinates for facilities, captured via the browser's geolocation
-- API + reverse-geocoded to an address rather than typed by hand.

alter table facilities add column if not exists district text;
alter table facilities add column if not exists latitude double precision;
alter table facilities add column if not exists longitude double precision;

-- ─────────────────────────────────────────────────────────────
-- Spare 0006_equipment_history.sql
-- ─────────────────────────────────────────────────────────────
-- Equipment change history: every "created" (tagged) and "updated" event is
-- logged here, so the detail page can show a full log of who mapped/edited
-- an item and when -- the equipment row itself only ever holds the LATEST
-- updated_by/updated_at, which loses everything before the most recent edit.

create table equipment_history (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  action text not null check (action in ('created', 'updated')),
  changes jsonb not null default '{}',
  performed_by uuid references profiles(id),
  performed_at timestamptz not null default now()
);

create index equipment_history_equipment_idx on equipment_history(equipment_id, performed_at);

alter table equipment_history enable row level security;

-- Readable by anyone who can read the equipment row itself. This subquery
-- against `equipment` still goes through equipment's own RLS policy for the
-- current caller, so it isn't a bypass -- just piggybacking on it.
create policy "equipment_history_select" on equipment_history for select
  using (exists (select 1 from equipment e where e.id = equipment_history.equipment_id));

-- Insertable when recording your own action on equipment you can access
-- (covers the client-side inserts from tagging a new item or editing one
-- directly). The resolve_edit_request() RPC below runs SECURITY DEFINER and
-- doesn't need this policy.
create policy "equipment_history_insert" on equipment_history for insert
  with check (
    performed_by = auth.uid()
    and exists (
      select 1 from equipment e where e.id = equipment_history.equipment_id and has_facility_access(e.facility_id)
    )
  );

-- Explicit grants (this project's default privileges have twice needed a
-- follow-up migration to actually reach a new table -- see 0002 and 0004 --
-- so these are spelled out directly rather than trusted to be inherited).
grant select, insert on public.equipment_history to authenticated;
grant all on public.equipment_history to service_role;

-- Log every approval of an edit request as an 'updated' event, attributed to
-- the engineer who requested the change (the reviewer is already recorded
-- separately on the edit_requests row itself via reviewed_by).
create or replace function public.resolve_edit_request(
  request_id uuid,
  approve boolean,
  note text default null
) returns edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req edit_requests;
  eq equipment;
begin
  if not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve edit requests';
  end if;

  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Edit request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This edit request was already resolved';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;

  update edit_requests set
    status = case when approve then 'approved'::request_status else 'rejected'::request_status end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = note
  where id = request_id
  returning * into req;

  if approve then
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

    insert into equipment_history (equipment_id, action, changes, performed_by)
    values (req.equipment_id, 'updated', req.proposed_changes, req.requested_by);
  end if;

  return req;
end;
$$;

grant execute on function public.resolve_edit_request(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Spare 0007_facility_field_geo.sql
-- ─────────────────────────────────────────────────────────────
-- Lets a field engineer add a facility that doesn't exist yet instead of
-- waiting on an admin, and lets a facility's GPS location be captured by
-- whoever tags the first piece of equipment there when it doesn't already
-- have one (covers both facilities added from the field and ones that came
-- in via bulk upload without coordinates). Also records where an engineer
-- actually was when they tagged each item, so it can be compared against
-- the facility's own location later.

drop policy if exists "facilities_admin_insert" on facilities;
create policy "facilities_insert" on facilities for insert
  with check (auth.uid() is not null and created_by = auth.uid());

-- A facility's location can be filled in exactly once by anyone with access
-- to it, but only while it's still unset -- this lets the first tag at a
-- GPS-less facility establish its location, without letting non-admins
-- overwrite an address an admin already set. Full editing of an existing
-- facility (any field, any time) stays admin-only via facilities_admin_update.
create policy "facilities_fill_missing_location" on facilities for update
  using (has_facility_access(id) and latitude is null and longitude is null)
  with check (has_facility_access(id));

alter table equipment add column if not exists tag_latitude double precision;
alter table equipment add column if not exists tag_longitude double precision;

-- ─────────────────────────────────────────────────────────────
-- Spare 0008_self_facility_assignment.sql
-- ─────────────────────────────────────────────────────────────
-- When an engineer adds a facility from the field (see 0007), they need to
-- keep access to it themselves afterwards -- otherwise it vanishes from
-- their own facility picker the moment they reload. Admin still has to
-- explicitly assign it to any other engineer, same as any other facility.

create policy "user_facilities_self_insert" on user_facilities for insert
  with check (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Spare 0009_history_and_request_location.sql
-- ─────────────────────────────────────────────────────────────
-- Extends GPS capture from "only at the original tag" to every edit too --
-- both a direct PM/admin edit and an engineer's edit request carry the
-- submitter's position through to the history log, so the distance-from-
-- facility badge isn't limited to the very first tag.

alter table equipment_history add column if not exists latitude double precision;
alter table equipment_history add column if not exists longitude double precision;

alter table edit_requests add column if not exists latitude double precision;
alter table edit_requests add column if not exists longitude double precision;

create or replace function public.resolve_edit_request(
  request_id uuid,
  approve boolean,
  note text default null
) returns edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req edit_requests;
  eq equipment;
begin
  if not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve edit requests';
  end if;

  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Edit request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This edit request was already resolved';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;

  update edit_requests set
    status = case when approve then 'approved'::request_status else 'rejected'::request_status end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = note
  where id = request_id
  returning * into req;

  if approve then
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

    insert into equipment_history (equipment_id, action, changes, performed_by, latitude, longitude)
    values (req.equipment_id, 'updated', req.proposed_changes, req.requested_by, req.latitude, req.longitude);
  end if;

  return req;
end;
$$;

grant execute on function public.resolve_edit_request(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Spare 0010_barcode_field_type.sql
-- ─────────────────────────────────────────────────────────────
-- New custom-field type for values that are themselves scanned off a
-- physical barcode/QR sticker already on the equipment (e.g. a manufacturer
-- serial number) -- distinct from the QR code the app uses to identify the
-- equipment record itself. Rendered as a text input with a scan button, so
-- it always has a manual-entry fallback.

alter type field_type add value if not exists 'barcode';

-- ─────────────────────────────────────────────────────────────
-- Spare 0011_item_masters.sql
-- ─────────────────────────────────────────────────────────────
-- Item masters for the spare-mapping workflow.
--
-- Two separate catalogues exist for the same physical spares:
--   * bpl_item_master  -- BPL's own catalogue. Their barcode is already
--                         printed/stuck on the spare in the warehouse, so
--                         scanning it is how we identify their item.
--   * cyrix_item_master -- Cyrix's own catalogue for the same parts, whose
--                         naming differs (e.g. "abc" vs "ab -c").
--
-- bpl_item_master carries the resolved Cyrix mapping inline: cyrix_item_code
-- is the stable link, cyrix_item_name is kept alongside it so lists and
-- suggestions can render without a join (and so the mapping still reads
-- correctly if the Cyrix catalogue is later re-uploaded with a new name).
-- Both are null until someone confirms the match.

create table cyrix_item_master (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cyrix_item_master_name_idx on cyrix_item_master(lower(item_name));

create table bpl_item_master (
  id uuid primary key default gen_random_uuid(),
  item_code text not null unique,
  item_name text not null,
  barcode text,
  cyrix_item_code text,
  cyrix_item_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Barcode is how a scan finds the row, so it needs to be fast to look up.
-- Deliberately NOT unique: master files in the wild routinely repeat or omit
-- barcodes, and a single bad value shouldn't reject an entire upload.
create index bpl_item_master_barcode_idx on bpl_item_master(barcode);
create index bpl_item_master_name_idx on bpl_item_master(lower(item_name));
create index bpl_item_master_cyrix_code_idx on bpl_item_master(cyrix_item_code);

create trigger trg_cyrix_item_master_touch before update on cyrix_item_master
  for each row execute function public.touch_updated_at();
create trigger trg_bpl_item_master_touch before update on bpl_item_master
  for each row execute function public.touch_updated_at();

alter table cyrix_item_master enable row level security;
alter table bpl_item_master enable row level security;

-- Any signed-in user can read both catalogues -- engineers need to look items
-- up while tagging. Only admins maintain them.
create policy "cyrix_item_master_select" on cyrix_item_master for select using (auth.uid() is not null);
create policy "cyrix_item_master_admin_insert" on cyrix_item_master for insert with check (is_admin());
create policy "cyrix_item_master_admin_update" on cyrix_item_master for update using (is_admin()) with check (is_admin());
create policy "cyrix_item_master_admin_delete" on cyrix_item_master for delete using (is_admin());

create policy "bpl_item_master_select" on bpl_item_master for select using (auth.uid() is not null);
create policy "bpl_item_master_admin_insert" on bpl_item_master for insert with check (is_admin());
create policy "bpl_item_master_admin_delete" on bpl_item_master for delete using (is_admin());

-- Any signed-in user may set the Cyrix mapping on a BPL row (that's the
-- tagger confirming a suggested match); everything else stays admin-only.
create policy "bpl_item_master_admin_update" on bpl_item_master for update
  using (is_admin()) with check (is_admin());
create policy "bpl_item_master_map_update" on bpl_item_master for update
  using (auth.uid() is not null) with check (auth.uid() is not null);

-- Explicit grants: this project's default privileges have twice failed to
-- reach a new table on their own (see 0002 and 0004), so they're spelled out
-- rather than assumed.
grant select, insert, update, delete on public.cyrix_item_master to authenticated;
grant select, insert, update, delete on public.bpl_item_master to authenticated;
grant all on public.cyrix_item_master to service_role;
grant all on public.bpl_item_master to service_role;

-- ─────────────────────────────────────────────────────────────
-- Spare 0012_item_name_normalized.sql
-- ─────────────────────────────────────────────────────────────
-- Matching BPL names to Cyrix names has to ignore punctuation and spacing:
-- "abc" and "ab -c" are the same part. A plain ILIKE can't see that, so both
-- catalogues get a stored, indexed column holding the name reduced to bare
-- alphanumerics -- that's what candidate lookup actually searches against.
--
-- Generated (not trigger-maintained) so it can never drift from item_name,
-- including on bulk upserts. regexp_replace and lower are both immutable,
-- which is what lets a generated column use them.

alter table cyrix_item_master
  add column name_normalized text
  generated always as (regexp_replace(lower(item_name), '[^a-z0-9]+', '', 'g')) stored;

alter table bpl_item_master
  add column name_normalized text
  generated always as (regexp_replace(lower(item_name), '[^a-z0-9]+', '', 'g')) stored;

create index cyrix_item_master_norm_idx on cyrix_item_master(name_normalized);
create index bpl_item_master_norm_idx on bpl_item_master(name_normalized);

-- ─────────────────────────────────────────────────────────────
-- Spare 0013_cyrix_item_columns.sql
-- ─────────────────────────────────────────────────────────────
-- The real Cyrix item master carries more than code+name. These are columns
-- C..I of the source workbook (A and B are already item_code / item_name):
--
--   C In Stock              D Item Cost             E Additional Identifier
--   F Item Group            G Parent Equip          H Make
--   I Model
--
-- E..I are only 58-67% populated in the source file, so all are nullable.
-- "Additional Identifier" often holds a manufacturer/vendor part number,
-- which makes it a useful secondary key when matching against BPL's
-- catalogue -- hence the index.

alter table cyrix_item_master
  add column if not exists in_stock numeric,
  add column if not exists item_cost numeric,
  add column if not exists additional_identifier text,
  add column if not exists item_group text,
  add column if not exists parent_equipment text,
  add column if not exists make text,
  add column if not exists model text;

create index if not exists cyrix_item_master_addl_id_idx on cyrix_item_master(additional_identifier);
create index if not exists cyrix_item_master_group_idx on cyrix_item_master(item_group);

-- ─────────────────────────────────────────────────────────────
-- Spare 0014_rename_bpl_to_bluestar.sql
-- ─────────────────────────────────────────────────────────────
-- The client is Blue Star, not "BPL" -- that was a misnomer carried through
-- from the initial description. Renaming rather than leaving it: the table is
-- still empty, so this is the last cheap moment to correct it, and a
-- mis-named core table would mislead every future reader.
--
-- Policies and foreign keys follow a renamed table automatically; indexes
-- keep working under their old names but are renamed here so nothing is left
-- referring to the wrong company.

alter table bpl_item_master rename to bluestar_item_master;

alter index bpl_item_master_barcode_idx rename to bluestar_item_master_barcode_idx;
alter index bpl_item_master_name_idx rename to bluestar_item_master_name_idx;
alter index bpl_item_master_cyrix_code_idx rename to bluestar_item_master_cyrix_code_idx;
alter index bpl_item_master_norm_idx rename to bluestar_item_master_norm_idx;

alter policy "bpl_item_master_select" on bluestar_item_master rename to "bluestar_item_master_select";
alter policy "bpl_item_master_admin_insert" on bluestar_item_master rename to "bluestar_item_master_admin_insert";
alter policy "bpl_item_master_admin_update" on bluestar_item_master rename to "bluestar_item_master_admin_update";
alter policy "bpl_item_master_admin_delete" on bluestar_item_master rename to "bluestar_item_master_admin_delete";
alter policy "bpl_item_master_map_update" on bluestar_item_master rename to "bluestar_item_master_map_update";

-- Grants carry over with the rename, but restate them so a fresh apply of
-- these migrations ends in the same place regardless of ordering.
grant select, insert, update, delete on public.bluestar_item_master to authenticated;
grant all on public.bluestar_item_master to service_role;

-- ─────────────────────────────────────────────────────────────
-- Spare 0015_mapping_history.sql
-- ─────────────────────────────────────────────────────────────
-- Engineers and managers can re-point a Blue Star item at a different Cyrix
-- item, so every change needs an audit trail: who changed it, when, and what
-- it was before.
--
-- The mapping is therefore only writable through set_cyrix_mapping() below,
-- which records the history row and applies the change in one transaction.
-- The previous blanket "any signed-in user may update this table" policy is
-- dropped: it let a non-admin edit item_name or barcode too, and allowed the
-- mapping to change without leaving a trace.

create table bluestar_item_mapping_history (
  id uuid primary key default gen_random_uuid(),
  bluestar_item_id uuid not null references bluestar_item_master(id) on delete cascade,
  -- Snapshotted so the log still reads correctly if the item's barcode or
  -- name is later corrected in a re-uploaded master file.
  barcode text,
  bluestar_item_code text,
  from_cyrix_item_code text,
  from_cyrix_item_name text,
  to_cyrix_item_code text,
  to_cyrix_item_name text,
  performed_by uuid references profiles(id),
  performed_at timestamptz not null default now()
);

create index bluestar_item_mapping_history_item_idx
  on bluestar_item_mapping_history(bluestar_item_id, performed_at desc);
create index bluestar_item_mapping_history_barcode_idx
  on bluestar_item_mapping_history(barcode);

alter table bluestar_item_mapping_history enable row level security;

create policy "bluestar_item_mapping_history_select" on bluestar_item_mapping_history
  for select using (auth.uid() is not null);

grant select on public.bluestar_item_mapping_history to authenticated;
grant all on public.bluestar_item_mapping_history to service_role;

-- Only admins may edit the catalogue directly now; everyone else changes the
-- mapping through the function.
drop policy if exists "bluestar_item_master_map_update" on bluestar_item_master;

create or replace function public.set_cyrix_mapping(item_id uuid, new_cyrix_code text)
returns bluestar_item_master
language plpgsql
security definer
set search_path = public
as $$
declare
  cur bluestar_item_master;
  cyx cyrix_item_master;
  new_name text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into cur from bluestar_item_master where id = item_id for update;
  if cur is null then
    raise exception 'Blue Star item not found';
  end if;

  if new_cyrix_code is not null then
    select * into cyx from cyrix_item_master where item_code = new_cyrix_code;
    if cyx is null then
      raise exception 'Cyrix item % not found', new_cyrix_code;
    end if;
    new_name := cyx.item_name;
  end if;

  -- Nothing actually changed -- don't write a history row for a no-op.
  if cur.cyrix_item_code is not distinct from new_cyrix_code then
    return cur;
  end if;

  insert into bluestar_item_mapping_history (
    bluestar_item_id, barcode, bluestar_item_code,
    from_cyrix_item_code, from_cyrix_item_name,
    to_cyrix_item_code, to_cyrix_item_name, performed_by
  ) values (
    cur.id, cur.barcode, cur.item_code,
    cur.cyrix_item_code, cur.cyrix_item_name,
    new_cyrix_code, new_name, auth.uid()
  );

  update bluestar_item_master
  set cyrix_item_code = new_cyrix_code,
      cyrix_item_name = new_name
  where id = item_id
  returning * into cur;

  return cur;
end;
$$;

grant execute on function public.set_cyrix_mapping(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Spare 0016_history_clock_timestamp.sql
-- ─────────────────────────────────────────────────────────────
-- now() is the transaction start time, so two mapping changes made inside one
-- transaction get byte-identical timestamps and the history then sorts
-- arbitrarily between them. clock_timestamp() reads the actual wall clock at
-- insert, keeping the order stable no matter how the writes are batched.
--
-- Applied to the equipment history too, for the same reason.

alter table bluestar_item_mapping_history
  alter column performed_at set default clock_timestamp();

alter table equipment_history
  alter column performed_at set default clock_timestamp();

-- ─────────────────────────────────────────────────────────────
-- Spare 0017_history_approver.sql
-- ─────────────────────────────────────────────────────────────
-- An approved edit produced a history row attributed to the engineer who
-- requested it, with no record of who approved it -- so the log couldn't
-- answer "who signed this off". The approver is now recorded alongside the
-- requester, which is the whole point of the approval step.

alter table equipment_history add column if not exists approved_by uuid references profiles(id);

create or replace function public.resolve_edit_request(
  request_id uuid,
  approve boolean,
  note text default null
) returns edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req edit_requests;
  eq equipment;
begin
  if not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve edit requests';
  end if;

  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Edit request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This edit request was already resolved';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;

  update edit_requests set
    status = case when approve then 'approved'::request_status else 'rejected'::request_status end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = note
  where id = request_id
  returning * into req;

  if approve then
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

    -- performed_by stays the requester (they made the change); approved_by
    -- records the reviewer who let it through.
    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by, latitude, longitude)
    values (req.equipment_id, 'updated', req.proposed_changes, req.requested_by, auth.uid(), req.latitude, req.longitude);
  end if;

  return req;
end;
$$;

grant execute on function public.resolve_edit_request(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Spare 0018_tagged_bluestar_items.sql
-- ─────────────────────────────────────────────────────────────
-- Tagging a spare *is* recording one of Blue Star's items in a warehouse, but
-- until now a tag only ever wrote to `equipment`. The Blue Star catalogue
-- stayed empty however many spares had been tagged against it, and a Cyrix
-- link made while tagging had nowhere to live -- the mapping columns sit on
-- bluestar_item_master, and no row existed to carry them.
--
-- So every tagged spare now creates (or joins) a Blue Star item, and the
-- equipment row points at it. That keeps the Cyrix mapping in exactly one
-- place no matter where it was set -- the tag form or the admin catalogue --
-- and routes both through the same history-writing path.

alter table bluestar_item_master
  add column if not exists origin text not null default 'upload';

-- Separates rows that came from Blue Star's own master file from rows this
-- app created while tagging: the two are maintained differently (see the
-- name rule in upsert_tagged_bluestar_item below).
alter table bluestar_item_master
  drop constraint if exists bluestar_item_master_origin_check;
alter table bluestar_item_master
  add constraint bluestar_item_master_origin_check check (origin in ('upload', 'tagged'));

alter table equipment
  add column if not exists bluestar_item_id uuid references bluestar_item_master(id) on delete set null;

create index if not exists equipment_bluestar_item_idx on equipment(bluestar_item_id);

-- Engineers may not insert into the catalogue directly (that stays admin-only,
-- migration 0011), so tagging goes through this definer function instead. It
-- is deliberately the *only* way a tag reaches the catalogue.
create or replace function public.upsert_tagged_bluestar_item(
  p_item_code text,
  p_item_name text,
  p_barcode text,
  p_cyrix_code text
)
returns bluestar_item_master
language plpgsql
security definer
set search_path = public
as $$
declare
  rec bluestar_item_master;
  code  text := nullif(btrim(p_item_code), '');
  bcode text := nullif(btrim(p_barcode), '');
  nm    text := nullif(btrim(p_item_name), '');
  cyx   text := nullif(btrim(p_cyrix_code), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if code is null then
    raise exception 'A Blue Star item code is required';
  end if;

  -- The barcode Blue Star printed on the spare is the strongest identifier we
  -- have, so an existing catalogue row is matched on that first; the code is
  -- only used when there's no barcode to go on. Barcodes are deliberately not
  -- unique (0011), hence the ordered limit rather than a bare select-into.
  if bcode is not null then
    select * into rec from bluestar_item_master
    where barcode = bcode order by created_at limit 1;
  end if;

  if rec.id is null then
    select * into rec from bluestar_item_master where item_code = code;
  end if;

  if rec.id is null then
    insert into bluestar_item_master (item_code, item_name, barcode, origin)
    values (code, coalesce(nm, code), bcode, 'tagged')
    returning * into rec;
  else
    -- A row that came from Blue Star's master file keeps Blue Star's name --
    -- that file is their record, not ours to overwrite from a tag. Rows this
    -- app created by tagging are ours, so they track what the tagger typed.
    update bluestar_item_master
    set item_name = case when rec.origin = 'tagged' and nm is not null then nm else item_name end,
        barcode   = coalesce(bcode, barcode)
    where id = rec.id
    returning * into rec;
  end if;

  -- Routed through set_cyrix_mapping so the change lands in the mapping
  -- history like any other re-map. Clearing is not done here: an empty
  -- selection on the tag form means "not decided yet", not "unlink".
  if cyx is not null and rec.cyrix_item_code is distinct from cyx then
    rec := set_cyrix_mapping(rec.id, cyx);
  end if;

  return rec;
end;
$$;

grant execute on function public.upsert_tagged_bluestar_item(text, text, text, text) to authenticated;

-- Backfill: spares tagged before this migration never reached the catalogue,
-- which is exactly the gap this fixes. The name and Blue Star code live in
-- admin-defined custom fields, so their keys are read from field_definitions
-- rather than hardcoded.
do $$
declare
  name_key text;
  code_key text;
  eq record;
  code  text;
  nm    text;
  bcode text;
  found_id uuid;
begin
  select field_key into code_key from field_definitions
   where field_type = 'barcode' and active order by display_order limit 1;

  select field_key into name_key from field_definitions
   where active and field_type not in ('image', 'barcode')
     and (label ilike '%name%' or label ilike '%description%' or label ilike '%spare%')
   order by display_order limit 1;

  for eq in select * from equipment where bluestar_item_id is null loop
    found_id := null;
    bcode := nullif(btrim(coalesce(eq.custom_fields ->> code_key, '')), '');
    nm    := nullif(btrim(coalesce(eq.custom_fields ->> name_key, '')), '');
    code  := coalesce(bcode, eq.qr_value);

    if bcode is not null then
      select id into found_id from bluestar_item_master where barcode = bcode order by created_at limit 1;
    end if;
    if found_id is null then
      select id into found_id from bluestar_item_master where item_code = code;
    end if;
    if found_id is null then
      insert into bluestar_item_master (item_code, item_name, barcode, origin)
      values (code, coalesce(nm, code), bcode, 'tagged')
      returning id into found_id;
    end if;

    update equipment set bluestar_item_id = found_id where id = eq.id;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────
-- Spare 0019_sync_bluestar_from_equipment.sql
-- ─────────────────────────────────────────────────────────────
-- Keeps a tagged spare's Blue Star catalogue row in step with the spare
-- itself. Editing a spare has to show up in the Blue Star item list, and
-- there is more than one way to edit one: a manager or admin saving directly,
-- and an engineer's request being approved (which writes through
-- resolve_edit_request, not through the app). A trigger on `equipment` covers
-- every one of those paths at once rather than each caller remembering to.
--
-- Only rows this app created by tagging (origin = 'tagged') are touched.
-- Rows that came from Blue Star's own master file are their record, and a
-- tagger's wording must not overwrite it.

create or replace function public.sync_bluestar_item_from_equipment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  name_key text;
  code_key text;
  nm    text;
  bcode text;
begin
  if new.bluestar_item_id is null then
    return new;
  end if;

  -- The spare's name and Blue Star code live in admin-defined custom fields,
  -- so which keys those are has to be looked up rather than hardcoded.
  select field_key into code_key from field_definitions
   where field_type = 'barcode' and active order by display_order limit 1;

  select field_key into name_key from field_definitions
   where active and field_type not in ('image', 'barcode')
     and (label ilike '%name%' or label ilike '%description%' or label ilike '%spare%')
   order by display_order limit 1;

  nm    := nullif(btrim(coalesce(new.custom_fields ->> name_key, '')), '');
  bcode := nullif(btrim(coalesce(new.custom_fields ->> code_key, '')), '');

  update bluestar_item_master
  set item_name = coalesce(nm, item_name),
      barcode   = coalesce(bcode, barcode)
  where id = new.bluestar_item_id
    and origin = 'tagged'
    and (item_name is distinct from coalesce(nm, item_name)
         or barcode is distinct from coalesce(bcode, barcode));

  return new;
end;
$$;

drop trigger if exists trg_equipment_sync_bluestar on equipment;
create trigger trg_equipment_sync_bluestar
  after insert or update of custom_fields, bluestar_item_id on equipment
  for each row execute function public.sync_bluestar_item_from_equipment();

-- ─────────────────────────────────────────────────────────────
-- Spare 0020_drop_location_columns.sql
-- ─────────────────────────────────────────────────────────────
-- Drops every location column. The app no longer captures, reads or displays
-- where anything is, so these are dead weight that still reads as tracking.
--
-- resolve_edit_request has to be rewritten first: it copies a request's
-- coordinates onto the history row it writes. PL/pgSQL bodies aren't tracked
-- as dependencies, so dropping the columns underneath it would not fail here
-- -- it would fail later, the next time a manager approved an edit.

create or replace function public.resolve_edit_request(request_id uuid, approve boolean, note text default null)
returns edit_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  req edit_requests;
  eq equipment;
begin
  if not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve edit requests';
  end if;

  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Edit request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This edit request was already resolved';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;

  update edit_requests set
    status = case when approve then 'approved'::request_status else 'rejected'::request_status end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = note
  where id = request_id
  returning * into req;

  if approve then
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

    -- performed_by stays the requester (they made the change); approved_by
    -- records the reviewer who let it through.
    insert into equipment_history (equipment_id, action, changes, performed_by, approved_by)
    values (req.equipment_id, 'updated', req.proposed_changes, req.requested_by, auth.uid());
  end if;

  return req;
end;
$$;

-- Dropped explicitly rather than by CASCADE, so what goes is on the record.
-- This policy (0007) let any assigned engineer write a warehouse's latitude
-- and longitude while both were still null -- the "first engineer to arrive
-- sets the location" rule. With no location to set it would only widen what
-- a non-admin can update, so it goes with the columns.
drop policy if exists "facilities_fill_missing_location" on facilities;

alter table facilities        drop column if exists address;
alter table facilities        drop column if exists latitude;
alter table facilities        drop column if exists longitude;
alter table equipment         drop column if exists tag_latitude;
alter table equipment         drop column if exists tag_longitude;
alter table equipment_history drop column if exists latitude;
alter table equipment_history drop column if exists longitude;
alter table edit_requests     drop column if exists latitude;
alter table edit_requests     drop column if exists longitude;

-- ─────────────────────────────────────────────────────────────
-- Spare 0021_clear_cyrix_mapping.sql
-- ─────────────────────────────────────────────────────────────
-- Unlinking a Cyrix item is now something a tagger can actually ask for
-- (a "Remove" button next to "Change"), so the upsert has to be able to tell
-- "leave the mapping alone" from "clear it".
--
-- Those were the same value before -- a null p_cyrix_code -- and the function
-- deliberately treated it as "leave alone", because on a fresh tag an empty
-- selection means the tagger hasn't chosen yet, not that they want the
-- catalogue row unlinked. An explicit flag keeps that safe default while
-- letting a deliberate removal through.

create or replace function public.upsert_tagged_bluestar_item(
  p_item_code text,
  p_item_name text,
  p_barcode text,
  p_cyrix_code text,
  p_clear_cyrix boolean default false
)
returns bluestar_item_master
language plpgsql
security definer
set search_path = public
as $$
declare
  rec bluestar_item_master;
  code  text := nullif(btrim(p_item_code), '');
  bcode text := nullif(btrim(p_barcode), '');
  nm    text := nullif(btrim(p_item_name), '');
  cyx   text := nullif(btrim(p_cyrix_code), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if code is null then
    raise exception 'A Blue Star item code is required';
  end if;

  -- The barcode Blue Star printed on the spare is the strongest identifier we
  -- have, so an existing catalogue row is matched on that first; the code is
  -- only used when there's no barcode to go on. Barcodes are deliberately not
  -- unique (0011), hence the ordered limit rather than a bare select-into.
  if bcode is not null then
    select * into rec from bluestar_item_master
    where barcode = bcode order by created_at limit 1;
  end if;

  if rec.id is null then
    select * into rec from bluestar_item_master where item_code = code;
  end if;

  if rec.id is null then
    insert into bluestar_item_master (item_code, item_name, barcode, origin)
    values (code, coalesce(nm, code), bcode, 'tagged')
    returning * into rec;
  else
    -- A row that came from Blue Star's master file keeps Blue Star's name --
    -- that file is their record, not ours to overwrite from a tag. Rows this
    -- app created by tagging are ours, so they track what the tagger typed.
    update bluestar_item_master
    set item_name = case when rec.origin = 'tagged' and nm is not null then nm else item_name end,
        barcode   = coalesce(bcode, barcode)
    where id = rec.id
    returning * into rec;
  end if;

  -- Both branches route through set_cyrix_mapping so the change lands in the
  -- mapping history like any other re-map -- an unlink is just as much a
  -- change of mapping as a swap, and reads that way in the log.
  if p_clear_cyrix then
    if rec.cyrix_item_code is not null then
      rec := set_cyrix_mapping(rec.id, null);
    end if;
  elsif cyx is not null and rec.cyrix_item_code is distinct from cyx then
    rec := set_cyrix_mapping(rec.id, cyx);
  end if;

  return rec;
end;
$$;

grant execute on function public.upsert_tagged_bluestar_item(text, text, text, text, boolean) to authenticated;

-- The four-argument version is now unreachable from the app; dropping it
-- keeps PostgREST from having two overloads to disambiguate between.
drop function if exists public.upsert_tagged_bluestar_item(text, text, text, text);

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0022_catalogue_is_reference_data.sql
-- ─────────────────────────────────────────────────────────────
-- Corrects a wrong model. Tagging was creating rows in bluestar_item_master,
-- one per QR, using the QR value as the item code. That is backwards.
--
-- Both catalogues are reference data. They change when an admin uploads a new
-- master file and at no other time. A Blue Star item is a *part* -- "Spare X,
-- quantity 4" -- and the four physical units each get their own Cyrix QR
-- sticker. Tagging records a QR against an existing catalogue item; it never
-- invents one. Four tags against one item is the normal case, not four items.
--
-- What tagging may still change is the Blue Star -> Cyrix mapping, which is
-- the whole point of the exercise and stays audited through set_cyrix_mapping.

-- How many units Blue Star's master file says there are. Nullable: a file
-- without the column still imports, and progress simply can't be computed for
-- those rows rather than being computed wrongly.
alter table bluestar_item_master add column if not exists quantity integer;

-- The trigger pushed a spare's edits back into the catalogue. Reference data
-- does not follow the things that reference it.
drop trigger if exists trg_equipment_sync_bluestar on equipment;
drop function if exists public.sync_bluestar_item_from_equipment();

-- The function that created catalogue rows from tags, in both its shapes.
drop function if exists public.upsert_tagged_bluestar_item(text, text, text, text, boolean);
drop function if exists public.upsert_tagged_bluestar_item(text, text, text, text);

-- Remove what that design left behind. Every one of these rows is an
-- artefact: its item_code is a QR value, not a Blue Star code. Deleting them
-- sets equipment.bluestar_item_id to null (0018 declares on delete set null),
-- so the tagged spares survive and simply show as not yet matched to a
-- catalogue item -- which is the truth until the real master file is loaded.
delete from bluestar_item_mapping_history
 where bluestar_item_id in (select id from bluestar_item_master where origin = 'tagged');
delete from bluestar_item_master where origin = 'tagged';

alter table bluestar_item_master drop constraint if exists bluestar_item_master_origin_check;
alter table bluestar_item_master drop column if exists origin;

-- Tagging progress has to be counted across every warehouse, but equipment
-- rows are readable only for the warehouses you are assigned to
-- (equipment_select uses has_facility_access). Counting in the browser would
-- therefore report "1 of 4" to one person and "3 of 4" to another. This
-- returns counts only -- no spare, no warehouse, nothing about who tagged
-- what -- so the number means the same thing to everybody.
create or replace function public.bluestar_tag_counts(item_ids uuid[])
returns table (bluestar_item_id uuid, tagged_count bigint)
language sql
security definer
set search_path = public
as $$
  select e.bluestar_item_id, count(*)::bigint
  from equipment e
  where auth.uid() is not null
    and e.bluestar_item_id = any(item_ids)
  group by e.bluestar_item_id
$$;

grant execute on function public.bluestar_tag_counts(uuid[]) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0023_mapping_per_tag.sql
-- ─────────────────────────────────────────────────────────────
-- The Blue Star -> Cyrix mapping moves onto the tag.
--
-- It lived on the catalogue row, so all four units of a four-quantity part
-- shared one Cyrix code. A second engineer choosing differently overwrote
-- what the first engineer's units showed, and two units simply could not
-- differ -- the disagreement had nowhere to exist. Now each QR keeps the
-- Cyrix item chosen for it, and the catalogue row reports what its units add
-- up to instead of dictating it.

alter table equipment add column if not exists cyrix_item_code text;
alter table equipment add column if not exists cyrix_item_name text;
create index if not exists equipment_cyrix_code_idx on equipment(cyrix_item_code);

-- Carry across whatever the catalogue currently says, so no tag loses the
-- mapping it was showing a moment ago.
update equipment e
set cyrix_item_code = b.cyrix_item_code,
    cyrix_item_name = b.cyrix_item_name
from bluestar_item_master b
where e.bluestar_item_id = b.id
  and e.cyrix_item_code is null
  and b.cyrix_item_code is not null;

-- History can now say which unit was re-mapped, not just which part.
alter table bluestar_item_mapping_history
  add column if not exists equipment_id uuid references equipment(id) on delete set null;
create index if not exists bluestar_item_mapping_history_equipment_idx
  on bluestar_item_mapping_history(equipment_id);

-- Changing a tag's mapping, audited the same way a catalogue re-map is.
-- Definer because the history table is insert-protected: it must only ever be
-- written by the functions that also apply the change.
create or replace function public.set_tag_cyrix_mapping(p_equipment_id uuid, p_cyrix_code text)
returns equipment
language plpgsql
security definer
set search_path = public
as $$
declare
  eq equipment;
  cyx cyrix_item_master;
  new_name text;
  code text := nullif(btrim(p_cyrix_code), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into eq from equipment where id = p_equipment_id for update;
  if eq is null then
    raise exception 'Spare not found';
  end if;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this warehouse';
  end if;

  if code is not null then
    select * into cyx from cyrix_item_master where item_code = code;
    if cyx is null then
      raise exception 'Cyrix item % not found', code;
    end if;
    new_name := cyx.item_name;
  end if;

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
         code, new_name, auth.uid()
  from bluestar_item_master b where b.id = eq.bluestar_item_id
  union all
  -- An unlinked tag still records its mapping change; there is just no
  -- catalogue row to name alongside it.
  select null, eq.id, null, null,
         eq.cyrix_item_code, eq.cyrix_item_name,
         code, new_name, auth.uid()
  where eq.bluestar_item_id is null;

  update equipment
  set cyrix_item_code = code, cyrix_item_name = new_name
  where id = p_equipment_id
  returning * into eq;

  return eq;
end;
$$;

grant execute on function public.set_tag_cyrix_mapping(uuid, text) to authenticated;

-- What each catalogue item's tags actually add up to: one row per distinct
-- Cyrix item, with how many of that part's units point at it. Definer for the
-- same reason the tag counts are -- equipment is readable only for the
-- warehouses you are assigned to, and this has to mean the same to everyone.
create or replace function public.bluestar_mapping_summary(item_ids uuid[])
returns table (
  bluestar_item_id uuid,
  cyrix_item_code text,
  cyrix_item_name text,
  tag_count bigint
)
language sql
security definer
set search_path = public
as $$
  select e.bluestar_item_id, e.cyrix_item_code, max(e.cyrix_item_name), count(*)::bigint
  from equipment e
  where auth.uid() is not null
    and e.bluestar_item_id = any(item_ids)
    and e.cyrix_item_code is not null
  group by e.bluestar_item_id, e.cyrix_item_code
  order by count(*) desc
$$;

grant execute on function public.bluestar_mapping_summary(uuid[]) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0024_prior_mappings_from_tags.sql
-- ─────────────────────────────────────────────────────────────
-- "What has this spare name been linked to before?" now has to be answered
-- from the tags, since that is where the mapping lives. Definer for the usual
-- reason: the answer has to be the same for everyone, and equipment rows are
-- readable only for the warehouses the caller is assigned to.
--
-- Returns counts and the most recent person, nothing about the spares
-- themselves.
create or replace function public.cyrix_mappings_for_name(p_name_normalized text)
returns table (
  cyrix_item_code text,
  cyrix_item_name text,
  tag_count bigint,
  last_mapped_by uuid,
  last_mapped_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select e.cyrix_item_code,
         max(e.cyrix_item_name) as cyrix_item_name,
         count(*)::bigint as tag_count,
         (array_agg(h.performed_by order by h.performed_at desc nulls last))[1] as last_mapped_by,
         max(h.performed_at) as last_mapped_at
  from equipment e
  join bluestar_item_master b on b.id = e.bluestar_item_id
  left join bluestar_item_mapping_history h
    on h.equipment_id = e.id and h.to_cyrix_item_code = e.cyrix_item_code
  where auth.uid() is not null
    and b.name_normalized = p_name_normalized
    and e.cyrix_item_code is not null
  group by e.cyrix_item_code
  order by count(*) desc
$$;

grant execute on function public.cyrix_mappings_for_name(text) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0025_drop_bluestar_barcode.sql
-- ─────────────────────────────────────────────────────────────
-- Blue Star identifies a part by its item code. There is no separate barcode.
--
-- The column was carried from an earlier reading of the model, where the
-- string scanned off a label was assumed to be a barcode distinct from the
-- code. It never held anything: the catalogue is empty until the real master
-- file is loaded, and that file has no such column. Leaving it would keep
-- offering a second way to identify a part that does not exist, in the
-- importer, the export and the search.

drop index if exists bluestar_item_master_barcode_idx;
alter table bluestar_item_master drop column if exists barcode;

-- The history row snapshotted the barcode alongside the item code so the log
-- still read correctly after a re-upload. With no barcode there is nothing to
-- snapshot.
drop index if exists bluestar_item_mapping_history_barcode_idx;
alter table bluestar_item_mapping_history drop column if exists barcode;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0026_catalogue_columns.sql
-- ─────────────────────────────────────────────────────────────
-- Whatever columns the master file happens to carry.
--
-- Neither workbook is ours. Blue Star's carries whichever columns the people
-- who maintain it decided on, and that set changes between revisions; the
-- Cyrix export has the same problem. A column per field means every column we
-- didn't anticipate is silently dropped on import -- the admin uploads a
-- fifteen-column sheet and five columns arrive. So the columns we don't have a
-- home for land in a jsonb bag instead, and the site learns the shape of the
-- file from the file.
alter table public.bluestar_item_master
  add column if not exists attributes jsonb not null default '{}'::jsonb;
alter table public.cyrix_item_master
  add column if not exists attributes jsonb not null default '{}'::jsonb;

-- Which columns the site shows, and in what order.
--
-- Site-wide rather than per-user: this is the admin deciding what the
-- catalogue looks like for everyone, not a personal view preference.
--
-- `source` separates the two kinds. 'core' columns are the app's own -- the
-- identity fields, plus the tagging progress the app computes rather than
-- reads -- and exist whether or not any file mentions them. 'imported'
-- columns are discovered from an uploaded sheet and read back out of
-- `attributes`.
create table if not exists public.catalogue_columns (
  catalogue text not null check (catalogue in ('bluestar', 'cyrix')),
  key text not null,
  label text not null,
  source text not null default 'imported' check (source in ('core', 'imported')),
  visible boolean not null default true,
  -- New columns from a fresh upload sort after everything already placed,
  -- so an import never reshuffles a layout the admin has arranged.
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  primary key (catalogue, key)
);

alter table public.catalogue_columns enable row level security;

-- Everyone signed in reads the layout -- an engineer's table has to render
-- the same columns the admin chose. Only admins change it.
create policy "catalogue_columns_select" on public.catalogue_columns
  for select using (auth.uid() is not null);
create policy "catalogue_columns_admin_insert" on public.catalogue_columns
  for insert with check (is_admin());
create policy "catalogue_columns_admin_update" on public.catalogue_columns
  for update using (is_admin()) with check (is_admin());
create policy "catalogue_columns_admin_delete" on public.catalogue_columns
  for delete using (is_admin());

-- Spelled out rather than assumed: default privileges have twice failed to
-- reach a new table in this project (see 0002 and 0004).
grant select, insert, update, delete on public.catalogue_columns to authenticated;
grant all on public.catalogue_columns to service_role;

-- The core columns, seeded so the chooser has something to show before any
-- file is uploaded. `on conflict do nothing` keeps a re-run from resetting
-- visibility the admin has since changed.
insert into public.catalogue_columns (catalogue, key, label, source, visible, sort_order) values
  ('bluestar', 'item_code',  'Item code',  'core', true, 10),
  ('bluestar', 'item_name',  'Item name',  'core', true, 20),
  ('bluestar', 'cyrix_item', 'Cyrix item', 'core', true, 30),
  ('bluestar', 'quantity',   'Qty',        'core', true, 40),
  ('bluestar', 'tagged',     'Tagged',     'core', true, 50),
  ('bluestar', 'status',     'Status',     'core', true, 60),
  ('cyrix', 'item_code',             'Item code',        'core', true, 10),
  ('cyrix', 'item_name',             'Item name',        'core', true, 20),
  ('cyrix', 'in_stock',              'In stock',         'core', true, 30),
  ('cyrix', 'item_cost',             'Item cost',        'core', true, 40),
  ('cyrix', 'additional_identifier', 'Addl. identifier', 'core', true, 50),
  ('cyrix', 'item_group',            'Item group',       'core', true, 60),
  ('cyrix', 'parent_equipment',      'Parent equip',     'core', true, 70),
  ('cyrix', 'make',                  'Make',             'core', true, 80),
  ('cyrix', 'model',                 'Model',            'core', true, 90)
on conflict (catalogue, key) do nothing;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0027_imported_columns_start_hidden.sql
-- ─────────────────────────────────────────────────────────────
-- A master file routinely carries thirty columns. Showing all of them the
-- moment a file is uploaded turns the catalogue into a table nobody can read
-- across, which is the opposite of the point: the file decides what is
-- available, the admin decides what is shown.
--
-- So a discovered column starts hidden and is switched on deliberately. The
-- app's own columns are unaffected -- they are seeded visible in 0026 and
-- are what the table shows until someone chooses otherwise.
alter table public.catalogue_columns alter column visible set default false;

update public.catalogue_columns set visible = false where source = 'imported';

-- ─────────────────────────────────────────────────────────────
-- Spare 0028_core_columns_always_shown.sql
-- ─────────────────────────────────────────────────────────────
-- The app's own columns are not a preference.
--
-- 0026 treated every column the same -- core and imported alike were things
-- an admin could switch off. But the built-in columns are what the catalogue
-- *is*: the item code and name identify the row, and Cyrix item, Qty, Tagged
-- and Status are the tagging progress this app exists to report. Hiding one
-- of those doesn't tidy the table, it removes the point of it.
--
-- So the choice is now only over the columns a file brought with it, and the
-- rule is enforced here rather than left to the dialog to remember.
update public.catalogue_columns set visible = true where source = 'core';

alter table public.catalogue_columns
  add constraint catalogue_columns_core_always_visible
  check (source <> 'core' or visible);

-- ─────────────────────────────────────────────────────────────
-- Spare 0029_link_tags_to_catalogue.sql
-- ─────────────────────────────────────────────────────────────
-- Every spare an engineer tagged was invisible to the Blue Star item master.
--
-- The link from a tag to its catalogue row lives in equipment.bluestar_item_id,
-- and the app set it in a second statement immediately after inserting the
-- tag. But the only UPDATE policy on equipment is is_pm_or_admin() -- by
-- design, since an engineer's edits are supposed to go through the approval
-- flow -- so for an engineer that second statement matched no rows. RLS
-- filters rather than errors, so nothing failed and nothing was linked.
--
-- The tag still appeared under Tagged, which reads the item code straight out
-- of custom_fields, so the only visible symptom was an item master reporting
-- 0 tagged for a part that plainly had been tagged. Engineers do most of the
-- tagging, so in practice progress was being reported almost entirely blank.
--
-- The app now writes the link as part of the insert, which an engineer is
-- allowed to do. This migration deals with the two places SQL owns: the tags
-- already saved without a link, and the approval path, which applies a new
-- item code without ever re-pointing the link that code decides.

-- Which custom field holds the Blue Star item code. It is admin-configurable,
-- so it is looked up rather than assumed, and there is only ever one.
create or replace function public.bluestar_code_field_key()
returns text
language sql stable security definer set search_path = public as $$
  select field_key from field_definitions
  where field_type = 'barcode' and active
  order by display_order limit 1
$$;

-- The catalogue row a tag's own item code points at, or null when the code is
-- blank or matches nothing. Null is a real answer: it means this spare is not
-- in Blue Star's master file, and it should count towards no item's progress.
create or replace function public.bluestar_item_for_tag(p_equipment_id uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select b.id
  from equipment e
  join bluestar_item_master b
    on b.item_code = nullif(btrim(e.custom_fields ->> public.bluestar_code_field_key()), '')
  where e.id = p_equipment_id
$$;

-- Backfill. Only fills in links that are missing: a tag deliberately pointed
-- somewhere else is left alone.
update equipment e
set bluestar_item_id = public.bluestar_item_for_tag(e.id)
where e.bluestar_item_id is null
  and public.bluestar_item_for_tag(e.id) is not null;

-- Approving an edit can change the item code, and the item code is what
-- decides the link -- so the link has to be recomputed here too, or an
-- approved correction moves the code without moving the tag with it.
create or replace function public.resolve_edit_request(request_id uuid, approve boolean, note text default null)
returns edit_requests
language plpgsql
security definer
set search_path = public as $$
declare
  req edit_requests;
  eq equipment;
begin
  if not is_pm_or_admin() then
    raise exception 'Only project managers or admins can resolve edit requests';
  end if;

  select * into req from edit_requests where id = request_id for update;
  if req is null then
    raise exception 'Edit request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This edit request was already resolved';
  end if;

  select * into eq from equipment where id = req.equipment_id;
  if not has_facility_access(eq.facility_id) then
    raise exception 'Not authorized for this facility';
  end if;

  update edit_requests set
    status = case when approve then 'approved'::request_status else 'rejected'::request_status end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    review_note = note
  where id = request_id
  returning * into req;

  if approve then
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
  end if;

  return req;
end;
$$;

grant execute on function public.bluestar_code_field_key() to authenticated;
grant execute on function public.bluestar_item_for_tag(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0030_delete_catalogue_rows.sql
-- ─────────────────────────────────────────────────────────────
-- Clearing a catalogue from the admin screen.
--
-- Deleting the rows on screen would be no use here: the item master lists a
-- hundred rows a page out of tens of thousands, so "delete all" has to mean
-- the whole catalogue -- or, when a search is active, everything the search
-- matches, which is what the list is actually showing. The filter therefore
-- lives here rather than in a list of ids the browser had to fetch first.
--
-- Deleting a Blue Star item does not delete the spares tagged against it:
-- equipment.bluestar_item_id is ON DELETE SET NULL, so those tags survive and
-- simply stop counting towards any item's progress until the master file is
-- uploaded again. Their mapping history does cascade away with the item.
--
-- Nothing references cyrix_item_master, because a tag stores the Cyrix code
-- as text -- so clearing that catalogue costs lookups and suggestions, not
-- the mappings already made.
create or replace function public.delete_catalogue_rows(
  p_catalogue text,
  p_search text default null,
  p_ids uuid[] default null
)
returns bigint
language plpgsql
security definer
set search_path = public as $$
declare
  removed bigint;
  pattern text;
begin
  -- Definer rights would otherwise hand this to anyone who could call it.
  -- Both tables already restrict DELETE to is_admin() through RLS; this says
  -- the same thing again because the function bypasses that.
  if not is_admin() then
    raise exception 'Only admins can delete item master rows';
  end if;

  pattern := case when coalesce(btrim(p_search), '') = '' then null else '%' || btrim(p_search) || '%' end;

  if p_catalogue = 'bluestar' then
    delete from bluestar_item_master
    where (p_ids is not null and id = any(p_ids))
       or (p_ids is null and (pattern is null or item_code ilike pattern or item_name ilike pattern));

  elsif p_catalogue = 'cyrix' then
    delete from cyrix_item_master
    where (p_ids is not null and id = any(p_ids))
       or (p_ids is null and (pattern is null
             or item_code ilike pattern
             or item_name ilike pattern
             or additional_identifier ilike pattern
             or make ilike pattern
             or model ilike pattern));

  else
    raise exception 'Unknown catalogue: %', p_catalogue;
  end if;

  get diagnostics removed = row_count;
  return removed;
end;
$$;

grant execute on function public.delete_catalogue_rows(text, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0031_relink_tags_on_upload.sql
-- ─────────────────────────────────────────────────────────────
-- A catalogue row that comes back should take its tags back with it.
--
-- equipment.bluestar_item_id is ON DELETE SET NULL, so deleting an item from
-- the master leaves the spares tagged against it intact but unlinked -- which
-- is right, since the item they pointed at no longer exists. The problem is
-- what happens next: re-uploading the master file inserts a *new* row with a
-- new id, and nothing was re-pointing those tags at it. They stayed orphaned
-- for good, counting towards nothing, with no way back short of hand-editing
-- the database.
--
-- That was already reachable by deleting one row. With "delete all" on the
-- admin screen it becomes the ordinary way to correct a bad upload: clear the
-- catalogue, upload the fixed file. So linking has to happen on the way in.
--
-- Statement-level with a transition table rather than per row: an upload
-- arrives in chunks of several hundred, and a per-row trigger would re-scan
-- the tags once for every line of the file.
create or replace function public.link_tags_to_inserted_items()
returns trigger
language plpgsql
security definer
set search_path = public as $$
begin
  update equipment e
     set bluestar_item_id = i.id
    from inserted i
   where e.bluestar_item_id is null
     and nullif(btrim(e.custom_fields ->> public.bluestar_code_field_key()), '') = i.item_code;
  return null;
end;
$$;

drop trigger if exists trg_bluestar_item_master_link_tags on public.bluestar_item_master;

create trigger trg_bluestar_item_master_link_tags
after insert on public.bluestar_item_master
referencing new table as inserted
for each statement execute function public.link_tags_to_inserted_items();

-- An upsert only INSERTs codes the catalogue doesn't already have, so a
-- re-upload of an unchanged file fires this for nothing and updates nothing.

notify pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────
-- Spare 0032_client_neutral_field_label.sql
-- ─────────────────────────────────────────────────────────────
-- The customer must not be named anywhere a user of the site can see it.
--
-- Most of that is UI text, but this one is data: field_definitions.label is
-- admin-authored and renders as a form label and as a column header in the
-- tagged list, so it was showing the customer's name on every row of the
-- busiest table in the app. It cannot be fixed by editing the code.
--
-- Only the label changes. field_key stays 'barcode', because that is what
-- every equipment.custom_fields entry is keyed by and renaming it would
-- orphan every tag already recorded.
update field_definitions
   set label = 'Client item code'
 where field_key = 'barcode'
   and label ilike '%blue%star%';

-- =====================================================================
-- PART 2 · HR's employee list is the master record
--
-- Spare kept its own roster in `profiles`, filled in by its own admin
-- screens. Two rosters for the same people drift the moment somebody
-- leaves: HR marks them inactive in `employees` and Spare keeps letting
-- them scan. So identity now flows one way — employees to profiles —
-- and nothing flows back.
--
-- profiles stays a TABLE rather than becoming a view over employees,
-- and that is deliberate. `employees` is read-restricted to yourself,
-- your reports and your manager. A view inheriting that leaves a Spare
-- engineer unable to see the colleague who filed a request; a view
-- bypassing it turns Spare into a side door onto all 1,148 employee
-- records. Neither is acceptable, so each product keeps its own
-- visibility rules over its own table and only the identity columns
-- are shared.
--
-- Division of ownership:
--   ecode, full_name, active  — KPI's, synced down, not writable here
--   role                      — Spare's own, untouched by the sync
-- =====================================================================

-- ---------------------------------------------------------------------
-- The sync. Runs as definer because it writes profiles on behalf of
-- whoever changed the employee, and that person is HR, not a Spare admin.
-- ---------------------------------------------------------------------
create or replace function public.spare_sync_profile_from_employee()
returns trigger
language plpgsql security definer set search_path = public as $spare_sync$
begin
  -- Somebody with no login cannot own rows keyed to auth.users.
  if new.auth_user_id is null then
    return new;
  end if;

  -- Tell the read-only guard below that this write is the sync itself and
  -- not somebody editing a name in Spare. Transaction-local, so it cannot
  -- leak into the next statement and quietly disarm the guard.
  perform set_config('spare.syncing', 'on', true);

  insert into profiles (id, ecode, full_name, active)
  values (new.auth_user_id, new.ecode, new.full_name, new.is_active)
  on conflict (id) do update set
    ecode     = excluded.ecode,
    full_name = excluded.full_name,
    active    = excluded.active;
    -- role deliberately absent: it is Spare's to decide.

  return new;
end $spare_sync$;

drop trigger if exists trg_employees_sync_spare_profile on employees;
create trigger trg_employees_sync_spare_profile
  after insert or update of ecode, full_name, is_active, auth_user_id on employees
  for each row execute function public.spare_sync_profile_from_employee();


-- ---------------------------------------------------------------------
-- Make "master" mean something. Without this, Spare's own
-- profiles_admin_update policy still lets a Spare admin rename somebody
-- — it would just be silently overwritten the next time HR touched the
-- row, which is worse than refusing.
-- ---------------------------------------------------------------------
create or replace function public.spare_identity_is_read_only()
returns trigger
language plpgsql set search_path = public as $spare_guard$
begin
  -- The sync sets this immediately before writing. Checking the database
  -- role instead would have been wrong twice over: migrations run as the
  -- owner rather than service_role, and the role a request arrives under
  -- is not evidence of what the write is for.
  if current_setting('spare.syncing', true) = 'on' then
    return new;
  end if;
  if new.ecode is distinct from old.ecode
     or new.full_name is distinct from old.full_name then
    raise exception
      'Name and employee code come from the HR employee record. Change them in KPI.';
  end if;
  return new;
end $spare_guard$;

drop trigger if exists trg_profiles_identity_read_only on profiles;
create trigger trg_profiles_identity_read_only
  before update on profiles
  for each row execute function public.spare_identity_is_read_only();


-- ---------------------------------------------------------------------
-- Seed. Everyone who can sign in gets a Spare profile; whether they can
-- SEE Spare is the module grant from 0057, which is a separate question.
--
-- HR and SW Admin become Spare admins so the module has someone who can
-- administer it on day one. Everybody else starts as an engineer, and
-- project managers are promoted inside Spare — that is a Spare judgement
-- about facilities, not an HR fact about the payroll.
-- ---------------------------------------------------------------------
insert into profiles (id, ecode, full_name, role, active)
select
  e.auth_user_id,
  e.ecode,
  e.full_name,
  case when exists (
    select 1 from user_roles ur
    where ur.employee_id = e.id and ur.role in ('hr_admin', 'super_admin')
  ) then 'admin'::user_role else 'engineer'::user_role end,
  e.is_active
from employees e
where e.auth_user_id is not null
on conflict (id) do nothing;


-- =====================================================================
-- Self-test
-- =====================================================================
do $spare_selftest$
declare
  n_emp      integer;
  n_prof     integer;
  n_admin       integer;
  probe_id      uuid;
  probe_auth    uuid;
  original_name text;
begin
  select count(*) into n_emp  from employees where auth_user_id is not null;
  select count(*) into n_prof from profiles;
  if n_prof < n_emp then
    raise exception 'Seeded % profiles for % employees with logins', n_prof, n_emp;
  end if;

  select count(*) into n_admin from profiles where role = 'admin';
  if n_admin = 0 then
    raise exception 'Nobody can administer Spare — no profile has the admin role';
  end if;

  -- The collision is gone: KPI's settings are not reachable as Spare's.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'app_settings'
               and column_name = 'updated_by') then
    raise exception 'app_settings still carries Spare''s shape — the rename did not take';
  end if;
  if not exists (select 1 from information_schema.tables
                 where table_schema = 'public' and table_name = 'spare_settings') then
    raise exception 'spare_settings was not created';
  end if;

  -- Exercise the trigger on a real employee and put them back. A made-up
  -- employee cannot be used here: profiles.id references auth.users, so a
  -- synthetic auth_user_id fails the foreign key — which is the constraint
  -- doing its job, not a fault to work around.
  select e.id, e.auth_user_id, e.full_name
    into probe_id, probe_auth, original_name
  from employees e
  where e.auth_user_id is not null
  order by e.ecode
  limit 1;

  if probe_id is null then
    raise exception 'No employee has a login, so the sync cannot be tested';
  end if;

  -- HR renames somebody; Spare follows.
  update employees set full_name = 'ZZ-0058-PROBE' where id = probe_id;
  if not exists (select 1 from profiles where id = probe_auth and full_name = 'ZZ-0058-PROBE') then
    raise exception 'A rename in employees did not reach profiles';
  end if;

  -- And back, so this migration leaves the row exactly as it found it.
  update employees set full_name = original_name where id = probe_id;
  if not exists (select 1 from profiles where id = probe_auth and full_name = original_name) then
    raise exception 'Restoring the name did not reach profiles';
  end if;

  -- Every profile agrees with its employee record on who is still here.
  if exists (
    select 1 from employees e join profiles p on p.id = e.auth_user_id
    where p.active is distinct from e.is_active
  ) then
    raise exception 'A profile disagrees with the employee record about being active';
  end if;

  raise notice
    '0058 self-test passed (% profiles seeded, % admin, Spare schema installed)',
    n_prof, n_admin;
end $spare_selftest$;
