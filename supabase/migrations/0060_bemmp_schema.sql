-- =====================================================================
-- Cyrix KPI  ·  0060  ·  BEMMP moves in
--
-- The last module still holding its own Supabase project, and so the
-- last one asking for a second password. Its 9 migrations are replayed
-- below in their original order with one substitution.
--
-- BEMMP defines is_admin(), and so does Spare, which arrived in 0058.
-- Same name, same signature, different table: BEMMP reads `profile`,
-- Spare reads `profiles`. Loading it unrenamed would have silently
-- replaced Spare's and rewired every Spare RLS policy to ask a question
-- about the wrong table — no error, no failed migration, just Spare
-- quietly deciding access on BEMMP's roster. It becomes bemmp_is_admin
-- here; nothing outside these policies calls it, and the app only ever
-- reaches for meeting_log and reconcile_open_calls.
--
-- Nothing else collides: no table, no other function, and app_role does
-- not clash with the types Spare brought.
--
-- BEMMP's dashboard figures do not live in Postgres — only sign-in, the
-- daily penalty meeting and who may edit it. Meeting notes recorded in
-- the old project stay there; this is a fresh table on this side.
-- =====================================================================

-- =====================================================================
-- PART 1 · BEMMP schema, replayed
-- =====================================================================

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0001_meeting.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- BEMMP daily penalty meeting — schema
--
-- The dashboard itself stays read-only and file-driven: ticket data is still
-- built from the TM export into public/data. What lives here is only the part
-- that cannot come from the export — what people type in the daily meeting, and
-- who is allowed to type it.
--
-- Run with:  psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_meeting.sql
-- ============================================================================

-- ------------------------------------------------------------------ roles --

-- Role decides *what you can do*, scope decides *which contract you see*, and
-- the two are independent: the AP account in the source workbook is a Director
-- who nonetheless only sees Andhra.
do $$ begin
  create type app_role as enum ('director', 'project_head', 'coordinator', 'purchase');
exception when duplicate_object then null; end $$;

create table if not exists profile (
  id         uuid primary key references auth.users on delete cascade,
  code       text unique not null,
  full_name  text,
  role       app_role not null,
  -- Which BEMMP contracts this account may open. {'kl','ap'} is the All case.
  scope      text[] not null default '{}',
  created_at timestamptz not null default now()
);

comment on column profile.scope is
  'BEMMP contract ids the account may read. Empty means no access at all.';

-- Directors are the read-only audience: they get every tab except the daily
-- penalty meeting, which is a working surface rather than a report.
create or replace function is_director() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'director' from profile where id = auth.uid()), false);
$$;

create or replace function in_scope(want text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select want = any (scope) from profile where id = auth.uid()), false);
$$;

-- ------------------------------------------------------- penalty type list --

-- The column S dropdown, as a table rather than a hard-coded list so the
-- business can extend it without a deploy.
create table if not exists penalty_type (
  name     text primary key,
  sort     integer not null default 0,
  archived boolean not null default false
);

insert into penalty_type (name, sort) values
  ('Calibration', 10), ('CAMC', 20), ('Decison Pending', 30), ('ESV', 40),
  ('Hospital Electrical Issue', 50), ('Hospital General Issue', 60),
  ('Local Service', 70), ('Massimo', 80), ('Not Under Scope', 90),
  ('OEM Service', 100), ('Others', 110), ('Part Missing', 120),
  ('PO Pending', 130), ('Rber', 140), ('Spare/Machine Waiting', 150),
  ('Specialist Attend Pending', 160), ('Standby', 170), ('TRC', 180),
  ('Waiting For Quote', 190), ('Warranty', 200)
on conflict (name) do nothing;

-- ---------------------------------------------------------- meeting notes --

