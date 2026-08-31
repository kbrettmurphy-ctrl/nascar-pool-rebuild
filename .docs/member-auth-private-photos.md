# Member authentication and private BuschGirls rollout

This rollout is intentionally split so the live photo rotation is never broken by an early bucket change.

## What is implemented

- Portfolio visitors can continue as guests without creating an account.
- Supabase email/password sessions persist and refresh on the member's device.
- Approved accounts are linked server-side to exactly one row in `players`.
- The player selector is locked to that identity for members.
- Guests never request `/api/buschgirls`, and the endpoint independently rejects them.
- Member photo batches contain 32 short-lived signed URLs rather than the whole inventory.
- Votes use the verified member's player identity instead of a browser-submitted name.
- Player originals, admin thumbnails, ratings, and maintenance backfill use bulk signed URLs.
- The final public-to-private bucket change is isolated in its own migration.

## Required Cloudflare Pages variables

Configure these for both Preview and Production, then trigger a new deployment:

- `SUPABASE_URL` (existing)
- `SUPABASE_SECRET_KEY` (existing, server only)
- `SUPABASE_PUBLISHABLE_KEY` (new; safe for browser Auth initialization)
- `ADMIN_SESSION_SECRET` (existing)

Never put `SUPABASE_SECRET_KEY` in browser code. `/api/member-auth-config` returns only the publishable key.

## Supabase Auth setup

1. Keep email/password authentication enabled.
2. Keep email confirmation enabled.
3. Disable public user registration after the member invitations are created, or otherwise ensure that only invited users are used. The server allowlist still denies unapproved accounts.
4. Set the Site URL to the production pool origin.
5. Add the production recovery URL: `https://YOUR_HOST/?memberAuth=recovery`.
6. Add the intended Cloudflare preview URL while testing. Do not add an unnecessarily broad wildcard.
7. Configure custom SMTP before inviting members. Supabase's trial email service is rate-limited and is not suitable for the full member rollout.
8. Leave the normal persistent session defaults unless there is a specific reason to force periodic logins.

## Stage 1: schema and allowlist

Status: applied to the live Supabase project on 2026-08-31 as migration
`20260831214328_member_auth_private_buschgirls_stage_1`. The local source file
below remains the reviewed rollout source.

Apply only:

`20260831205334_member_auth_private_buschgirls.sql`

This creates the server-only `pool_members` allowlist, removes direct browser
access to photo/vote metadata, and backfills the canonical `storage_path`. The
Pages Functions continue to work with the server key. It does **not** change
either bucket. It also restricts the existing admin PIN helpers to the server
key before any member Auth accounts are created.

Confirm every photo has a canonical path:

```sql
select count(*) as missing_paths
from public.buschgirls_photos
where storage_path is null;
```

Confirm that no browser-facing policies remain on the private metadata tables:

```sql
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in ('buschgirls_photos', 'buschgirl_votes');
```

This should return zero rows.

Find player IDs:

```sql
select id, name
from public.players
order by name;
```

Seed each approved email before sending its invitation:

```sql
insert into public.pool_members (player_id, email)
select id, lower('member@example.com')
from public.players
where name = 'Player Name';
```

Email matching is case-normalized. On the first authenticated request, the server binds the verified Auth user UUID to the matching allowlisted email. After all members have signed in, check:

```sql
select pm.email, pm.auth_user_id, pm.active, p.name as player
from public.pool_members pm
join public.players p on p.id = pm.player_id
order by p.name;
```

## Preview deployment and invitations

1. Deploy the application changes to a Cloudflare Pages preview.
2. Verify `/api/member-auth-config` returns `enabled: true` and contains no secret key.
3. From Supabase Authentication > Users, send an invitation to one seeded test member.
4. Set the invitation redirect to the preview origin.
5. Open the invitation, choose a password, and confirm the OS offers to save it.
6. Reload and confirm the member remains signed in and is locked to the correct player.
7. Sign out and confirm all photo DOM state is cleared.

## Required pre-cutover checks

- Guest mode opens the public app immediately.
- Guest `GET /api/buschgirls` returns `401` without any metadata or URLs.
- An authenticated but unallowlisted account gets `403` and is signed out locally.
- An approved member receives at most 32 signed photos in a batch.
- A vote is recorded under the linked player even if a different `playerName` is sent manually.
- Admin gallery thumbnails and full-size viewing work.
- Admin ratings images work.
- Upload, move, soft removal, permanent deletion, and maintenance backfill work.
- Mobile save/share still works with a signed URL.
- The service worker contains no private photo response in Cache Storage.

## Stage 2: final private-bucket cutover

Status: applied to the live Supabase project on 2026-08-31 as migration
`20260831222637_private_buschgirls_cutover`. Both buckets were verified private,
and a formerly public object URL returned `400` after the cutover.

Only after the preview checks pass, apply:

`20260831205408_private_buschgirls_cutover.sql`

First inspect policies whose expressions mention either bucket:

```sql
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and (
    coalesce(qual, '') ilike '%buschgirls%'
    or coalesce(with_check, '') ilike '%buschgirls%'
  );
```

Review and remove only policies dedicated to these two buckets. Do not blindly
drop a shared policy that also authorizes unrelated Storage buckets. The cutover
migration intentionally stops and names any matching policies still present;
after they are resolved, it makes both buckets private.

Immediately verify:

```sql
select id, public
from storage.buckets
where id in ('buschgirls', 'buschgirls-thumbnails')
order by id;
```

Both rows must report `false`. Then test an old `/object/public/buschgirls/...` URL in a private browser window; it must fail. Re-run the member and admin smoke tests against Production.

## Emergency rollback

If authenticated signing fails after cutover, fix or roll back the application first. Making the buckets public again restores availability but also restores the exposure this project is intended to remove, so it is an emergency-only rollback.
