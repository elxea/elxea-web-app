/**
 * Hume の「入場券」(短命アクセストークン) の取得と、サーバ内での使い回し。
 *
 * 正本: 設計書 D-1
 * https://app.notion.com/p/3d870c9d064c81798c41cd5135be44f0
 *
 * ## なぜ恒久鍵をブラウザに置かないのか
 *
 * ブラウザから Hume に直接つなぐとき渡せる資格情報は 2 種類ある。
 * (1) 恒久的な API キーそのもの、(2) 短い期限の入場券。(1) はブラウザに
 * 秘密を置くことになるので採らない。この module は (2) を作る側で、
 * `HUME_API_KEY` / `HUME_SECRET_KEY` は**この process から出ない**。
 *
 * ## なぜサーバ内で使い回すのか
 *
 * 入場券は Hume アカウント単位で発行され、利用者ごとではない (設計書 D-1
 * 「ここが本当のリスク」)。人数ぶん取りに行っても中身は同じ資格で、
 * 増えるのは Hume への往復と、期限切れ間際の券を配ってしまう確率だけ。
 * なので 1 つ取って、期限に安全余裕を引いたあいだ同じものを配る。
 *
 * キャッシュは `lib/config/index.ts` が「値のキャッシュは第 2 の正本になる」と
 * して避けているのとは種類が違う。あちらは**同じ事実の写し**を持つ話で、
 * こちらは**外部への往復の削減**で、正本は常に Hume 側にある (期限が来れば
 * 必ず取り直す)。
 *
 * ## 同時に来た要求をまとめる (single flight)
 *
 * キャッシュが空のときに 10 本同時に来たら、素朴な実装は Hume へ 10 回行く。
 * 進行中の約束を 1 本だけ持ち、後続はそれに相乗りする。
 *
 * ## 秘密を出さない約束
 *
 * この module は例外メッセージにもログにも、鍵とトークンの**中身を一切**
 * 書かない。Hume が返したエラー本文もそのままは通さない (資格情報を
 * echo back する実装が上流にあった場合に巻き込まれるため)。
 */

import { env } from "@/lib/config";

/** Hume の client-credentials トークン発行口。 */
const HUME_TOKEN_ENDPOINT = "https://api.hume.ai/oauth2-cc/token";

/**
 * 期限のどれだけ手前で取り直すか。
 *
 * ブラウザが受け取ってから実際に Hume へつなぐまでの間と、時計のずれの分。
 * ここが 0 だと「受け取った瞬間に切れている券」を配りうる。
 */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/** Hume への往復が返らないときに諦めるまで。入場券の発行は数百 ms の処理。 */
const REQUEST_TIMEOUT_MS = 8_000;

/** 呼び出し側に渡す入場券。恒久鍵は含まれない。 */
export interface HumeAccessToken {
  /** Hume へ渡す短命トークン。 */
  accessToken: string;
  /** 失効時刻 (epoch ms)。安全余裕を引く前の、Hume が言った値。 */
  expiresAt: number;
}

/** `HUME_API_KEY` / `HUME_SECRET_KEY` が揃っていない。 */
export class HumeCredentialsMissingError extends Error {
  constructor(missing: string) {
    super(
      `Hume credentials are not configured: ${missing} is missing. ` +
        "Both are declared in lib/config/spec.ts — set them in the deployment environment.",
    );
    this.name = "HumeCredentialsMissingError";
  }
}

/** Hume がトークンを返さなかった。値・本文は含めない。 */
export class HumeTokenError extends Error {
  /** Hume の HTTP ステータス。ネットワーク層で落ちたときは undefined。 */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "HumeTokenError";
    this.status = status;
  }
}

/** 現在保持している入場券。期限切れまで使い回す。 */
let cached: HumeAccessToken | null = null;
/** 進行中の取得。同時要求はこれに相乗りする。 */
let inFlight: Promise<HumeAccessToken> | null = null;