-- One row per ticket per contract, holding columns S..AO of the meeting sheet.
--
-- Keyed on the ticket rather than on a surrogate id, because the join back to
-- the export is by ticket and nothing else survives a re-export.
create table if not exists meeting_note (
  state  text not null check (state in ('kl', 'ap')),
  ticket text not null,

  -- S..AO in sheet order.
  penalty_type            text references penalty_type (name),
  current_status          text,
  trc_given_date          date,
  trc_spare_received_date date,
  standby_given_date      date,
  standby_days            integer,
  pi_no                   text,
  pi_date                 date,
  pi_tat                  integer,
  pr_no                   text,
  pr_date                 date,
  pr_conversion_days      integer,
  pr_remark               text,
  po_no                   text,
  po_date                 date,
  purchase_delay_days     integer,
  vendor_name             text,
  payment_request_date    date,
  payment_date            date,
  spare_edd               date,
  po_remark               text,
  payment_issue           text,
  not_in_scope_reason     text,

  -- A date cell in the workbook is not always a date. People recorded revisions
  -- by appending to it — "7/11/2026 15-7-26 31-7-26" is one cell — so a plain
  -- `date` column would drop the very history the meeting cares about. Anything
  -- the importer could not parse is kept verbatim here, keyed by column, and
  -- shown beside the field as what the old sheet said.
  legacy_values           jsonb,

  -- Lifecycle. `closed_on` is set when a ticket stops appearing in the open
  -- list; the row is kept rather than deleted so a call that reopens does not
  -- come back blank, and so the meeting has a record of what was said.
  first_seen date not null default current_date,
  last_seen  date not null default current_date,
  closed_on  date,

  updated_by uuid references auth.users on delete set null,
  updated_at timestamptz not null default now(),

  primary key (state, ticket)
);

create index if not exists meeting_note_open_idx
  on meeting_note (state) where closed_on is null;

-- ------------------------------------------------------------------ audit --

