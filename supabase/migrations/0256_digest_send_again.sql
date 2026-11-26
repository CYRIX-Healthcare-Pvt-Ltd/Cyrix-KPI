-- =====================================================================
-- Cyrix KPI  ·  0256  ·  Forms and quizzes sent once, unless allowed again
--
-- The user, 5 Nov: "in forms and quiz, we need a check box ie can send
-- mulitple response, default is off, if only on the this needed ie you can
-- change it until, if not dont show it, say submitted".
--
-- allow_again off (the default, for every form and quiz): each person sends
-- it once. On: a form's answers can be changed, and a quiz taken again (its
-- latest score counts), until it closes. An anonymous form is always sent
-- once, as nothing links its answers to the person (0254).
-- =====================================================================

alter table digest_posts add column if not exists allow_again boolean not null default false;

create or replace function digest_set_allow_again(p_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from digest_posts where id = p_id and kind in ('form', 'quiz') and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted it can change this';
  end if;
  update digest_posts set allow_again = coalesce(p_on, false) and not anonymous where id = p_id;
end $$;
revoke all on function digest_set_allow_again(uuid, boolean) from public, anon;
grant execute on function digest_set_allow_again(uuid, boolean) to authenticated;

create or replace function digest_allow_again(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select allow_again from digest_posts where id = p_id and deleted_at is null), false)
  where current_employee_id() is not null
$$;
revoke all on function digest_allow_again(uuid) from public, anon;
grant execute on function digest_allow_again(uuid) to authenticated;

do $$
declare src text; at_ text;
begin
  -- A form: sent once unless allowed again.
  select replace(pg_get_functiondef('digest_form_submit(uuid, jsonb)'::regprocedure), E'\r\n', E'\n') into src;
  at_ := '  if (select anonymous from digest_posts where id = p_id) then';
  if position(at_ in src) = 0 then raise exception 'digest_form_submit has changed'; end if;
  execute replace(src, at_,
'  if not (select allow_again from digest_posts where id = p_id)
     and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
    raise exception ''You have sent this form already'';
  end if;
' || at_);

  -- A quiz: taken again when allowed, the latest score kept.
  select replace(pg_get_functiondef('digest_quiz_submit(uuid, jsonb)'::regprocedure), E'\r\n', E'\n') into src;
  at_ := '  if exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then';
  if position(at_ in src) = 0 then raise exception 'digest_quiz_submit has changed (1)'; end if;
  src := replace(src, at_, '  if not (select allow_again from digest_posts where id = p_id)
     and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then');
  at_ := 'insert into digest_form_responses (post_id, employee_id, answers, score, max_score) values (p_id, me, clean, got, total);';
  if position(at_ in src) = 0 then raise exception 'digest_quiz_submit has changed (2)'; end if;
  execute replace(src, at_, 'insert into digest_form_responses (post_id, employee_id, answers, score, max_score) values (p_id, me, clean, got, total)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, score = excluded.score, max_score = excluded.max_score, updated_at = now();');
end $$;
