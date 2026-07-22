# BuschGirls administrator gallery

## Access and privacy

The gallery is at `/buschgirls-gallery/`. It has no public navigation or separate login. Unlock the existing NASCAR administrator interface, open **Photos**, then choose **Open Gallery**. The button navigates in the same tab. Pages Functions middleware rejects the gallery document and every gallery asset unless the signed `nascar_pool_admin_session` cookie is valid.

The existing login still returns the 45-minute bearer token stored in `sessionStorage["nascar_pool_admin_token"]`. It also sets a separate 45-minute `HttpOnly; Secure; SameSite=Strict; Path=/` cookie authenticated with the existing `ADMIN_SESSION_SECRET`. JavaScript cannot read it. Logout clears sessionStorage and calls `/api/admin-logout` to expire the cookie. The cookie permits the protected static route to load; it does not authorize gallery APIs or mutations. Those still require the bearer token.

Gallery pages, assets, and responses use `private, no-store`, same-origin referrers, and no-index headers. The service worker bypasses the gallery and its APIs and does not provide the public app shell as an offline fallback.

The existing `buschgirls` originals bucket remains public because the player popup uses public URLs. The application does not expose gallery inventory or browse metadata without admin access, and the private `buschgirls-thumbnails` bucket is read with short-lived signed URLs. Someone who already knows an exact original URL can still reach it. Making the popup or whole pool member-only is a separate project requiring member authentication and signed/authenticated original delivery.

## Data and endpoints

Migration: `supabase/migrations/20260721000000_buschgirls_gallery.sql`

It adds nullable `sha256`, `thumbnail_path`, and `indexed_at` columns; a partial normal SHA-256 index; a folder/upload-date pagination index; a case-insensitive unique folder/filename index; and the private `buschgirls-thumbnails` bucket. It creates no public Storage policy. It is safe to apply before August 9: it does not read originals, calculate hashes, generate thumbnails, or start the backfill. Existing rows remain unchanged with null indexing fields.

Before the historical backfill, the gallery still lists every existing row and uses its existing original `url` as the thumbnail-grid source for the current paginated page. Once a private thumbnail exists, the API uses its short-lived signed URL instead. Folder filtering, pagination, viewing, menus, and deletion do not require indexing.

Endpoints:

- `POST /api/admin-login`: existing PIN verification and bearer response, plus signed cookie.
- `POST /api/admin-logout`: expires the administrator cookie.
- `GET /api/admin-buschgirls-gallery`: bearer-protected folder filtering, counts, server pagination (80 default, 100 maximum), and signed thumbnail URLs.
- `GET /api/admin-buschgirls-backfill`: returns at most 40 rows still missing a hash or thumbnail; the browser normally asks for 20.
- `POST /api/index-buschgirl`: derives paths from the authoritative row, upserts one thumbnail, and records its SHA-256/index time.
- `GET /api/admin-buschgirls-duplicates`: lists exact duplicate hash groups for review only.
- `POST /api/delete-buschgirl`: permanent deletion by UUID, separate from the existing soft-removal endpoint.
- `POST /api/upload-buschgirl`: calculates an original-byte SHA-256, rejects exact duplicates with HTTP 409, uploads the original and supplied thumbnail, and cleans up uploads if insertion fails.

Thumbnails are WebP, at most 460 pixels on the longest edge, quality 0.68, and stored as `<folder>/<photo UUID>.webp`. Originals are neither recompressed nor replaced. SHA-256 finds byte-for-byte identical files even under different names; it does not find crops, resizes, recompressions, screenshots, edits, or format conversions. No perceptual or facial matching is performed.

Soft removal (`/api/remove-buschgirl`) only sets `active=false` and remains unchanged. Permanent deletion first makes the row inactive, then removes original and thumbnail objects, vote rows, and the photo row after a strong browser confirmation. Partial failures are reported and are retryable where practical.

## Manual Supabase setup

The migration may be applied now. Only the historical image-processing backfill must wait until August 9, 2026.

1. In Supabase SQL Editor, run the preflight query included at the top of `20260721000000_buschgirls_gallery.sql`. It must return zero rows. Resolve duplicate paths before proceeding; do not remove the unique index from the migration.
2. Paste and run the complete migration file manually. Do not run unrelated migrations.
3. Confirm columns:
   `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='buschgirls_photos' and column_name in ('sha256','thumbnail_path','indexed_at') order by column_name;`
4. Confirm indexes:
   `select indexname, indexdef from pg_indexes where schemaname='public' and tablename='buschgirls_photos' and indexname in ('buschgirls_photos_sha256_idx','buschgirls_photos_gallery_folder_uploaded_idx','buschgirls_photos_folder_filename_ci_uidx');`
5. Confirm the bucket:
   `select id, name, public from storage.buckets where id='buschgirls-thumbnails';`
   It must show `public = false`.
6. Do not add public read or write policies for the thumbnail bucket.

## Cloudflare and preview deployment

No new secret is required: the cookie deliberately reuses the existing `ADMIN_SESSION_SECRET`. Confirm that `ADMIN_SESSION_SECRET`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` are configured for both Preview and Production in Cloudflare Pages. Never expose or paste their values into source control. If a missing secret is added or changed, trigger a fresh deployment afterward.

For a preview, push `feature/buschgirls-gallery`, open the Cloudflare Pages branch preview, and verify:

1. `/buschgirls-gallery/`, `/gallery.css`, and `/gallery.js` below that route return a generic 404 before login.
2. The normal application works without any admin cookie.
3. Existing admin login succeeds, the bearer remains in sessionStorage, and the response has an HttpOnly cookie containing neither PIN nor bearer token.
4. **Photos → Open Gallery** opens the gallery in the same tab.
5. Missing or altered bearer tokens show the gallery's expired-session state and do not return API data.
6. Pagination, folder totals, viewer, right-click/long-press menu, and confirmation wording work against non-production test data.
7. Lock expires the cookie; gallery documents/assets are rejected afterward. A tampered or expired cookie is rejected.
8. The maintenance panel says stopped and no network requests begin automatically.

## Manual backfill — only after August 9, 2026

Do not start the production backfill before August 9, 2026. After that date, unlock admin, open the gallery, choose **Maintenance**, read the 2,605-file / 683-MB warning, and explicitly confirm **Start**. Four items are processed concurrently. **Pause** stops after the active small group; **Resume** queries missing database state, so reloads do not repeat completed rows. **Stop** ends the loop. **Retry failures** retries the capped visible failure set. If authentication expires, processing stops and admin must be unlocked again.

Use **Review duplicates** to inspect exact hash groups. It never merges, deletes, changes votes, or changes active state. After completion, confirm the gallery reports zero pending items and run:

```sql
select
  count(*) as total,
  count(*) filter (where sha256 is not null and thumbnail_path is not null) as indexed,
  count(*) filter (where sha256 is null or thumbnail_path is null) as remaining
from public.buschgirls_photos;

select count(*) as exact_duplicate_groups
from (
  select sha256 from public.buschgirls_photos
  where sha256 is not null
  group by sha256 having count(*) > 1
) groups;
```

Confirm that thumbnail object counts are consistent with indexed rows. Do not delete duplicate groups automatically.