-- A shared grid that several people edit needs to be able to answer "who put
-- that there". Append-only; nothing in the app deletes from it.
create table if not exists meeting_note_history (
  id         bigserial primary key,
  state      text not null,
  ticket     text not null,
  column_name text not null,
  old_value  text,
  new_value  text,
  changed_by uuid references auth.users on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists meeting_note_history_ticket_idx
  on meeting_note_history (state, ticket, changed_at desc);

create or replace function log_meeting_note_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  col  text;
  oldv text;
  newv text;
begin
  foreach col in array array[
    'penalty_type','current_status','trc_given_date','trc_spare_received_date',
    'standby_given_date','standby_days','pi_no','pi_date','pi_tat','pr_no',
    'pr_date','pr_conversion_days','pr_remark','po_no','po_date',
    'purchase_delay_days','vendor_name','payment_request_date','payment_date',
    'spare_edd','po_remark','payment_issue','not_in_scope_reason'
  ] loop
    execute format('select ($1).%I::text, ($2).%I::text', col, col)
      into oldv, newv using old, new;
    if oldv is distinct from newv then
      insert into meeting_note_history (state, ticket, column_name, old_value, new_value, changed_by)
      values (new.state, new.ticket, col, oldv, newv, auth.uid());
    end if;
  end loop;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

drop trigger if exists meeting_note_audit on meeting_note;
create trigger meeting_note_audit
  before update on meeting_note
  for each row execute function log_meeting_note_change();

-- -------------------------------------------------------------------- RLS --

alter table profile              enable row level security;
alter table penalty_type         enable row level security;
alter table meeting_note         enable row level security;
alter table meeting_note_history enable row level security;

drop policy if exists profile_self on profile;
create policy profile_self on profile
  for select to authenticated using (id = auth.uid());

drop policy if exists penalty_type_read on penalty_type;
create policy penalty_type_read on penalty_type
  for select to authenticated using (true);

-- Read what your scope covers. Directors read too — they simply have no tab
-- in the UI that shows it.
drop policy if exists meeting_note_read on meeting_note;
create policy meeting_note_read on meeting_note
  for select to authenticated using (in_scope (state));

-- Write is the actual restriction, and it lives here rather than in the UI:
-- hiding a tab is a courtesy, a policy is a control.
drop policy if exists meeting_note_write on meeting_note;
create policy meeting_note_write on meeting_note
  for update to authenticated
  using (in_scope (state) and not is_director ())
  with check (in_scope (state) and not is_director ());

drop policy if exists meeting_note_history_read on meeting_note_history;
create policy meeting_note_history_read on meeting_note_history
  for select to authenticated using (in_scope (state));

-- Rows are created and closed by the sync job under the service role, which
-- bypasses RLS. No insert or delete policy exists for end users on purpose.

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0002_reconcile.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- Reconciling yesterday's meeting against today's export.
-- ============================================================================

-- The audit trigger stamped updated_at/updated_by on *every* update, including
-- the housekeeping ones below. That would have credited the whole table to
-- whoever happened to open the page first each morning. Only stamp when one of
-- the tracked columns actually moved.
create or replace function log_meeting_note_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  col     text;
  oldv    text;
  newv    text;
  touched boolean := false;
begin
  foreach col in array array[
    'penalty_type','current_status','trc_given_date','trc_spare_received_date',
    'standby_given_date','standby_days','pi_no','pi_date','pi_tat','pr_no',
    'pr_date','pr_conversion_days','pr_remark','po_no','po_date',
    'purchase_delay_days','vendor_name','payment_request_date','payment_date',
    'spare_edd','po_remark','payment_issue','not_in_scope_reason'
  ] loop
    execute format('select ($1).%I::text, ($2).%I::text', col, col)
      into oldv, newv using old, new;
    if oldv is distinct from newv then
      touched := true;
      insert into meeting_note_history (state, ticket, column_name, old_value, new_value, changed_by)
      values (new.state, new.ticket, col, oldv, newv, auth.uid());
    end if;
  end loop;

  if touched then
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;

/*
 * Moves the meeting on by a day.
 *
 * Everything still open keeps its notes and has `last_seen` carried forward;
 * anything that has dropped off the open list is stamped `closed_on` rather than
 * deleted, so a call that reopens does not come back blank and the meeting keeps
 * a record of what was said about it.
 *
 * `security definer` because closing a call is housekeeping rather than an edit:
 * it has to work for a coordinator whose write policy covers only their own
 * contract, and it must not be something a director can use to change content.
 * Scope is still enforced — on the caller, explicitly, on the first line.
 */
create or replace function reconcile_open_calls(p_state text, p_tickets text[])
returns table (reopened integer, closed integer)
language plpgsql security definer set search_path = public as $$
declare
  n_reopened integer;
  n_closed   integer;
begin
  if not in_scope (p_state) then
    raise exception 'You do not have access to %', p_state using errcode = '42501';
  end if;

  update meeting_note
     set last_seen = current_date, closed_on = null
   where state = p_state
     and ticket = any (p_tickets)
     and (last_seen is distinct from current_date or closed_on is not null);
  get diagnostics n_reopened = row_count;

  update meeting_note
     set closed_on = current_date
   where state = p_state
     and closed_on is null
     and not (ticket = any (p_tickets));
  get diagnostics n_closed = row_count;

  return query select n_reopened, n_closed;
end $$;

revoke all on function reconcile_open_calls (text, text[]) from public;
grant execute on function reconcile_open_calls (text, text[]) to authenticated;

-- Creating a note row is how a first edit gets somewhere to land, so it needs an
-- insert policy — but only within scope, and not for the accounts that may not
-- edit at all.
drop policy if exists meeting_note_insert on meeting_note;
create policy meeting_note_insert on meeting_note
  for insert to authenticated
  with check (in_scope (state) and not is_director ());

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0003_datasets.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- Shared ticket artifacts.
--
-- Until now a TM export uploaded in the browser stayed in that browser's
-- IndexedDB, so every person had to upload the same file for themselves. One
-- upload should serve the team.
--
-- The artifact is a file, not a table: 27 MB of concatenated Int32Array columns
-- that the browser slices into typed arrays with zero parse cost. Putting 265k
-- rows into Postgres would throw away the entire reason the columnar format
-- exists, so the bytes live in Storage and only the provenance lives here.
-- ============================================================================

create table if not exists dataset (
  state       text primary key check (state in ('kl', 'ap')),
  rows        integer not null,
  min_day     integer not null,
  max_day     integer not null,
  filename    text,
  bytes       bigint,
  -- Both objects are gzipped client-side before upload. Recorded rather than
  -- assumed so a future raw upload can still be read back.
  encoding    text not null default 'gzip',
  uploaded_by uuid references auth.users on delete set null,
  uploaded_at timestamptz not null default now()
);

alter table dataset enable row level security;

drop policy if exists dataset_read on dataset;
create policy dataset_read on dataset
  for select to authenticated using (in_scope (state));

-- Same rule as editing the meeting: your own contract, and not a director.
-- Replacing the artifact changes what every figure on the page is computed
-- from, so it is emphatically not a read-only person's action.
drop policy if exists dataset_write on dataset;
create policy dataset_write on dataset
  for all to authenticated
  using (in_scope (state) and not is_director ())
  with check (in_scope (state) and not is_director ());

-- --------------------------------------------------------------- storage ---

insert into storage.buckets (id, name, public)
values ('datasets', 'datasets', false)
on conflict (id) do nothing;

/*
 * Objects are `<state>/meta.json.gz` and `<state>/tickets.bin.gz`, so the first
 * path segment is the contract and scope can be enforced on it directly. A
 * private bucket, so every read is a signed request carrying the user's session
 * rather than a public URL anyone could pass around.
 */
drop policy if exists "datasets read in scope" on storage.objects;
create policy "datasets read in scope" on storage.objects
  for select to authenticated
  using (bucket_id = 'datasets' and in_scope ((storage.foldername (name))[1]));

drop policy if exists "datasets insert in scope" on storage.objects;
create policy "datasets insert in scope" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'datasets'
    and in_scope ((storage.foldername (name))[1])
    and not is_director ()
  );

