import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";

const CLIENT_ID = process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";

const ACCOUNT_DOMAIN = "account.elxea.com";
const AUTHORIZE_URL = `https://${ACCOUNT_DOMAIN}/authentication/oauth/authorize`;
const TOKEN_URL = `https://${ACCOUNT_DOMAIN}/authentication/oauth/token`;
const LOGOUT_URL = `https://${ACCOUNT_DOMAIN}/authentication/logout`;
const CUSTOMER_API_URL = `https://shopify.com/53242265758/account/customer/api/2025-04/graphql`;

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
}: {
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
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
  return `${AUTHORIZE_URL}?${params.toString()}`;
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

export type Customer = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddress: { emailAddress: string } | null;
  phoneNumber: { phoneNumber: string } | null;
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
    intervalCount: number;
  };
  lines: {
    edges: {
      node: {
        id: string;
        title: string;
        variantTitle: string | null;
        quantity: number;
        currentPrice: { amount: string; currencyCode: string };
        productId: string;
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
              intervalCount
            }
            lines(first: 10) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  quantity
                  currentPrice { amount currencyCode }
                  productId
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

const SUBSCRIPTION_BILLING_SKIP_MUTATION = /* GraphQL */ `
  mutation subscriptionBillingCycleSkip($subscriptionContractId: ID!, $billingCycleIndex: Int!) {
    subscriptionBillingCycleSkip(
      subscriptionContractId: $subscriptionContractId
      billingCycleIndex: $billingCycleIndex
    ) {
      billingCycle {
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
  const res = await fetch(CUSTOMER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    return { success: false, error: `API error: ${res.status}` };
  }

  const json = await res.json();
  // Check for userErrors in any mutation response
  const data = json.data;
  if (data) {
    const mutationKey = Object.keys(data)[0];
    if (mutationKey) {
      const result = data[mutationKey];
      if (result?.userErrors?.length > 0) {
        return {
          success: false,
          error: result.userErrors.map((e: { message: string }) => e.message).join(", "),
        };
      }
    }
  }

  if (json.errors) {
    return {
      success: false,
      error: json.errors.map((e: { message: string }) => e.message).join(", "),
    };
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

export async function skipNextBillingCycle(
  accessToken: string,
  subscriptionContractId: string,
  billingCycleIndex: number = 0
): Promise<SubscriptionMutationResult> {
  return executeSubscriptionMutation(accessToken, SUBSCRIPTION_BILLING_SKIP_MUTATION, {
    subscriptionContractId,
    billingCycleIndex,
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
