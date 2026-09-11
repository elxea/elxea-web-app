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
- `LINE_ALLOWED_CALLBACK_HOSTS` and `AUTH_COOKIE_APEX` are both unset in
  production. `isRegisteredAuthHost` therefore returns `true`, and
  `getBaseUrl(request)` falls through to the env chain.

### CORRECTION — rollback is NOT an env deletion

An earlier revision of this file claimed "rollback is deleting an env var, with
no deploy". **That was wrong and is retracted.**

`AUTH_COOKIE_APEX` defaults to `"elxea.com"` in code, so the shared-domain
cookie machinery — the dual-scope deletion, the Domain-scoped issuing, the
apex-derived host trust — is **always active**, entirely outside any env gate.
Deleting env vars does not disable it.

**Rolling back this change requires `git revert` and a deploy.** The env
variables only control the additional host allow-list; they cannot switch the
core behaviour off. Anyone planning the release should size the rollback on that
basis.

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

Neither blocks the code. Note, however, that "with these variables unset,
behaviour matches today's" is true only of the allow-list; the cookie-scope
change itself is unconditional (see the correction above).

## Symptom 3 — root cause confirmed (preview scope)

**`NEXTAUTH_URL` is not set in the preview environment.**

| Variable | production | preview | development |
|---|---|---|---|
| `NEXTAUTH_URL` | set | **not set** | not set |
| `NEXT_PUBLIC_SITE_URL` | set | set | not set |
| `SITE_PASSWORD` | set | set | not set |
| `NEXT_PUBLIC_APP_URL` | not set | not set | not set |
| `LINE_ALLOWED_CALLBACK_HOSTS` | not set | not set | not set |
| `AUTH_COOKIE_APEX` | not set | not set | not set |

(Names only; no value was read.)

This explains the "goes to the top page and shows the old design" half of symptom
3. `getBaseUrl()` walks `NEXTAUTH_URL` -> `VERCEL_PROJECT_PRODUCTION_URL` ->
`VERCEL_URL`. Vercel injects `VERCEL_PROJECT_PRODUCTION_URL` into **every**
environment, including preview. With `NEXTAUTH_URL` absent in preview, the second
entry wins and resolves to the **production** origin — so a LINE login started
from a preview deployment completed against production and landed the user on the
production top page, which is the older design.

Fixed by refusing rather than redirecting: `/api/line-login/init`,
`/api/line-login` and `/api/auth/login` now return
`503 auth_host_not_registered` when the request host is not at or under our own
apex (and not explicitly allow-listed). Production and `www` satisfy that with no
configuration; a preview deployment gets a legible error instead of being
silently switched to another deployment.

Residual: this stops the wrong landing, it does not make LINE login work on
previews. Doing that needs a registered callback host, which is the
`LINE_ALLOWED_CALLBACK_HOSTS` + console-registration work in section 4c above and
requires a human.
