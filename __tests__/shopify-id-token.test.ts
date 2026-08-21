/**
 * Tests for `verifyShopifyIdToken` — 設計書 v1.2 の実装項目 1-0b。
 *
 * What this pins, and why each one matters:
 *
 *   - **signature**: the previous implementation decoded the payload and never
 *     looked at the signature. A forged token with the right shape was accepted.
 *     Every case here uses a really-signed token so a regression to "just decode
 *     it" fails loudly instead of passing.
 *   - **alg allowlist**: `alg` is asserted by the token, so `none` and HS256 must
 *     be refused by name rather than by whether verification happens to fail.
 *   - **nonce**: a token that is perfectly valid but belongs to a different login
 *     attempt must not establish this session (OIDC Core §3.1.3.7 step 11 / D11).
 *   - **JWKS availability**: fail-closed when no key can be obtained, but keep
 *     serving from the cached key when a refresh fails — otherwise a blip at
 *     Shopify becomes a total login outage, and "fail closed" turns into an
 *     argument for removing the check.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  __resetShopifyJwksCacheForTests,
  verifyShopifyIdToken,
} from "@/lib/shopify/id-token";
import {
  TEST_CLIENT_ID,
  TEST_DISCOVERY_URL,
  TEST_ISSUER,
  makeJwksFetch,
  makeKeypair,
  signIdToken,
  validClaims,
  type FetchLog,
} from "./helpers/shopify-oidc-fixtures";

const NONCE = "b6cf1d2e4a7f8091b6cf1d2e4a7f8091";

const keypair = makeKeypair();
const jwksFetch = () => makeJwksFetch([keypair.jwk]);

const SAVED = {
  clientId: process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID,
  discovery: process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL,
};

beforeEach(() => {
  __resetShopifyJwksCacheForTests();
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID = TEST_CLIENT_ID;
  process.env.SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL = TEST_DISCOVERY_URL;
});

afterEach(() => {
  __resetShopifyJwksCacheForTests();
  for (const [key, value] of [
    ["SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID", SAVED.clientId],
    ["SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL", SAVED.discovery],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("verifyShopifyIdToken — happy path", () => {
  it("accepts a properly signed token and returns the numeric customer id", async () => {
    const token = signIdToken(keypair, validClaims(NONCE));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toMatchObject({ ok: true, customerId: "7654321" });
  });

  it("accepts an aud given as an array containing our client id", async () => {
    const token = signIdToken(keypair, validClaims(NONCE, { aud: ["someone-else", TEST_CLIENT_ID] }));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result.ok).toBe(true);
  });
});

describe("verifyShopifyIdToken — signature", () => {
  it("rejects a token signed by a key that is not in the JWKS", async () => {
    /* The forgery an attacker can actually mount: a well-formed token with the
     * claims they want, signed with their own key. Only the signature check
     * catches it — every claim here is valid. */
    const attacker = makeKeypair();
    const token = signIdToken(attacker, validClaims(NONCE));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it("rejects a token whose payload was altered after signing", async () => {
    const token = signIdToken(keypair, validClaims(NONCE), { corruptSignature: true });

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "signature_invalid" });
  });

  it('refuses alg "none" without even looking for a key', async () => {
    const token = signIdToken(keypair, validClaims(NONCE), { header: { alg: "none" } });

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "id_token_alg_not_allowed" });
  });

  it("refuses a symmetric alg (HS256 key-confusion)", async () => {
    const token = signIdToken(keypair, validClaims(NONCE), { header: { alg: "HS256" } });

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "id_token_alg_not_allowed" });
  });

  it("rejects a token with no kid rather than trying every key", async () => {
    const token = signIdToken(keypair, validClaims(NONCE), { header: { kid: undefined } });

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "id_token_kid_missing" });
  });

  it("rejects a malformed token instead of throwing", async () => {
    for (const bad of ["", "not-a-jwt", "a.b", "a.!!!not-base64!!!.c"]) {
      const result = await verifyShopifyIdToken(bad, {
        expectedNonce: NONCE,
        fetchImpl: jwksFetch(),
      });
      expect(result.ok).toBe(false);
    }
  });
});

describe("verifyShopifyIdToken — nonce (D1 / D11)", () => {
  it("rejects a valid token minted for a different login attempt", async () => {
    const token = signIdToken(keypair, validClaims("some-other-attempts-nonce"));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("rejects a token that carries no nonce claim", async () => {
    const claims = validClaims(NONCE);
    delete claims.nonce;
    const token = signIdToken(keypair, claims);

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "nonce_missing" });
  });

  it("rejects when we have no expected nonce to compare against", async () => {
    /* Fail-closed in both directions. A missing cookie is not an exemption:
     * anything an attacker can supply, they can also omit. */
    const token = signIdToken(keypair, validClaims(NONCE));

    for (const expectedNonce of [undefined, null, ""]) {
      const result = await verifyShopifyIdToken(token, {
        expectedNonce,
        fetchImpl: jwksFetch(),
      });
      expect(result).toEqual({ ok: false, reason: "expected_nonce_missing" });
    }
  });

  it("does not accept a nonce that is a prefix of the expected one", async () => {
    const token = signIdToken(keypair, validClaims(NONCE.slice(0, -1)));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "nonce_mismatch" });
  });
});

