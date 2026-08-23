/**
 * LIFF ID トークンのサーバ側検証（案A: LINE×Shopify 連携の「なりすまし不能」の核）。
 *
 * なぜサーバで検証するのか:
 *   LIFF ページ（ブラウザ）は `liff.getIDToken()` で ID トークン（LINE が署名した JWT）を得る。
 *   このトークンの `sub` が「トーク用（Messaging）userId」で、Bot / customer_linkages が使う値。
 *   ブラウザが送ってくる userId をそのまま信じると詐称できてしまうため、**トークンを LINE の
 *   verify API に投げてサーバ側で検証し、`sub` を取り出す**。JWT は LINE の署名鍵で署名されて
 *   いるので、攻撃者は任意の sub を持つ有効トークンを作れない（＝ userId を偽装できない）。
 *
 * 検証手段（LINE 公式）:
 *   POST https://api.line.me/oauth2/v2.1/verify
 *   body: id_token, client_id（= LIFF アプリが属する LINE Login チャネル ID）
 *   成功時: { sub, aud, iss, exp, name?, picture?, email? } を返す。
 *   失敗時（署名不正・期限切れ・aud 不一致等）: 400/401 系。→ 本関数は null を返す（fail-closed）。
 *
 * 前提（LINE Developers コンソール設定 / 報告に記載）:
 *   - LIFF アプリを載せる LINE Login チャネルと、Bot の Messaging API チャネルは
 *     **同一プロバイダー**に置くこと。LINE の userId はプロバイダー単位で一意なので、
 *     同一プロバイダーなら id_token の `sub` == Messaging userId になる（これが案A の肝）。
 *   - `LINE_LIFF_CHANNEL_ID` に、その LINE Login チャネルの Channel ID を設定すること。
 */

import { createHash, timingSafeEqual } from "crypto";

import { lineApiBaseUrl, lineAuthBaseUrl } from "@/lib/line/endpoints";

/** verify API が返す最小の payload（本フローで使うフィールドのみ）。 */
export interface LiffIdTokenPayload {
  /** LINE userId（同一プロバイダー前提で Messaging userId と一致）。 */
  sub: string;
  /** トークンの発行先チャネル ID（= client_id と一致するはず）。 */
  aud: string;
  /** 発行者。LINE の ID トークンは常に "https://access.line.me"。 */
  iss?: string;
  /** 有効期限（Unix 秒）。 */
  exp: number;
  /**
   * 認可 URL に載せた `nonce`。認可要求で nonce を送らなかった場合は含まれない
   * （LINE 公式仕様）。Web 発の連携フロー（P2）は必ず送るので、そこでは必須になる。
   */
  nonce?: string;
  /** 表示名（scope による・任意）。 */
  name?: string;
  /** メール（email scope 承認時のみ・任意）。 */
  email?: string;
}

/**
 * LINE ID トークンの発行者（iss）。本物の LINE では常に `https://access.line.me`（LINE 公式仕様）。
 *
 * `LINE_AUTH_BASE_URL` で差し替えられるのは verify エンドポイント（`LINE_API_BASE_URL`）と同じ
 * 理由。偽 LINE サーバーに向けたテストでは iss も偽サーバーのオリジンになるため、ここだけ
 * 本物固定だと必ず「iss が LINE でない」で落ちて SUCCESS 経路を一度も通せない。
 * env 未設定（本番・通常実行）では本物の LINE と完全に同じ値になる。
 */
function lineTokenIssuer(): string {
  return lineAuthBaseUrl();
}

/** exp 検証の時刻ずれ許容（秒）。サーバ時計の微差で正当トークンを弾かないための猶予。 */
const EXP_CLOCK_SKEW_SEC = 300;

/** 検証結果。ok:true のとき messagingUserId が使える。 */
export type VerifyResult =
  | { ok: true; messagingUserId: string; email: string | null; payload: LiffIdTokenPayload }
  | { ok: false; reason: string };

/**
 * verify エンドポイント。`LINE_API_BASE_URL` で差し替えられるのは、`app/api/line-callback`
 * が token / profile 呼び出しで既に同じ env を見ているため（テストが LINE の API ホストを
 * 丸ごとスタブに向けられる）。ここだけ固定値のままだと、同じフローの一部だけ本物の
 * api.line.me を叩きに行く。
 */
function lineVerifyEndpoint(): string {
  return `${lineApiBaseUrl()}/oauth2/v2.1/verify`;
}

/** Messaging userId 形式（U + 32 hex）。sub がこの形でなければ拒否（多層防御）。 */
const LINE_MESSAGING_USER_ID_REGEX = /^U[0-9a-f]{32}$/;

