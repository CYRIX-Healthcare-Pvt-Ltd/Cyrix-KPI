-- =====================================================================
-- Cyrix KPI  ·  0114  ·  The tracker says where a PR and a PO stand
--
-- The meeting asked for two more columns beside the purchase trail:
--   PR status  Cancelled, Clarification or Hold  (after PR purchase remark)
--   PO status  Cancelled                         (after Purchase delay days)
-- Blank is null in both.
--
-- Checked here and not only offered in the dropdown. The grid is not the
-- only thing that writes these rows -- the workbook import does too --
-- and a typo stored as a fourth status becomes a filter value nobody can
-- explain.
--
-- The audit trigger lists every column it logs by name, so without the
-- second half of this the edits would save and never appear in a
-- ticket's log. Its body below is the live definition read back with
-- pg_get_functiondef, with the two names spliced in beside their
-- neighbours. Nothing was retyped.
--
-- Nothing else needed: authenticated already holds table-wide select,
-- insert and update on meeting_note, and no view or other function
-- names its columns.
-- =====================================================================

alter table meeting_note
  add column if not exists pr_status text
    constraint meeting_note_pr_status_check
    check (pr_status in ('Cancelled', 'Clarification', 'Hold')),
  add column if not exists po_status text
    constraint meeting_note_po_status_check
    check (po_status in ('Cancelled'));

comment on column meeting_note.pr_status is
  'Where the PR stands: Cancelled, Clarification or Hold; null for none.';
comment on column meeting_note.po_status is
  'Cancelled, or null while the PO stands.';

CREATE OR REPLACE FUNCTION public.log_meeting_note_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  col     text;
  oldv    text;
  newv    text;
  touched boolean := false;
begin
  foreach col in array array[
    'penalty_type','current_status','trc_given_date','trc_spare_received_date',
    'standby_given_date','standby_days','pi_no','pi_date','pi_tat','pr_no',
    'pr_date','pr_conversion_days','pr_remark','pr_status','po_no','po_date',
    'purchase_delay_days','po_status','vendor_name','payment_request_date','payment_date',
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
end $function$;

do $$
declare
  probe_state  text;
  probe_ticket text;
  logged       integer;
begin
  if not has_column_privilege('authenticated', 'meeting_note', 'pr_status', 'UPDATE')
     or not has_column_privilege('authenticated', 'meeting_note', 'po_status', 'UPDATE') then
    raise exception 'authenticated cannot update the new status columns';
  end if;

  select state, ticket into probe_state, probe_ticket from meeting_note limit 1;
  if probe_ticket is null then
    raise notice '0114 self-test: no rows to probe, schema checks only';
    return;
  end if;

  -- A value outside the list is refused.
  begin
    update meeting_note set pr_status = 'Pending'
    where state = probe_state and ticket = probe_ticket;
    raise exception 'pr_status accepted a value outside its list';
  exception when check_violation then null;
  end;

  -- A real value saves and the trigger logs both columns. Rolled back.
  begin
    update meeting_note set pr_status = 'Hold', po_status = 'Cancelled'
    where state = probe_state and ticket = probe_ticket;
    select count(*) into logged from meeting_note_history
    where state = probe_state and ticket = probe_ticket
      and column_name in ('pr_status', 'po_status')
      and changed_at >= now() - interval '1 minute';
    if logged < 2 then
      raise exception 'the audit trigger logged % of the 2 status changes', logged;
    end if;
    raise exception 'rollback the probe';
  exception when others then
    if sqlerrm <> 'rollback the probe' then raise; end if;
  end;

  raise notice '0114 self-test passed (values checked, writable, and logged)';
end $$;
