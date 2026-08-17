# Stage 4 — environment and IdP console checks

Records the checks stage 4 depends on, and what was and was not established.
No credential value was read; only variable NAMES were listed. No LINE or Shopify
console setting was changed — those are read-only for this work by instruction.

All times JST, 2026-08-18.

## 4b-pre — is there a `NEXT_PUBLIC_APP_URL` / `NEXTAUTH_URL` host mismatch?

**The question is vacuous: `NEXT_PUBLIC_APP_URL` is not set in production.**

Method (names only, no values):

```
VERCEL_ORG_ID=… VERCEL_PROJECT_ID=… npx vercel env ls production
```

| Variable | Set in production? |
|---|---|
| `NEXT_PUBLIC_APP_URL` | **no** |
| `NEXTAUTH_URL` | yes |
| `LINE_ALLOWED_CALLBACK_HOSTS` | **no** |
| `AUTH_COOKIE_APEX` | **no** |

### What this changes about the design

The design's account of defect 4 "system B" states that `NEXT_PUBLIC_*` is inlined
at build time with a single production value, so previews resolve to the
production origin and the 503 gate is bypassed. **That premise does not hold
here** — the variable is absent, so `process.env.NEXT_PUBLIC_APP_URL ||
request.nextUrl.origin` has always evaluated to the request origin in production.

Consequences, applied:

- Removing the `NEXT_PUBLIC_APP_URL` branch is provably a no-op in production. It
  is still worth removing (it is a loaded footgun the moment anyone sets it) and
  it is what lets the T2 scanner enforce a single origin owner.
- Repointing those four routes at `NEXTAUTH_URL`, as the design proposed, would
  NOT have been a fix. It would have changed the `redirect_uri` /
  `post_logout_redirect_uri` that Shopify matches by exact string, without any
  ability to read Shopify's registered list. So the origin source is preserved
  and the protection is added in front of it as a gate that is inert until
  `LINE_ALLOWED_CALLBACK_HOSTS` is deliberately set.
- Because `LINE_ALLOWED_CALLBACK_HOSTS` and `AUTH_COOKIE_APEX` are both unset in
  production, every new gate ships **inert**: `isRegisteredAuthHost` returns
  `true`, `getBaseUrl(request)` falls through to the env chain, and
  `AUTH_COOKIE_APEX` defaults to `elxea.com` — the value previously hard-coded.
  Rollback is deleting an env var, with no deploy.

A separate defect WAS confirmed and fixed while checking this: `nextUrl.origin`
reports the origin the server is bound to, not the host the user addressed. On
the dev server that is always `localhost:<port>`, so a user on
`www.elxea.test:3310` was redirected to `localhost:3310` after logout. Origin now
comes from the `Host` header, with `nextUrl.origin` as fallback.

## 4c — LINE / Shopify console registration

**All four items are UNCONFIRMED. Per the design, `LINE_ALLOWED_CALLBACK_HOSTS`
therefore starts from `www` alone, and the apex is not added.**

Changing LINE or Shopify console settings is prohibited for this work, and
reading them requires console access this session does not have. "Unconfirmed" is
recorded as unconfirmed rather than assumed either way.

| # | Item | Result |
|---|---|---|
| 1 | `LINE_ALLOWED_CALLBACK_HOSTS` set in production env | **No** — currently unset (verified above) |
| 2 | LINE Developers Console callback URL list contains BOTH apex and www | **Unconfirmed** |
| 3 | Shopify redirect URI list contains BOTH apex and www | **Unconfirmed** |
| 4 | Shopify post-logout redirect URI list contains BOTH apex and www | **Unconfirmed** |

### The rule this enforces

Because items 2-4 are unconfirmed, when `LINE_ALLOWED_CALLBACK_HOSTS` is first
set it must contain **`www.elxea.com` only**. Adding the apex is what would send
an apex-derived origin to Shopify, and if the apex is not in Shopify's registered
list that breaks production login and logout. The apex may be added only after
all four rows above read "confirmed".

No value in this file is a secret; the table records presence and truth only.

## What still needs a human

1. Read the LINE Developers Console callback URL list and both Shopify redirect
   URI lists, and record items 2-4 as confirmed or not.
2. Decide whether `LINE_ALLOWED_CALLBACK_HOSTS` should be set at all yet. Nothing
   in this change requires it — every gate is inert without it.

Neither blocks the code: with these variables unset, behaviour matches today's.