drop policy if exists "datasets update in scope" on storage.objects;
create policy "datasets update in scope" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'datasets'
    and in_scope ((storage.foldername (name))[1])
    and not is_director ()
  );

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0004_admin.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- The administrator, and the one secret the server needs.
--
-- Two things that both have to live outside the browser.
--
-- Creating a login is an `auth.admin` call, which only the service key can make;
-- and the OpenAI key is a bearer credential, which anything the browser can read
-- is by definition not keeping. Both therefore go through the server functions
-- in api/, and what lives here is only the part Postgres can enforce: who counts
-- as an administrator, and a table the anon key cannot see at all.
-- ============================================================================

-- ------------------------------------------------------------------ role ---

-- `admin` joins the four business roles rather than replacing any of them. It is
-- not a bigger director: a director is a read-only audience for the figures,
-- while an admin manages accounts and has no special claim on the data.
alter type app_role add value if not exists 'admin';

/*
 * `role::text` rather than `role = 'admin'`, throughout this file.
 *
 * Postgres refuses to let a transaction use an enum value the same transaction
 * added — "unsafe use of new value" — and this migration both adds `admin` and
 * defines the functions that test for it. Comparing as text is not a workaround
 * for a lint: it is what lets the file run in one pass on a fresh database.
 */
create or replace function bemmp_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role::text = 'admin' from profile where id = auth.uid()), false);
$$;

/*
 * Every contract, without listing them.
 *
 * An admin's scope column is left empty on purpose. Writing {'kl','ap'} into it
 * would make the grant a copy that goes stale the moment a third contract is
 * added — and the person who adds it is the same person who would have to
 * remember. Asking the role instead cannot drift.
 */
create or replace function in_scope(want text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role::text = 'admin' or want = any (scope) from profile where id = auth.uid()),
    false);
$$;

-- ------------------------------------------------------------- profiles ----

/*
 * Until now every account could read exactly its own profile row, which is all
 * the dashboard needs. The admin screen needs the list, and needs to change
 * role and scope on it.
 *
 * Note what is *not* here: no policy lets anyone insert a profile. A profile
 * without a matching `auth.users` row is an account that cannot sign in, so the
 * two are created together by the server function or not at all.
 */
drop policy if exists profile_self on profile;
create policy profile_self on profile
  for select to authenticated using (id = auth.uid() or bemmp_is_admin ());

drop policy if exists profile_admin_write on profile;
create policy profile_admin_write on profile
  for update to authenticated
  using (bemmp_is_admin ())
  with check (bemmp_is_admin ());

-- --------------------------------------------------------------- secrets ---

/*
 * Server-side configuration. One row per secret.
 *
 * RLS is on and there is deliberately **no policy**, which is the whole design:
 * with none, the anon and authenticated roles match no row and the table is
 * invisible to every browser, however the request is shaped. Only the service
 * key — which bypasses RLS and never leaves the Vercel function — can read it.
 *
 * A key kept here rather than in a deploy variable can be rotated with an update
 * and no redeploy, which matters because rotating it is the response to it
 * leaking.
 */