function isUsable(token: HumeAccessToken | null): token is HumeAccessToken {
  return token !== null && Date.now() < token.expiresAt - EXPIRY_SAFETY_MARGIN_MS;
}

/**
 * Hume に入場券を取りに行く (キャッシュを見ない)。
 *
 * 認証は client-credentials。`Authorization: Basic base64(apiKey:secretKey)` に
 * 鍵を載せるので、この関数の外へ `headers` を渡さない。
 */
async function fetchAccessToken(): Promise<HumeAccessToken> {
  const apiKey = env("HUME_API_KEY");
  const secretKey = env("HUME_SECRET_KEY");

  if (!apiKey || !secretKey) {
    throw new HumeCredentialsMissingError(!apiKey ? "HUME_API_KEY" : "HUME_SECRET_KEY");
  }

  const basic = Buffer.from(`${apiKey}:${secretKey}`, "utf8").toString("base64");

  /* 期限の起点は「送る直前」。Hume の応答を受け取った時刻を起点にすると、
     往復にかかった分だけ期限を長く見積もることになる。 */
  const requestedAt = Date.now();

  let response: Response;
  try {
    response = await fetch(HUME_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      /* 入場券は人ごとに違う。どこかに載ると別の人に同じ券が配られる。 */
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    /* 原因 (timeout / DNS / TLS) は握り潰さず名前だけ残す。本文は残さない。 */
    const name = err instanceof Error ? err.name : "UnknownError";
    throw new HumeTokenError(`Hume token request failed before a response (${name})`);
  }

  if (!response.ok) {
    /* 本文は読まない。資格情報を echo back する上流に巻き込まれない。 */
    throw new HumeTokenError("Hume rejected the token request", response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new HumeTokenError("Hume returned a non-JSON token response", response.status);
  }

  const body = payload as { access_token?: unknown; expires_in?: unknown };
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!accessToken) {
    throw new HumeTokenError("Hume token response had no access_token", response.status);
  }

  /* `expires_in` は秒。欠けていたら短めに見積もる — 長く見積もると
     「切れている券を配り続ける」side に倒れるため。 */
  const expiresInSec =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in) && body.expires_in > 0
      ? body.expires_in
      : 300;

  return { accessToken, expiresAt: requestedAt + expiresInSec * 1000 };
}

/**
 * 入場券を得る。使える券が手元にあればそれを返す。
 *
 * @throws {HumeCredentialsMissingError} 鍵が未設定のとき。
 * @throws {HumeTokenError} Hume が返さなかったとき。
 *
 * **音声セッションは一切張らない。** ここが触るのはトークン発行口だけで、
 * Hume の音声時間 (課金対象) を消費しない。
 */
export async function getHumeAccessToken(): Promise<HumeAccessToken> {
  if (isUsable(cached)) return cached;
  if (inFlight) return inFlight;

  inFlight = fetchAccessToken()
    .then((token) => {
      cached = token;
      return token;
    })
    .finally(() => {
      /* 失敗は覚えない。次の要求で素直に取り直す (失敗を握ったまま
         全員に配り続けるより、1 往復増えるほうが安い)。 */
      inFlight = null;
    });

  return inFlight;
}

/**
 * ブラウザに返す「あと何秒使えるか」。
 *
 * 安全余裕を引いた値を返す。ブラウザ側は「この秒数を過ぎたら取り直す」と
 * だけ決めればよく、時計のずれを各自で見積もらなくて済む。
 */
export function remainingSeconds(token: HumeAccessToken, now: number = Date.now()): number {
  return Math.max(0, Math.floor((token.expiresAt - EXPIRY_SAFETY_MARGIN_MS - now) / 1000));
}

/** キャッシュを捨てる。テスト専用 — 本番コードから呼ばない。 */
export function __resetHumeTokenCacheForTests(): void {
  cached = null;
  inFlight = null;
}
