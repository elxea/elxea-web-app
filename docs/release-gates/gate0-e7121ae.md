# Stage 0 GATE — auth fix (design R6)

The design forbids writing any fix until "today's code goes red, and the red
matches the predicted mechanism" has been measured. This file is that
measurement.

- Commit under test: `e7121aed066cc185c9d6ea0f5859e8d5a73941c6` (`e7121ae`)
  - Observations (i)/(ii) were first taken on the parent `fefa9be`; both were
    re-taken on `e7121ae` and are unchanged. `e7121ae` is a UI-only commit
    (bottom-stack z fix) and touches nothing on the auth path.
- Harness: `e2e/playwright-auth-flow.config.ts` (fake apex `www.elxea.test:3310`,
  `AUTH_COOKIE_APEX=elxea.test`), dev server on port 3310, Shopify logout
  contract served by `scripts/e2e/shopify-logout-stub.mjs` on 127.0.0.1:3311.
- All times JST.

## Verdict

| # | Observation | Predicted | Measured | Result |
|---|---|---|---|---|
| 0-pre | fake apex loads, no cross-origin dev-resource block | 0 such errors | 0 | [OK] |
| i | today's logout emits no `Domain` attribute | 10 Set-Cookie, Domain 0 | 10 / 0 | [OK] matches |
| ii | deletion is host-only only | all 10 `Path=/; Max-Age=0` | confirmed | [OK] matches |
| iii | S4 red: shared-domain LINE cookies survive | 4 survive, `/account` still authorises | 4 survive, `/ja/account` still renders the LINE view | [OK] matches |
| 0b | S5 red: logout leaves the site, contract answers 400 | `id_token_hint` absent, 400 | absent, 400 | [OK] matches |
| 0d | `/api/user/*` real statuses for the allow-list | measure | favorites 401 / follows 401 / customer-id 200 | [OK] |

Stage 0 passes: the fix may proceed. Four findings below change the design and
must be resolved as part of it.

## Observation (i) + (ii) — server-issued Set-Cookie has no Domain

Measured 2026-08-18 01:21:18 JST on `e7121ae`.

Command:

```
curl -sS -D - -o /dev/null \
  -H 'Host: www.elxea.test:3310' \
  'http://127.0.0.1:3310/api/auth/logout?locale=ja'
```

Response (relevant lines, verbatim):

```
HTTP/1.1 307 Temporary Redirect
location: http://127.0.0.1:3311/authentication/00000000/logout?post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3310%2Fja
set-cookie: shop_at=; Path=/; Max-Age=0
set-cookie: shop_rt=; Path=/; Max-Age=0
set-cookie: shop_exp=; Path=/; Max-Age=0
set-cookie: shop_auth=; Path=/; Max-Age=0
set-cookie: shop_cid=; Path=/; Max-Age=0
set-cookie: shop_it=; Path=/; Max-Age=0
set-cookie: line_user=; Path=/; Max-Age=0
set-cookie: line_session=; Path=/; Max-Age=0
set-cookie: line_auth=; Path=/; Max-Age=0
set-cookie: line_uid=; Path=/; Max-Age=0
```

Counts: `set-cookie` lines 10, with `Domain=` **0**, host-only 10,
`id_token_hint` in `location` **0**.

Why this is the red: `app/api/auth/logout/route.ts:40` builds
`{ path: "/", maxAge: 0 }` with no `domain`, while `app/api/line-callback/route.ts:187-224`
issues the four LINE cookies with `domain: ".elxea.com"` in production. A
host-only delete does not match a Domain-scoped cookie, so the delete is a no-op
for exactly the cookies that authorise `/account`.

Second red visible in the same response: `location` carries no `id_token_hint`
(defect 1). `route.ts:26-27` only reads `shop_it`, and a LINE-only user never has
one.

Also confirmed here: `post_logout_redirect_uri` is `http://localhost:3310/ja`,
not the request host — i.e. `request.nextUrl.origin` ignores the `Host` header,
as the design's premise table states.

## Observation (iii) — S4 is red, for the predicted reason

