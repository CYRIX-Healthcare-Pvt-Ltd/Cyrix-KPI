-- =====================================================================
-- Cyrix KPI  ·  0253  ·  Cyrix Digest quiz
--
-- The user, 5 Nov: "we need new thing, ie quiz, option to enter questions,
-- option to add choices or check boxes and the one who posts should able to
-- mark it as correct answer, score for each question. on submit by user, he
-- should see the result, ie scored, and question and answers, if wrong show
-- the correct answer".
--
-- A Quiz post uses the form's questions (0181), each One choice or Many
-- choices, with the correct choice(s) and its marks. Everybody answers every
-- question and sends it once. The score is worked out here, never in the
-- page, and the correct answers reach a person only after they have sent
-- theirs (or to whoever posted it). A Many choices question scores its marks
-- only when exactly the correct choices are ticked. Once anybody has sent
-- it, the correct answers and marks stay as they were, so every score is
-- counted the same way.
--
-- Undo: drop the quiz functions, the three columns, and 'quiz' from the
-- kind check, digest_ended, digest_feed and digest_last_day.
-- =====================================================================

alter table digest_posts drop constraint if exists digest_posts_kind_check;
alter table digest_posts add constraint digest_posts_kind_check
  check (kind in ('news', 'meeting', 'poll', 'announcement', 'alert', 'notice', 'vacancy', 'form', 'video', 'quiz'));

alter table digest_form_questions add column if not exists correct text[] not null default '{}';
alter table digest_form_questions add column if not exists points int not null default 1;
alter table digest_form_questions drop constraint if exists digest_form_questions_points_check;
alter table digest_form_questions add constraint digest_form_questions_points_check check (points between 1 and 100);
alter table digest_form_responses add column if not exists score int;
alter table digest_form_responses add column if not exists max_score int;

-- A quiz closes, and leaves the home page, as a form does.
do $$
declare src text;
begin
  select pg_get_functiondef('digest_ended'::regproc) into src;
  if src not like '%p_kind in (''poll'', ''form'')%' then raise exception 'digest_ended has changed'; end if;
  execute replace(src, 'p_kind in (''poll'', ''form'')', 'p_kind in (''poll'', ''form'', ''quiz'')');

  select pg_get_functiondef('digest_feed'::regproc) into src;
  if src not like '%p.kind not in (''poll'', ''form'')%' then raise exception 'digest_feed has changed'; end if;
  execute replace(src, 'p.kind not in (''poll'', ''form'')', 'p.kind not in (''poll'', ''form'', ''quiz'')');

  select pg_get_functiondef('digest_last_day'::regproc) into src;
  if src not like '%when ''form'' then (p_closes_at at time zone ''Asia/Kolkata'')::date%' then raise exception 'digest_last_day has changed'; end if;
  execute replace(src, 'when ''form'' then (p_closes_at at time zone ''Asia/Kolkata'')::date',
    'when ''form'' then (p_closes_at at time zone ''Asia/Kolkata'')::date
           when ''quiz'' then (p_closes_at at time zone ''Asia/Kolkata'')::date');
end $$;

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
    if coalesce(q->>'qtype', '') not in ('one', 'many') then raise exception 'Question % must be One choice or Many choices', n; end if;
    select coalesce(array_agg(btrim(o) order by i), '{}') into opts
    from jsonb_array_elements_text(coalesce(q->'options', '[]'::jsonb)) with ordinality as t(o, i) where btrim(o) <> '';
    if cardinality(opts) < 2 then raise exception 'Question % needs at least two choices', n; end if;
    if cardinality(opts) <> (select count(distinct o) from unnest(opts) o) then raise exception 'Question % has the same choice twice', n; end if;
    select coalesce(array_agg(distinct btrim(o)), '{}') into right_
    from jsonb_array_elements_text(coalesce(q->'correct', '[]'::jsonb)) o where btrim(o) = any (opts);
    if cardinality(right_) = 0 then raise exception 'Mark the correct answer for question %', n; end if;
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

-- The questions; the correct answers only once this person has sent theirs, or to whoever posted it.
create or replace function digest_quiz(p_id uuid)
returns table (id uuid, label text, qtype text, options text[], points int, correct text[], closes_at timestamptz,
               mine jsonb, sent_at timestamptz, score int, max_score int)
language sql stable security definer set search_path = public as $$
  with r as (select * from digest_form_responses r where r.post_id = p_id and r.employee_id = current_employee_id())
  select q.id, q.label, q.qtype, q.options, q.points,
         case when exists (select 1 from r) or digest_can_edit(p_id) then q.correct end,
         p.closes_at, (select r.answers from r), (select r.created_at from r), (select r.score from r), (select r.max_score from r)
  from digest_form_questions q join digest_posts p on p.id = q.post_id
  where q.post_id = p_id and p.kind = 'quiz' and p.deleted_at is null and current_employee_id() is not null
  order by q.position
$$;
revoke all on function digest_quiz(uuid) from public, anon;
grant execute on function digest_quiz(uuid) to authenticated;

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

-- Everybody's score, for whoever posted it.
create or replace function digest_quiz_scores(p_id uuid)
returns table (ecode text, score int, max_score int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from digest_posts where id = p_id and (digest_can_edit(id) or is_sw_admin())) then
    raise exception 'Only whoever posted it';
  end if;
  return query select e.ecode, r.score, r.max_score
  from digest_form_responses r join employees e on e.id = r.employee_id where r.post_id = p_id;
end $$;
revoke all on function digest_quiz_scores(uuid) from public, anon;
grant execute on function digest_quiz_scores(uuid) to authenticated;
