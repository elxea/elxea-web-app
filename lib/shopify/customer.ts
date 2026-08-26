import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "crypto";

import {
  matchesExpectedBillingDate,
  STALE_BILLING_CYCLE_VIEW,
} from "@/lib/subscription-view";

import { SHOPIFY_API_VERSION } from "./api-version";
import {
  loadFailed,
  loaded,
  reportLoadFailure,
  type LoadResult,
} from "./load-result";
import { reportSubscriptionFailure } from "./subscription-failure";

const CLIENT_ID = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

// Fail fast at module load time if SESSION_SECRET is missing.
// This is used for token encryption; an empty secret would silently produce
// insecure ciphertext.
if (!SESSION_SECRET && typeof process !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error(
    "SESSION_SECRET environment variable is required for token encryption. " +
    "Set it in .env.local or your deployment environment.",
  );
}

// Shopify Customer Account API OAuth endpoints.
//
// These are env-driven so a Preview/staging deployment can point at a test
// store (e.g. elxea-test2) without touching production. The account domain is
// store-specific: the production store is served at the `account.elxea.com`
// vanity domain, while a test store without a vanity domain uses the
// `https://shopify.com/authentication/<shop_id>/oauth/...` form.
//
// Set SHOPIFY_CUSTOMER_ACCOUNT_{AUTHORIZE,TOKEN,LOGOUT}_URL to override. When
// unset, we fall back to the production `account.elxea.com` endpoints so
// existing production behaviour is unchanged.
const DEFAULT_ACCOUNT_DOMAIN = "account.elxea.com";
const AUTHORIZE_URL =
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL ||
  `https://${DEFAULT_ACCOUNT_DOMAIN}/authentication/oauth/authorize`;
const TOKEN_URL =
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_TOKEN_URL ||
  `https://${DEFAULT_ACCOUNT_DOMAIN}/authentication/oauth/token`;
const LOGOUT_URL =
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_LOGOUT_URL ||
  `https://${DEFAULT_ACCOUNT_DOMAIN}/authentication/logout`;
// Customer GraphQL API の向き先。
//
// AUTHORIZE / TOKEN / LOGOUT は既に env で差し替えられるのに、ここだけ固定だった。その結果、
// 偽の Customer Account サーバーに向けて自動テストを回しても **この 1 本だけ本物の
// shopify.com へ出ていく**（`SHOPIFY_SHOP_ID` 未設定なら `.../undefined/...` という
// 存在しない URL へ）。「テストは外部に接続しない」を設計で担保するために、他の 3 本と
// 同じ形で差し替えられるようにする。
//
// 未設定時の値は従来と完全に同一なので、本番の挙動は変わらない。
const CUSTOMER_API_URL =
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_API_URL ||
  `https://shopify.com/${process.env.SHOPIFY_SHOP_ID}/account/customer/api/${SHOPIFY_API_VERSION}/graphql`;

export { LOGOUT_URL };

// --- PKCE helpers ---

export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function generateState(): string {
  return randomBytes(16).toString("hex");
}

export function generateNonce(): string {
  return randomBytes(16).toString("hex");
}

// --- Auth URL ---

