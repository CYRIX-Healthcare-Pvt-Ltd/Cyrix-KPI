-- =====================================================================
-- Cyrix KPI  ·  0045  ·  Say why the score went down
--
-- A manager can score somebody well below their own assessment and
-- submit it without a word. The team member sees a number drop and has
-- to raise a query to find out why — which is a dispute where a sentence
-- would have done.
--
-- So: more than five points below the self assessment and the reason is
-- required. Not a nudge, not a placeholder — the action refuses.
--
-- Five points on the total, deliberately. Per row it would fire on
-- rounding: a row worth 5% marked one unit lower is a 100% cut of that
-- row and nothing at all to explain. The total is what the person sees
-- and what they would query.
-- =====================================================================

alter table kpi_submissions
  add column if not exists score_cut_reason text;

comment on column kpi_submissions.score_cut_reason is
  'Why the manager scored materially below the self assessment. Required '
  'when the gap is more than 5 points; shown to the team member.';


-- ---------------------------------------------------------------------
-- The rule.
--
-- The old single-argument function is dropped rather than left beside
-- the new one: a defaulted second parameter alongside it makes every
-- one-argument call ambiguous, and Postgres reports that at call time
-- rather than here.
-- ---------------------------------------------------------------------
drop function if exists submit_manager_scores(uuid);

create or replace function submit_manager_scores(
  p_submission_id uuid,
  p_reason        text default null
)
returns kpi_submissions
language plpgsql security definer set search_path = public as $$
declare
  s        kpi_submissions%rowtype;
  missing  int;
  gap      numeric;
  who      text;
  -- Mirrored in the client as SCORE_CUT_POINTS. If one moves, move both.
  cut_at   constant numeric := 5;
begin
  select * into s from kpi_submissions where id = p_submission_id;
  if not found then raise exception 'Submission not found'; end if;
  if not (manages_employee(s.employee_id) or is_hr_admin()) then
    raise exception 'Only the reporting manager or HR can score this';
  end if;
  if s.status not in ('submitted','scored') then
    raise exception 'This month is not ready for scoring (current: %)', s.status;
  end if;

  select count(*) into missing
  from kpi_submission_items
  where submission_id = p_submission_id
    and section <> 'core_values' and manager_achieved is null;
  if missing > 0 then
    raise exception '% KPI row(s) still need a manager value', missing;
  end if;

  -- How far below their own assessment this lands.
  gap := case
    when s.self_total_score is null or s.mgr_total_score is null then null
    else s.self_total_score - s.mgr_total_score
  end;

  if gap is not null and gap > cut_at then
    if p_reason is null or btrim(p_reason) = '' then
      select split_part(full_name, ' ', 1) into who
      from employees where id = s.employee_id;
      raise exception
        'Your score is % points below %''s own assessment. Say why before you submit — they will see it.',
        round(gap, 1), coalesce(who, 'their');
    end if;
  end if;

  perform set_config('cyrix.system_write', 'on', true);
  update kpi_submissions
  set status            = 'scored',
      manager_scored_at = now(),
      -- Cleared when the gap closes. A manager who revises upward should
      -- not leave last version's explanation attached to a score it no
      -- longer describes.
      score_cut_reason  = case
        when gap is not null and gap > cut_at then btrim(p_reason)
        else nullif(btrim(coalesce(p_reason, '')), '')
      end
  where id = p_submission_id returning * into s;
  perform set_config('cyrix.system_write', 'off', true);

  perform log_audit('kpi_submission', p_submission_id, 'manager_scored',
                    jsonb_build_object('gap', gap,
                                       'explained', p_reason is not null));
  return s;
end $$;

grant execute on function submit_manager_scores(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- And it cannot be written any other way.
--
-- Without this a team member could PATCH the column directly and edit
-- the explanation of their own score. Reproduced whole from 0010 with
-- one clause added — the guard takes no patches either.
-- ---------------------------------------------------------------------
create or replace function guard_submission_header()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if system_write_active() then
    return new;
  end if;

  -- No end user means a direct database connection: a migration, an admin
  -- script, or the service role. Those are trusted and bypass RLS anyway.
  -- An anonymous PostgREST caller never reaches here — every policy on this
  -- table is `to authenticated`, and anon holds no UPDATE grant.
  if auth.uid() is null then
    return new;
  end if;

  if is_hr_admin() then return new; end if;

  if new.status is distinct from old.status then
    raise exception 'Status changes must go through the submit / score / finalise actions';
  end if;
  if new.self_total_score    is distinct from old.self_total_score
     or new.mgr_total_score   is distinct from old.mgr_total_score
     or new.final_total_score is distinct from old.final_total_score then
    raise exception 'Scores are calculated and cannot be set directly';
  end if;

  -- New in 0045. It belongs to the scoring action, not to whoever holds
  -- an UPDATE grant on the row.
  if new.score_cut_reason is distinct from old.score_cut_reason then
    raise exception 'The reason for a reduced score is set when the score is submitted';
  end if;

  if old.employee_id = current_employee_id() then
    if new.manager_remarks is distinct from old.manager_remarks then
      raise exception 'You cannot edit the manager remarks';
    end if;
  elsif manages_employee(old.employee_id) then
    if new.employee_remarks is distinct from old.employee_remarks then
      raise exception 'You cannot edit the team member''s remarks';
    end if;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- Self-test.
--
-- Only ever calls the function where it is expected to refuse, so no
-- real assessment is advanced. Were it to succeed unexpectedly, the
-- assertion fails and the whole file rolls back with it.
-- ---------------------------------------------------------------------
do $$
declare
  sid     uuid;
  gap     numeric;
  n_args  int;
begin
  -- The one-argument version must be gone, or every existing caller
  -- becomes ambiguous.
  select count(*) into n_args
  from pg_proc where proname = 'submit_manager_scores';
  if n_args <> 1 then
    raise exception
      'expected exactly one submit_manager_scores, found %', n_args;
  end if;

  select id, self_total_score - mgr_total_score into sid, gap
  from kpi_submissions
  where status in ('submitted','scored')
    and self_total_score is not null
    and mgr_total_score is not null
    and self_total_score - mgr_total_score > 5
  limit 1;

  if sid is null then
    raise notice
      '0045 self-test partial — no submission is currently more than 5 '
      'points below its self assessment; column, rule and guard installed';
    return;
  end if;

  begin
    perform submit_manager_scores(sid, null);
    raise exception 'a % point cut was accepted with no reason', round(gap, 1);
  exception when others then
    if sqlerrm not like 'Your score is % points below%' then raise; end if;
  end;

  raise notice
    '0045 self-test passed — a % point cut was refused without a reason',
    round(gap, 1);
end $$;
