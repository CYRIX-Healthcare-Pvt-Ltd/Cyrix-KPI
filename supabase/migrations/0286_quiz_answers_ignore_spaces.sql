-- =====================================================================
-- Cyrix KPI  ·  0286  ·  Written quiz answers ignore spaces
--
-- The user, 12 Nov: "I got 15/15 but it is showing 14/15". The page counted
-- "Revivelab" as right for "Revive Lab" (it ignores spaces) while the server
-- did not, so the score and the page's "15 of 15 correct" disagreed. Written
-- answers now match ignoring spaces and capitals, as the page always did, and
-- every quiz's sent answers are scored again (scores only go up).
-- =====================================================================

create or replace function digest_quiz_same(p_answer text, p_correct text[])
returns boolean
language sql immutable as $$
  select lower(regexp_replace(coalesce(p_answer, ''), '\s+', '', 'g')) <> ''
     and lower(regexp_replace(coalesce(p_answer, ''), '\s+', '', 'g')) = any (select lower(regexp_replace(x, '\s+', '', 'g')) from unnest(p_correct) x)
$$;

-- Sending: within the time the clock has run (and 30 seconds' grace) as sent; past it, the answers kept are what count.
create or replace function digest_quiz_submit(p_id uuid, p_answers jsonb)
returns table (score int, max_score int)
language plpgsql security definer set search_path = public as $$
declare
  me uuid := current_employee_id(); p record; s digest_quiz_starts; timed boolean; ans jsonb := coalesce(p_answers, '{}'::jsonb);
  q record; v jsonb; picked text[]; clean jsonb := '{}'::jsonb; got int := 0; total int := 0;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into p from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null;
  if not found then raise exception 'That quiz is not there'; end if;
  timed := p.time_limit_seconds is not null;
  if not p.allow_again and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
    raise exception 'You have sent this quiz already';
  end if;
  if timed then
    s := digest_quiz_open_row(p_id, me);
    if s.post_id is null then raise exception 'Press Start first'; end if;
    if digest_quiz_used(s) > p.time_limit_seconds + 30 then ans := coalesce(s.draft, '{}'::jsonb); end if;
  elsif p.closes_at < now() then
    raise exception 'This quiz has closed';
  end if;

  for q in select * from digest_form_questions where post_id = p_id order by position loop
    total := total + q.points;
    v := ans -> q.id::text;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb
       or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if timed then continue; end if;
      raise exception 'Answer "%" first', q.label;
    end if;
    if q.qtype = 'many' then
      if jsonb_typeof(v) <> 'array' then raise exception 'Choose from the choices for "%"', q.label; end if;
      select coalesce(array_agg(distinct x), '{}') into picked from jsonb_array_elements_text(v) x;
      if exists (select 1 from unnest(picked) x where not (x = any (q.options))) then raise exception 'Choose from the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, to_jsonb(picked));
      if picked <@ q.correct and q.correct <@ picked then got := got + q.points; end if;
    elsif q.qtype = 'short' then
      if jsonb_typeof(v) <> 'string' then raise exception 'Answer "%" in words', q.label; end if;
      if length(v #>> '{}') > 300 then raise exception 'The answer to "%" is too long', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, btrim(v #>> '{}'));
      if digest_quiz_same(v #>> '{}', q.correct) then
        got := got + q.points;
      end if;
    else
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (q.options)) then raise exception 'Choose one of the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, v);
      if (v #>> '{}') = any (q.correct) then got := got + q.points; end if;
    end if;
  end loop;
  -- The clock stops at sending; time taken is what it ran.
  if timed then
    update digest_quiz_starts set used_seconds = least(p.time_limit_seconds, digest_quiz_used(s)), running_since = null
    where post_id = p_id and employee_id = me;
  end if;
  insert into digest_form_responses (post_id, employee_id, answers, score, max_score) values (p_id, me, clean, got, total)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, score = excluded.score, max_score = excluded.max_score, updated_at = now();
  return query select got, total;
end $$;
revoke all on function digest_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function digest_quiz_submit(uuid, jsonb) to authenticated;


-- Score again every sent quiz answer the same way (choices unchanged; written answers ignoring spaces).
update digest_form_responses r set score = x.got
from (
  select r2.post_id, r2.employee_id, coalesce(sum(case
      when q.qtype = 'short' then case when jsonb_typeof(r2.answers -> q.id::text) = 'string' and digest_quiz_same(r2.answers ->> q.id::text, q.correct) then q.points else 0 end
      when q.qtype = 'many' then case when jsonb_typeof(r2.answers -> q.id::text) = 'array'
             and (select coalesce(array_agg(distinct e), '{}') from jsonb_array_elements_text(r2.answers -> q.id::text) e) <@ q.correct
             and q.correct <@ (select coalesce(array_agg(distinct e), '{}') from jsonb_array_elements_text(r2.answers -> q.id::text) e) then q.points else 0 end
      else case when (r2.answers ->> q.id::text) = any (q.correct) then q.points else 0 end
    end), 0) got
  from digest_form_responses r2 join digest_posts p on p.id = r2.post_id and p.kind = 'quiz'
  join digest_form_questions q on q.post_id = r2.post_id
  group by r2.post_id, r2.employee_id
) x
where r.post_id = x.post_id and r.employee_id = x.employee_id and x.got > r.score;