export function buildAuthorizeUrl({
  redirectUri,
  state,
  nonce,
  codeChallenge,
  prompt,
}: {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  /**
   * Shopify Customer Account API の authorize が受け付ける `prompt` は **`none`
   * だけ**（= ログイン画面を出さず、セッションがあれば code を返し、無ければ
   * `login_required` を返す）。OIDC 一般の `login` / `consent` / `select_account`
   * は、この endpoint には存在しない。
   *
   * 型で `none` に絞ってあるのは事故の再発防止。ここには 2026-04-13 から
   * `prompt=login` が入っており、2026-08-25 のメールログイン障害
   * （Shopify 側でエラーになり callback に戻って来ない）の原因になった。詳細と
   * 本番ログの根拠は `app/api/auth/login/route.ts` のコメント。
   *
   * Ref: https://shopify.dev/docs/api/customer/2025-07
   */
  prompt?: "none";
}): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid email customer-account-api:full",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  // 共有 PC / アカウント切り替えの担保は `/api/auth/logout` の RP-initiated logout
  // （id_token_hint 付きで Shopify 側 SSO を落とす）が持つ。ここで prompt を使うのは
  // 「画面を出さずにセッションの有無だけ確かめたい」場合の `none` に限られる。
  if (prompt) {
    params.set("prompt", prompt);
  }
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * Build the Shopify Customer Account API RP-initiated logout URL.
 *
 * Calling this endpoint clears the Shopify-side SSO session so the next
 * authorize request actually prompts for credentials. Without this, logging
 * out of our site alone leaves Shopify's session cookie intact and the next
 * login silently re-authenticates the previous user.
 *
 * `idTokenHint` is REQUIRED, not optional. Shopify rejects an RP-initiated
 * logout that omits `id_token_hint` with `400 invalid_request` — measured
 * 2026-08-18 against the real endpoint (see
 * docs/release-gates/gate0-e7121ae.md). The parameter used to be optional and
 * silently omitted when absent, which meant a LINE-only user — who never holds a
 * Shopify `id_token` — hit that 400 on their very first logout. Requiring it
 * turns that class of regression into a type error at the call site instead of a
 * runtime 400 for the user.
 *
 * Callers that have no token must NOT pass a placeholder; they must skip the
 * Shopify round trip entirely and complete logout locally.
 *
 * Ref: OpenID Connect RP-Initiated Logout 1.0
 * https://openid.net/specs/openid-connect-rpinitiated-1_0.html
 */
export function buildLogoutUrl({
  idTokenHint,
  postLogoutRedirectUri,
}: {
  idTokenHint: string;
  postLogoutRedirectUri: string;
}): string {
  const params = new URLSearchParams({
    post_logout_redirect_uri: postLogoutRedirectUri,
    id_token_hint: idTokenHint,
  });
  return `${LOGOUT_URL}?${params.toString()}`;
}

// --- Token exchange ---

export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token: string;
  token_type: string;
};

export async function exchangeToken(
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  return res.json();
}

// --- Customer Account API queries ---

export type MembershipTier = "none" | "standard" | "premium";

export type Customer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddress: { emailAddress: string } | null;
  phoneNumber: { phoneNumber: string } | null;
  tags: string[];
  orders: {
    edges: {
      node: {
        id: string;
        name: string;
        processedAt: string;
        financialStatus: string;
        totalPrice: { amount: string; currencyCode: string };
      };
    }[];
  };
};

export type SubscriptionContract = {
  id: string;
  status: string;
  createdAt: string;
  nextBillingDate: string | null;
  deliveryPolicy: {
    interval: string;
    intervalCount: { count: number };
  };
  lines: {
    edges: {
      node: {
        id: string;
        title: string;
        variantTitle: string | null;
        quantity: number;
        currentPrice: { amount: string; currencyCode: string };
        variantImage: { url: string; altText: string | null } | null;
      };
    }[];
  };
};

const CUSTOMER_QUERY = /* GraphQL */ `
  query {
    customer {
      id
      firstName
      lastName
      emailAddress { emailAddress }
      phoneNumber { phoneNumber }
      tags
      orders(first: 10, sortKey: PROCESSED_AT, reverse: true) {
        edges {
          node {
            id
            name
            processedAt
            financialStatus
            totalPrice { amount currencyCode }
          }
        }
      }
    }
  }
`;

const SUBSCRIPTION_CONTRACTS_QUERY = /* GraphQL */ `
  query {
    customer {
      subscriptionContracts(first: 20) {
        edges {
          node {
            id
            status
            createdAt
            nextBillingDate
            deliveryPolicy {
              interval
              intervalCount {
                count
              }
            }
            lines(first: 10) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  quantity
                  currentPrice { amount currencyCode }
                  variantImage { url altText }
                }
              }
            }
          }
        }
      }
    }
  }
`;

