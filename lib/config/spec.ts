/**
 * @sot env-var-registry
 *
 * The declaration of every environment variable this application reads at
 * runtime: how it is read, how it is normalised, and what shape it must have.
 *
 * ## Why this file exists (憲章 R4「設定値は起動時検証・raw 読み禁止」)
 *
 * Before this, configuration was read wherever it was needed — 151 raw
 * `process.env` expressions across 63 files under `app/`, `lib/`, `components/`
 * and `middleware.ts`. Each one re-decided, independently, what "unset" means,
 * whether to trim, and what to fall back to. Two defects shipped to production
 * out of exactly that spread:
 *
 *   - `NEXT_PUBLIC_SITE_URL` was stored with a trailing newline, so all 172
 *     `<loc>` entries in the sitemap became `https://elxea.com\n/ja/...`. Every
 *     call site concatenated the raw value, so every call site was wrong.
 *   - `LINE_LOGIN_CHANNEL_SECRET` was stored as 32 correct characters plus one
 *     invisible newline, and LINE answered `400 invalid_client` on every token
 *     exchange. The Web linking flow was down on 2026-08-22 and the failure
 *     looked like a linking bug rather than a configuration one.
 *
 * `lib/env.ts` was the first attempt at a fix and it worked — for the three
 * call sites that adopted it. That is the failure mode the charter names in R8:
 * a good shared device gets built and the migration onto it is never finished.
 * So this table is paired with a lint rule (`no-restricted-syntax` in
 * `eslint.config.mjs`) that makes `process.env` unreachable outside
 * `lib/config/**`, and with startup validation that refuses to boot production
 * on a value this table rejects.
 *
 * ## Why read and schema live in the same entry
 *
 * A two-table design (a list of readers here, a list of schemas there) is the
 * same duplication this charter's R5 exists to prevent: the two lists drift and
 * nothing notices. Keeping `read` and `schema` adjacent in one entry makes the
 * drift unrepresentable — you cannot add a variable without giving it both.
 *
 * ## Why every read is a literal member expression
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` into client bundles by matching
 * the **literal member expression** in the source text at build time. A dynamic
 * `process.env[name]` lookup is not matched and silently becomes `undefined` in
 * the browser. That is why each entry stores a closure whose body is the
 * literal read (`() => process.env.NEXT_PUBLIC_SITE_URL`) rather than a name to
 * be looked up. Selecting the closure dynamically is fine — the inliner only
 * cares about the text inside it.
 *
 * `lib/firebase/firestore-target.ts` still carries the bug this rule prevents:
 * its client half reads `NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST` through a dynamic
 * `env[name]` indexer, so the browser never sees it. See the entry below.
 *
 * ## Normalisation policy: `trimmed` vs `raw`
 *
 * Trimming is a repair, and applying it to the wrong variable is itself a
 * production defect. `SESSION_SECRET` is a sha256 input for token encryption:
 * if the stored value has a trailing newline today, every cookie in the wild
 * was derived **with** that newline. Trimming it would change the derived key
 * and log every customer out. So cryptographic material is declared `raw` — the
 * value is handed through byte-identical, and the shape check runs against its
 * trimmed projection so a malformed value is still reported.
 *
 * Everything a human pastes into a dashboard and the code then concatenates
 * (URLs, hosts, ids, addresses) is declared `trimmed`.
 */

import { z } from "zod";

/** Canonical public origin of the site, with no trailing slash. */
export const SITE_URL_FALLBACK = "https://elxea.com";

/* ------------------------------------------------------------------ *
 * Schema builders
 *
 * These exist so that the intent of each variable reads as one word in the
 * table below, and so that "what does trimmed mean here" has exactly one
 * definition rather than 79.
 * ------------------------------------------------------------------ */

/**
 * An optional value that a person types or pastes.
 *
 * Surrounding whitespace is removed and a value that trims down to nothing
 * becomes `undefined`, so a variable that exists but is blank is treated as
 * "not configured" rather than as an empty credential sent upstream. This is
 * the rule `readSecretEnvTrimmed` established in `lib/env.ts`; it is restated
 * here once and applied by declaration instead of by remembering to call it.
 */
function optionalTrimmed() {
  return z
    .string()
    .optional()
    .transform((v) => {
      if (typeof v !== "string") return undefined;
      const trimmed = v.trim();
      return trimmed === "" ? undefined : trimmed;
    });
}

