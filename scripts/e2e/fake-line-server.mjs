/**
 * 偽 LINE サーバー（E2E 専用）。
 *
 * ## なぜ「偽サーバー」でなければならないのか
 *
 * LINE ログイン／連携の往復のうち、**ブラウザから見えるのは authorize の 1 ホップだけ**で、
 * token 交換・profile 取得・verify は route handler から LINE へのサーバ間通信になる。
 * Playwright の `page.route` はサーバ間通信を触れないので、ブラウザ側の仕掛けでは
 * 成功経路（SUCCESS）を一度も踏めない。踏めない結果として、この経路が発行する
 * セッションクッキーを壊す変更がフルグリーンのまま通ったことが実際にある
 * （経緯は lib/line/endpoints.ts の冒頭）。
 *
 * 接続先は PR #103 で env 化済み（`LINE_AUTH_BASE_URL` / `LINE_API_BASE_URL`）。この
 * サーバーはその 2 つを 1 プロセスで受ける。**本物の LINE には一切接続しない。**
 *
 * ## 既存の line-api-stub.mjs との関係
 *
 * これは同スタブの後継で、置き換える（偽 LINE を 2 つ育てない = 単一正本）。旧スタブは
 *   - `/oauth2/v2.1/authorize` を持たず、認可の往復そのものを飛ばしていた
 *   - `/oauth2/v2.1/verify` が `{ email }` しか返さず、`verifyLineIdToken` が要求する
 *     `aud` / `iss` / `exp` / `sub` / `nonce` を満たしていなかった
 * ため、id_token 検証がゲート化された今では SUCCESS 経路に到達できない。
 *
 * ## 何を模しているか
 *
 *   GET  /oauth2/v2.1/authorize  … 認可。同意画面は出さず即 302 で `code` を返す
 *   POST /oauth2/v2.1/token      … code → access_token / id_token
 *   GET  /v2/profile             … access_token → userId / displayName
 *   POST /oauth2/v2.1/verify     … id_token → claims（aud/iss/exp/sub/nonce/email）
 *
 * ## id_token の形について
 *
 * 本物の LINE の id_token は署名付き JWT だが、`lib/line/verify-liff-token.ts` は
 * **署名を自分で検証しない**（LINE の verify エンドポイントの応答を信頼し、その上で
 * aud/iss/exp/sub/nonce を自前で再検査する）。よってここでは JWT を作らず、
 * `fake.<base64url(JSON)>` という**明らかに合成物と分かる**不透明トークンにする。
 * 署名を偽造して「本物っぽく」見せるより、偽物であることが読んで分かる方が安全。
 * （Shopify 側は署名を実際に検証するので、そちらの偽サーバーは本物の RS256 を使う。）
 *
 * ## 「今この端末でログインしている LINE アカウント」の決め方
 *
 * 実機では LINE 側のセッションが決める。テストからはそれを選べる必要があるので
 * `POST /__control/line-user` で切り替える（シナリオ④「同じ人でもう一度ログイン」と
 * 「別人の LINE が残っている共用端末」を撃ち分けるための唯一の入口）。
 *
 * 使い方: node scripts/e2e/fake-line-server.mjs <port> <publicOrigin> [hitLogPath]
 */
