-- =====================================================================
-- Cyrix KPI  ·  0254  ·  Anonymous forms
--
-- The user, 5 Nov: "in forms we need 1 option ie, anonymous, ie we dont
-- collect who has done it, ie ecode and name wont be there ... only for
-- forms".
--
-- An anonymous form keeps its answers in digest_form_anon, which has no
-- person and no time on it, so nothing joins an answer back to anybody.
-- digest_form_responses keeps only that the person has sent it (answers
-- '{}'), so each person sends it once, and the desk still sees who has and
-- has not answered, but never what they said. Sent once: with nothing
-- linking the answers to the person, they cannot be changed afterwards.
-- The choice is fixed once anybody has sent the form.
-- =====================================================================

alter table digest_posts add column if not exists anonymous boolean not null default false;

create table if not exists digest_form_anon (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references digest_posts (id) on delete cascade,
  answers jsonb not null
);
create index if not exists digest_form_anon_post on digest_form_anon (post_id);
alter table digest_form_anon enable row level security;
revoke all on digest_form_anon from anon, authenticated;

create or replace function digest_set_form_anonymous(p_id uuid, p_on boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from digest_posts where id = p_id and kind = 'form' and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted the form can change this';
  end if;
  if (select anonymous from digest_posts where id = p_id) = coalesce(p_on, false) then return; end if;
  if exists (select 1 from digest_form_responses where post_id = p_id) then
    raise exception 'People have sent it already, so it stays %', case when coalesce(p_on, false) then 'with names' else 'anonymous' end;
  end if;
  update digest_posts set anonymous = coalesce(p_on, false) where id = p_id;
end $$;
revoke all on function digest_set_form_anonymous(uuid, boolean) from public, anon;
grant execute on function digest_set_form_anonymous(uuid, boolean) to authenticated;

-- For the form's page: whether it is anonymous.
create or replace function digest_form_is_anonymous(p_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select anonymous from digest_posts where id = p_id and deleted_at is null), false)
  where current_employee_id() is not null
$$;
revoke all on function digest_form_is_anonymous(uuid) from public, anon;
grant execute on function digest_form_is_anonymous(uuid) to authenticated;

-- Sending: an anonymous form's answers go where no name is.
do $$
declare src text; old_ins text :=
'  insert into digest_form_responses (post_id, employee_id, answers) values (p_id, me, clean)
  on conflict (post_id, employee_id) do update set answers = excluded.answers, updated_at = now();';
begin
  select pg_get_functiondef('digest_form_submit(uuid, jsonb)'::regprocedure) into src;
  src := replace(src, E'\r\n', E'\n');
  if position(old_ins in src) = 0 then raise exception 'digest_form_submit has changed'; end if;
  src := replace(src, old_ins,
'  if (select anonymous from digest_posts where id = p_id) then
    if exists (select 1 from digest_form_responses where post_id = p_id and employee_id = me) then
      raise exception ''You have sent this form already'';
    end if;
    insert into digest_form_anon (post_id, answers) values (p_id, clean);
    insert into digest_form_responses (post_id, employee_id, answers) values (p_id, me, ''{}''::jsonb);
  else
' || old_ins || '
  end if;');
  execute src;
end $$;

-- The answers of an anonymous form, for whoever posted it: no names, in no particular order.
create or replace function digest_form_anon_answers(p_id uuid)
returns table (answers jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from digest_posts where id = p_id and (digest_can_edit(id) or is_sw_admin())) then
    raise exception 'Only whoever posted it';
  end if;
  return query select a.answers from digest_form_anon a where a.post_id = p_id order by md5(a.id::text);
end $$;
revoke all on function digest_form_anon_answers(uuid) from public, anon;
grant execute on function digest_form_anon_answers(uuid) to authenticated;
