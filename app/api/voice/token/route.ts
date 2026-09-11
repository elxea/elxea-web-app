/**
 * POST /api/voice/token — 音声の「入場券」を受け取る唯一の口。
 *
 * 正本: 設計書 D-1
 * https://app.notion.com/p/3d870c9d064c81798c41cd5135be44f0
 *
 * 音声そのものはこのサーバを 1 バイトも通らない。ここが渡すのは
 *   - Hume につなぐための短命トークン
 *   - どの会話の続きなのかを表す、元に戻せない文字列 (`session_handle`)
 * の 2 つだけ。
 *
 * ## 処理の順 (設計書 D-1 の確定仕様。並べ替えない)
 *
 *   会話 ID を確定 → ログイン判定 → 使いすぎのチェック
 *   → 機能スイッチが切なら 404 → 入場券を発行 → 返す
 *
 * 機能スイッチの判定を**使いすぎのチェックより後**に置いてあるのは意図的。
 * 先に 404 で返すと、止めている状態では回数を数えないことになり、
 * 「切ってあるはずの窓口を叩き続ける」挙動に気付けない。
 *
 * ## 他人に入場券が配られる事故を防ぐ 4 重の止め
 *
 *   1. `dynamic = "force-dynamic"` — 既存 7 本と同じ書き方
 *   2. `Cache-Control: no-store` — 会話 ID を返す既存の窓口と同じ
 *   3. **POST 固定** — GET だと先読み・CDN・履歴戻りの対象になりうる。
 *      他の method を export していないので Next が 405 を返す
 *   4. 応答に個人情報を混ぜない。恒久鍵 (`HUME_API_KEY` / `HUME_SECRET_KEY`) は
 *      どの経路でも応答に載らない (`lib/voice/hume-token.ts` の外に出ない)
 *
 * ランタイム指定 (`runtime`) も処理時間の上限 (`maxDuration`) も**書かない**。
 * Route Handler 49 本すべてで 0 件の作法で、ここだけ特別に見えるのを避ける。
 */
import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/config";
import { logger } from "@/lib/log";
import { buildProxyAuth } from "@/lib/chat/proxy";
import { resolveChatSession, writeChatSessionCookie } from "@/lib/chat/session-server";
import { enforceRateLimit, getClientIp, type Ratelimiter } from "@/lib/ratelimit";
import {
  HumeCredentialsMissingError,
  type HumeAccessToken,
  getHumeAccessToken,
  remainingSeconds,
} from "@/lib/voice/hume-token";
import { VoiceSessionSecretMissingError, deriveVoiceSessionHandle } from "@/lib/voice/session-id";

/* cookie を読んで (必要なら) 発行するので動的レンダリング固定。
   ランタイム指定は書かない (Route Handler の既定が nodejs)。 */
export const dynamic = "force-dynamic";

/**
 * 入場券の発行回数の上限。
 *
 * **U-3 未決・暫定。** 上限方式そのもの (アカウント単位で通算いくらまで許すか /
 * 1 人あたりで切るか) はオーナー判断待ちで、ここでは決めていない。判断を待たずに
 * 公開しないための保守的な当て板として、1 発行者あたりの発行**回数**だけを絞る。
 *
 * 値をここに置いてあるのは、上限を変えるときに触る場所を 1 箇所にするため。
 * 環境変数にはしていない — 設計書 D-1 が挙げる新設の設定値は 5 本で確定しており、
 * 6 本目を lint 強制のレジストリに足すのは設計の範囲外。
 *
 * `backend: "memory"` は費用上の選択。Upstash は Free plan の日次コマンド数に
 * 上限があり、`lib/ratelimit.ts` は security-critical な 2 本だけをそちらへ
 * 回している。音声の入場券のために新しく外部サービスを使う種別を足さない
 * (設計書 D-5 の注意点)。process 内でしか数えないので Vercel の instance を
 * またいだ合算はできない — そこは上限方式が決まったときに一緒に直す。
 *
 * 既定が保守的なのは、Hume の残枠が約 21 秒しかないため (設計書 D-5)。
 * 1 回の音声セッションにつき発行は 1〜2 回なので、10 回/時 は
 * 「同じ人が繰り返し試す」には足りて「1 人が使い切る」には届かない量。
 */
