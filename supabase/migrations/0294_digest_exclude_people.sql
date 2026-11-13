-- 0294 · Cyrix Digest: Exclude people, for every kind of post (the user, 13 Nov: "in digest, we need exclude people
-- also, add to all" ... "only option to type ecode and name, so suggestion should come").
-- Everyone with nobody excluded stays everyone (audience_ids null, so new joiners see it). Everyone with people
-- excluded, or chosen people, saves the list it reaches less those excluded; the feed, its notification and the
-- meeting reminders already follow audience_ids. audience keeps the choice for editing ('exclude', 'everyone').

drop function if exists public.digest_audience_count(text[], text[], text[], text[]);
create or replace function public.digest_audience_count(p_functions text[], p_managers text[], p_ecodes text[],
                                                        p_direct text[] default null, p_exclude text[] default null)
returns integer
language plpgsql stable security definer set search_path to 'public'
as $function$
declare chosen boolean := coalesce(cardinality(p_functions), 0) + coalesce(cardinality(p_managers), 0)
                          + coalesce(cardinality(p_ecodes), 0) + coalesce(cardinality(p_direct), 0) > 0;
begin
  if digest_can_post() is null then raise exception 'Only HR, IT, Marketing or Management'; end if;
  return (select count(*) from employees e
          where e.is_active
            and (not chosen or e.id = any (digest_audience_resolve(p_functions, p_managers, p_ecodes, p_direct)))
            and upper(e.ecode) <> all (select upper(btrim(x)) from unnest(coalesce(p_exclude, '{}')) x));
end $function$;
revoke all on function public.digest_audience_count(text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.digest_audience_count(text[], text[], text[], text[], text[]) to authenticated;

drop function if exists public.digest_set_audience(uuid, text[], text[], text[], text[]);
create or replace function public.digest_set_audience(p_id uuid, p_functions text[], p_managers text[], p_ecodes text[],
                                                      p_direct text[] default null, p_exclude text[] default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare
  everyone boolean := coalesce(cardinality(p_functions), 0) + coalesce(cardinality(p_managers), 0)
                      + coalesce(cardinality(p_ecodes), 0) + coalesce(cardinality(p_direct), 0) = 0;
  ex text[] := (select coalesce(array_agg(distinct upper(btrim(x))), '{}') from unnest(coalesce(p_exclude, '{}')) x where btrim(x) <> '');
  ids uuid[];
begin
  if not exists (select 1 from digest_posts where id = p_id and deleted_at is null and digest_can_edit(id)) then
    raise exception 'Only whoever posted it can choose who it goes to';
  end if;
  if not everyone or cardinality(ex) > 0 then
    select coalesce(array_agg(e.id), '{}') into ids from employees e
    where e.is_active
      and (everyone or e.id = any (digest_audience_resolve(p_functions, p_managers, p_ecodes, p_direct)))
      and upper(e.ecode) <> all (ex);
    if cardinality(ids) = 0 then raise exception 'Nobody is in that choice — choose again'; end if;
  end if;
  update digest_posts
     set audience = case when everyone and cardinality(ex) = 0 then null else jsonb_build_object(
           'everyone', everyone,
           'functions', to_jsonb(coalesce(p_functions, '{}')), 'managers', to_jsonb(coalesce(p_managers, '{}')),
           'ecodes', to_jsonb(coalesce(p_ecodes, '{}')), 'direct', to_jsonb(coalesce(p_direct, '{}')),
           'exclude', to_jsonb(ex)) end,
         audience_ids = ids
   where id = p_id;
  return coalesce(cardinality(ids), 0);
end $function$;
revoke all on function public.digest_set_audience(uuid, text[], text[], text[], text[], text[]) from public, anon;
grant execute on function public.digest_set_audience(uuid, text[], text[], text[], text[], text[]) to authenticated;
