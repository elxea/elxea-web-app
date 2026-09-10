/**
 * 偽 Shopify Customer Account サーバー（E2E 専用）。
 *
 * ## なぜ必要か
 *
 * 受入シナリオの②「メールでログインしてから LINE を連携する」は、Shopify の顧客セッションが
 * 無いと 1 行目から進まない（`/api/user/line-link/init` は `requireAuth()` で 401）。
 * そしてそのセッションは **Shopify の OAuth 往復でしか**得られない。
 *
 * テスト専用の「セッションを直接生やす裏口」を足す選択肢は取らない。裏口はテストのためだけに
 * 認証を 1 本迂回させることになり、しかも本番のコードに残る（このリポジトリは実際に
 * `chore/remove-deploy-backdoor` で裏口を剥がしている）。代わりに **本物と同じ往復を、
 * 偽の相手に対して**回す。
 *
 * 接続先はすべて既に env 化されている（`SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL` /
 * `_TOKEN_URL` / `_LOGOUT_URL`、discovery は authorize の origin から導出）。唯一
 * 未対応だった Customer GraphQL API の向き先だけ、本 PR で `_API_URL` を足している
 * （既定値は現行と完全に同一）。
 *
 * ## id_token は本物の RS256 で署名する
 *
 * LINE と違い、`lib/shopify/id-token.ts` は **署名を自分で検証する**（discovery → JWKS →
 * kid 照合 → `crypto.verify`）。よってここは本物の JWT を作る必要がある。鍵は起動のたびに
 * その場で生成する使い捨てで、リポジトリにも env にも秘密は置かない。
 *
 * 使い方: node scripts/e2e/fake-shopify-account-server.mjs <port> <publicOrigin> <clientId>
 */
import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import http from "node:http";

const PORT = Number(process.argv[2] ?? 4012);
const PUBLIC_ORIGIN = process.argv[3] ?? `http://127.0.0.1:${PORT}`;
const CLIENT_ID = process.argv[4] ?? "fake-shopify-client-id";

const KID = "fake-shopify-key-1";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = publicKey.export({ format: "jwk" });

const ID_TOKEN_TTL_SEC = 3600;

/** 「今ログインしようとしている顧客」。テストから差し替えられる。 */
const DEFAULT_CUSTOMER = {
  id: "9001",
  email: "fake-customer@example.test",
  firstName: "偽",
  lastName: "顧客",
};
let currentCustomer = { ...DEFAULT_CUSTOMER };

/** code -> { nonce, customer } */
const codes = new Map();
let counter = 0;

function base64url(input) {
  return Buffer.from(input, "utf8").toString("base64url");
}

function signJwt(claims) {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }));
  const payload = base64url(JSON.stringify(claims));
  const signer = createSign("sha256");
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, PUBLIC_ORIGIN);
  const { pathname } = url;

  if (pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }

  if (pathname === "/__control/customer" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    currentCustomer = { ...DEFAULT_CUSTOMER, ...body };
    return json(res, 200, { ok: true, customer: currentCustomer });
  }

  if (pathname === "/__control/reset" && req.method === "POST") {
    currentCustomer = { ...DEFAULT_CUSTOMER };
    codes.clear();
    return json(res, 200, { ok: true });
  }

  /* ---- OIDC discovery / JWKS ---------------------------------------------- */

  if (pathname === "/.well-known/openid-configuration") {
    return json(res, 200, {
      issuer: PUBLIC_ORIGIN,
      authorization_endpoint: `${PUBLIC_ORIGIN}/authentication/oauth/authorize`,
      token_endpoint: `${PUBLIC_ORIGIN}/authentication/oauth/token`,
      jwks_uri: `${PUBLIC_ORIGIN}/.well-known/jwks.json`,
      id_token_signing_alg_values_supported: ["RS256"],
    });
  }

  if (pathname === "/.well-known/jwks.json") {
    return json(res, 200, {
      keys: [{ kty: "RSA", use: "sig", alg: "RS256", kid: KID, n: jwk.n, e: jwk.e }],
    });
  }

  /* ---- OAuth ---------------------------------------------------------------- */

  if (pathname === "/authentication/oauth/authorize") {
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const nonce = url.searchParams.get("nonce");
    if (!redirectUri) return json(res, 400, { error: "invalid_request" });

    const code = `fake-shop-code-${++counter}`;
    codes.set(code, { nonce, customer: { ...currentCustomer } });

    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    if (state) back.searchParams.set("state", state);
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }

  if (pathname === "/authentication/oauth/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const code = form.get("code");
    const issued = code ? codes.get(code) : undefined;
    if (!issued) return json(res, 400, { error: "invalid_grant" });
    codes.delete(code);

    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = signJwt({
      iss: PUBLIC_ORIGIN,
      /* `sub` は Customer GID。web-app 側はここから数値 ID を取り出して `shop_cid` に封じ、
       * それが Firestore の棚のキーになる。 */
      sub: `gid://shopify/Customer/${issued.customer.id}`,
      aud: CLIENT_ID,
      exp: nowSec + ID_TOKEN_TTL_SEC,
      iat: nowSec,
      nonce: issued.nonce ?? undefined,
      sid: randomUUID(),
      email: issued.customer.email,
    });

    return json(res, 200, {
      access_token: `fake-shop-access-${counter}`,
      refresh_token: `fake-shop-refresh-${counter}`,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: ID_TOKEN_TTL_SEC,
    });
  }

  if (pathname === "/authentication/logout") {
    const back = url.searchParams.get("post_logout_redirect_uri");
    if (back) {
      res.writeHead(302, { location: back }).end();
      return;
    }
    return json(res, 200, { ok: true });
  }

  /* ---- Customer GraphQL API ------------------------------------------------ */

  if (pathname.endsWith("/graphql") && req.method === "POST") {
    /* 実際に読まれるのは「新規会員か（注文が 0 件か）」の判定だけ。注文を 1 件入れて
     * **新規会員ではない**ことにしておく。0 件だとウェルカムメール送信に進んでしまい、
     * テストが外部送信を試みる形になる（送信は Resend の鍵が無くて失敗するが、
     * 「試みない」ことを設計で担保するほうが正しい）。 */
    return json(res, 200, {
      data: {
        customer: {
          id: `gid://shopify/Customer/${currentCustomer.id}`,
          firstName: currentCustomer.firstName,
          lastName: currentCustomer.lastName,
          emailAddress: { emailAddress: currentCustomer.email },
          orders: { edges: [{ node: { id: "gid://shopify/Order/1" } }] },
        },
      },
    });
  }

  return json(res, 404, { error: "not_found", path: pathname });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`fake Shopify account server on 127.0.0.1:${PORT}\n`);
});