create table if not exists app_secret (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table app_secret enable row level security;

comment on table app_secret is
  'Server-only. RLS on with no policy: unreadable by anon and authenticated. '
  'Read by the service key inside api/ functions and nowhere else.';

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0005_log.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- The meeting's audit trail, readable.
--
-- `meeting_note_history` has recorded every field change since 0001 — column,
-- before, after, who, when — but nothing has ever shown it. The rows are there;
-- what is missing is a way to turn `changed_by` into a person.
--
-- That is the whole reason for the two functions below. `profile` is readable
-- only for your own row (and by an admin), which is right — role and contract
-- scope are nobody else's business — but it means a coordinator cannot resolve a
-- colleague's uuid to a name. A `security definer` function hands back the code
-- and nothing else, so the log reads "KLCoord" without the profile table being
-- opened up to everyone.
-- ============================================================================

/*
 * The entries for one ticket, newest first, opened on demand.
 *
 * `changed_by` can be null: the reconcile job and the original import both run
 * under the service role, which has no `auth.uid()`. Those show as the system
 * rather than as a blank, because a blank author reads like a bug.
 */
create or replace function meeting_log(p_state text, p_ticket text)
returns table (
  id bigint,
  column_name text,
  old_value text,
  new_value text,
  changed_at timestamptz,
  changed_by_code text
)
language sql stable security definer set search_path = public as $$
  select h.id, h.column_name, h.old_value, h.new_value, h.changed_at, p.code
    from meeting_note_history h
    left join profile p on p.id = h.changed_by
   where h.state = p_state
     and h.ticket = p_ticket
     and in_scope (p_state)
   order by h.changed_at desc, h.id desc
   limit 500;
$$;

revoke all on function meeting_log(text, text) from public;
grant execute on function meeting_log(text, text) to authenticated;

-- A per-ticket summary lived here briefly, to put a change count and the last
-- editor in the grid. The column became the widest thing on the row for the
-- least urgent information on it, so the cell is now one button and the trail
-- is a click away. Dropped rather than left behind unused.
drop function if exists meeting_log_summary (text, text[]);

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0006_dataset_version.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- Immutable artifact paths.
--
-- The two objects lived at one fixed path each, overwritten on every publish,
-- and Storage serves them with `cache-control: max-age=3600`. So for an hour
-- after a publish a browser could hold the previous 27 MB `tickets.bin.gz` in
-- its own HTTP cache while fetching the new `meta.json.gz` over the network — a
-- meta describing 270,293 rows paired with a buffer holding 270,030. Every
-- figure would be read out of the wrong column, so the reader refuses the pair
-- and the page is dead until the cache expires.
--
-- That is not a rare race. Anybody who opened the dashboard in the hour before a
-- publish hit it, which is how one publish took the deployment down for a
-- morning.
--
-- The fix is to stop rewriting paths. Each publish writes `<state>/<version>/`
-- and this column is the pointer, so the switch is a single-row update and the
-- bytes behind any given URL never change — which also makes caching them for a
-- year correct rather than dangerous.
--
-- Null means an artifact published before this, still at the old flat paths;
-- `paths()` in src/data/datasets.js reads those unchanged.
-- ============================================================================

alter table dataset add column if not exists version text;

-- --------------------------------------------------------------- storage ---

/*
 * A publish now sweeps the version it replaced, so the bucket does not grow by
 * 27 MB every time somebody uploads. Same scope test as writing: your own
 * contract, and not a director.
 *
 * `(storage.foldername(name))[1]` is still the contract — the version is a
 * second segment below it, so the existing read/insert/update policies need no
 * change.
 */
drop policy if exists "datasets delete in scope" on storage.objects;
create policy "datasets delete in scope" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'datasets'
    and in_scope ((storage.foldername (name))[1])
    and not is_director ()
  );

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0007_account_audit.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- Who did what to which account.
--
-- `meeting_note` has been audited since 0001, and nothing else has. Account
-- administration was the gap that mattered: an admin could create a login, reset
-- anybody's password to their employee code, change a role, or revoke access,
-- and none of it left a record anywhere. "Who reset my password on Tuesday" had
-- no answer.
--
-- Append-only by construction rather than by convention — see the policies.
-- ============================================================================