Measured 2026-08-18 01:32:44 JST on `e7121ae`.

Command:

```
SHOPIFY_LOGOUT_STUB_LOG=<path> \
  npx playwright test --config e2e/playwright-auth-flow.config.ts
```

Output:

```
[gate0][0a-iii] BEFORE logout: /ja/account renders LINE view = true
[gate0][0a-iii] remaining Domain-scoped LINE cookies after logout:
                line_auth@.elxea.test, line_session@.elxea.test,
                line_uid@.elxea.test, line_user@.elxea.test
[gate0][0a-iii] stub hits during logout:
                [{"hits":7,"path":"/authentication/00000000/logout",
                  "hasIdTokenHint":false,"hasPostLogoutRedirectUri":true,"verdict":400}]
[gate0][0a-iii] /ja/account after logout landed on: /ja/account
[gate0][0a-iii] AFTER logout: /ja/account still renders LINE view = true
  3 passed
```

Reason for red, stated as the mechanism: four `Domain=.elxea.test` LINE cookies
were injected; the logout response's host-only `Max-Age=0` directives do not
domain-match them; all four survive; `middleware.ts:140-151` authorises
`/account` on `line_session` alone, so `/ja/account` still renders
`LineAccountView` after logout. That is the security hole, reproduced.

## Observation 0b — the Shopify contract answers 400

Same run, 01:32:44 JST.

```
[gate0][0b] stub hits: [{"hits":8,"path":"/authentication/00000000/logout",
                         "hasIdTokenHint":false,"hasPostLogoutRedirectUri":true,"verdict":400}]
[gate0][0b] non-2xx observed: [400 /authentication/00000000/logout]
```

Reason for red: an unauthenticated logout still leaves the site, arrives without
`id_token_hint`, and the contract rejects it with `400 invalid_request`.

Note on provenance: before the contract was pinned to a local stub, an earlier
run (01:09 JST) reached the **real** `account.elxea.com/authentication/logout`
and it answered **400** — independent confirmation that the modelled contract is
the real one, not an assumption. The endpoint has been pinned to
`127.0.0.1:3311` since, so no further traffic leaves the machine.

## Observation 0d — allow-list inputs

Measured 2026-08-18 01:05:51 JST (code-independent).

```
/api/user/favorites   -> 401
/api/user/follows     -> 401
/api/auth/customer-id -> 200
```

`401` also with `line_session=1; line_auth=1` present. Only these values go in
the allow-list. `customer-id` returning 200 matches `customer-id/route.ts:16-29`.

## Findings that change the design

### F1 (blocking) — "dual-scope deletion" cannot be written as specified

The design says to emit a host-only and a shared-domain `Max-Age=0` for each
cookie, but never says how. Both obvious spellings silently drop one scope:

| Attempt | Measured | Time |
|---|---|---|
| `response.cookies.set(name, ...)` twice (host-only, then Domain) | **10** Set-Cookie lines, all Domain-scoped. The host-only delete vanished. | 01:02 JST |
| `cookies.set()` then `headers.append("set-cookie", ...)` interleaved per cookie | **11** lines; only the *last* append survived | 01:03 JST |
| all `cookies.set()` first, then all `headers.append()` | **20** lines = 10 host-only + 10 Domain | 01:04 JST |

Root cause, read from the shipped runtime
(`next/dist/compiled/@edge-runtime/cookies/index.js`):

- `:295` — `set()` does `map.set(name, normalizeCookie(...))`. The jar is keyed
  by **cookie name only**, so a second `set()` for the same name replaces.
- `:313-319` — `set()` then calls `replace(map, headers)`, which does
  `headers.delete("set-cookie")` before re-appending the map. Any raw append is
  destroyed by a later `set()`.

