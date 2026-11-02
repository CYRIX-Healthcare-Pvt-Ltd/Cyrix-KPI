-- Undo 0247: IT by role alone again.
drop policy if exists support_tickets_read on support_tickets;
create policy support_tickets_read on support_tickets for select to authenticated
  using ((employee_id = current_employee_id()) or ((desk = 'hr') and is_hr_admin()) or ((desk = 'software') and is_sw_admin()) or ((desk = 'it') and is_it_admin()));
CREATE OR REPLACE FUNCTION public.answer_support_ticket(p_id uuid, p_response text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  t    support_tickets;
  body text := btrim(coalesce(p_response, ''));
begin
  select * into t from support_tickets where id = p_id;
  if t.id is null then
    raise exception 'No such request';
  end if;

  if not ((t.desk = 'hr' and is_hr_admin()) or (t.desk = 'software' and is_sw_admin())
          or (t.desk = 'it' and is_it_admin())) then
    raise exception 'That request is not on your desk';
  end if;
  if t.answered_at is not null then
    raise exception 'That request has already been answered';
  end if;
  if length(body) < 2 then
    raise exception 'Write an answer before sending it';
  end if;

  update support_tickets
  set response = body, answered_by = current_employee_id(), answered_at = now()
  where id = p_id;

  return jsonb_build_object('ok', true);
end $function$;

CREATE OR REPLACE FUNCTION public.it_set_work_email(p_ecode text, p_email text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e    employees%rowtype;
  mail text := lower(btrim(coalesce(p_email, '')));
begin
  if not (is_it_admin() or is_sw_admin() or is_hr_admin()) then
    raise exception 'Only IT, HR or the software administrator can change an email';
  end if;
  select * into e from employees where upper(ecode) = upper(btrim(coalesce(p_ecode, '')));
  if not found then raise exception 'There is nobody with the code %', p_ecode; end if;
  if mail <> '' and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That is not an email address';
  end if;
  update employees set work_email = nullif(mail, ''), updated_at = now() where id = e.id;
  perform log_audit('employee', e.id, 'work_email_changed',
                    jsonb_build_object('from', e.work_email, 'to', nullif(mail, '')));
  return nullif(mail, '');
end $function$;

CREATE OR REPLACE FUNCTION public.login_status()
 RETURNS SETOF v_login_status
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select * from v_login_status
  where is_sw_admin() or is_hr_admin() or is_it_admin()
$function$;
drop function if exists it_can(text);
