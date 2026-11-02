-- Undo 0244. Only while no files have been kept: the bucket goes with what is in it.
drop policy if exists kpi_month_files_read on storage.objects;
drop policy if exists kpi_month_files_upload on storage.objects;
drop policy if exists kpi_month_files_delete on storage.objects;
drop function if exists kpi_month_file_add(uuid, text, text, integer);
drop function if exists kpi_month_file_remove(uuid);
drop table if exists kpi_submission_files;
drop function if exists kpi_month_files_can_see(text);
drop function if exists kpi_month_files_can_change(text);
delete from storage.buckets where id = 'kpi-month-files';