/**
 * An optional value that must be handed through **byte-identical** because
 * something downstream derives from its exact bytes (a key, an HMAC).
 *
 * The shape check still runs against the trimmed projection, so a blank or
 * whitespace-only value is still normalised to `undefined`; what is preserved
 * is the interior and edge bytes of a value that is genuinely present.
 */
function optionalRaw() {
  return z
    .string()
    .optional()
    .transform((v) => {
      if (typeof v !== "string") return undefined;
      return v.trim() === "" ? undefined : v;
    });
}

/**
 * A trimmed value with trailing slashes removed — the rule `readUrlEnvTrimmed`
 * in `lib/env.ts` applies, for values consumed as `${base}/path`.
 */
function trimmedNoTrailingSlash() {
  return optionalTrimmed().transform((v) => {
    if (v === undefined) return undefined;
    const stripped = v.replace(/\/+$/, "");
    return stripped === "" ? undefined : stripped;
  });
}

/** A trimmed value with a fallback used whenever it is unset or blank. */
function trimmedWithDefault(fallback: string) {
  return optionalTrimmed().transform((v) => v ?? fallback);
}

/**
 * An origin (scheme + host, no trailing slash).
 *
 * **All** whitespace is stripped, not just the edges: a URL never legitimately
 * contains a space, and the observed production defect put a newline in the
 * middle of a concatenation rather than at a tidy boundary. Trailing slashes go
 * too, so that every call site can write `${origin}/path` without producing
 * `//path`.
 *
 * The result must parse as an `http:`/`https:` URL. This is the check that
 * makes a mis-pasted origin a boot failure instead of 172 silently invalid
 * sitemap entries.
 */
