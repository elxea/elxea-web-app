import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";

/**
 * LINE 連携解除の cx-agent 側呼び出し（解除を「本当に効く」ようにするための片割れ）。
 *
 * ## 何を直しているか
 *
 * 解除はこれまで 2 系統に割れていて、どちらも単独では嘘だった。
 *   - web-app `DELETE /api/user/line-link` … Firestore の `lineUserId` を消すだけ。
 *     LINE Bot が実際に読む cx-agent の連携台帳（`customer_linkages`）には触れない。
 *     **消えていないのに 200 を返す**ので、お客さまは解除したつもりで解除できていない。
 *   - cx-agent `clearCustomerLinkage` … 実体はあるが HTTP の入口が無く、LINE トークの
 *     完全一致キーワードからしか到達できなかった。
 *
 * 本モジュールは前者から後者を呼ぶための唯一の経路。解除ロジックは **cx-agent 側の
 * 既存関数がすべて**で、ここは HTTP の往復と失敗の翻訳しかしない（解除の定義を
 * 2 つに割らない）。
 *
 * ## fail-CLOSED（読み取りの fail-soft とは逆）
 *
 * 連携状態の**読み取り**（`linkage-status.ts`）は不達を `null`（不明）に倒して
 * マイページを壊さないが、**解除は書き込み**なので同じ倒し方をしてはいけない。
 * cx-agent に届かなかったのに成功を返すと、まさに今直している「消えていないのに
 * 成功」を別の形で作り直すことになる。よって不達・非 2xx・秘密未設定はすべて
 * 失敗として返し、呼び出し側は **Firestore を消さずに** 非 2xx を返す。
 */

/**
 * 解除要求の結果。
 *
 * `reason` は呼び出し側が HTTP ステータスに翻訳するための内部コード。
 * **お客さまには出さない**（検証の内訳を外に見せない既存方針）。
 */
export type CxUnlinkResult =
  | { ok: true; clearedCount: number }
  | { ok: false; reason: "not_configured" | "upstream_error" };

/** cx-agent への解除要求の上限。押しっぱなしに見えないよう短く切る。 */
const UNLINK_TIMEOUT_MS = 5000;

/**
 * cx-agent の連携台帳からこの顧客の連携を外す。
 *
 * ## 誰の連携を外すのか（P8 / 2026-08-22）
 *
 * 1 人の顧客に複数の LINE が紐づきうる（世帯共有・cx-agent migration 027）。
 * `lineUserId` を渡さないと cx-agent は **その顧客の連携をすべて**外す。
 * LINE セッションから解除した人は「自分の連携を外す」つもりなので、
 * 家族の連携まで巻き添えにするのは意図と違う。**対象が分かるときは必ず名指しする。**
 *
 * 名指しは cx-agent 側で所有権も確かめられる（その LINE がこの顧客に紐づいて
 * いなければ 403）ので、範囲を狭めるだけでなく取り違えの検出にもなる。
 *
 * マイページ（Shopify セッション）からの解除には LINE を選ぶ UI が無く、
 * 「このアカウントの LINE 連携を解除する」という 1 つの操作しか無い。そこでは
 * 顧客単位（= 全件）が意図どおりなので `lineUserId` を渡さない。
 *
 * @param shopifyCustomerId **サーバ認証済みセッション（requireAuth）由来**、または
 *   検証済み LINE userId から台帳で引いた連携先。ブラウザから受け取った値を渡しては
 *   ならない（他人の連携を外せる）。
 * @param lineUserId 任意。**サーバ側で検証済み**の LINE userId のみ（暗号化 cookie の
 *   復号結果）。渡すとその 1 件だけを外す。
 * @returns 成功なら実際に解除できた件数。**決して throw しない**。
 */
export async function requestCxUnlink(
  shopifyCustomerId: string,
  lineUserId?: string,
): Promise<CxUnlinkResult> {
  if (!shopifyCustomerId) return { ok: false, reason: "upstream_error" };

  const secret = process.env.SYNC_API_SECRET;
  if (!secret) {
    // 秘密が無ければ cx-agent は 401 を返す。無駄打ちせず「設定が無い」として失敗させる。
    // ここを成功に倒すと、設定漏れのデプロイで解除が静かに効かなくなる。
    console.warn("[line-unlink] SYNC_API_SECRET not set; cannot unlink.");
    return { ok: false, reason: "not_configured" };
  }

  try {
    const upstream = await fetch(`${CX_AGENT_BASE_URL}/api/identity/unlink`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": secret,
      },
      body: JSON.stringify({
        shopify_customer_id: shopifyCustomerId,
        // 対象が分かるときだけ名指しする（省略 = その顧客の連携をすべて外す）。
        ...(lineUserId ? { line_user_id: lineUserId } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(UNLINK_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      console.warn(`[line-unlink] cx-agent returned ${upstream.status}`);
      return { ok: false, reason: "upstream_error" };
    }

    const data = (await upstream.json()) as { cleared_count?: unknown };
    const clearedCount =
      typeof data.cleared_count === "number" ? data.cleared_count : 0;

    return { ok: true, clearedCount };
  } catch (err) {
    console.warn(
      "[line-unlink] unreachable:",
      err instanceof Error ? err.message : err,
    );
    return { ok: false, reason: "upstream_error" };
  }
}
