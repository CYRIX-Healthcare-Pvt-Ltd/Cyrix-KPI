-- =====================================================================
-- Cyrix KPI  ·  0255  ·  A quiz question answered in words
--
-- The user, 5 Nov: "need text also, not only choices". A Text question
-- takes the correct answer typed by whoever posts it, and any other
-- spellings to accept; a person's answer scores when it matches one of
-- them, without regard to capitals or extra spaces.
-- =====================================================================

-- The posting desk sets the questions, their correct choices and marks.
create or replace function digest_set_quiz(p_id uuid, p_questions jsonb, p_closes_at timestamptz)
returns void
language plpgsql security definer set search_path = public as $$
declare
  q jsonb; n int := 0; answered boolean; keep uuid[] := '{}'; qid uuid; opts text[]; right_ text[]; pts int;
  prev record;
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted the quiz can set its questions';
  end if;
  if p_closes_at is null then raise exception 'A quiz needs a closing date'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'A quiz needs at least one question'; end if;
  if jsonb_array_length(p_questions) > 50 then raise exception 'A quiz takes up to 50 questions'; end if;
  answered := exists (select 1 from digest_form_responses where post_id = p_id);
  update digest_posts set closes_at = p_closes_at where id = p_id;

  for q in select * from jsonb_array_elements(p_questions) loop
    n := n + 1;
    if btrim(coalesce(q->>'label', '')) = '' then raise exception 'Question % has no wording', n; end if;
    if coalesce(q->>'qtype', '') not in ('one', 'many', 'short') then raise exception 'Question % must be One choice, Many choices or Text', n; end if;
    if q->>'qtype' = 'short' then
      -- A text answer: the accepted answers, matched without regard to capitals or extra spaces.
      opts := '{}';
      select coalesce(array_agg(distinct regexp_replace(btrim(o), '\s+', ' ', 'g')), '{}') into right_
      from jsonb_array_elements_text(coalesce(q->'correct', '[]'::jsonb)) o where btrim(o) <> '';
      if cardinality(right_) = 0 then raise exception 'Type the correct answer for question %', n; end if;
      if cardinality(right_) > 10 then raise exception 'Question % takes up to 10 accepted answers', n; end if;
    else
      select coalesce(array_agg(btrim(o) order by i), '{}') into opts
      from jsonb_array_elements_text(coalesce(q->'options', '[]'::jsonb)) with ordinality as t(o, i) where btrim(o) <> '';
      if cardinality(opts) < 2 then raise exception 'Question % needs at least two choices', n; end if;
      if cardinality(opts) <> (select count(distinct o) from unnest(opts) o) then raise exception 'Question % has the same choice twice', n; end if;
      select coalesce(array_agg(distinct btrim(o)), '{}') into right_
      from jsonb_array_elements_text(coalesce(q->'correct', '[]'::jsonb)) o where btrim(o) = any (opts);
      if cardinality(right_) = 0 then raise exception 'Mark the correct answer for question %', n; end if;
    end if;
    if q->>'qtype' = 'one' and cardinality(right_) > 1 then raise exception 'Question % takes one correct answer', n; end if;
    pts := coalesce(nullif(q->>'points', '')::int, 1);
    if pts < 1 or pts > 100 then raise exception 'Marks for question % go from 1 to 100', n; end if;

    qid := nullif(q->>'id', '')::uuid;
    select * into prev from digest_form_questions where id = qid and post_id = p_id;
    if found then
      if answered and (prev.qtype <> q->>'qtype' or prev.points <> pts
                       or (select array_agg(x order by x) from unnest(prev.correct) x) is distinct from (select array_agg(x order by x) from unnest(right_) x)
                       or prev.options <> opts) then
        raise exception 'People have sent it already, so question % keeps its choices, correct answer and marks', n;
      end if;
      update digest_form_questions set position = n, label = btrim(q->>'label'), qtype = q->>'qtype', options = opts,
             required = true, correct = right_, points = pts
      where id = qid;
    else
      if answered then raise exception 'People have sent it already, so no question can be added'; end if;
      insert into digest_form_questions (post_id, position, label, qtype, options, required, correct, points)
      values (p_id, n, btrim(q->>'label'), q->>'qtype', opts, true, right_, pts)
      returning id into qid;
    end if;
    keep := keep || qid;
  end loop;

  if answered and exists (select 1 from digest_form_questions where post_id = p_id and not (id = any (keep))) then
    raise exception 'People have sent it already, so no question can be removed';
  end if;
  delete from digest_form_questions where post_id = p_id and not (id = any (keep));
end $$;
revoke all on function digest_set_quiz(uuid, jsonb, timestamptz) from public, anon;
grant execute on function digest_set_quiz(uuid, jsonb, timestamptz) to authenticated;

-- Send one's answers, once: every question answered, before it closes. Scored here.
create or replace function digest_quiz_submit(p_id uuid, p_answers jsonb)
returns table (score int, max_score int)
language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); q record; v jsonb; picked text[]; clean jsonb := '{}'::jsonb; got int := 0; total int := 0;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from digest_posts where id = p_id and kind = 'quiz' and deleted_at is null) then
    raise exception 'That quiz is not there';
  end if;
  if (select closes_at from digest_posts where id = p_id) < now() then raise exception 'This quiz has closed'; end if;
  if exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
    raise exception 'You have sent this quiz already';
  end if;
  for q in select * from digest_form_questions where post_id = p_id order by position loop
    v := p_answers -> q.id::text;
    if q.qtype = 'many' then
      if v is null or jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 then raise exception 'Answer "%" first', q.label; end if;
      select coalesce(array_agg(distinct x), '{}') into picked from jsonb_array_elements_text(v) x;
      if exists (select 1 from unnest(picked) x where not (x = any (q.options))) then raise exception 'Choose from the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, to_jsonb(picked));
      if picked <@ q.correct and q.correct <@ picked then got := got + q.points; end if;
    elsif q.qtype = 'short' then
      if v is null or jsonb_typeof(v) <> 'string' or btrim(v #>> '{}') = '' then raise exception 'Answer "%" first', q.label; end if;
      if length(v #>> '{}') > 300 then raise exception 'The answer to "%" is too long', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, btrim(v #>> '{}'));
      if lower(regexp_replace(btrim(v #>> '{}'), '\s+', ' ', 'g')) = any (select lower(x) from unnest(q.correct) x) then got := got + q.points; end if;
    else
      if v is null or jsonb_typeof(v) <> 'string' or btrim(v #>> '{}') = '' then raise exception 'Answer "%" first', q.label; end if;
      if not ((v #>> '{}') = any (q.options)) then raise exception 'Choose one of the choices for "%"', q.label; end if;
      clean := clean || jsonb_build_object(q.id::text, v);
      if (v #>> '{}') = any (q.correct) then got := got + q.points; end if;
    end if;
    total := total + q.points;
  end loop;
  insert into digest_form_responses (post_id, employee_id, answers, score, max_score) values (p_id, me, clean, got, total);
  return query select got, total;
end $$;
revoke all on function digest_quiz_submit(uuid, jsonb) from public, anon;
grant execute on function digest_quiz_submit(uuid, jsonb) to authenticated;