export type VerifyLineIdTokenOptions = {
  /** テスト用の fetch 差し替え（省略時は global fetch）。 */
  fetchImpl?: typeof fetch;
  /**
   * 認可を開始したときに発行した `nonce`。**渡した場合は必須チェックになる**
   * （claim が無い / 違う → 失敗）。
   *
   * 渡さないのは LIFF 経路だけ。LIFF の id_token は LINE アプリが発行するもので、
   * こちらが認可 URL を組み立てていないため nonce を仕込む余地が無い。LIFF 側の
   * リプレイ束縛は「Shopify セッション（requireAuth）+ サーバ側 verify」で取っている。
   * OAuth 認可 URL を自分で組み立てる経路（Web 発連携 = P2）では必ず渡すこと。
   */
  expectedNonce?: string | null;
};

/**
 * LIFF ID トークンを LINE の verify API で検証し、Messaging userId（sub）を取り出す。
 *
 * fail-closed:
 *   - channelId 未設定 → 検証不能なので必ず失敗（設定漏れで無検証開放しない）。
 *   - idToken 空 → 失敗。
 *   - LINE verify が非 200 / aud 不一致 / iss 不一致 / exp 期限切れ / sub 形式不正 → 失敗。
 *     （iss / exp は docstring の LINE 仕様を「実チェック」に格上げした多層防御。LINE verify が
 *      期限切れを弾く前提でも、応答の握りつぶし・時刻ずれ・仕様変更に備え自前でも検証する。）
 *   - `expectedNonce` を渡したのに nonce claim が無い / 一致しない → 失敗（D11）。
 *
 * nonce は **LINE にも渡し、こちらでも突き合わせる**。verify API は `nonce` パラメータを
 * 受け取って不一致なら 400 を返すが、その 1 本に寄りかからない（LINE 側の挙動変更や、
 * 将来 verify を別実装へ差し替えたときに検証が黙って消えるのを避ける）。
 *
 * @param idToken  liff.getIDToken() / token 交換で得た JWT
 * @param channelId  トークンの発行元 LINE Login チャネル ID（env LINE_LIFF_CHANNEL_ID）
 * @param options  fetch 差し替えと nonce 期待値
 */
export async function verifyLineIdToken(
  idToken: string | undefined | null,
  channelId: string | undefined | null,
  options: VerifyLineIdTokenOptions = {},
): Promise<VerifyResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const expectedNonce = options.expectedNonce ?? null;

  if (!channelId) {
    return { ok: false, reason: "LINE_LIFF_CHANNEL_ID is not configured" };
  }
  if (!idToken || typeof idToken !== "string") {
    return { ok: false, reason: "id_token is required" };
  }

  let res: Response;
  try {
    const form = new URLSearchParams({ id_token: idToken, client_id: channelId });
    if (expectedNonce) form.set("nonce", expectedNonce);
    res = await fetchImpl(lineVerifyEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch (err) {
    return {
      ok: false,
      reason: `LINE verify request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    // 署名不正・期限切れ・aud 不一致などは LINE 側が 400/401 で返す。
    return { ok: false, reason: `LINE verify returned ${res.status}` };
  }

  let payload: LiffIdTokenPayload;
  try {
    payload = (await res.json()) as LiffIdTokenPayload;
  } catch {
    return { ok: false, reason: "LINE verify returned non-JSON" };
  }

  // aud（トークンの宛先チャネル）が期待値と一致することを二重に確認する。
  if (payload.aud !== channelId) {
    return { ok: false, reason: "id_token aud does not match channel id" };
  }

  // iss（発行者）が LINE であることを確認する（docstring の LINE 仕様を実チェック化・多層防御）。
  if (payload.iss !== lineTokenIssuer()) {
    return { ok: false, reason: "id_token iss is not LINE" };
  }

  // exp（有効期限）を自前でも検証する（LINE verify は期限切れを弾くが、握りつぶし・時刻ずれ対策の二重化）。
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= nowSec - EXP_CLOCK_SKEW_SEC) {
    return { ok: false, reason: "id_token is expired or has no exp" };
  }

  /* nonce（D11）。この経路で認可 URL を組み立てたのは我々なので、戻ってきた id_token が
   * **その認可要求のもの**であることを nonce が証明する。state は「応答がこのブラウザ宛か」
   * しか言わない。長さ差で例外を投げない固定長比較にしてから timingSafeEqual に渡す。 */
  if (expectedNonce) {
    if (typeof payload.nonce !== "string" || payload.nonce.length === 0) {
      return { ok: false, reason: "id_token has no nonce" };
    }
    const actual = createHash("sha256").update(payload.nonce).digest();
    const expected = createHash("sha256").update(expectedNonce).digest();
    if (!timingSafeEqual(actual, expected)) {
      return { ok: false, reason: "id_token nonce does not match" };
    }
  }

  const sub = payload.sub;
  if (!sub || !LINE_MESSAGING_USER_ID_REGEX.test(sub)) {
    return { ok: false, reason: "id_token sub is not a valid Messaging userId" };
  }

  return {
    ok: true,
    messagingUserId: sub,
    email: payload.email ?? null,
    payload,
  };
}
