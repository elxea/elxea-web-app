import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";

import { SHOPIFY_API_VERSION } from "./api-version";

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
const CUSTOMER_API_URL = `https://shopify.com/${process.env.SHOPIFY_SHOP_ID}/account/customer/api/${SHOPIFY_API_VERSION}/graphql`;

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
  prompt?: "login" | "none" | "consent" | "select_account";
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
  // Fix (shared PC / account switching): force re-authentication at IdP.
  // Without this, Shopify SSO cookie silently re-authenticates the previous user
  // on the next login attempt, making it impossible to switch accounts or
  // leaking the previous user's session on shared devices.
  // Ref: RFC 6749 §4.1.1, OIDC Core 1.0 §3.1.2.1
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
 * Ref: OpenID Connect RP-Initiated Logout 1.0
 * https://openid.net/specs/openid-connect-rpinitiated-1_0.html
 */
export function buildLogoutUrl({
  idTokenHint,
  postLogoutRedirectUri,
}: {
  idTokenHint?: string;
  postLogoutRedirectUri: string;
}): string {
  const params = new URLSearchParams({
    post_logout_redirect_uri: postLogoutRedirectUri,
  });
  if (idTokenHint) {
    params.set("id_token_hint", idTokenHint);
  }
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
 * Fail-closed by construction: every path that is not an explicit, matching
 * contract id returns `false` — transport failure, GraphQL error, null contract,
 * malformed GID, or an id that does not match what we asked for. A caller that
 * cannot prove ownership must be treated exactly like a caller that does not own
 * the contract.
 */
export async function verifySubscriptionContractOwnership(
  accessToken: string,
  subscriptionContractId: string
): Promise<boolean> {
  if (!accessToken) return false;
  if (!isSubscriptionContractGid(subscriptionContractId)) return false;

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
      console.error(
        "[verifySubscriptionContractOwnership] Customer API error:",
        res.status
      );
      return false;
    }

    json = await res.json();
  } catch (e) {
    console.error("[verifySubscriptionContractOwnership] request failed:", e);
    return false;
  }

  if (json.errors && json.errors.length > 0) {
    console.error(
      "[verifySubscriptionContractOwnership] GraphQL errors:",
      JSON.stringify(json.errors)
    );
    return false;
  }

  const returnedId = json.data?.customer?.subscriptionContract?.id;
  if (!returnedId) return false;

  // Compare on the numeric suffix so an equivalent-but-differently-formatted
  // GID from Shopify still matches, while a different contract never does.
  const requested = gidNumericSuffix(subscriptionContractId);
  const returned = gidNumericSuffix(returnedId);
  return requested !== null && requested === returned;
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
  return next.cycleIndex;
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
      return { success: false, error: `API error: ${res.status}` };
    }

    json = await res.json();
  } catch (e) {
    console.error("[executeSubscriptionMutation] request failed:", e);
    return { success: false, error: "Subscription API request failed" };
  }

  // Check for userErrors in any mutation response
  const data = json.data;
  if (data) {
    const mutationKey = Object.keys(data)[0];
    if (mutationKey) {
      const userErrors = data[mutationKey]?.userErrors;
      if (userErrors && userErrors.length > 0) {
        return {
          success: false,
          error: userErrors.map((e) => e.message).join(", "),
        };
      }
    }
  }

  if (json.errors && json.errors.length > 0) {
    return {
      success: false,
      error: json.errors.map((e) => e.message).join(", "),
    };
  }

  // No data at all means the request did not produce a mutation result — treat
  // that as failure rather than reporting success on an empty response.
  if (!data) {
    return { success: false, error: "Subscription API returned no data" };
  }

  return { success: true };
}

export async function pauseSubscription(
  accessToken: string,
  subscriptionContractId: string
): Promise<SubscriptionMutationResult> {
  return executeSubscriptionMutation(accessToken, SUBSCRIPTION_PAUSE_MUTATION, {
    subscriptionContractId,
  });
}

export async function activateSubscription(
  accessToken: string,
  subscriptionContractId: string
): Promise<SubscriptionMutationResult> {
  return executeSubscriptionMutation(accessToken, SUBSCRIPTION_ACTIVATE_MUTATION, {
    subscriptionContractId,
  });
}

export async function cancelSubscription(
  accessToken: string,
  subscriptionContractId: string
): Promise<SubscriptionMutationResult> {
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
  billingCycleIndex?: number
): Promise<SubscriptionMutationResult> {
  if (!isSubscriptionContractGid(subscriptionContractId)) {
    return { success: false, error: "Invalid subscription contract ID" };
  }

  let cycleIndex = billingCycleIndex;

  if (cycleIndex === undefined) {
    const resolved = await resolveNextBillingCycleIndex(
      accessToken,
      subscriptionContractId
    );
    if (resolved === null) {
      return {
        success: false,
        error: "Could not determine the next billing cycle to skip",
      };
    }
    cycleIndex = resolved;
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

/**
 * Extract the numeric Shopify Customer ID from a Shopify Customer Account API id_token.
 *
 * The id_token is a JWT. Its payload contains:
 *   sub: "gid://shopify/Customer/12345"  (Customer GID)
 *
 * We decode the JWT payload without verifying the signature (the access_token
 * already proves the session is valid). This avoids an extra API round-trip on
 * every authenticated request.
 *
 * Returns the numeric portion (e.g. "12345") or null if decoding fails.
 */
export function extractCustomerIdFromIdToken(idToken: string): string | null {
  try {
    const parts = idToken.split(".");
    if (parts.length < 2) return null;

    // Base64url → Base64 → JSON
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));

    const sub: string | undefined = json.sub;
    if (!sub) return null;

    // sub is a GID: "gid://shopify/Customer/12345"
    const match = sub.match(/(\d+)$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}
