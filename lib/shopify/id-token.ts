import { createHash, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "crypto";

import { env } from "@/lib/config";

/**
 * Shopify Customer Account API の `id_token` を **署名まで含めて** 検証する。
 *
 * ## なぜ必要か（設計書 §5-4 / 実装項目 1-0b）
 *
 * これまで `lib/shopify/customer.ts` は id_token の payload を Base64 で開くだけで、
 * 署名を一切見ていなかった（`TODO(signature)`）。「back-channel で取ってきたのだから
 * 出所は TLS が保証している」という理由づけは、**その 1 回の交換の中でだけ**成り立つ。
 * トークンはその後 `shop_it` cookie に保存され、ログアウトの `id_token_hint` として
 * 再利用され、`sub` から導いた `shop_cid` が Firestore のユーザーキーを決める。つまり
 * 「誰か」を決める材料が、検証されていないバイト列に依存していた。
 *
 * OIDC Core 1.0 §3.1.3.7 が要求するのは transport の信頼ではなく **トークン自身の検証**で、
 * 具体的には (1) 署名 (2) iss (3) aud (4) exp/iat (5) nonce の 5 点。本モジュールはその 5 点を
 * すべて実施し、どれか 1 つでも欠けたら「検証できなかった」として拒否する（fail-closed）。
 *
 * ## 鍵はどこから来るか
 *
 * ハードコードしない。OIDC discovery（`/.well-known/openid-configuration`）を引いて
 * `issuer` と `jwks_uri` を取り、JWKS から `kid` 一致の公開鍵を選ぶ。実測 2026-08-21:
 *
 *   discovery: https://account.elxea.com/.well-known/openid-configuration
 *   issuer   : https://shopify.com/authentication/{shop_id}
 *   jwks_uri : https://account.elxea.com/.well-known/jwks.json   ← `/authentication/` は付かない
 *   id_token_signing_alg_values_supported: ["RS256"]
 *
 * jwks_uri のパスを推測で書くと 404 になる（Shopify のドキュメント例は
 * `/authentication/.well-known/jwks.json` という別の形を載せている）。だから discovery を
 * 必ず経由し、URL を自前で組み立てない。
 *
 * ## 可用性（鍵取得が落ちているときに全ログインを止めないために）
 *
 * fail-closed は「検証できないトークンを通さない」であって「Shopify の JWKS が一瞬落ちたら
 * 全員ログイン不能」ではない。取得できた鍵はプロセス内にキャッシュし、
 *
 *   - `JWKS_REFRESH_MS` を過ぎたら**取りに行く**が、失敗しても古い鍵で検証を続ける
 *     （鍵のローテーションは新旧並存期間があるので、直前の鍵はしばらく有効）
 *   - ただし `JWKS_HARD_MAX_AGE_MS` を超えて更新できない鍵は使わない
 *     （無期限に古い鍵を信じ続けると、失効した鍵での偽造を受け入れる窓が開く）
 *   - 未知の `kid` が来たら鍵ローテーションの可能性があるので即時再取得を 1 回試す。
 *     ただし `UNKNOWN_KID_REFRESH_COOLDOWN_MS` で頻度を絞る（未知 kid を投げ続けるだけで
 *     JWKS へ増幅リクエストを出せる状態を作らない）
 *
 * ## 秘密の扱い
 *
 * 失敗理由には payload の中身を入れない。ログに出るのは `reason` の短い定数だけで、
 * トークンそのもの・sub・nonce の実値は出さない。
 */

/** discovery と JWKS の取得先を組み立てる元。`SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL` と同じ既定。 */
const DEFAULT_ACCOUNT_DOMAIN = "account.elxea.com";

/** JWKS を取り直しに行く間隔。 */
const JWKS_REFRESH_MS = 60 * 60 * 1000; // 1h

/** これを超えて更新できていない鍵は使わない（失効鍵を無期限に信じない）。 */
const JWKS_HARD_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

/** 未知 kid をきっかけにした再取得の最短間隔。 */
const UNKNOWN_KID_REFRESH_COOLDOWN_MS = 60 * 1000;

/** exp / iat の時刻ずれ許容。 */
const CLOCK_SKEW_SEC = 60;

/**
 * 受け入れる署名アルゴリズム。discovery の
 * `id_token_signing_alg_values_supported` は `["RS256"]` のみ（実測）。
 *
 * 許可リストであることが本質。`alg` はトークン側が名乗る値なので、ここを緩めると
 * `none`（署名なし）や HS256（公開鍵を HMAC 鍵として使わせる古典的な混同攻撃）が通る。
 */
const ALLOWED_ALGS = new Set(["RS256"]);

/** `sub` が Customer GID の形をしているとき、その数値部分を取り出す。 */
const CUSTOMER_GID_REGEX = /^gid:\/\/shopify\/Customer\/(\d+)$/;

/** `sub` が数値 ID だけで来たとき（GID に包まれていない形）。 */
const BARE_CUSTOMER_ID_REGEX = /^\d+$/;

/**
 * `sub` から `shop_cid` に入れてよい顧客 ID を取り出す。取り出せなければ null。
 *
 * ## null を「検証失敗」にしない理由（2026-08-22 の本番障害）
 *
 * ここは一度「`sub` が Customer GID でなければログイン全体を拒否する」という形で
 * 書かれていて、本番の全メールログインを止めた。実測（Vercel runtime log,
 * `GET /api/auth/callback` 13:05-13:08 JST の 6 回すべて）が示したのは
 * `reason: sub_missing` — つまり署名 / iss / aud / exp / nonce は**すべて通っており
 * トークンは本物**で、`sub` の形だけが想定と違った。GID 前提は実測ではなく
 * テスト fixture に手で書いた値が根拠になっていたため、テストは通ったまま本番だけが落ちた。
 *
 * `sub` は `shop_cid`（識別のキャッシュ）を作るためだけに使う。セッションの権限そのものは
 * access token 側が持ち、`shop_cid` が無いときは `requireAuth` が Customer API を引く
 * 遅い経路へ落ちるので、**取り出せないことは機能の欠落ではなく最適化の不発**でしかない。
 * この修正より前（PR #91 以前）も `extractCustomerIdFromIdToken` が null を返し、
 * 呼び出し側が `shop_cid` を省略するだけでログインは成立していた。その寛容さに戻す。
 *
 * 一方で**形の検査は捨てない**。cookie に入れて Firestore のユーザーキーになる値なので、
 * 見慣れない形は「分からなかった」として null に倒し、推測して詰め込まない。
 */
function extractCustomerId(sub: unknown): string | null {
  /* 数値で来る実装もあるため、文字列化してから形を見る。 */
  const raw =
    typeof sub === "string" ? sub : typeof sub === "number" ? String(sub) : null;
  if (!raw) return null;

  const gid = CUSTOMER_GID_REGEX.exec(raw);
  if (gid) return gid[1];
  if (BARE_CUSTOMER_ID_REGEX.test(raw)) return raw;
  return null;
}

export type ShopifyIdTokenClaims = {
  iss: string;
  sub?: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nonce?: string;
  sid?: string;
  email?: string;
};

export type VerifyShopifyIdTokenResult =
  /** `customerId` は `sub` から取り出せたときだけ入る。null は検証失敗ではない（上記参照）。 */
  | { ok: true; customerId: string | null; claims: ShopifyIdTokenClaims }
  | { ok: false; reason: string };

export type VerifyShopifyIdTokenOptions = {
  /**
   * `/api/auth/login` が発行し `shop_nonce` cookie に置いた値。
   *
   * **必須**。「nonce が無ければ nonce 検証を飛ばす」分岐は作らない — 攻撃者が用意できる
   * トークンからは nonce を落とせるので、その分岐こそが穴になる（PR #90 の判断を踏襲）。
   */
  expectedNonce: string | undefined | null;
  /** テスト用の時刻固定（ms）。 */
  now?: number;
  /** テスト用の fetch 差し替え。 */
  fetchImpl?: typeof fetch;
};

// --- discovery / JWKS cache -------------------------------------------------

type JwksCache = {
  issuer: string;
  jwksUri: string;
  /** kid → 公開鍵。alg は取得時に検査済み。 */
  keys: Map<string, ReturnType<typeof createPublicKey>>;
  fetchedAt: number;
};

let cache: JwksCache | null = null;
let lastUnknownKidRefreshAt = 0;

/** テスト用。モジュール内キャッシュを捨てる。 */
export function __resetShopifyJwksCacheForTests(): void {
  cache = null;
  lastUnknownKidRefreshAt = 0;
}

function discoveryUrl(): string {
  const explicit = env("SHOPIFY_CUSTOMER_ACCOUNT_DISCOVERY_URL");
  if (explicit) return explicit;

  /* authorize URL と同じ origin から組み立てる。テストストアを指す preview では
   * `SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL` が本番と別 origin になるため、
   * discovery だけ本番に張り付いてしまう事故を防ぐ。 */
  const authorizeUrl = env("SHOPIFY_CUSTOMER_ACCOUNT_AUTHORIZE_URL");
  const origin = authorizeUrl
    ? safeOrigin(authorizeUrl) ?? `https://${DEFAULT_ACCOUNT_DOMAIN}`
    : `https://${DEFAULT_ACCOUNT_DOMAIN}`;
  return `${origin}/.well-known/openid-configuration`;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

type JwkLike = {
  kty?: unknown;
  kid?: unknown;
  use?: unknown;
  alg?: unknown;
  n?: unknown;
  e?: unknown;
};

/**
 * discovery → JWKS を取得してキャッシュを差し替える。
 *
 * 失敗しても例外は投げず false を返す。呼び出し側は「古い鍵で続行できるか」を
 * 自分で判断する（可用性の節を参照）。
 */
async function refreshJwks(fetchImpl: typeof fetch, now: number): Promise<boolean> {
  let discovery: { issuer?: unknown; jwks_uri?: unknown };
  try {
    const res = await fetchImpl(discoveryUrl(), { headers: { Accept: "application/json" } });
    if (!res.ok) return false;
    discovery = (await res.json()) as typeof discovery;
  } catch {
    return false;
  }

  const issuer = typeof discovery.issuer === "string" ? discovery.issuer : null;
  const jwksUri = typeof discovery.jwks_uri === "string" ? discovery.jwks_uri : null;
  if (!issuer || !jwksUri) return false;

  let jwks: { keys?: unknown };
  try {
    const res = await fetchImpl(jwksUri, { headers: { Accept: "application/json" } });
    if (!res.ok) return false;
    jwks = (await res.json()) as typeof jwks;
  } catch {
    return false;
  }

  if (!Array.isArray(jwks.keys)) return false;

  const keys = new Map<string, ReturnType<typeof createPublicKey>>();
  for (const raw of jwks.keys as JwkLike[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.kty !== "RSA") continue; // 署名検証に使うのは RS256 の RSA 鍵だけ
    if (raw.use !== undefined && raw.use !== "sig") continue;
    if (raw.alg !== undefined && !ALLOWED_ALGS.has(String(raw.alg))) continue;
    if (typeof raw.kid !== "string" || !raw.kid) continue;
    if (typeof raw.n !== "string" || typeof raw.e !== "string") continue;

    try {
      keys.set(
        raw.kid,
        createPublicKey({ key: { kty: "RSA", n: raw.n, e: raw.e }, format: "jwk" }),
      );
    } catch {
      /* 1 本壊れていても他の鍵は使える。ここで全体を落とさない。 */
    }
  }

  if (keys.size === 0) return false;

  cache = { issuer, jwksUri, keys, fetchedAt: now };
  return true;
}

/**
 * 検証に使える鍵束を返す。取得できず、キャッシュも寿命切れなら null（= fail-closed）。
 */
async function getKeys(fetchImpl: typeof fetch, now: number): Promise<JwksCache | null> {
  if (!cache || now - cache.fetchedAt > JWKS_REFRESH_MS) {
    const refreshed = await refreshJwks(fetchImpl, now);
    if (!refreshed) {
      /* 取れなかった。直前の鍵がまだ「使ってよい古さ」ならそれで続ける。 */
      if (cache && now - cache.fetchedAt <= JWKS_HARD_MAX_AGE_MS) return cache;
      return null;
    }
  }
  return cache;
}

// --- JWT ---------------------------------------------------------------------

function decodeSegment(segment: string): unknown {
  const json = Buffer.from(segment, "base64url").toString("utf8");
  return JSON.parse(json);
}

function constantTimeEquals(a: string, b: string): boolean {
  /* 長さ差で例外を投げさせないため、両辺を固定長にしてから比較する。 */
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * id_token を検証し、Shopify Customer ID を取り出す。
 *
 * 返り値が `ok: false` のとき、呼び出し側は **セッションを一切作らずに**中断すること。
 * 「検証は落ちたがログインは通す」は、この関数を置いた意味を丸ごと消す。
 */
export async function verifyShopifyIdToken(
  idToken: string | undefined | null,
  options: VerifyShopifyIdTokenOptions,
): Promise<VerifyShopifyIdTokenResult> {
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!idToken || typeof idToken !== "string") {
    return { ok: false, reason: "id_token_missing" };
  }
  if (!options.expectedNonce) {
    /* nonce を渡せない呼び出しは、そもそも OIDC のリプレイ束縛が成立していない。 */
    return { ok: false, reason: "expected_nonce_missing" };
  }

  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, reason: "id_token_malformed" };
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: unknown; kid?: unknown; typ?: unknown };
  let claims: ShopifyIdTokenClaims;
  try {
    header = decodeSegment(headerB64) as typeof header;
    claims = decodeSegment(payloadB64) as ShopifyIdTokenClaims;
  } catch {
    return { ok: false, reason: "id_token_undecodable" };
  }
  if (!header || typeof header !== "object" || !claims || typeof claims !== "object") {
    return { ok: false, reason: "id_token_malformed" };
  }

  const alg = typeof header.alg === "string" ? header.alg : "";
  if (!ALLOWED_ALGS.has(alg)) {
    /* `none` / HS256 はここで死ぬ。`alg` はトークン側の自己申告なので許可リストで受ける。 */
    return { ok: false, reason: "id_token_alg_not_allowed" };
  }
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) return { ok: false, reason: "id_token_kid_missing" };

  let keyset = await getKeys(fetchImpl, now);
  if (!keyset) return { ok: false, reason: "jwks_unavailable" };

  let key = keyset.keys.get(kid);
  if (!key && now - lastUnknownKidRefreshAt > UNKNOWN_KID_REFRESH_COOLDOWN_MS) {
    /* 鍵ローテーション直後は未知 kid が正常に起こる。1 回だけ取り直す。 */
    lastUnknownKidRefreshAt = now;
    if (await refreshJwks(fetchImpl, now)) {
      keyset = cache!;
      key = keyset.keys.get(kid);
    }
  }
  if (!key) return { ok: false, reason: "signing_key_not_found" };

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, "utf8");
  let signature: Buffer;
  try {
    signature = Buffer.from(signatureB64, "base64url");
  } catch {
    return { ok: false, reason: "signature_undecodable" };
  }

  let signatureValid = false;
  try {
    signatureValid = cryptoVerify("sha256", signingInput, key, signature);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return { ok: false, reason: "signature_invalid" };

  // --- claims ---------------------------------------------------------------

  if (typeof claims.iss !== "string" || claims.iss !== keyset.issuer) {
    return { ok: false, reason: "iss_mismatch" };
  }

  const clientId = env("SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID") ?? "";
  if (!clientId) return { ok: false, reason: "client_id_not_configured" };
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.some((a) => typeof a === "string" && a === clientId)) {
    return { ok: false, reason: "aud_mismatch" };
  }

  const nowSec = Math.floor(now / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= nowSec - CLOCK_SKEW_SEC) {
    return { ok: false, reason: "expired" };
  }
  if (claims.iat !== undefined) {
    if (typeof claims.iat !== "number" || claims.iat > nowSec + CLOCK_SKEW_SEC) {
      return { ok: false, reason: "iat_in_future" };
    }
  }

  if (typeof claims.nonce !== "string" || claims.nonce.length === 0) {
    return { ok: false, reason: "nonce_missing" };
  }
  if (!constantTimeEquals(claims.nonce, options.expectedNonce)) {
    return { ok: false, reason: "nonce_mismatch" };
  }

  /* `sub` は識別のキャッシュ用でしかないので、ここでログインを止めない。
   * 取り出せない形なら null を返し、呼び出し側は `shop_cid` を置かずに続ける
   * （= PR #91 以前と同じ挙動）。理由は `extractCustomerId` の注記を参照。 */
  return { ok: true, customerId: extractCustomerId(claims.sub), claims };
}