create table if not exists account_audit (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),

  action      text not null check (
                action in ('create', 'update', 'reset', 'disable', 'enable')
              ),

  /*
   * Both sides are stored as a uuid *and* a code, which looks redundant and is
   * not. `profile` is readable only for your own row, so resolving somebody
   * else's uuid to a name needs a security-definer function — that is exactly
   * why `meeting_log` had to become one. A log that has to run a definer
   * function per row to be legible is a log nobody reads.
   *
   * The codes are also what makes the trail survive its subjects: accounts are
   * disabled rather than deleted today, but a row here must still make sense if
   * one is ever removed, so `target_id` is deliberately NOT a foreign key.
   */
  actor_id    uuid references auth.users on delete set null,
  actor_code  text not null,
  target_id   uuid,
  target_code text not null,

  /*
   * What changed, for the actions where that is a question — the before and
   * after of a role or scope change. Never a password: `reset` records that a
   * reset happened and by whom, which is the auditable fact. The value is the
   * employee code, it is already known, and writing secrets into a log is how
   * logs become the thing that leaks.
   */
  detail      jsonb
);

create index if not exists account_audit_at_idx on account_audit (at desc);
create index if not exists account_audit_target_idx on account_audit (target_id, at desc);

alter table account_audit enable row level security;

/*
 * Read: administrators, and only them. The rows name who changed whose access,
 * which is not a coordinator's business.
 */
drop policy if exists account_audit_read on account_audit;
create policy account_audit_read on account_audit
  for select to authenticated using (bemmp_is_admin ());

/*
 * Write: nobody, through this API.
 *
 * There is deliberately no insert, update or delete policy. `authenticated` and
 * `anon` therefore match no row for any of those, so a browser cannot add a
 * line, edit one, or remove one however the request is shaped — the same
 * technique `app_secret` uses to stay invisible. Only the service key can write
 * here, and the only thing holding it is `api/users.js`, which writes a row for
 * every action it takes. An audit trail the audited party can edit is not one.
 */

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0008_field_roles.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- Three more designations: zonal manager, district incharge, divisional manager.
--
-- These are job titles the business already uses, not new tiers of access. What
-- makes that cheap is the shape of the existing permission model: every check in
-- the app asks whether somebody is a *director* (read-only) or an *admin*
-- (manages accounts), and everyone else works the meeting. `canEditMeeting` is
-- `role <> 'director'` and `meeting_note_write` leans on `is_director()`, so a
-- new operational role needs no policy of its own and gets working access to its
-- own contracts the moment the enum accepts it.
--
-- Adding a role is therefore adding a name. If one of these ever needs to be
-- read-only, that is a change to `is_director()` and to `canEditMeeting`, and it
-- should be made in both or the client and the database will disagree about who
-- may type in the grid.
-- ============================================================================

/*
 * `add value if not exists`, the same as 0004 did for `admin`, so a re-run is a
 * no-op rather than an error.
 *
 * Note that Postgres will not let a transaction use an enum value the same
 * transaction added — "unsafe use of new value". Nothing here compares against
 * these three, so this file is safe in one pass; anything later that tests for
 * them must either be in its own migration or compare `role::text`, which is why
 * 0004 does it that way throughout.
 */
alter type app_role add value if not exists 'zonal_manager';
alter type app_role add value if not exists 'district_incharge';
alter type app_role add value if not exists 'divisional_manager';

-- ─────────────────────────────────────────────────────────────
-- BEMMP 0009_area_scope.sql
-- ─────────────────────────────────────────────────────────────
-- ============================================================================
-- Area scope: which zone, or which districts, an account works.
--
-- `scope` already answers "which contracts", and it is enforced — meeting notes
-- live in Postgres and `in_scope()` refuses the rows. This is a narrower and
-- weaker thing, and the difference is worth stating in the schema because it
-- cannot be read off the column names:
--
--   Ticket data is not in Postgres. The whole state's `tickets.bin` is
--   downloaded into the browser, so restricting somebody to South zone changes
--   what the dashboard *shows* them, not what their machine holds. It is a
--   working scope, not a confidentiality boundary. Anyone who needs the second
--   needs a separate artifact per area, which is a build change, not a column.
--
-- Empty means everything, exactly as an admin's empty `scope` grants every
-- contract. That keeps every existing account unrestricted without a backfill,
-- and it is the only default that stays correct when a district is added.
--
-- Zone and district are deliberately two columns rather than one list. They are
-- different questions — a zone is a closed set of two in Kerala and absent in
-- Andhra, a district is one of fourteen — and the client enforces "a zone, or
-- districts, never both" on top. Storing them together would make that rule
-- unexpressible and let a later edit produce a scope nobody can read aloud.
-- ============================================================================