import { appendFileSync, mkdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const PORT = Number(process.argv[2] ?? 4010);
/** `iss` に載せる値。アプリ側の `lineAuthBaseUrl()` と一致していなければならない。 */
const PUBLIC_ORIGIN = process.argv[3] ?? `http://127.0.0.1:${PORT}`;
const HIT_LOG = process.argv[4] ?? null;

/** 既定の LINE ユーザー。`sub` は Messaging userId 形式（U + 32 hex）でなければ弾かれる。 */
const DEFAULT_USER = {
  userId: `U${"a".repeat(32)}`,
  displayName: "偽LINE太郎",
  email: "fake-line-user@example.test",
};

/** id_token の寿命（秒）。`exp` の自前検証を通せる程度に短く、時計ずれには余裕を持たせる。 */
const ID_TOKEN_TTL_SEC = 600;

let currentUser = { ...DEFAULT_USER };
/** code → 認可要求の中身。1 回使ったら捨てる（本物と同じ one-shot）。 */
const codes = new Map();
/** access_token → 発行時のユーザー。 */
const accessTokens = new Map();
let counter = 0;

if (HIT_LOG) mkdirSync(path.dirname(HIT_LOG), { recursive: true });

function recordHit(entry) {
  if (!HIT_LOG) return;
  try {
    appendFileSync(HIT_LOG, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {
    /* ログが書けないことでテストを落とさない（ログは assertion の補助であって本体ではない）。 */
  }
}

function encodeIdToken(claims) {
  return `fake.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`;
}

function decodeIdToken(token) {
  if (typeof token !== "string" || !token.startsWith("fake.")) return null;
  try {
    return JSON.parse(Buffer.from(token.slice("fake.".length), "base64url").toString("utf8"));
  } catch {
    return null;
  }
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

  /* ---- テストからの操作（本物の LINE には存在しない） ---------------------- */

  if (pathname === "/__control/line-user" && req.method === "POST") {
    const body = JSON.parse((await readBody(req)) || "{}");
    currentUser = {
      userId: body.userId ?? DEFAULT_USER.userId,
      displayName: body.displayName ?? DEFAULT_USER.displayName,
      email: body.email ?? DEFAULT_USER.email,
    };
    recordHit({ path: pathname, userId: currentUser.userId });
    return json(res, 200, { ok: true, user: currentUser });
  }

  if (pathname === "/__control/reset" && req.method === "POST") {
    currentUser = { ...DEFAULT_USER };
    codes.clear();
    accessTokens.clear();
    return json(res, 200, { ok: true });
  }

  /* ---- 認可 ---------------------------------------------------------------- */

  if (pathname === "/oauth2/v2.1/authorize") {
    const responseType = url.searchParams.get("response_type");
    const clientId = url.searchParams.get("client_id");
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const nonce = url.searchParams.get("nonce");

    recordHit({ path: pathname, clientId, hasNonce: Boolean(nonce), hasState: Boolean(state) });

    if (responseType !== "code" || !clientId || !redirectUri) {
      return json(res, 400, { error: "invalid_request" });
    }

    /* テストが「ユーザーが同意しなかった」を作るための入口。認可 URL はアプリが組むので
     * クエリでは指定できない。`/__control/line-user` と同じ理由でここに置く。 */
    if (currentUser.userId === "__deny__") {
      const denied = new URL(redirectUri);
      denied.searchParams.set("error", "access_denied");
      if (state) denied.searchParams.set("state", state);
      res.writeHead(302, { location: denied.toString() }).end();
      return;
    }

    const code = `fake-code-${++counter}`;
    codes.set(code, { clientId, redirectUri, nonce, user: { ...currentUser } });

    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    if (state) back.searchParams.set("state", state);
    res.writeHead(302, { location: back.toString() }).end();
    return;
  }

  /* ---- token 交換 ---------------------------------------------------------- */

  if (pathname === "/oauth2/v2.1/token" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const code = form.get("code");
    const clientId = form.get("client_id");
    const issued = code ? codes.get(code) : undefined;

    recordHit({ path: pathname, clientId, codeKnown: Boolean(issued) });

    if (form.get("grant_type") !== "authorization_code" || !issued) {
      return json(res, 400, { error: "invalid_grant" });
    }
    /* code は one-shot。使い回しを黙って通すと「認可を 1 回しか使えない」性質が
     * テストから見えなくなる。 */
    codes.delete(code);

    if (issued.clientId !== clientId) {
      return json(res, 400, { error: "invalid_client" });
    }

    const accessToken = `fake-access-${++counter}`;
    accessTokens.set(accessToken, issued.user);

    const nowSec = Math.floor(Date.now() / 1000);
    const idToken = encodeIdToken({
      iss: PUBLIC_ORIGIN,
      sub: issued.user.userId,
      aud: clientId,
      exp: nowSec + ID_TOKEN_TTL_SEC,
      iat: nowSec,
      ...(issued.nonce ? { nonce: issued.nonce } : {}),
      name: issued.user.displayName,
      email: issued.user.email,
    });

    return json(res, 200, {
      access_token: accessToken,
      refresh_token: `fake-refresh-${counter}`,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: ID_TOKEN_TTL_SEC,
      scope: "profile openid email",
    });
  }

  /* ---- profile ------------------------------------------------------------- */

  if (pathname === "/v2/profile") {
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const user = accessTokens.get(bearer);
    recordHit({ path: pathname, known: Boolean(user) });
    if (!user) return json(res, 401, { message: "invalid access token" });
    return json(res, 200, {
      userId: user.userId,
      displayName: user.displayName,
      pictureUrl: `${PUBLIC_ORIGIN}/fake-avatar.png`,
    });
  }

  /* ---- verify -------------------------------------------------------------- */

  if (pathname === "/oauth2/v2.1/verify" && req.method === "POST") {
    const form = new URLSearchParams(await readBody(req));
    const claims = decodeIdToken(form.get("id_token"));
    const clientId = form.get("client_id");
    const nonce = form.get("nonce");

    recordHit({ path: pathname, clientId, hasNonce: Boolean(nonce) });

    if (!claims) return json(res, 400, { error: "invalid_request" });
    /* 本物の LINE は aud 不一致・nonce 不一致・期限切れを 400 で返す。アプリはその
     * 400 だけに寄りかからず自前でも見るが、偽物が全部 200 で返すと「LINE 側でも
     * 落ちる」という前提の方が検証されないまま残る。ここも本物と同じ形で落とす。 */
    if (claims.aud !== clientId) return json(res, 400, { error_description: "aud mismatch" });
    if (nonce && claims.nonce !== nonce) {
      return json(res, 400, { error_description: "nonce mismatch" });
    }
    if (typeof claims.exp !== "number" || claims.exp <= Math.floor(Date.now() / 1000)) {
      return json(res, 400, { error_description: "expired" });
    }

    return json(res, 200, claims);
  }

  recordHit({ path: pathname, unhandled: true });
  return json(res, 404, { error: "not_found", path: pathname });
});

server.listen(PORT, "127.0.0.1", () => {
  process.stderr.write(`fake LINE server on 127.0.0.1:${PORT} (iss=${PUBLIC_ORIGIN})\n`);
});