export async function getCustomer(accessToken: string): Promise<Customer | null> {
  const res = await fetch(CUSTOMER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: accessToken,
    },
    body: JSON.stringify({ query: CUSTOMER_QUERY }),
  });

  if (!res.ok) {
    console.error("Customer API error:", res.status, await res.text().catch(() => ""));
    return null;
  }

  const json = await res.json();
  if (json.errors) {
    console.error("Customer API GraphQL errors:", JSON.stringify(json.errors));
    return null;
  }
  return json.data?.customer ?? null;
}

/**
 * Query used to prove that a subscription contract belongs to the customer who
 * owns `accessToken`.
 *
 * `customer` is implicitly scoped to the bearer of the token, so
 * `customer.subscriptionContract(id:)` returns null for any contract the caller
 * does not own. That makes it a positive ownership proof rather than a guess
 * derived from client-supplied data.
 *
 * Ref: https://shopify.dev/docs/api/customer/latest/queries/customer
 */
const SUBSCRIPTION_CONTRACT_OWNERSHIP_QUERY = /* GraphQL */ `
  query SubscriptionContractOwnership($id: ID!) {
    customer {
      subscriptionContract(id: $id) {
        id
      }
    }
  }
`;

const UPCOMING_BILLING_CYCLES_QUERY = /* GraphQL */ `
  query UpcomingBillingCycles($id: ID!, $first: Int!) {
    customer {
      subscriptionContract(id: $id) {
        id
        upcomingBillingCycles(first: $first, sortKey: CYCLE_INDEX) {
          edges {
            node {
              cycleIndex
              skipped
              billingAttemptExpectedDate
            }
          }
        }
      }
    }
  }
`;

/**
 * Shape of a Shopify SubscriptionContract GID.
 * Anything else is rejected before it reaches an API call, so a caller cannot
 * smuggle a different resource type (or a raw numeric id) into a mutation.
 */
const SUBSCRIPTION_CONTRACT_GID_PATTERN =
  /^gid:\/\/shopify\/SubscriptionContract\/\d+$/;

export function isSubscriptionContractGid(value: unknown): value is string {
  return typeof value === "string" && SUBSCRIPTION_CONTRACT_GID_PATTERN.test(value);
}

