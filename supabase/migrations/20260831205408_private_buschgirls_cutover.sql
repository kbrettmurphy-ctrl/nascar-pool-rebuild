-- Stage 2 / final cutover. Apply only after the member-authenticated photo API,
-- admin bulk signing, voting, upload, move, and backfill flows are deployed and
-- verified against a preview environment.

do $$
declare
  matching_policies text;
begin
  -- Service-role requests bypass RLS and need no Storage policy. Stop rather
  -- than broadly dropping a policy that might also authorize another bucket.
  select string_agg(policyname, ', ' order by policyname)
  into matching_policies
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and (
      coalesce(qual, '') ilike '%buschgirls%'
      or coalesce(with_check, '') ilike '%buschgirls%'
    );

  if matching_policies is not null then
    raise exception 'Review and remove BuschGirls Storage policies before cutover: %', matching_policies;
  end if;
end
$$;

update storage.buckets
set public = false
where id in ('buschgirls', 'buschgirls-thumbnails');

do $$
begin
  if (select count(*) from storage.buckets where id in ('buschgirls', 'buschgirls-thumbnails') and public = false) <> 2 then
    raise exception 'Private BuschGirls cutover failed: both buckets must exist and be private';
  end if;
end
$$;
