-- Member-backed administrator roles. Authorization remains server-side so a
-- browser cannot promote itself by editing user metadata or JWT contents.

alter table public.pool_members
  add column if not exists is_admin boolean not null default false;

update public.pool_members
set is_admin = true,
    updated_at = now()
where email = 'kbrettmurphy@gmail.com';

comment on column public.pool_members.is_admin is
  'Grants NASCAR Pool administrator access after the Supabase user session is verified.';
