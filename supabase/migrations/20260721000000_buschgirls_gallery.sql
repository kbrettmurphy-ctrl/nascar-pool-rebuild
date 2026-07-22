-- BuschGirls administrator gallery metadata and private thumbnails.
-- Safe to apply before the historical image backfill. This migration does not
-- read or download originals, calculate hashes, generate thumbnails, or start
-- any background work. Existing rows intentionally retain NULL gallery fields.
--
-- Preflight before applying:
-- SELECT lower(folder), lower(filename), count(*)
-- FROM public.buschgirls_photos
-- GROUP BY lower(folder), lower(filename)
-- HAVING count(*) > 1;
-- The unique path index below will intentionally fail if this returns rows.

alter table public.buschgirls_photos
  add column if not exists sha256 text,
  add column if not exists thumbnail_path text,
  add column if not exists indexed_at timestamptz;

create index if not exists buschgirls_photos_sha256_idx
  on public.buschgirls_photos (sha256)
  where sha256 is not null;

create index if not exists buschgirls_photos_gallery_folder_uploaded_idx
  on public.buschgirls_photos (folder, uploaded_at desc, id desc);

create unique index if not exists buschgirls_photos_folder_filename_ci_uidx
  on public.buschgirls_photos (lower(folder), lower(filename));

insert into storage.buckets (id, name, public)
values ('buschgirls-thumbnails', 'buschgirls-thumbnails', false)
on conflict (id) do update set public = false;

-- No public policies are created. Thumbnail reads and all writes are performed
-- server-side with the existing Supabase secret, and reads use short-lived URLs.