/**
 * 上限の名前。
 *
 * `name: "voice-token"` と直接書かない。`__tests__/auth-cookie-registry.test.ts`
 * の走査器は cookie 名を解決するとき、`response.cookies.set(name, ...)` のような
 * **識別子**を、走査対象ツリー全体の `name:` という property assignment から
 * 名前一致で引き当てる。`app/` は `lib/` より先に歩かれるので、ここに
 * `name: "<文字列リテラル>"` を書くと `lib/auth/cookies.ts` の cookie 名が
 * この文字列に解決され、「登録されていない cookie 名がある」として落ちる
 * (実際に落ちたのを確認済み)。走査器側の曖昧さで、この窓口の問題ではないが、
 * 定数を 1 枚挟むだけで回避できるので挟む。
 */
const VOICE_TOKEN_LIMITER_NAME = "voice-token";

const VOICE_TOKEN_LIMITER: Ratelimiter = {
  name: VOICE_TOKEN_LIMITER_NAME,
  limit: 10,
  windowMs: 60 * 60 * 1000,
  backend: "memory",
};

export async function POST(request: NextRequest) {
  /* 1. 会話 ID を確定する。
        ブラウザは会話 ID を指定できない — cookie の署名を検証して
        サーバが決めた値だけを使う (設計書 F-4)。 */
  const session = await resolveChatSession();

  /* 2. ログイン判定。2 つ目の判定を作らない (2026-08-30 の本番障害の再発防止)。
        ここでは誰かを弾くためではなく、使いすぎを**人ごとに**数えるために使う。
        未ログインでも文字チャットは使えるので、音声だけログイン必須にはしない。 */
  const { verifiedCustomerId } = await buildProxyAuth();

  /* 3. 使いすぎのチェック。
        ログイン済みなら本人単位、そうでなければ接続元単位で数える。
        **会話 ID を鍵にしない**: cookie を消すたびに新しい会話 ID が発行される
        ので、消して掛け直すだけで上限をすり抜けられる。IP は cookie ほど
        気軽には替えられないぶん、匿名側の当て板として素直。 */
  const rateLimitKey = verifiedCustomerId ?? `ip:${getClientIp(request)}`;
  const limited = await enforceRateLimit(request, VOICE_TOKEN_LIMITER, rateLimitKey);
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  /* 4. 機能スイッチ。未設定なら無効 (`lib/config/spec.ts` の宣言側で潰してある)。
        切のときは 404 — 「ある窓口が今は断っている」ではなく「そんな窓口は無い」
        として扱う。存在を知らせない。 */
  if (!env("NEXT_PUBLIC_VOICE_ENABLED")) {
    return noStore({ error: "Not Found" }, 404);
  }

  /* 5. 入場券を発行する。
        handle が作れないときは券を出さない。handle 無しで Hume につなぐと
        声で話した分が既存の会話に合流できず、文字と声で会話が分裂する
        (設計書 D-4 の根幹)。無言で劣化させない。 */
  let sessionHandle: string;
  try {
    sessionHandle = deriveVoiceSessionHandle(session.sessionId);
  } catch (err) {
    if (err instanceof VoiceSessionSecretMissingError) {
      logger.error("voice.token.session-secret-missing", err, {
        operation: "POST /api/voice/token",
        /* 値は出さない (未設定であることだけが情報)。 */
        consequence: "no voice token is issued; text chat is unaffected",
      });
      return noStore({ error: "Voice is not configured" }, 503);
    }
    throw err;
  }

  let token: HumeAccessToken;
  try {
    token = await getHumeAccessToken();
  } catch (err) {
    if (err instanceof HumeCredentialsMissingError) {
      logger.error("voice.token.credentials-missing", err, {
        operation: "POST /api/voice/token",
        consequence: "no voice token is issued; text chat is unaffected",
      });
      return noStore({ error: "Voice is not configured" }, 503);
    }
    /* Hume 側の不調。理由の中身はブラウザに渡さない (上流のメッセージが
       資格情報を含みうるため) が、調べられる形ではサーバに残す。
       `lib/voice/hume-token.ts` の例外は値を持たない作りなのでそのまま渡せる。 */
    logger.error("voice.token.upstream-failed", err, {
      operation: "POST /api/voice/token",
      consequence: "voice is unavailable for this request",
    });
    return noStore({ error: "Voice is temporarily unavailable" }, 502);
  }

  /* 6. 返す。載せるのは 3 つだけ。顧客 ID も会話 ID の生の値も載らない。 */
  const response = noStore(
    {
      access_token: token.accessToken,
      expires_in: remainingSeconds(token),
      session_handle: sessionHandle,
    },
    200,
  );

  /* この要求の中で会話 ID を作ったのなら、cookie にも書いて次から同じ会話に
     なるようにする。書かないと音声のたびに別の会話 handle が出る。 */
  if (session.minted) writeChatSessionCookie(response, session);

  return response;
}

/** 応答を組む。この窓口の応答は例外なく保存禁止。 */
function noStore(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