function originUrl() {
  return z
    .string()
    .optional()
    .transform((v) => (typeof v === "string" ? v.replace(/\s+/g, "").replace(/\/+$/, "") : ""))
    .transform((v) => (v === "" ? undefined : v))
    .refine(
      (v) => {
        if (v === undefined) return true;
        try {
          const { protocol } = new URL(v);
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      },
      { message: "must be an absolute http(s) URL" },
    );
}

/** An origin with a fallback applied after normalisation and validation. */
function originUrlWithDefault(fallback: string) {
  return originUrl().transform((v) => v ?? fallback);
}

/**
 * A hostname, or a comma-separated list of them, as configured by a person.
 * Whitespace around each entry is removed; the list itself is kept as a string
 * so that call sites that only ask "is this configured at all" keep working.
 */
function optionalHostList() {
  return optionalTrimmed();
}

/* ------------------------------------------------------------------ *
 * The registry
 * ------------------------------------------------------------------ */

type EnvEntry = {
  /**
   * Reads the variable. The body MUST be a literal `process.env.NAME` member
   * expression — see the note on client inlining at the top of this file.
   */
  read: () => string | undefined;
  schema: z.ZodType;
};

/**
 * Every environment variable read by application runtime code.
 *
 * Variables used only by `scripts/**`, `e2e/**` or build config are absent on
 * purpose: those run outside the Next runtime, are not covered by the lint
 * rule, and cannot take production down at boot.
 */
export const ENV_SPEC = {
  /* ---------------- Platform-injected (Node / Vercel) ---------------- *
   * Nobody pastes these; the toolchain sets them. They are declared anyway so
   * that the registry is the complete answer to "what does this app read",
   * and so `NODE_ENV`-shaped typos surface at boot rather than as a branch
   * that quietly never fires.
   */
  NODE_ENV: {
    read: () => process.env.NODE_ENV,
    schema: z
      .enum(["development", "test", "production"], {
        // Explicit message rather than Zod's default: the default for an enum
        // mismatch quotes the received value back, and error text from this
        // registry is written into boot logs. Nothing here may echo a value.
        error: "must be one of development | test | production",
      })
      .default("development"),
  },
  /*
   * `NEXT_RUNTIME` はここに**入れない**。
   *
   * これは人が設定する値ではなく、バンドラが edge / nodejs のどちら向けに
   * ビルドしているかをリテラルとして埋め込むコンパイル対象の識別子。
   * `env("NEXT_RUNTIME")` にすると関数呼び出しになってビルド時に畳めず、
   * `instrumentation.ts` の nodejs 分岐 (sentry.server.config /
   * firebase-admin) が dead code elimination されずに Edge Function の
   * bundle に入り、Vercel のデプロイが unsupported modules で落ちる
   * (2026-08-27 実害。経緯と実際のエラー文は `instrumentation.ts` の
   * `register()` の doc comment)。
   *
   * 唯一の読み手である `instrumentation.ts` が `process.env.NEXT_RUNTIME` を
   * 直接読み、そこだけ inline disable を置いている。宣言をここに戻すと
   * `env()` 経由で読めるようになり同じ壊れ方が再流入するので、戻さない。
   */
  VERCEL: {
    read: () => process.env.VERCEL,
    schema: optionalTrimmed(),
  },
  VERCEL_ENV: {
    read: () => process.env.VERCEL_ENV,
    schema: optionalTrimmed(),
  },
  VERCEL_URL: {
    read: () => process.env.VERCEL_URL,
    schema: optionalTrimmed(),
  },
  VERCEL_BRANCH_URL: {
    read: () => process.env.VERCEL_BRANCH_URL,
    schema: optionalTrimmed(),
  },
  VERCEL_PROJECT_PRODUCTION_URL: {
    read: () => process.env.VERCEL_PROJECT_PRODUCTION_URL,
    schema: optionalTrimmed(),
  },
  VERCEL_GIT_COMMIT_SHA: {
    read: () => process.env.VERCEL_GIT_COMMIT_SHA,
    schema: optionalTrimmed(),
  },

  /* ---------------- Site identity ---------------- */

  /**
   * The canonical public origin. Consumed through `lib/site-url.ts`, which is
   * the single accessor (`@sot site-origin`).
   *
   * This is the variable whose trailing newline invalidated the whole sitemap,
   * which is why it is the one with the strictest normalisation in the file.
   */
  NEXT_PUBLIC_SITE_URL: {
    read: () => process.env.NEXT_PUBLIC_SITE_URL,
    schema: originUrlWithDefault(SITE_URL_FALLBACK),
  },
  /**
   * Origin used by the Shopify-family auth routes. Measured 2026-08-18 with
   * `vercel env ls production` (names only): **not set in production**, so the
   * `NEXT_PUBLIC_APP_URL || request.nextUrl.origin` expressions those routes
   * used to carry always took the request-origin branch there. Kept declared
   * because a preview or a local run may still set it.
   */
  NEXT_PUBLIC_APP_URL: {
    read: () => process.env.NEXT_PUBLIC_APP_URL,
    schema: originUrl(),
  },
  /**
   * Origin handed to an identity provider as `redirect_uri`. Read only by
   * `lib/base-url.ts`, whose resolution order this does not change.
   */
  NEXTAUTH_URL: {
    read: () => process.env.NEXTAUTH_URL,
    schema: originUrl(),
  },
  /**
   * Apex domain that owns the auth cookie jar. Validated further by
   * `validateApex` in `lib/auth/cookies.ts`, which is the rule's owner; here it
   * only has to be a trimmed non-empty string.
   */
  AUTH_COOKIE_APEX: {
    read: () => process.env.AUTH_COOKIE_APEX,
    schema: trimmedWithDefault("elxea.com"),
  },
  /**
   * Comma-separated hosts an IdP is known to accept a callback on. Unset means
   * "gate off" — deliberately fail-open, see `lib/base-url.ts`.
   */
  LINE_ALLOWED_CALLBACK_HOSTS: {
    read: () => process.env.LINE_ALLOWED_CALLBACK_HOSTS,
    schema: optionalHostList(),
  },

  /* ---------------- Shared secrets ----------------
   * `raw` wherever the value is a key or an HMAC input, `trimmed` wherever it
   * is compared for equality against a header. Comparison targets are safe to
   * trim (and better for it — a pasted newline would otherwise make every
   * comparison fail); derivation inputs are not.
   */

  /**
   * sha256 input for customer-token encryption in `lib/shopify/customer.ts`.
   * **`raw` on purpose**: trimming would change the derived key and invalidate
   * every session cookie already issued.
   */
  SESSION_SECRET: {
    read: () => process.env.SESSION_SECRET,
    schema: optionalRaw(),
  },
  SITE_PASSWORD: {
    read: () => process.env.SITE_PASSWORD,
    schema: optionalRaw(),
  },
  CRON_SECRET: {
    read: () => process.env.CRON_SECRET,
    schema: optionalTrimmed(),
  },
  SYNC_API_SECRET: {
    read: () => process.env.SYNC_API_SECRET,
    schema: optionalTrimmed(),
  },
  /**
   * チャットの会話 ID に付ける HMAC-SHA256 の鍵 (`lib/chat/session-token.ts`)。
   *
   * `trimmed` にしてある。この鍵は新設で、**これに由来する発行済みの値がまだ
   * どのブラウザにも無い**ため、貼り付け由来の末尾改行を落としても何も無効化
   * しない。`SESSION_SECRET` を `raw` にしてあるのは逆に「発行済みの cookie が
   * 全部その改行込みで導出されている」からで、前提が違う (冒頭の正規化方針)。
   *
   * 未設定でも起動は止めない。止めると鍵を配る前にチャットごと落ちるので、
   * `resolveChatSession()` が未署名へ落として `logger.error` を 1 行残す。
   */
  CHAT_SESSION_SECRET: {
    read: () => process.env.CHAT_SESSION_SECRET,
    schema: optionalTrimmed(),
  },
  ERASE_API_SECRET: {
    read: () => process.env.ERASE_API_SECRET,
    schema: optionalTrimmed(),
  },
  DEBUG_AUTH_SECRET: {
    read: () => process.env.DEBUG_AUTH_SECRET,
    schema: optionalTrimmed(),
  },
  LINKAGE_EVENT_SECRET: {
    read: () => process.env.LINKAGE_EVENT_SECRET,
    schema: optionalTrimmed(),
  },
  SANITY_PREVIEW_SECRET: {
    read: () => process.env.SANITY_PREVIEW_SECRET,
    schema: optionalTrimmed(),
  },
  SANITY_REVALIDATE_SECRET: {
    read: () => process.env.SANITY_REVALIDATE_SECRET,
    schema: optionalTrimmed(),
  },
  /**
   * Which Sanity dataset a script writes to.
   *
   * Declared for the same reason as `LINE_LOGIN_CHANNEL_ID`: omitting it did
   * not merely fail to migrate a call site, it **changed behaviour**.
   * `lib/sanity/write-target.ts` resolves the dataset through a dynamic
   * `env[DATASET_ENV_VAR]` lookup, so once its default argument became
   * `envSnapshot()`, a name absent from this registry could no longer be found
   * there at all — `NEXT_PUBLIC_SANITY_DATASET=production npx tsx
   * scripts/backup-sanity.ts` would have stopped resolving.
   *
   * The dataset is also the one value in that module whose whole purpose is to
   * keep staging writes off production, which is not a place to accept an
   * accidental behaviour change.
   */
  NEXT_PUBLIC_SANITY_DATASET: {
    read: () => process.env.NEXT_PUBLIC_SANITY_DATASET,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_SANITY_PROJECT_ID: {
    read: () => process.env.NEXT_PUBLIC_SANITY_PROJECT_ID,
    schema: optionalTrimmed(),
  },
  SANITY_API_READ_TOKEN: {
    read: () => process.env.SANITY_API_READ_TOKEN,
    schema: optionalTrimmed(),
  },

  /* ---------------- Email (Resend) ---------------- */

  RESEND_API_KEY: {
    read: () => process.env.RESEND_API_KEY,
    schema: optionalTrimmed(),
  },
  /**
   * Note the two different historical fallbacks: the transactional senders use
   * `info@`, the contact forms use `no-reply@`. That difference is deliberate
   * and is preserved at the call sites rather than collapsed here, because
   * changing which address a customer sees reply-to is a business decision,
   * not a refactor.
   */
  RESEND_FROM_EMAIL: {
    read: () => process.env.RESEND_FROM_EMAIL,
    schema: optionalTrimmed(),
  },
  CONTACT_TO_EMAIL: {
    read: () => process.env.CONTACT_TO_EMAIL,
    schema: optionalTrimmed(),
  },
  CONTACT_BUSINESS_TO_EMAIL: {
    read: () => process.env.CONTACT_BUSINESS_TO_EMAIL,
    schema: optionalTrimmed(),
  },

  /* ---------------- Infrastructure ---------------- */

  R2_PUBLIC_DOMAIN: {
    read: () => process.env.R2_PUBLIC_DOMAIN,
    schema: optionalTrimmed(),
  },
  PIPELINE_TRIGGER_URL: {
    read: () => process.env.PIPELINE_TRIGGER_URL,
    schema: optionalTrimmed(),
  },
  UPSTASH_REDIS_REST_URL: {
    read: () => process.env.UPSTASH_REDIS_REST_URL,
    schema: optionalTrimmed(),
  },
  UPSTASH_REDIS_REST_TOKEN: {
    read: () => process.env.UPSTASH_REDIS_REST_TOKEN,
    schema: optionalTrimmed(),
  },

  /* ---------------- Shopify ---------------- */

  SHOPIFY_STORE_DOMAIN: {
    read: () => process.env.SHOPIFY_STORE_DOMAIN,
    schema: optionalTrimmed(),
  },
  SHOPIFY_SHOP_ID: {
    read: () => process.env.SHOPIFY_SHOP_ID,
    schema: optionalTrimmed(),
  },
  SHOPIFY_ADMIN_ACCESS_TOKEN: {
    read: () => process.env.SHOPIFY_ADMIN_ACCESS_TOKEN,
    schema: optionalTrimmed(),
  },
  SHOPIFY_STOREFRONT_ACCESS_TOKEN: {
    read: () => process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN,
    schema: optionalTrimmed(),
  },
  /** HMAC key for Shopify webhook signatures — `raw`, it is a derivation input. */
  SHOPIFY_WEBHOOK_SECRET: {
    read: () => process.env.SHOPIFY_WEBHOOK_SECRET,
    schema: optionalRaw(),
  },
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: {
    read: () => process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
    schema: optionalTrimmed(),
  },
  SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL: {
    read: () => process.env.SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL,
    schema: optionalTrimmed(),
  },
  SHOPIFY_CUSTOMER_ACCOUNT_TOKEN_URL: {
    read: () => process.env.SHOPIFY_CUSTOMER_ACCOUNT_TOKEN_URL,
    schema: optionalTrimmed(),
  },
  SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL: {
    read: () => process.env.SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL,
    schema: optionalTrimmed(),
  },
  SHOPIFY_CUSTOMER_ACCOUNT_API_URL: {
    read: () => process.env.SHOPIFY_CUSTOMER_ACCOUNT_API_URL,
    schema: optionalTrimmed(),
  },
  SHOPIFY_CUSTOMER_ACCOUNT_PORTAL_URL: {
    read: () => process.env.SHOPIFY_CUSTOMER_ACCOUNT_PORTAL_URL,
    schema: optionalTrimmed(),
  },
  SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL: {
    read: () => process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL,
    schema: optionalTrimmed(),
  },

  /* ---------------- LINE ----------------
   * Every one of these is `trimmed`. This is the family that took production
   * down on 2026-08-22, and none of them is a derivation input on our side —
   * they are sent to LINE as-is, where a stray newline is exactly the defect.
   */

  AUTH_LINE_ID: {
    read: () => process.env.AUTH_LINE_ID,
    schema: optionalTrimmed(),
  },
  AUTH_LINE_SECRET: {
    read: () => process.env.AUTH_LINE_SECRET,
    schema: optionalTrimmed(),
  },
  LINE_LOGIN_CHANNEL_SECRET: {
    read: () => process.env.LINE_LOGIN_CHANNEL_SECRET,
    schema: optionalTrimmed(),
  },
  /**
   * The login channel id under its second, historical name (`AUTH_LINE_ID` is
   * the same channel).
   *
   * Declared because leaving it out **silently narrowed a production guard**.
   * `checkChannelNamespace()` in `lib/line/login-channel.ts` compares four
   * variables that must all name one channel; when its default argument moved
   * from `process.env` to `envSnapshot()`, any name missing from this registry
   * simply stopped being compared. The guard would have kept reporting "OK" on
   * three of four — and the failure it exists to catch (write side and read
   * side on different channels) is exactly the one that is invisible until a
   * customer's linked account cannot be looked up.
   */
  LINE_LOGIN_CHANNEL_ID: {
    read: () => process.env.LINE_LOGIN_CHANNEL_ID,
    schema: optionalTrimmed(),
  },
  LINE_LIFF_CHANNEL_ID: {
    read: () => process.env.LINE_LIFF_CHANNEL_ID,
    schema: optionalTrimmed(),
  },
  LINE_LIFF_CHANNEL_SECRET: {
    read: () => process.env.LINE_LIFF_CHANNEL_SECRET,
    schema: optionalTrimmed(),
  },
  LINE_CHANNEL_ACCESS_TOKEN: {
    read: () => process.env.LINE_CHANNEL_ACCESS_TOKEN,
    schema: optionalTrimmed(),
  },
  LINE_ADMIN_USER_ID: {
    read: () => process.env.LINE_ADMIN_USER_ID,
    schema: optionalTrimmed(),
  },
  LINE_LOGIN_EMAIL_SCOPE: {
    read: () => process.env.LINE_LOGIN_EMAIL_SCOPE,
    schema: optionalTrimmed(),
  },
  LINE_LOGIN_BOT_PROMPT: {
    read: () => process.env.LINE_LOGIN_BOT_PROMPT,
    schema: optionalTrimmed(),
  },
  /**
   * These two are overridable API endpoints, consumed as `${base}/path`. They
   * were read through `readUrlEnvTrimmed`, which strips trailing slashes as
   * well as whitespace, so they keep that rule here — dropping it would turn a
   * value that ends in `/` into a `//` in every LINE request path.
   */
  LINE_AUTH_BASE_URL: {
    read: () => process.env.LINE_AUTH_BASE_URL,
    schema: trimmedNoTrailingSlash(),
  },
  LINE_API_BASE_URL: {
    read: () => process.env.LINE_API_BASE_URL,
    schema: trimmedNoTrailingSlash(),
  },
  /* LINE アプリ受け渡しホスト (既定 `https://access-auto.line.me`)。認可ホストとは
   * 別ホストであることに意味がある — 理由は lib/line/endpoints.ts の
   * `LINE_APP_HANDOFF_BASE_URL_DEFAULT` の注記。 */
  LINE_APP_HANDOFF_BASE_URL: {
    read: () => process.env.LINE_APP_HANDOFF_BASE_URL,
    schema: trimmedNoTrailingSlash(),
  },

  /* ---------------- Firebase ---------------- */

  FIREBASE_PROJECT_ID: {
    read: () => process.env.FIREBASE_PROJECT_ID,
    schema: optionalTrimmed(),
  },
  FIREBASE_CLIENT_EMAIL: {
    read: () => process.env.FIREBASE_CLIENT_EMAIL,
    schema: optionalTrimmed(),
  },
  /**
   * A PEM block, optionally base64-encoded. **`raw`**: the interior newlines
   * are the format, and `decodePrivateKey` in `lib/firebase/admin.ts` owns the
   * decoding. Trimming here would be the start of corrupting a key.
   */
  FIREBASE_PRIVATE_KEY: {
    read: () => process.env.FIREBASE_PRIVATE_KEY,
    schema: optionalRaw(),
  },
  FIRESTORE_EMULATOR_HOST: {
    read: () => process.env.FIRESTORE_EMULATOR_HOST,
    schema: optionalTrimmed(),
  },
  FIRESTORE_EMULATOR_PROJECT_ID: {
    read: () => process.env.FIRESTORE_EMULATOR_PROJECT_ID,
    schema: optionalTrimmed(),
  },
  ALLOW_PRODUCTION_FIRESTORE: {
    read: () => process.env.ALLOW_PRODUCTION_FIRESTORE,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_FIREBASE_API_KEY: {
    read: () => process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: {
    read: () => process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: {
    read: () => process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: {
    read: () => process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: {
    read: () => process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_FIREBASE_APP_ID: {
    read: () => process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    schema: optionalTrimmed(),
  },
  /**
   * The browser-side emulator switch.
   *
   * `lib/firebase/firestore-target.ts` reads this through a dynamic
   * `env[name]` indexer, which Next cannot inline — so in a real browser bundle
   * it has always been `undefined` and the client emulator branch never fired.
   * Declaring it here with a literal read is what makes it reachable at all.
   */
  NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: {
    read: () => process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_ALLOW_PRODUCTION_FIRESTORE: {
    read: () => process.env.NEXT_PUBLIC_ALLOW_PRODUCTION_FIRESTORE,
    schema: optionalTrimmed(),
  },

  /* ---------------- Chat / LIFF / media ---------------- */

  NEXT_PUBLIC_CHAT_API_URL: {
    read: () => process.env.NEXT_PUBLIC_CHAT_API_URL,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_CHAT_MOCK: {
    read: () => process.env.NEXT_PUBLIC_CHAT_MOCK,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_LIFF_ID: {
    read: () => process.env.NEXT_PUBLIC_LIFF_ID,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_LINE_FRIEND_URL: {
    read: () => process.env.NEXT_PUBLIC_LINE_FRIEND_URL,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_BGM_URL: {
    read: () => process.env.NEXT_PUBLIC_BGM_URL,
    schema: optionalTrimmed(),
  },
  NEXT_PUBLIC_GTM_ID: {
    read: () => process.env.NEXT_PUBLIC_GTM_ID,
    schema: optionalTrimmed(),
  },

  /* ---------------- Preview seeding / E2E ----------------
   * Dev and preview switches. They are declared so that the registry is
   * complete and so the lint rule needs no per-variable escape hatch.
   */

  PREVIEW_SEED: {
    read: () => process.env.PREVIEW_SEED,
    schema: optionalTrimmed(),
  },
  PREVIEW_SEED_EVENTS: {
    read: () => process.env.PREVIEW_SEED_EVENTS,
    schema: optionalTrimmed(),
  },
  PREVIEW_SEED_STOREFRONT: {
    read: () => process.env.PREVIEW_SEED_STOREFRONT,
    schema: optionalTrimmed(),
  },
  PREVIEW_SEED_DETERMINISTIC: {
    read: () => process.env.PREVIEW_SEED_DETERMINISTIC,
    schema: optionalTrimmed(),
  },
  PREVIEW_SEED_SUBSCRIPTIONS_EMPTY: {
    read: () => process.env.PREVIEW_SEED_SUBSCRIPTIONS_EMPTY,
    schema: optionalTrimmed(),
  },
  E2E_FIRESTORE_STUB: {
    read: () => process.env.E2E_FIRESTORE_STUB,
    schema: optionalTrimmed(),
  },

  /* ---------------- Error reporting (Sentry) ----------------
   * Wave 1 QA 指摘 (2026-08-27) で見つかった取り残し。`sentry.*.config.ts` と
   * `instrumentation-client.ts` は Next の起動ファイルで `app/` `lib/`
   * `components/` のどれでもないため、Wave 1 の lint の `files` に入っておらず
   * 生読みのまま残っていた。3 ファイル 6 か所が同じ 1 変数を各自で
   * 「未設定とは何か」を決めながら読んでいた (`!!` で真偽に潰す形)。
   *
   * 末尾改行の混入で壊れる型の値 (URL) であることは
   * `NEXT_PUBLIC_SITE_URL` の事故と同じなので、trim を通す。
   */
  NEXT_PUBLIC_SENTRY_DSN: {
    read: () => process.env.NEXT_PUBLIC_SENTRY_DSN,
    schema: optionalTrimmed(),
  },

  /* ---------------- roji プロファイル (ミクロ⇔マクロ・段1) ----------------
   * 正本: Spec https://app.notion.com/p/3d270c9d064c8171b70be803150d6d5d
   * `PROFILE_MICRO_MACRO` は画面 (`/dev/profile` 、段3で `/{locale}/account/profile`)
   * を出すかどうかのフラグ。`PROFILE_DATA_SOURCE` は3本のGETが読む値の出どころ。
   * 実行時 fail-closed (本番×synthetic の拒否) は `lib/profile/source.ts` 側で行う
   * (ここでは値の形だけを検証する)。
   */
  PROFILE_MICRO_MACRO: {
    read: () => process.env.PROFILE_MICRO_MACRO,
    schema: optionalTrimmed().transform((v) => v === "1" || v === "true"),
  },
  PROFILE_DATA_SOURCE: {
    read: () => process.env.PROFILE_DATA_SOURCE,
    schema: optionalTrimmed()
      .transform((v) => v ?? "live")
      .pipe(z.enum(["live", "synthetic"])),
  },
} as const satisfies Record<string, EnvEntry>;

/** Every variable name the application is allowed to read. */
export type EnvName = keyof typeof ENV_SPEC;

/** The normalised type of one variable, as produced by its schema. */
export type EnvValue<K extends EnvName> = z.output<(typeof ENV_SPEC)[K]["schema"]>;

export const ENV_NAMES = Object.keys(ENV_SPEC) as EnvName[];
