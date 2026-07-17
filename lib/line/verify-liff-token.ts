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

/** verify API が返す最小の payload（本フローで使うフィールドのみ）。 */
export interface LiffIdTokenPayload {
  /** LINE userId（同一プロバイダー前提で Messaging userId と一致）。 */
  sub: string;
  /** トークンの発行先チャネル ID（= client_id と一致するはず）。 */
  aud: string;
  /** 有効期限（Unix 秒）。 */
  exp: number;
  /** 表示名（scope による・任意）。 */
  name?: string;
  /** メール（email scope 承認時のみ・任意）。 */
  email?: string;
}

/** 検証結果。ok:true のとき messagingUserId が使える。 */
export type VerifyResult =
  | { ok: true; messagingUserId: string; email: string | null; payload: LiffIdTokenPayload }
  | { ok: false; reason: string };

const LINE_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";

/** Messaging userId 形式（U + 32 hex）。sub がこの形でなければ拒否（多層防御）。 */
const LINE_MESSAGING_USER_ID_REGEX = /^U[0-9a-f]{32}$/;

/**
 * LIFF ID トークンを LINE の verify API で検証し、Messaging userId（sub）を取り出す。
 *
 * fail-closed:
 *   - channelId 未設定 → 検証不能なので必ず失敗（設定漏れで無検証開放しない）。
 *   - idToken 空 → 失敗。
 *   - LINE verify が非 200 / aud 不一致 / sub 形式不正 → 失敗。
 *
 * @param idToken  liff.getIDToken() で得た JWT
 * @param channelId  LIFF が属する LINE Login チャネル ID（env LINE_LIFF_CHANNEL_ID）
 * @param fetchImpl  テスト用の fetch 差し替え（省略時は global fetch）
 */
export async function verifyLiffIdToken(
  idToken: string | undefined | null,
  channelId: string | undefined | null,
  fetchImpl: typeof fetch = fetch,
): Promise<VerifyResult> {
  if (!channelId) {
    return { ok: false, reason: "LINE_LIFF_CHANNEL_ID is not configured" };
  }
  if (!idToken || typeof idToken !== "string") {
    return { ok: false, reason: "id_token is required" };
  }

  let res: Response;
  try {
    res = await fetchImpl(LINE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
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
