# BuschGirls administrator gallery

## Access and privacy

The gallery is at `/buschgirls-gallery/`. It has no public navigation or separate login. Sign in with an administrator-enabled member account, long-press the Player Portal pill, open **Photos**, then choose **Open Gallery**. The button navigates in the same tab. Pages Functions middleware rejects the gallery document and every gallery asset unless the signed `nascar_pool_admin_session` cookie is valid.

The member-backed admin exchange returns a 45-minute bearer token stored in `sessionStorage["nascar_pool_admin_token"]`. It also sets a separate 45-minute `HttpOnly; Secure; SameSite=Strict; Path=/` cookie authenticated with the existing `ADMIN_SESSION_SECRET`. JavaScript cannot read it. Logout clears sessionStorage and calls `/api/admin-logout` to expire the cookie. The cookie permits the protected static route to load; it does not authorize gallery APIs or mutations. Those still require the bearer token. Each check also verifies the live `pool_members.is_admin` role, making revocation immediate.

Gallery pages, assets, and responses use `private, no-store`, same-origin referrers, and no-index headers. The service worker bypasses the gallery and its APIs and does not provide the public app shell as an offline fallback.

The original gallery rollout left `buschgirls` public because the player popup used public URLs. The member-authentication rollout in [`member-auth-private-photos.md`](member-auth-private-photos.md) replaces that delivery path with short-lived signed URLs and includes a staged cutover that makes both originals and thumbnails private. Until that final cutover is applied, someone who knows an exact original public URL can still reach it.

## Data and endpoints

Migration: `supabase/migrations/20260721000000_buschgirls_gallery.sql`

It adds nullable `sha256`, `thumbnail_path`, and `indexed_at` columns; a partial normal SHA-256 index; a folder/upload-date pagination index; a case-insensitive unique folder/filename index; and the private `buschgirls-thumbnails` bucket. It creates no public Storage policy. It is safe to apply before August 9: it does not read originals, calculate hashes, generate thumbnails, or start the backfill. Existing rows remain unchanged with null indexing fields.

Before the historical backfill, the gallery still lists every existing row. The current gallery API bulk-signs original and thumbnail paths for the requested page, so it continues to work after either bucket becomes private. Folder filtering, pagination, viewing, menus, and deletion do not require indexing.

Endpoints:

- `POST /api/admin-login`: verified Supabase member-admin exchange for a bearer token and signed cookie; no PIN.
- `POST /api/admin-logout`: expires the administrator cookie.
- `GET /api/admin-buschgirls-gallery`: bearer-protected filename search, folder/rotation/indexing/exact-hash filters, deterministic sorting, filtered counts, adaptive server pagination (100 maximum), and signed thumbnail URLs. The browser chooses a page size near 80 that is divisible by the measured responsive grid column count.
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
3. A signed-in admin opens the portal without a PIN, the bearer remains in sessionStorage, and the response has an HttpOnly cookie containing no bearer token.
4. **Photos → Open Gallery** opens the gallery in the same tab.
5. Missing or altered bearer tokens show the gallery's expired-session state and do not return API data.
6. Pagination, folder totals, viewer, right-click/long-press menu, and confirmation wording work against non-production test data.
7. Lock expires the cookie; gallery documents/assets are rejected afterward. A tampered or expired cookie is rejected.

## Historical backfill (completed, tool removed)

The one-time thumbnail and SHA-256 backfill ran in August 2026, and every photo now has both. New uploads create their thumbnail and hash at upload time, so the gallery's **Maintenance** panel (backfill, **Repair missing thumbnails**, and **Review duplicates**) was removed in October 2026. The server endpoints it used (`/api/admin-buschgirls-backfill`, `/api/index-buschgirl`, `/api/admin-buschgirls-verify-thumbnails`, `/api/admin-buschgirls-duplicates`) are still deployed but no longer called from the gallery.

One case still produces a photo without a thumbnail: an upload the browser cannot decode is stored untouched with `thumbnail_path` null. The gallery shows such photos using the original. To find them:

```sql
select folder, filename, uploaded_at from public.buschgirls_photos where thumbnail_path is null order by uploaded_at desc;
```

## Multi-select

Press **Select** in the toolbar (an icon on phones), hover a tile on desktop and click its corner circle, or long-press a tile and choose **Select Multiple**. Taps then toggle photos, and the selection is kept across pages. **Delete N** confirms once, then deletes three at a time through `/api/delete-buschgirl`, retrying 429/5xx responses; failed photos stay selected for retry.
