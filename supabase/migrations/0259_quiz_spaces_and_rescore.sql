-- =====================================================================
-- Cyrix KPI  ·  0259  ·  Quiz: spaces don't matter; answers and marks can change, and scores follow
--
-- The user, 5 Nov: "in text answer option, space is making it wrong" —
-- "Care360" was marked wrong against "Care 360". A text answer now matches
-- with all spaces and capitals left out. And the correct answers and marks
-- may be changed after people have sent it (the spellings added to that
-- quiz were refused for that reason): everybody's score is counted again.
-- A question's type and choices still stay as they were.
-- =====================================================================

create or replace function digest_quiz_norm(t text)
returns text language sql immutable as $$ select lower(regexp_replace(coalesce(t, ''), '\s+', '', 'g')) $$;

-- Every sent answer of a quiz scored again against its questions as they are now.
create or replace function digest_quiz_rescore(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r record; q record; v jsonb; got int; total int; picked text[];
begin
  for r in select * from digest_form_responses where post_id = p_id loop
    got := 0; total := 0;
    for q in select * from digest_form_questions where post_id = p_id loop
      total := total + q.points;
      v := r.answers -> q.id::text;
      continue when v is null;
      if q.qtype = 'many' and jsonb_typeof(v) = 'array' then
        select coalesce(array_agg(distinct x), '{}') into picked from jsonb_array_elements_text(v) x;
        if picked <@ q.correct and q.correct <@ picked then got := got + q.points; end if;
      elsif q.qtype = 'short' and jsonb_typeof(v) = 'string' then
        if digest_quiz_norm(v #>> '{}') = any (select digest_quiz_norm(x) from unnest(q.correct) x) then got := got + q.points; end if;
      elsif jsonb_typeof(v) = 'string' and (v #>> '{}') = any (q.correct) then
        got := got + q.points;
      end if;
    end loop;
    update digest_form_responses set score = got, max_score = total where post_id = r.post_id and employee_id = r.employee_id;
  end loop;
end $$;
revoke all on function digest_quiz_rescore(uuid) from public, anon, authenticated;

do $$
declare src text; a text; b text;
begin
  -- Sending: a text answer without regard to spaces.
  select replace(pg_get_functiondef('digest_quiz_submit(uuid, jsonb)'::regprocedure), E'\r\n', E'\n') into src;
  a := 'if lower(regexp_replace(btrim(v #>> ''{}''), ''\s+'', '' '', ''g'')) = any (select lower(regexp_replace(btrim(x), ''\s+'', '' '', ''g'')) from unnest(q.correct) x) then';
  if position(a in src) = 0 then raise exception 'digest_quiz_submit has changed'; end if;
  execute replace(src, a, 'if digest_quiz_norm(v #>> ''{}'') = any (select digest_quiz_norm(x) from unnest(q.correct) x) then');

  -- Setting: answers and marks may change once sent; type and choices may not; then score everybody again.
  select replace(pg_get_functiondef('digest_set_quiz(uuid, jsonb, timestamptz)'::regprocedure), E'\r\n', E'\n') into src;
  a := '      if answered and (prev.qtype <> q->>''qtype'' or prev.points <> pts
                       or (select array_agg(x order by x) from unnest(prev.correct) x) is distinct from (select array_agg(x order by x) from unnest(right_) x)
                       or prev.options <> opts) then
        raise exception ''People have sent it already, so question % keeps its choices, correct answer and marks'', n;';
  if position(a in src) = 0 then raise exception 'digest_set_quiz has changed (1)'; end if;
  src := replace(src, a, '      if answered and (prev.qtype <> q->>''qtype'' or prev.options <> opts) then
        raise exception ''People have sent it already, so question % keeps its type and choices'', n;');
  b := '  delete from digest_form_questions where post_id = p_id and not (id = any (keep));
end';
  if position(b in src) = 0 then raise exception 'digest_set_quiz has changed (2)'; end if;
  execute replace(src, b, '  delete from digest_form_questions where post_id = p_id and not (id = any (keep));
  if answered then perform digest_quiz_rescore(p_id); end if;
end');
end $$;

-- Quizzes already answered: their text answers counted again without spaces.
select digest_quiz_rescore(p.id) from digest_posts p where p.kind = 'quiz' and exists (select 1 from digest_form_questions q where q.post_id = p.id and q.qtype = 'short');