describe("verifyShopifyIdToken — claims", () => {
  it("rejects a token from a different issuer", async () => {
    const token = signIdToken(keypair, validClaims(NONCE, { iss: "https://evil.example" }));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "iss_mismatch" });
  });

  it("rejects a token issued for another client", async () => {
    const token = signIdToken(keypair, validClaims(NONCE, { aud: "some-other-app" }));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "aud_mismatch" });
  });

  it("rejects an expired token", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signIdToken(keypair, validClaims(NONCE, { exp: nowSec - 3600 }));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token issued in the future beyond the clock skew allowance", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const token = signIdToken(keypair, validClaims(NONCE, { iat: nowSec + 600 }));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "iat_in_future" });
  });

  it("rejects a sub that is not a Customer GID", async () => {
    const token = signIdToken(
      keypair,
      validClaims(NONCE, { sub: "gid://shopify/StaffMember/1" }),
    );

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "sub_not_customer_gid" });
  });

  it("refuses to verify anything when the client id is not configured", async () => {
    delete process.env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID;
    const token = signIdToken(keypair, validClaims(NONCE));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "client_id_not_configured" });
  });
});

describe("verifyShopifyIdToken — JWKS availability", () => {
  it("fails closed when the key set cannot be fetched at all", async () => {
    const token = signIdToken(keypair, validClaims(NONCE));
    const downFetch = makeJwksFetch([keypair.jwk], { failAfter: 0 });

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: downFetch,
    });

    /* No key, no verification, no session. The alternative — trusting the token
     * because we could not check it — is the failure mode this whole module exists
     * to remove. */
    expect(result).toEqual({ ok: false, reason: "jwks_unavailable" });
  });

  it("keeps verifying from the cached key when a later refresh fails", async () => {
    /* `exp` has to outlive the simulated clock jump below, otherwise this would
     * pass or fail on expiry rather than on the cache behaviour under test. */
    const token = signIdToken(
      keypair,
      validClaims(NONCE, { exp: Math.floor(Date.now() / 1000) + 30 * 3600 }),
    );
    /* One successful pair of calls (discovery + jwks), then the endpoint dies. */
    const flakyFetch = makeJwksFetch([keypair.jwk], { failAfter: 2 });

    const first = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: flakyFetch,
    });
    expect(first.ok).toBe(true);

    /* Two hours later the cache is past its refresh interval, the refresh fails,
     * and the previous key is still inside the hard max age — logins continue. */
    const later = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: flakyFetch,
      now: Date.now() + 2 * 60 * 60 * 1000,
    });
    expect(later.ok).toBe(true);
  });

  it("stops trusting a cached key once it is older than the hard max age", async () => {
    const token = signIdToken(keypair, validClaims(NONCE));
    const flakyFetch = makeJwksFetch([keypair.jwk], { failAfter: 2 });

    expect((await verifyShopifyIdToken(token, { expectedNonce: NONCE, fetchImpl: flakyFetch })).ok)
      .toBe(true);

    /* 25 hours on, with every refresh failing. A key we have not been able to
     * confirm for a day may have been rotated out; continuing to accept it would
     * keep a revoked signer valid indefinitely. */
    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: flakyFetch,
      now: Date.now() + 25 * 60 * 60 * 1000,
    });

    expect(result).toEqual({ ok: false, reason: "jwks_unavailable" });
  });

  it("re-fetches once when an unknown kid arrives (key rotation)", async () => {
    const log: FetchLog = { discovery: 0, jwks: 0 };
    const rotated = makeKeypair("id_1");
    /* The served JWKS already contains the new key; the cache does not, because
     * this call is the first one. To model rotation the cache is warmed with the
     * old key set, then a token signed by the new key arrives. */
    const oldOnly = makeJwksFetch([keypair.jwk], { log });
    await verifyShopifyIdToken(signIdToken(keypair, validClaims(NONCE)), {
      expectedNonce: NONCE,
      fetchImpl: oldOnly,
    });
    expect(log.jwks).toBe(1);

    const bothKeys = makeJwksFetch([keypair.jwk, rotated.jwk], { log });
    const token = signIdToken(rotated, validClaims(NONCE), { header: { kid: "id_1" } });

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: bothKeys,
    });

    expect(result.ok).toBe(true);
    expect(log.jwks).toBe(2); // exactly one extra fetch, not one per attempt
  });

  it("fails closed when the kid is unknown even after a refresh", async () => {
    const stranger = makeKeypair("not-published");
    const token = signIdToken(stranger, validClaims(NONCE), { header: { kid: "not-published" } });

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result).toEqual({ ok: false, reason: "signing_key_not_found" });
  });

  it("does not build the JWKS URL itself — it follows discovery", async () => {
    /* Shopify's own docs show a jwks_uri under `/authentication/`, while the live
     * discovery document for this store points at `/.well-known/jwks.json`. A
     * hard-coded path 404s. This test fails if anyone reintroduces one. */
    const log: FetchLog = { discovery: 0, jwks: 0 };
    const token = signIdToken(keypair, validClaims(NONCE));

    await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: makeJwksFetch([keypair.jwk], { log }),
    });

    expect(log.discovery).toBe(1);
    expect(log.jwks).toBe(1);
  });

  it("ignores non-RSA keys in the JWKS (the store publishes Ed25519 keys too)", async () => {
    const ed25519Key = { kty: "OKP", crv: "Ed25519", x: "AAAA", kid: "shop_0", use: "sig" };
    const token = signIdToken(keypair, validClaims(NONCE));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: makeJwksFetch([ed25519Key, keypair.jwk]),
    });

    expect(result.ok).toBe(true);
  });

  it("reports the issuer from discovery, not a compiled-in constant", async () => {
    const token = signIdToken(keypair, validClaims(NONCE));

    const result = await verifyShopifyIdToken(token, {
      expectedNonce: NONCE,
      fetchImpl: jwksFetch(),
    });

    expect(result.ok && result.claims.iss).toBe(TEST_ISSUER);
  });
});
