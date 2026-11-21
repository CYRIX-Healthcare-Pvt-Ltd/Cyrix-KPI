/*
 * 0307 · Edit employee failed with "DELETE requires a WHERE clause" (the user, 21 Nov: Henry's function would not save).
 * 0300's statement trigger on employees emptied kpi_rank_ones_saved with a bare DELETE, which Supabase refuses for
 * calls from the app. Same clearing, with a WHERE.
 */
create or replace function public.kpi_rank_ones_clear_all()
 returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  delete from kpi_rank_ones_saved where true;
  return null;
end $function$;
