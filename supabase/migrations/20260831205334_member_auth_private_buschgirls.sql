-- Stage 1: member allowlist and canonical private-storage paths.
-- Apply this before deploying the authenticated application code. This stage
-- deliberately does not change either bucket's public/private setting.

-- Member accounts must not inherit access to privileged admin helpers. These
-- functions remain callable by the server's service-role key only.
alter function public.set_admin_pin(text)
  set search_path = pg_catalog, extensions;
alter function public.verify_admin_pin(text)
  set search_path = pg_catalog, extensions;

revoke all on function public.set_admin_pin(text) from public, anon, authenticated;
revoke all on function public.verify_admin_pin(text) from public, anon, authenticated;
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.set_admin_pin(text) to service_role;
grant execute on function public.verify_admin_pin(text) to service_role;

create table if not exists public.pool_members (
  id uuid primary key default gen_random_uuid(),
  player_id bigint not null unique references public.players(id) on delete restrict,
  email text not null,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pool_members_email_normalized check (email = lower(btrim(email)))
);

create unique index if not exists pool_members_email_lower_uidx
  on public.pool_members (lower(email));

alter table public.pool_members enable row level security;
revoke all on table public.pool_members from anon, authenticated;
grant select, insert, update, delete on table public.pool_members to service_role;

comment on table public.pool_members is
  'Server-only allowlist linking an invited Supabase Auth account to one NASCAR pool player.';

-- The browser receives only the small, authenticated responses produced by
-- Pages Functions. Remove direct Data API access to photo and vote metadata.
alter table public.buschgirls_photos enable row level security;
alter table public.buschgirl_votes enable row level security;
revoke all on table public.buschgirls_photos from anon, authenticated;
revoke all on table public.buschgirl_votes from anon, authenticated;
grant select, insert, update, delete on table public.buschgirls_photos to service_role;
grant select, insert, update, delete on table public.buschgirl_votes to service_role;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('buschgirls_photos', 'buschgirl_votes')
  loop
    execute format(
      'drop policy %I on %I.%I',
      policy_row.policyname,
      policy_row.schemaname,
      policy_row.tablename
    );
  end loop;
end
$$;

alter table public.buschgirls_photos
  add column if not exists storage_path text;

update public.buschgirls_photos
set storage_path = folder || '/' || filename
where storage_path is null
  and folder is not null
  and filename is not null;

do $$
begin
  if exists (select 1 from public.buschgirls_photos where storage_path is null) then
    raise exception 'Cannot require storage_path: one or more BuschGirls rows have no folder/filename path';
  end if;
end
$$;

alter table public.buschgirls_photos
  alter column storage_path set not null;

create unique index if not exists buschgirls_photos_storage_path_uidx
  on public.buschgirls_photos (storage_path);

-- Seed the member allowlist before sending Auth invitations. Repeat once per
-- member with their real player UUID and normalized email address:
-- insert into public.pool_members (player_id, email)
-- values ('PLAYER_UUID', 'member@example.com');
