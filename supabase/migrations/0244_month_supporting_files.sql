-- =====================================================================
-- Cyrix KPI  ·  0244  ·  Supporting files on a month
--
-- The requirement: "an option ... to upload monthly supporting Excel
-- sheets/documents against each month for validation and record-keeping".
-- The user, 2 Nov: per month only, optional, kept for good, 10 MB in all.
--
-- Excel, PDF, Word and photos. The employee adds and removes them while the
-- month is theirs to change (draft or returned); after that they stay as they
-- were sent. Seen by the employee, their manager and HR — as the month is,
-- less SW Admin, whose remit is logins.
-- =====================================================================

create table if not exists kpi_submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references kpi_submissions (id) on delete cascade,
  path text not null unique,
  name text not null,
  size_bytes integer not null check (size_bytes > 0),
  uploaded_by uuid references employees (id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists kpi_submission_files_sub on kpi_submission_files (submission_id, uploaded_at);

-- p_sub is text: it is also read from a file's folder name.
create or replace function kpi_month_files_can_see(p_sub text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kpi_submissions s
                 where s.id::text = p_sub
                   and (s.employee_id = current_employee_id() or manages_employee(s.employee_id) or is_hr_admin()))
$$;
create or replace function kpi_month_files_can_change(p_sub text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from kpi_submissions s
                 where s.id::text = p_sub and s.employee_id = current_employee_id()
                   and s.status in ('draft', 'returned'))
$$;
revoke all on function kpi_month_files_can_see(text) from public, anon;
revoke all on function kpi_month_files_can_change(text) from public, anon;
grant execute on function kpi_month_files_can_see(text) to authenticated;
grant execute on function kpi_month_files_can_change(text) to authenticated;

alter table kpi_submission_files enable row level security;
revoke all on kpi_submission_files from anon, authenticated;
grant select on kpi_submission_files to authenticated;
drop policy if exists kpi_submission_files_read on kpi_submission_files;
create policy kpi_submission_files_read on kpi_submission_files for select to authenticated
  using (kpi_month_files_can_see(submission_id::text));

-- Recorded after the file is in the bucket, under the month's folder.
create or replace function kpi_month_file_add(p_sub uuid, p_path text, p_name text, p_size integer)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; used bigint;
begin
  if not kpi_month_files_can_change(p_sub::text) then
    raise exception 'Files can be added only while the month is with you';
  end if;
  if p_path not like p_sub::text || '/%' then raise exception 'That file is not in this month'; end if;
  if lower(p_name) !~ '\.(xlsx|xls|csv|pdf|doc|docx|jpg|jpeg|png)$' then
    raise exception 'Only Excel, PDF, Word or photo files';
  end if;
  select coalesce(sum(size_bytes), 0) into used from kpi_submission_files where submission_id = p_sub;
  if used + p_size > 10485760 then raise exception 'All files together can be up to 10 MB'; end if;
  insert into kpi_submission_files (submission_id, path, name, size_bytes, uploaded_by)
  values (p_sub, p_path, left(p_name, 200), p_size, current_employee_id())
  returning id into v;
  return v;
end $$;

-- Gives back the path, for the file to be taken out of the bucket.
create or replace function kpi_month_file_remove(p_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare f kpi_submission_files;
begin
  select * into f from kpi_submission_files where id = p_id;
  if f.id is null or not kpi_month_files_can_change(f.submission_id::text) then
    raise exception 'Files can be removed only while the month is with you';
  end if;
  delete from kpi_submission_files where id = p_id;
  return f.path;
end $$;
revoke all on function kpi_month_file_add(uuid, text, text, integer) from public, anon;
revoke all on function kpi_month_file_remove(uuid) from public, anon;
grant execute on function kpi_month_file_add(uuid, text, text, integer) to authenticated;
grant execute on function kpi_month_file_remove(uuid) to authenticated;

-- The files: a private bucket, 10 MB a file at most, one folder per month.
insert into storage.buckets (id, name, public, file_size_limit)
values ('kpi-month-files', 'kpi-month-files', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

drop policy if exists kpi_month_files_read on storage.objects;
create policy kpi_month_files_read on storage.objects for select to authenticated
  using (bucket_id = 'kpi-month-files' and kpi_month_files_can_see((storage.foldername(name))[1]));
drop policy if exists kpi_month_files_upload on storage.objects;
create policy kpi_month_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'kpi-month-files' and kpi_month_files_can_change((storage.foldername(name))[1]));
drop policy if exists kpi_month_files_delete on storage.objects;
create policy kpi_month_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'kpi-month-files' and kpi_month_files_can_change((storage.foldername(name))[1]));
