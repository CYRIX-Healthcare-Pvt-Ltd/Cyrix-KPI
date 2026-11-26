-- =====================================================================
-- Cyrix KPI  ·  0278  ·  Sub-questions in a Digest form
--
-- Under any form question, a long-text sub-question (the user, 10 Nov:
-- "how is my performance, 1-5, so on same qstn under that, tell me whr to
-- improve as long text box"). Each sub-question is optional, required, or
-- required only when its question's answer is a rating below N, or No.
--
-- A sub-question is a row of digest_form_questions with parent_id set and
-- qtype 'long'; required_if is 'below:N' or 'no' (null: the required flag).
-- Answers stay keyed by question id, so anonymous forms and the Excel need
-- nothing new. digest_form returns parent_id and required_if; the portal
-- shows a sub-question under its question.
-- =====================================================================

alter table digest_form_questions
  add column if not exists parent_id uuid references digest_form_questions(id) on delete cascade,
  add column if not exists required_if text check (required_if is null or required_if = 'no' or required_if ~ '^below:[2-5]$');

create or replace function public.digest_set_form(p_id uuid, p_questions jsonb, p_closes_at timestamptz)
returns void language plpgsql security definer set search_path = public as $$
declare
  q jsonb; s jsonb; n int := 0; k int; answered boolean; keep uuid[] := '{}'; qid uuid; sid uuid; opts text[]; rif text;
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'form' and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted the form can set its questions';
  end if;
  if p_closes_at is null then raise exception 'A form needs a closing date'; end if;
  if jsonb_typeof(p_questions) <> 'array' or jsonb_array_length(p_questions) = 0 then raise exception 'A form needs at least one question'; end if;
  if jsonb_array_length(p_questions) > 30 then raise exception 'A form takes up to 30 questions'; end if;
  answered := exists (select 1 from digest_form_responses where post_id = p_id);
  update digest_posts set closes_at = p_closes_at where id = p_id;

  for q in select * from jsonb_array_elements(p_questions) loop
    n := n + 1;
    if btrim(coalesce(q->>'label', '')) = '' then raise exception 'Question % has no wording', n; end if;
    select coalesce(array_agg(btrim(o) order by i), '{}') into opts
    from jsonb_array_elements_text(coalesce(q->'options', '[]'::jsonb)) with ordinality as t(o, i) where btrim(o) <> '';
    if q->>'qtype' in ('one', 'many') and cardinality(opts) < 2 then raise exception 'Question % needs at least two choices', n; end if;
    qid := nullif(q->>'id', '')::uuid;
    if qid is not null and exists (select 1 from digest_form_questions where id = qid and post_id = p_id and parent_id is null) then
      if answered and (select qtype from digest_form_questions where id = qid) <> q->>'qtype' then
        raise exception 'People have answered already, so question % cannot change its type', n;
      end if;
      update digest_form_questions set position = n * 10, label = btrim(q->>'label'), qtype = q->>'qtype', options = opts,
             required = coalesce((q->>'required')::boolean, false), required_if = null
      where id = qid;
    else
      insert into digest_form_questions (post_id, position, label, qtype, options, required)
      values (p_id, n * 10, btrim(q->>'label'), q->>'qtype', opts, coalesce((q->>'required')::boolean, false))
      returning id into qid;
    end if;
    keep := keep || qid;

    -- Its sub-questions, long text, in order under it.
    if jsonb_typeof(q->'subs') = 'array' then
      if jsonb_array_length(q->'subs') > 5 then raise exception 'Question % takes up to 5 sub-questions', n; end if;
      k := 0;
      for s in select * from jsonb_array_elements(q->'subs') loop
        k := k + 1;
        if btrim(coalesce(s->>'label', '')) = '' then raise exception 'Sub-question % of question % has no wording', k, n; end if;
        rif := nullif(s->>'required_if', '');
        if rif = 'no' and q->>'qtype' <> 'yesno' then rif := null; end if;
        if rif like 'below:%' and q->>'qtype' <> 'rating' then rif := null; end if;
        if rif is not null and not (rif = 'no' or rif ~ '^below:[2-5]$') then raise exception 'Sub-question % of question % has an unknown rule', k, n; end if;
        sid := nullif(s->>'id', '')::uuid;
        if sid is not null and exists (select 1 from digest_form_questions where id = sid and post_id = p_id and parent_id is not null) then
          update digest_form_questions set parent_id = qid, position = n * 10 + k, label = btrim(s->>'label'), qtype = 'long', options = '{}',
                 required = coalesce((s->>'required')::boolean, false), required_if = rif
          where id = sid;
        else
          insert into digest_form_questions (post_id, parent_id, position, label, qtype, options, required, required_if)
          values (p_id, qid, n * 10 + k, btrim(s->>'label'), 'long', '{}', coalesce((s->>'required')::boolean, false), rif)
          returning id into sid;
        end if;
        keep := keep || sid;
      end loop;
    end if;
  end loop;

  if answered and exists (select 1 from digest_form_questions where post_id = p_id and not (id = any (keep))) then
    raise exception 'People have answered already, so no question can be removed';
  end if;
  delete from digest_form_questions where post_id = p_id and not (id = any (keep));
  perform digest_log(p_id, 'edited', array['questions']);
end $$;

drop function if exists public.digest_form(uuid);
create function public.digest_form(p_id uuid)
returns table (id uuid, label text, qtype text, options text[], required boolean, closes_at timestamptz, mine jsonb, sent_at timestamptz, answered integer,
               parent_id uuid, required_if text)
language sql stable security definer set search_path = public as $$
  select q.id, q.label, q.qtype, q.options, q.required, p.closes_at,
         (select r.answers from digest_form_responses r where r.post_id = p_id and r.employee_id = current_employee_id()),
         (select r.updated_at from digest_form_responses r where r.post_id = p_id and r.employee_id = current_employee_id()),
         (select count(*)::int from digest_form_responses r where r.post_id = p_id),
         q.parent_id, q.required_if
  from digest_form_questions q join digest_posts p on p.id = q.post_id
  where q.post_id = p_id and p.deleted_at is null and current_employee_id() is not null
  order by q.position
$$;
revoke all on function public.digest_form(uuid) from public, anon;
grant execute on function public.digest_form(uuid) to authenticated;

create or replace function public.digest_form_submit(p_id uuid, p_answers jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := current_employee_id(); q record; v jsonb; clean jsonb := '{}'::jsonb; need boolean; pa text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if not exists (select 1 from digest_posts where id = p_id and kind = 'form' and deleted_at is null) then
    raise exception 'That form is not there';
  end if;
  if (select closes_at from digest_posts where id = p_id) < now() then raise exception 'This form has closed'; end if;
  for q in select * from digest_form_questions where post_id = p_id order by position loop
    v := p_answers -> q.id::text;
    -- A sub-question's rule reads its question's answer (sent before it, by position).
    need := q.required;
    if q.parent_id is not null and q.required_if is not null then
      pa := clean ->> q.parent_id::text;
      need := case when q.required_if = 'no' then pa = 'No'
                   else pa ~ '^[1-5]$' and pa::int < split_part(q.required_if, ':', 2)::int end;
      need := coalesce(need, false);
    end if;
    if v is null or v = 'null'::jsonb or v = '""'::jsonb or v = '[]'::jsonb or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      if need then raise exception 'Answer "%" first', q.label; end if;
      continue;
    end if;
    if q.qtype = 'many' then
      if jsonb_typeof(v) <> 'array' or exists (select 1 from jsonb_array_elements_text(v) a where not (a = any (q.options))) then
        raise exception 'Choose from the choices for "%"', q.label;
      end if;
    elsif q.qtype in ('one') and not ((v #>> '{}') = any (q.options)) then
      raise exception 'Choose one of the choices for "%"', q.label;
    elsif q.qtype = 'yesno' and (v #>> '{}') not in ('Yes', 'No') then
      raise exception 'Answer Yes or No for "%"', q.label;
    elsif q.qtype = 'rating' and (v #>> '{}') not in ('1', '2', '3', '4', '5') then
      raise exception 'Rate "%" from 1 to 5', q.label;
    elsif q.qtype = 'number' and (v #>> '{}') !~ '^-?[0-9]+(\.[0-9]+)?$' then
      raise exception 'A number for "%"', q.label;
    elsif q.qtype = 'date' and (v #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'A date for "%"', q.label;
    elsif q.qtype in ('short', 'long') and length(v #>> '{}') > (case when q.qtype = 'short' then 300 else 3000 end) then
      raise exception 'The answer to "%" is too long', q.label;
    end if;
    clean := clean || jsonb_build_object(q.id::text, v);
  end loop;
  if not (select allow_again from digest_posts where id = p_id)
     and exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
    raise exception 'You have sent this form already';
  end if;
  if (select anonymous from digest_posts where id = p_id) then
    if exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
      raise exception 'You have sent this form already';
    end if;
    insert into digest_form_anon (post_id, answers) values (p_id, clean);
    insert into digest_form_responses (post_id, employee_id, answers) values (p_id, me, '{}'::jsonb);
  else
  insert into digest_form_responses (post_id, employee_id, answers) values (p_id, me, clean)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, updated_at = now();
  end if;
end $$;