alter table profile add column if not exists zones     text[] not null default '{}';
alter table profile add column if not exists districts text[] not null default '{}';

comment on column profile.zones is
  'Zone names this account works, empty for all. A working scope shown in the '
  'UI, not a security boundary — ticket data is served as one artifact per state.';

comment on column profile.districts is
  'District names this account works, empty for all. Ignored when zones is set.';

-- =====================================================================
-- PART 2 · HR's employee list is the master record here too
--
-- Same arrangement as Spare in 0058: identity flows one way, from
-- employees to profile, and nothing flows back. BEMMP's own columns —
-- role and scope — are left alone by the sync, because which contracts
-- somebody works is BEMMP's judgement and not an HR fact.
-- =====================================================================

create or replace function public.bemmp_sync_profile_from_employee()
returns trigger
language plpgsql security definer set search_path = public as $bemmp_sync$
begin
  if new.auth_user_id is null then
    return new;
  end if;

  insert into profile (id, code, full_name, role)
  values (new.auth_user_id, new.ecode, new.full_name, 'coordinator'::app_role)
  on conflict (id) do update set
    code      = excluded.code,
    full_name = excluded.full_name;
    -- role and scope deliberately absent: BEMMP's to decide.

  return new;
end $bemmp_sync$;

drop trigger if exists trg_employees_sync_bemmp_profile on employees;
create trigger trg_employees_sync_bemmp_profile
  after insert or update of ecode, full_name, auth_user_id on employees
  for each row execute function public.bemmp_sync_profile_from_employee();


-- ---------------------------------------------------------------------
-- Seed.
--
-- scope stays empty, which in this schema means every contract rather
-- than none — 0009 is explicit about that. Directors for the two admin
-- accounts, coordinator for everybody else; BEMMP's own admin screens
-- promote from there.
-- ---------------------------------------------------------------------
insert into profile (id, code, full_name, role, scope)
select
  e.auth_user_id,
  e.ecode,
  e.full_name,
  case when exists (
    select 1 from user_roles ur
    where ur.employee_id = e.id and ur.role in ('hr_admin', 'sw_admin')
  ) then 'director'::app_role else 'coordinator'::app_role end,
  '{}'::text[]
from employees e
where e.auth_user_id is not null
on conflict (id) do nothing;


-- =====================================================================
-- Self-test
-- =====================================================================
do $bemmp_selftest$
declare
  n_emp      integer;
  n_prof     integer;
  n_director integer;
  probe_id   uuid;
  probe_auth uuid;
  original   text;
begin
  select count(*) into n_emp  from employees where auth_user_id is not null;
  select count(*) into n_prof from profile;
  if n_prof < n_emp then
    raise exception 'Seeded % BEMMP profiles for % employees with logins', n_prof, n_emp;
  end if;

  select count(*) into n_director from profile where role = 'director';
  if n_director < 2 then
    raise exception 'Expected HR Admin and SW Admin as directors, found %', n_director;
  end if;

  -- Spare's is_admin must have survived. BEMMP defines a function by that
  -- name over its own table; letting it load unrenamed would have replaced
  -- Spare's and silently opened or closed every Spare policy at once.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'is_admin'
      and pg_get_functiondef(p.oid) like '%from profiles%'
  ) then
    raise exception 'is_admin() no longer reads Spare''s profiles table';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'bemmp_is_admin'
  ) then
    raise exception 'bemmp_is_admin() was not created';
  end if;

  -- Identity follows HR, on a real row, restored afterwards.
  select e.id, e.auth_user_id, e.full_name
    into probe_id, probe_auth, original
  from employees e where e.auth_user_id is not null order by e.ecode limit 1;

  update employees set full_name = 'ZZ-0060-PROBE' where id = probe_id;
  if not exists (select 1 from profile where id = probe_auth and full_name = 'ZZ-0060-PROBE') then
    raise exception 'A rename in employees did not reach the BEMMP profile';
  end if;
  update employees set full_name = original where id = probe_id;

  raise notice '0060 self-test passed (% BEMMP profiles, % directors)', n_prof, n_director;
end $bemmp_selftest$;