function gidNumericSuffix(gid: string): string | null {
  const match = gid.match(/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Verify that `subscriptionContractId` belongs to the customer authenticated by
 * `accessToken`.
 *
 * **Fail-closed は一切緩めていない。** 所有が積極的に証明できない限り操作は通らない。
 * 変えたのは返り値の形だけで、判定そのものは以前と 1 対 1 に対応する。
 *
 * ## なぜ boolean をやめたか (設計憲章 R1 / R4)
 *
 * 以前は 3 つの全く違う事実がすべて `false` に潰れていた:
 *
 *   1. 他人の契約だった / 存在しない  … **答えが出ている**
 *   2. Shopify が落ちていて確かめられなかった … **答えが出ていない**
 *   3. GraphQL がエラーを返した … 同上
 *
 * 潰れていること自体は安全側だが、**運用が成立しない**。呼び出し側
 * (`subscription-actions.ts`) は `false` を受けて `NOT_AUTHORIZED` を投げ、
 * それが Sentry に上がる。つまり Sentry には「Subscription not found or not
 * accessible」だけが並び、**本物の不正アクセスと Shopify の一時障害が同じ 1 行**に
 * なる。どちらが起きているか事後にも分からないので、アラートを引くことができない。
 * 一方で生の失敗理由 (`console.error` のみ) はどこにも集約されていなかった。
 *
 * 返り値:
 *
 *   - `{ ok: true, data: true }`  … 所有を証明できた
 *   - `{ ok: true, data: false }` … 所有していないと**確定した** (不正・打ち間違い)
 *   - `{ ok: false, reason }`     … **確かめられなかった** (Shopify 側の問題)
 *
 * 呼び出し側は後ろ 2 つをどちらも「操作させない」に落とす (fail-closed は不変) が、
 * 記録と顧客向け文言は分けられる。顧客に返す文字列は従来どおり同一の一般化文言で、
 * どの契約 ID が存在するかを探れないようにしてある。
 */
export async function verifySubscriptionContractOwnership(
  accessToken: string,
  subscriptionContractId: string
): Promise<LoadResult<boolean>> {
  /* 引数の時点で確定する不成立。外部に問い合わせていないので「確かめられなかった」
     ではなく「所有していない」である。 */
  if (!accessToken) return loaded(false);
  if (!isSubscriptionContractGid(subscriptionContractId)) return loaded(false);

  let json: {
    data?: { customer?: { subscriptionContract?: { id?: string } | null } | null };
    errors?: unknown[];
  };

  try {
    const res = await fetch(CUSTOMER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: accessToken,
      },
      body: JSON.stringify({
        query: SUBSCRIPTION_CONTRACT_OWNERSHIP_QUERY,
        variables: { id: subscriptionContractId },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      reportLoadFailure(
        "verifySubscriptionContractOwnership:http",
        new Error(`Customer API responded ${res.status}`),
        { status: res.status, impact: "所有者照合ができず操作を拒否した" },
      );
      return loadFailed("upstream-unavailable");
    }

    json = await res.json();
  } catch (e) {
    reportLoadFailure("verifySubscriptionContractOwnership:transport", e, {
      impact: "所有者照合ができず操作を拒否した",
    });
    return loadFailed("upstream-unavailable");
  }

  if (json.errors && json.errors.length > 0) {
    /* GraphQL のエラー本文は Sentry にだけ残す。顧客 ID やストアの内部状態を
       含みうるので、呼び出し側へは reason しか渡さない。 */
    reportLoadFailure(
      "verifySubscriptionContractOwnership:graphql",
      new Error("Customer API returned GraphQL errors"),
      {
        errors: JSON.stringify(json.errors),
        impact: "所有者照合ができず操作を拒否した",
      },
    );
    return loadFailed("upstream-unavailable");
  }

  /* ここから先は Shopify が正常に答えた。契約が返らない = その顧客のものではない
     という**確定した答え**なので `ok: true, data: false`。 */
  const returnedId = json.data?.customer?.subscriptionContract?.id;
  if (!returnedId) return loaded(false);

  // Compare on the numeric suffix so an equivalent-but-differently-formatted
  // GID from Shopify still matches, while a different contract never does.
  const requested = gidNumericSuffix(subscriptionContractId);
  const returned = gidNumericSuffix(returnedId);
  return loaded(requested !== null && requested === returned);
}

export type UpcomingBillingCycle = {
  cycleIndex: number;
  skipped: boolean;
  billingAttemptExpectedDate: string | null;
};

/**
 * Resolve the cycle index of the next billing cycle that has not already been
 * skipped, for a contract owned by the bearer of `accessToken`.
 *
 * Returns `null` when the index cannot be determined (not owned, API failure,
 * no upcoming cycles). Callers must treat `null` as "do not proceed" — never as
 * "use a default index".
 *
 * Cycle indexes are 1-based, so there is no valid `0`. We read the real value
 * from `upcomingBillingCycles` instead of assuming one.
 *
 * Ref: https://shopify.dev/docs/api/customer/latest/objects/SubscriptionContract
 */
export async function resolveNextBillingCycleIndex(
  accessToken: string,
  subscriptionContractId: string,
  lookahead: number = 10
): Promise<number | null> {
  const cycle = await resolveNextBillingCycle(
    accessToken,
    subscriptionContractId,
    lookahead
  );
  return cycle ? cycle.cycleIndex : null;
}

/**
 * `resolveNextBillingCycleIndex` と同じ解決を行い、**周期そのもの** (index と
 * 予定日) を返す。予定日は「顧客が画面で見たお届け予定」と突き合わせるために要る
 * (`skipNextBillingCycle` の二重実行ガード)。
 */
export async function resolveNextBillingCycle(
  accessToken: string,
  subscriptionContractId: string,
  lookahead: number = 10
): Promise<UpcomingBillingCycle | null> {
  if (!accessToken) return null;
  if (!isSubscriptionContractGid(subscriptionContractId)) return null;

  let json: {
    data?: {
      customer?: {
        subscriptionContract?: {
          id?: string;
          upcomingBillingCycles?: { edges?: { node: UpcomingBillingCycle }[] };
        } | null;
      } | null;
    };
    errors?: unknown[];
  };

  try {
    const res = await fetch(CUSTOMER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: accessToken,
      },
      body: JSON.stringify({
        query: UPCOMING_BILLING_CYCLES_QUERY,
        variables: { id: subscriptionContractId, first: lookahead },
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error(
        "[resolveNextBillingCycleIndex] Customer API error:",
        res.status
      );
      return null;
    }

    json = await res.json();
  } catch (e) {
    console.error("[resolveNextBillingCycleIndex] request failed:", e);
    return null;
  }

  if (json.errors && json.errors.length > 0) {
    console.error(
      "[resolveNextBillingCycleIndex] GraphQL errors:",
      JSON.stringify(json.errors)
    );
    return null;
  }

  const contract = json.data?.customer?.subscriptionContract;
  if (!contract?.id) return null;

  const edges = contract.upcomingBillingCycles?.edges ?? [];
  const next = edges
    .map((e) => e.node)
    .find((node) => node && node.skipped === false);

  if (!next || typeof next.cycleIndex !== "number" || next.cycleIndex < 1) {
    return null;
  }
  return {
    cycleIndex: next.cycleIndex,
    skipped: next.skipped,
    billingAttemptExpectedDate: next.billingAttemptExpectedDate ?? null,
  };
}

export async function getSubscriptionContracts(
  accessToken: string
): Promise<SubscriptionContract[]> {
  const res = await fetch(CUSTOMER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: accessToken,
    },
    body: JSON.stringify({ query: SUBSCRIPTION_CONTRACTS_QUERY }),
  });

  if (!res.ok) {
    console.error("Subscription API error:", res.status);
    return [];
  }

  const json = await res.json();
  if (json.errors) {
    // Customer Account API may not support subscriptionContracts on all plans
    console.error("Subscription API GraphQL errors:", JSON.stringify(json.errors));
    return [];
  }

  const edges = json.data?.customer?.subscriptionContracts?.edges ?? [];
  return edges.map((e: { node: SubscriptionContract }) => e.node);
}

// --- Subscription management mutations ---

const SUBSCRIPTION_PAUSE_MUTATION = /* GraphQL */ `
  mutation subscriptionContractPause($subscriptionContractId: ID!) {
    subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SUBSCRIPTION_ACTIVATE_MUTATION = /* GraphQL */ `
  mutation subscriptionContractActivate($subscriptionContractId: ID!) {
    subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const SUBSCRIPTION_CANCEL_MUTATION = /* GraphQL */ `
  mutation subscriptionContractCancel($subscriptionContractId: ID!) {
    subscriptionContractCancel(subscriptionContractId: $subscriptionContractId) {
      contract {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * `subscriptionBillingCycleSkip` takes exactly one argument:
 *   billingCycleInput: SubscriptionBillingCycleInput!
 *     { contractId: ID!, selector: { date: DateTime, index: Int } }
 *
 * The previous version of this document passed `subscriptionContractId` and
 * `billingCycleIndex` as top-level arguments. Neither argument exists on this
 * mutation, so every skip request failed schema validation before it ever
 * reached the store.
 *
 * Ref: https://shopify.dev/docs/api/customer/latest/mutations/subscriptionBillingCycleSkip
 */
const SUBSCRIPTION_BILLING_SKIP_MUTATION = /* GraphQL */ `
  mutation subscriptionBillingCycleSkip($billingCycleInput: SubscriptionBillingCycleInput!) {
    subscriptionBillingCycleSkip(billingCycleInput: $billingCycleInput) {
      billingCycle {
        cycleIndex
        skipped
      }
      userErrors {
        field
        message
      }
    }
  }
`;

type SubscriptionMutationResult = {
  success: boolean;
  error?: string;
};

async function executeSubscriptionMutation(
  accessToken: string,
  query: string,
  variables: Record<string, unknown>
): Promise<SubscriptionMutationResult> {
  let json: {
    data?: Record<string, { userErrors?: { message: string }[] } | null>;
    errors?: { message: string }[];
  };

  try {
    const res = await fetch(CUSTOMER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: accessToken,
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });

    if (!res.ok) {
      // HTTP status も顧客には返さない (外部 API の内部状態を推し量る材料になる)。
      reportSubscriptionFailure("customerApiMutation", `HTTP ${res.status}`);
      return { success: false };
    }

    json = await res.json();
  } catch (e) {
    reportSubscriptionFailure("customerApiMutation:transport", e);
    return { success: false };
  }

  // Check for userErrors in any mutation response
  const data = json.data;
  if (data) {
    const mutationKey = Object.keys(data)[0];
    if (mutationKey) {
      const userErrors = data[mutationKey]?.userErrors;
      if (userErrors && userErrors.length > 0) {
        // Shopify の userErrors はストア側の事情 (在庫・プラン構成・内部 ID) を
        // 含みうるので転送しない。画面は `actionError` にフォールバックする。
        reportSubscriptionFailure("customerApiMutation:userErrors", userErrors, {
          mutationKey,
        });
        return { success: false };
      }
    }
  }

  if (json.errors && json.errors.length > 0) {
    reportSubscriptionFailure("customerApiMutation:graphqlErrors", json.errors);
    return { success: false };
  }

  // No data at all means the request did not produce a mutation result — treat
  // that as failure rather than reporting success on an empty response.
  if (!data) {
    reportSubscriptionFailure("customerApiMutation:emptyResponse", "no data field");
    return { success: false };
  }

  return { success: true };
}

/**
 * Shared shape guard for every contract-scoped subscription mutation.
 *
 * Why every mutation needs it, not just skip: `subscriptionContractId` reaches
 * these functions from a Server Action argument, i.e. from an untrusted HTTP
 * body. The Customer Account API scopes the *contract* to the token holder, but
 * it does not police the *shape* of the id — a caller can hand us
 * `gid://shopify/Customer/1` or a raw `1111` and we would forward it to Shopify
 * and surface whatever error comes back. Rejecting the wrong shape here keeps
 * malformed ids from reaching Shopify at all (no request is issued), so the
 * response cannot be used to probe which resources exist on the store.
 *
 * Kept identical in wording to the skip path so all four operations
 * (pause / activate / cancel / skip) fail the same way for the same reason.
 */
const INVALID_CONTRACT_ID: SubscriptionMutationResult = {
  success: false,
  error: "Invalid subscription contract ID",
};

export async function pauseSubscription(
  accessToken: string,
  subscriptionContractId: string
): Promise<SubscriptionMutationResult> {
  if (!isSubscriptionContractGid(subscriptionContractId)) {
    return INVALID_CONTRACT_ID;
  }
  return executeSubscriptionMutation(accessToken, SUBSCRIPTION_PAUSE_MUTATION, {
    subscriptionContractId,
  });
}

export async function activateSubscription(
  accessToken: string,
  subscriptionContractId: string
): Promise<SubscriptionMutationResult> {
  if (!isSubscriptionContractGid(subscriptionContractId)) {
    return INVALID_CONTRACT_ID;
  }
  return executeSubscriptionMutation(accessToken, SUBSCRIPTION_ACTIVATE_MUTATION, {
    subscriptionContractId,
  });
}

export async function cancelSubscription(
  accessToken: string,
  subscriptionContractId: string
): Promise<SubscriptionMutationResult> {
  if (!isSubscriptionContractGid(subscriptionContractId)) {
    return INVALID_CONTRACT_ID;
  }
  return executeSubscriptionMutation(accessToken, SUBSCRIPTION_CANCEL_MUTATION, {
    subscriptionContractId,
  });
}

/**
 * Skip a billing cycle of a subscription contract.
 *
 * When `billingCycleIndex` is omitted we resolve the real next un-skipped cycle
 * index from `upcomingBillingCycles` rather than guessing. There is no safe
 * default: cycle indexes are 1-based, and picking the wrong index would skip a
 * delivery the customer did not ask to skip.
 *
 * The resolve step queries the contract through `customer`, so it doubles as an
 * ownership check for the token holder.
 */
export async function skipNextBillingCycle(
  accessToken: string,
  subscriptionContractId: string,
  billingCycleIndex?: number,
  expectedBillingDate?: string | null
): Promise<SubscriptionMutationResult> {
  if (!isSubscriptionContractGid(subscriptionContractId)) {
    return INVALID_CONTRACT_ID;
  }

  let cycleIndex = billingCycleIndex;

  if (cycleIndex === undefined) {
    const resolved = await resolveNextBillingCycle(
      accessToken,
      subscriptionContractId
    );
    if (resolved === null) {
      return {
        success: false,
        error: "Could not determine the next billing cycle to skip",
      };
    }

    // 二重実行ガード (2026-08-11 の失敗系監査 Medium-4)。
    //
    // サーバは常に「次の未スキップ周期」を自分で解決する。そのため、別タブや
    // リロード後にもう一度スキップが飛ぶと、顧客が意図した周期ではなく**その次の
    // 周期**が黙って飛ぶ (連続 2 周期スキップ = 顧客の意図と違う売上減)。
    //
    // そこで「顧客が画面で見ていたお届け予定日」を突き合わせ、一致しないときは
    // 何もせず拒否する。index はクライアントから受け取らない (詐称できない) まま、
    // 期待とのズレだけを検出する形。日付が読めない場合も**倒す側は拒否**にする —
    // 検証できないまま周期を飛ばす方が実害が大きい。
    if (expectedBillingDate !== undefined) {
      if (
        !matchesExpectedBillingDate(
          resolved.billingAttemptExpectedDate,
          expectedBillingDate
        )
      ) {
        return { success: false, error: STALE_BILLING_CYCLE_VIEW };
      }
    }

    cycleIndex = resolved.cycleIndex;
  }

  // Cycle indexes are 1-based; reject 0 / negatives / non-integers outright
  // instead of letting Shopify interpret them.
  if (!Number.isInteger(cycleIndex) || cycleIndex < 1) {
    return { success: false, error: "Invalid billing cycle index" };
  }

  return executeSubscriptionMutation(accessToken, SUBSCRIPTION_BILLING_SKIP_MUTATION, {
    billingCycleInput: {
      contractId: subscriptionContractId,
      selector: { index: cycleIndex },
    },
  });
}

// --- Token encryption/decryption ---

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  return createHash("sha256").update(SESSION_SECRET).digest();
}

export function encryptToken(data: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(data, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted}`;
}

export function decryptToken(encrypted: string): string | null {
  try {
    const [ivB64, tagB64, data] = encrypted.split(".");
    if (!ivB64 || !tagB64 || !data) return null;
    const key = getKey();
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(data, "base64", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    return null;
  }
}

// --- id_token helpers ---
//
// **意図的に空**。id_token を「署名を見ずに開く」ヘルパーはここにあったが、`lib/shopify/id-token.ts`
// の `verifyShopifyIdToken`（署名 / iss / aud / exp / nonce を全部見る）へ置き換えて削除した。
// 設計書 v1.2 §5-4・実装項目 1-0b。復活させないこと — 未検証デコードが 1 つでも export されて
// いると、次に id_token を読みたくなった人がそちらを呼ぶ。
