import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";

/**
 * LINE 連携状態の読み取り（P1: マイページに「連携済み / 未連携」を表示する）。
 *
 * これまで連携の記録簿（cx-agent 側 `customer_linkages`）は **書くだけで読めなかった**。
 * そのため LINE 側で連携が成立してもマイページの表示は何も変わらず、お客さまは
 * 「連携できたのか分からない」まま置かれていた。本モジュールがその読み取り経路。
 *
 * ## ここが唯一の正本
 *
 * 連携状態を必要とするのは今のところ 2 か所ある。
 *   - `app/api/user/line-link-status/route.ts` … クライアントから引くとき
 *   - `app/[locale]/account/page.tsx`          … サーバコンポーネントが描画時に引くとき
 * どちらも本モジュールを通す。両方が別々に cx-agent を叩くと、fail-soft の扱いや
 * 「連携済みの定義」が 2 か所に分かれて必ずずれる。
 *
 * ## 秘密と顧客 ID の扱い（QA 要件 1・2）
 *
 * - `SYNC_API_SECRET` は **サーバ環境変数**。ブラウザには出さない。cx-agent 側は
 *   この鍵が無ければ 401 を返す（server-to-server 限定）。
 * - `shopifyCustomerId` は **必ずサーバ認証済み Shopify セッション由来**の値を渡すこと。
 *   リクエストパラメータで受け取った顧客 ID を渡してはならない（他人の連携状態を覗ける）。
 *   本モジュールは渡された値を検証できないため、これは呼び出し側の責務。
 *
 * ## fail-soft（マイページを壊さない）
 *
 * cx-agent 不達・タイムアウト・秘密未設定・想定外レスポンスは、すべて
 * `linked: null`（＝**不明**）に倒す。例外は投げない。連携状態が読めないことと
 * 「未連携」は違う意味なので、`false` に丸めない。不明のときの画面は未連携と同じ
 * 見た目（連携ボタンを出す）にするが、それは画面側の判断であって、ここでは
 * 「分からなかった」という事実をそのまま返す。
 */

/**
 * 連携状態。`linked` は 3 値であることに注意（true / false / null=不明）。
 *
 * ⚠ line_user_id は **持たない**。cx-agent も返さない（QA 要件 3・最小開示）。
 */
export type LineLinkageStatus = {
  /** 連携済みなら true、未連携なら false、読み取れなければ null（不明）。 */
  linked: boolean | null;
  /** 連携済みのとき、いつから連携しているか（ISO 8601）。不明・未連携なら null。 */
  linkedAt: string | null;
};

/** 読み取れなかったときの値。未連携（false）と区別する。 */
export const UNKNOWN_LINE_LINKAGE: LineLinkageStatus = {
  linked: null,
  linkedAt: null,
};

/** cx-agent への問い合わせ上限。マイページの描画を待たせすぎない。 */
const FETCH_TIMEOUT_MS = 3000;

/**
 * cx-agent の連携記録簿から、この Shopify 顧客の連携状態を読む。
 *
 * @param shopifyCustomerId サーバ認証済みセッション由来の顧客 ID（GID / 数値どちらでも可。
 *   cx-agent 側が正規化する）。
 * @returns 連携状態。**決して throw しない**（読めなければ `UNKNOWN_LINE_LINKAGE`）。
 */
export async function fetchLineLinkageStatus(
  shopifyCustomerId: string,
): Promise<LineLinkageStatus> {
  if (!shopifyCustomerId) return UNKNOWN_LINE_LINKAGE;

  const secret = process.env.SYNC_API_SECRET;
  if (!secret) {
    // 秘密が無ければ cx-agent は 401 を返すので、無駄打ちせず「不明」に倒す。
    // （連携していないと決めつけない。設定漏れは未連携ではない。）
    console.warn("[line-linkage-status] SYNC_API_SECRET not set; status unknown.");
    return UNKNOWN_LINE_LINKAGE;
  }

  const url = `${CX_AGENT_BASE_URL}/api/identity/linkage-status?shopify_customer_id=${encodeURIComponent(
    shopifyCustomerId,
  )}`;

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": secret },
      // 連携状態は都度読む（連携直後に古い「未連携」を見せない）。
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      console.warn(`[line-linkage-status] cx-agent returned ${upstream.status}`);
      return UNKNOWN_LINE_LINKAGE;
    }

    const data = (await upstream.json()) as {
      linked?: unknown;
      linkedAt?: unknown;
    };

    // 型が期待どおりでなければ「不明」。壊れた応答を連携済み / 未連携に化けさせない。
    if (typeof data.linked !== "boolean") return UNKNOWN_LINE_LINKAGE;

    return {
      linked: data.linked,
      linkedAt: typeof data.linkedAt === "string" ? data.linkedAt : null,
    };
  } catch (err) {
    // 不達 / タイムアウト / JSON 崩れ。マイページは通常どおり描く。
    console.warn(
      "[line-linkage-status] unreachable:",
      err instanceof Error ? err.message : err,
    );
    return UNKNOWN_LINE_LINKAGE;
  }
}

/**
 * 「連携済みの表示」を出してよいか。
 *
 * `linked === true` のときだけ true。**不明（null）を連携済み扱いにしない** —
 * 記録簿が読めなかっただけの人に「連携済み」と言うと、実際は未連携の人が
 * 連携導線を失って詰む。逆（未連携と同じ表示にする）なら、押しても連携は
 * 冪等なので実害が無い。安全側はこちら。
 *
 * この判定を画面の JSX に直書きすると `=== true` が `!!` に化けて不明が
 * 連携済みに倒れる事故が起きやすいので、関数として固定してテストで縛る。
 */
export function isLinkedForDisplay(
  status: LineLinkageStatus | undefined,
): status is LineLinkageStatus {
  return status?.linked === true;
}

/**
 * 連携日時の表示（yyyy/mm/dd）。
 *
 * サーバコンポーネントで描くため、実行環境の時刻ではなく **日本時間で固定**する。
 * サーバが UTC だと 09:00 JST 未満の連携が前日に見えてしまい、お客さまの記憶と
 * 1 日ずれる（「昨日つないだのに一昨日と書いてある」）。
 *
 * 解釈不能な値・null は null（＝日付を言わない）。壊れた文字列を画面に出さない。
 */
export function formatLinkedDate(
  iso: string | null,
  locale: string,
): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "en" ? "en-CA" : "ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
}
