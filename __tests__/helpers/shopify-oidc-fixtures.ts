/**
 * Test fixtures for Shopify `id_token` verification.
 *
 * These build **really signed** tokens with a throwaway RSA keypair and serve a
 * matching JWKS, so the tests exercise the actual signature path rather than a
 * mocked verifier. That is the whole point: the defect being fixed was a decode
 * that never checked a signature, and a test that mocks the check away would
 * have passed against the broken code too.
 *
 * Not a `.test.ts` file, so vitest's `include` does not collect it.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "crypto";

export const TEST_ISSUER = "https://shopify.com/authentication/53242265758";
export const TEST_CLIENT_ID = "shp_test_client_id";
export const TEST_DISCOVERY_URL = "https://account.test.invalid/.well-known/openid-configuration";
export const TEST_JWKS_URI = "https://account.test.invalid/.well-known/jwks.json";
export const TEST_KID = "id_0";

const b64url = (value: string | Buffer) =>
  Buffer.from(value as never).toString("base64url");

export type Keypair = {
  privateKeyPem: string;
  publicKeyPem: string;
  /** The JWK this key should appear as in a JWKS response. */
  jwk: Record<string, unknown>;
};

/** A fresh RSA keypair plus its JWK, tagged with `kid`. */
export function makeKeypair(kid = TEST_KID): Keypair {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const jwkRaw = createPublicKey(publicKeyPem).export({ format: "jwk" }) as Record<string, unknown>;
  return {
    privateKeyPem,
    publicKeyPem,
    jwk: { ...jwkRaw, kid, use: "sig", alg: "RS256" },
  };
}

export type SignOptions = {
  /** Override the JOSE header (e.g. `{ alg: "none" }`). */
  header?: Record<string, unknown>;
  /** Sign with this key instead of the one whose JWK is published. */
  signWith?: string;
  /** Emit the signature bytes of a DIFFERENT payload (tamper simulation). */
  corruptSignature?: boolean;
};

/** Build a signed RS256 JWT. */
export function signIdToken(
  keypair: Keypair,
  claims: Record<string, unknown>,
  options: SignOptions = {},
): string {
  const header = { alg: "RS256", typ: "JWT", kid: TEST_KID, ...options.header };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;

  if (header.alg === "none") return `${signingInput}.`;

  const key = createPrivateKey(options.signWith ?? keypair.privateKeyPem);
  const payloadToSign = options.corruptSignature ? `${signingInput}-tampered` : signingInput;
  const signature = sign("sha256", Buffer.from(payloadToSign, "utf8"), key);
  return `${signingInput}.${signature.toString("base64url")}`;
}

/** Claims that pass every check, so a test only has to state its one deviation. */
export function validClaims(
  nonce: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    iss: TEST_ISSUER,
    aud: TEST_CLIENT_ID,
    sub: "gid://shopify/Customer/7654321",
    exp: nowSec + 3600,
    iat: nowSec,
    nonce,
    ...overrides,
  };
}

export type FetchLog = { discovery: number; jwks: number };

/**
 * A `fetch` that answers the discovery and JWKS URLs and nothing else.
 *
 * `failAfter` lets a test make the endpoints start failing partway through, which
 * is how the "keep serving from cache when refresh fails" behaviour is pinned.
 */
export function makeJwksFetch(
  keys: Array<Record<string, unknown>>,
  options: { failAfter?: number; log?: FetchLog } = {},
): typeof fetch {
  let calls = 0;
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    calls += 1;
    if (options.failAfter !== undefined && calls > options.failAfter) {
      return new Response("upstream down", { status: 503 });
    }
    if (url === TEST_DISCOVERY_URL) {
      if (options.log) options.log.discovery += 1;
      return Response.json({ issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI });
    }
    if (url === TEST_JWKS_URI) {
      if (options.log) options.log.jwks += 1;
      return Response.json({ keys });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