Consequence if unnoticed: the first spelling produces Domain-only deletes, which
is precisely the R2 design the document rejects ("host-only `shop_at` / `shop_rt`
/ `shop_auth` are not cleared → logout does not log out"). It would have shipped
looking correct.

Required: `clearAuthCookies()` must be two passes — every `cookies.set()` first,
then every raw `headers.append()`. T1 must assert **20** directives, not just the
presence of a Domain one, or it cannot tell these three implementations apart.
The same name-keying applies to the `next/headers` store, so the T1 store mock
must record `(name, domain)` pairs rather than keying by name.

### F2 (blocking) — the contract stub cannot be a `page.route` handler

The design specifies `page.route(/\/authentication\/(\d+\/)?logout/, ...)` and
asserts on `stubHits`. Measured 01:12 JST: a catch-all
`context.route("**/*")` logged the `/api/auth/logout` navigation and every
subresource, but **never** the cross-origin redirect target; the browser then
resolved DNS for it (`ERR_NAME_NOT_RESOLVED` on the pinned fake host, and a real
400 from `account.elxea.com` before pinning). Playwright does not intercept the
cross-origin hop of a top-level navigation redirect, so `stubHits` is
unobtainable that way.

Resolved here by running the contract as a real local process
(`scripts/e2e/shopify-logout-stub.mjs`) and reading its hit log. Ring 2 must
adopt this; `webServer` accepts an array, so the stub can be a second entry.

### F3 (blocking) — the fake apex is not a secure context

Measured 01:32 JST: `{"isSecureContext":false,"hasRandomUUID":false,"hasSubtle":false}`.
`crypto.randomUUID` and `crypto.subtle` exist only in secure contexts, and
`components/chat/chat-provider.tsx:76` calls `crypto.randomUUID()` unguarded, so
`/ja` throws `crypto.randomUUID is not a function` on every load.

The design's S0/S7 assertion "console errors === 0" is therefore unreachable on
`http://www.elxea.test:3310` as written. Two options, both real changes:

1. Guard the call site (`crypto.randomUUID?.() ?? fallback`). Cheap, and it also
   fixes any real user on a non-secure origin.
2. Serve Ring 2 over https with a local cert plus `ignoreHTTPSErrors`. Restores
   the secure context, and `secure: prod-only` still yields `secure:false` under
   `NODE_ENV=development`, so cookies are unaffected.

Recommend option 1 as the smaller change; needs a decision before stage 6.

### F4 — "no external requests" is not achievable as stated

Measured 01:32 JST on `/ja`: `use.typekit.net`, `p.typekit.net`. The design's
S0/S7 "external requests 0" must become an allow-list containing the Typekit
hosts, or those two must be stubbed. Sentry is already silenced via
`NEXT_PUBLIC_SENTRY_DSN=""`.

### F5 — `deploy-production` is pinned to a branch the design does not name

Design gate 5, checked. `.github/workflows/ci.yml:500`:

```
if: github.event_name == 'push' && github.ref == 'refs/heads/feat/c1-ds-foundation'
```

`needs` at `:501` is the 6 listed in the design. But the design body says "a push
to `main` is the only legitimate production path", which contradicts the pinned
ref. `staging-smoke` (`:420`) is pinned the same way, and its own comment records
that it "has never run once" for exactly this reason. Adding `auth-flow-e2e` to
`needs` without settling which ref actually ships would reproduce that failure —
a gate that exists and never runs. Deferred to stage 6, to follow the outcome of
the main/feat consolidation.

## Harness notes for whoever runs this next

- Next 16 refuses a second dev server from the same directory (design L1
  confirmed: `"Another next dev server is already running. PID: ..."`). Stop the
  existing one first.
- Evacuate `.next` before a verification run. A SIGTERM mid-write corrupted the
  Turbopack dev cache here and the server then 500'd on every route
  (`Failed to open SST file ... 00000266.sst`).
- `context.request` / `APIRequestContext` runs in **Node**, so
  `--host-resolver-rules` does not apply and the fake apex is unresolvable from
  it. Read page HTML through the page. This is the same Node-vs-Chromium
  asymmetry that forces `webServer.url` to be `127.0.0.1`.
- Cookie values injected via `addCookies` must be ASCII. A non-ASCII
  `displayName` did not survive to the server; the same value in ASCII did.
