import * as Sentry from "@sentry/nextjs";

import { CX_AGENT_BASE_URL } from "@/lib/chat/proxy";
import { extractCustomerId } from "@/lib/firebase/types";

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
  now: number = Date.now(),
): Promise<LineLinkageStatus> {
  if (!shopifyCustomerId) return UNKNOWN_LINE_LINKAGE;

  const secret = process.env.SYNC_API_SECRET;
  if (!secret) {
    // 秘密が無ければ cx-agent は 401 を返すので、無駄打ちせず「不明」に倒す。
    // （連携していないと決めつけない。設定漏れは未連携ではない。）
    //
    // 文言が "forward lookup" で始まるのは監視の都合（逆引きの 4 か所と揃えてある）。
    // "SYNC_API_SECRET not set" も残してあるので、監視の not-configured 規則と
    // linkage-read-failed 規則の両方に当たる。
    console.warn(
      "[line-linkage-status] forward lookup unknown: SYNC_API_SECRET not set",
    );
    reportLinkageReadFailure("forward", "secret-missing", now);
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
      console.warn(
        `[line-linkage-status] forward lookup returned ${upstream.status}`,
      );
      reportLinkageReadFailure("forward", "upstream-status", now);
      return UNKNOWN_LINE_LINKAGE;
    }

    const data = (await upstream.json()) as {
      linked?: unknown;
      linkedAt?: unknown;
    };

    // 型が期待どおりでなければ「不明」。壊れた応答を連携済み / 未連携に化けさせない。
    if (typeof data.linked !== "boolean") {
      console.warn(
        "[line-linkage-status] forward lookup unknown: unexpected response shape",
      );
      reportLinkageReadFailure("forward", "invalid-response", now);
      return UNKNOWN_LINE_LINKAGE;
    }

    return {
      linked: data.linked,
      linkedAt: typeof data.linkedAt === "string" ? data.linkedAt : null,
    };
  } catch (err) {
    // 不達 / タイムアウト / JSON 崩れ。マイページは通常どおり描く。
    console.warn(
      "[line-linkage-status] forward lookup unreachable:",
      err instanceof Error ? err.message : err,
    );
    reportLinkageReadFailure("forward", "unreachable", now);
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
 * マイページの「LINE 連携」節をどう出すか。
 *
 * `canLink` は **この画面から連携フローに入れるか**（＝ Shopify セッションがあるか）。
 * LINE だけでログインしている人は `/api/user/line-link/init` に必要な Shopify の
 * 顧客セッションを持たないので、押しても入口で弾かれる連携ボタンを出さない。
 * 一方で **解除は LINE セッションでもできる**（解除の対象は台帳の自分の行だから）ので、
 * 連携済みなら状態と解除の導線を出す。ここが出ていなかったのが「LINE でログインすると
 * 連携を解除できない」の正体で、本関数はその出し分けを 1 か所に固定する。
 *
 *   - `linked`      … 連携済み。状態 + 解除の導線（`canLink` に関係なく出す）
 *   - `link-cta`    … 未連携 / 不明 かつ連携フローに入れる。従来どおり連携ボタン
 *   - `status-only` … 連携フローに入れないが、黙って消してはいけないとき
 *                     （状態が読めなかった / 連携フローから戻ってきた結果がある）
 *   - `hidden`      … LINE セッションで未連携。出す用は無い（この経路の入口は
 *                     「メールアドレスでログイン」→ ログイン後に連携、の 2 段階）
 *
 * 画面の JSX に直接この分岐を書かないのは `isLinkedForDisplay` と同じ理由
 * （3 値が `!!` に化けて不明が連携済みに倒れる事故を型と関数で止める）。
 */
export type LineLinkageEntryMode =
  | "linked"
  | "link-cta"
  | "status-only"
  | "hidden";

export function resolveLineLinkageEntryMode({
  canLink,
  status,
  hasResult = false,
}: {
  /** この画面から連携フローに入れるか（Shopify の顧客セッションがあるか）。 */
  canLink: boolean;
  status?: LineLinkageStatus;
  /** 連携フローから戻ってきた結果（`?line_link=...`）を出す必要があるか。 */
  hasResult?: boolean;
}): LineLinkageEntryMode {
  /* 「状態が読めなかった」かを先に determine する。`isLinkedForDisplay` は型述語
     （`status is LineLinkageStatus`）なので、あとに置くと else 側で status が never に
     狭まり `status?.linked` を読めなくなる。 */
  const statusUnknown = status?.linked === null;

  if (isLinkedForDisplay(status)) return "linked";
  if (canLink) return "link-cta";
  // 不明を黙って消さない（連携済みの人が「解除は要らない」と誤解する）。
  if (statusUnknown || hasResult) return "status-only";
  return "hidden";
}

/* ---------------------------------------------------------------------------
 * 逆引き（LINE userId → Shopify 顧客）: マイページ分裂の根因を塞ぐ読み取り口
 * ------------------------------------------------------------------------- */

/**
 * LINE セッションの本人が、どの Shopify 顧客として解決されるべきか。
 *
 * ## 何を直しているか
 *
 * `lib/firebase/auth-guard.ts` の `resolveIdentity` は、ログイン手段ごとに **別の
 * Firestore の棚**を選ぶ（Shopify は `users/{shopifyCustomerId}`、LINE は
 * `users/line:{lineUserId}`）。この 2 つは意図的に交わらない名前空間で、しかも
 * **連携台帳を一切見ていなかった**。だから「連携したはずなのに、メールでログインすると
 * A のマイページ、LINE でログインすると B のマイページ」という分裂が起きる。
 * 本関数はその解決に使う読み取り口。
 *
 * ## 「見つからない」と「読めなかった」を混ぜない（既存 3 値方針の踏襲）
 *
 * 戻り値は 3 値。
 *   - 文字列 … 検証済みの連携がある。**その Shopify 顧客の棚に解決してよい**
 *   - `false` … 連携が無い（または解除済み）。**従来どおり LINE 単独の人格**
 *   - `null` … 読めなかった（不達 / timeout / 秘密未設定 / 壊れた応答）
 *
 * `null` のときも呼び出し側は LINE 単独の人格に倒す（＝この変更が入る前と同じ挙動）。
 * ここで例外を投げたり顧客 ID を推測したりしない。**推測で棚を選ぶと、他人の
 * お気に入り・行動ログを見せる事故になる**ため、疑わしいときは必ず自分の棚に戻す。
 *
 * ## 解除が即座に効くこと（生存検証）
 *
 * cx-agent 側は `shopify_customer_id IS NOT NULL` の行を返す。解除
 * （`clearCustomerLinkage`）は `shopify_customer_id` を null にするので、解除された連携は
 * ここで自動的にヒットしなくなる。つまり **読み取りのたびに生存を確かめている**。
 * キャッシュはそれを最大 60 秒だけ遅らせる（下記）。
 *
 * ⚠ **友だち解除（ブロック）では連携は切れない**（cx-agent P4 / 2026-08-22）。以前は
 *   cx-agent が `unfollowed_at IS NULL` も条件に入れていたため、LINE 公式アカウントを
 *   ブロックしただけのお客さまがここで `false`（＝未連携）になり、`resolveIdentity` が
 *   空の `line:` 棚を返していた。ブロックは配信の意思表示であって連携の取り消しではない。
 *   連携が切れる操作は解除だけ。
 */
export type ResolvedShopifyCustomer = string | false | null;

/**
 * 逆引きのキャッシュ TTL。
 *
 * `resolveIdentity` は SSR の広い範囲から呼ばれるため、素通しにすると 1 画面で
 * cx-agent への往復が何度も出る。一方で長く持つと解除が効くまでの遅れになる。
 * **解除の反映が 60 秒を超えない**ことを上限として、その範囲で往復を減らす。
 */
export const LINKAGE_CACHE_TTL_MS = 60_000;

/**
 * 逆引きで分かること。**1 回の往復で全部返ってくる**（cx-agent の逆引きは
 * `linked` / `linkedAt` / `shopify_customer_id` を一緒に返す）ので、顧客 ID だけの
 * 引き方と連携状態の引き方で HTTP を 2 回叩かない（キャッシュも 1 つに保つ）。
 */
type ReverseLinkage = {
  /** 連携先の顧客 ID / 未連携 (`false`) / 読めなかった (`null`)。 */
  customer: ResolvedShopifyCustomer;
  /** 連携済みのとき、いつからか（ISO 8601）。分からなければ null。 */
  linkedAt: string | null;
};

type CacheEntry = { value: ReverseLinkage; expiresAt: number };

/**
 * プロセス内キャッシュ。
 *
 * ⚠ `null`（読めなかった）は **キャッシュしない**。障害中の「不明」を 60 秒固定すると、
 *   cx-agent が復旧しても連携済みの人が自分の棚に戻れない時間が伸びる。
 */
const reverseCache = new Map<string, CacheEntry>();

/**
 * キャッシュの上限件数。
 *
 * TTL だけだと、長寿命プロセス（serverless でない実行環境）で訪問者が増え続けたときに
 * Map が単調に膨らむ。上限に達したら期限切れを掃除し、それでも空かなければ最も古い
 * 挿入から捨てる（Map は挿入順を保つ）。**正しさには影響しない** — 捨てられた人は
 * 次の読み取りで台帳を引き直すだけ。
 */
const REVERSE_CACHE_MAX_ENTRIES = 5000;

function evictIfNeeded(now: number): void {
  if (reverseCache.size < REVERSE_CACHE_MAX_ENTRIES) return;

  for (const [key, entry] of reverseCache) {
    if (entry.expiresAt <= now) reverseCache.delete(key);
  }

  // 期限切れだけで足りなければ、古いものから落とす。
  while (reverseCache.size >= REVERSE_CACHE_MAX_ENTRIES) {
    const oldest = reverseCache.keys().next();
    if (oldest.done) break;
    reverseCache.delete(oldest.value);
  }
}

/* ---------------------------------------------------------------------------
 * 逆引きが読めなかったことを恒久記録する（検知の穴を塞ぐ）
 * ------------------------------------------------------------------------- */

/**
 * 逆引きが読めなかった理由。Sentry のタグにそのまま載せる（本文の文字列で
 * grep させない）。
 */
export type LinkageReadFailure =
  | "secret-missing"
  | "upstream-status"
  | "linked-without-customer-id"
  /** 200 が返ったが `linked` が boolean でない（応答が壊れている）。順引きのみ。 */
  | "invalid-response"
  | "unreachable";

/**
 * どちら向きの読み取りが失敗したか。
 *
 *   - `forward` … 顧客 ID → 連携の有無（マイページを**メールで**開いた人）
 *   - `reverse` … LINE userId → 顧客 ID（マイページを**LINE で**開いた人）
 *
 * 分けて持つのは、片方だけが壊れる状況が実在するから（順引きは cx-agent の
 * 別クエリを通り、キャッシュも持たない）。Sentry のタグで切り分けられないと、
 * 「マイページが未連携に見える」の原因がどちら側か分からないまま調べることになる。
 */
export type LinkageReadDirection = "forward" | "reverse";

/**
 * 同じ理由を鳴らし続けない間隔。
 *
 * 逆引きは `resolveIdentity` 経由で **SSR の広い範囲から呼ばれる**。cx-agent が
 * 落ちている間そのまま送ると、1 画面描くたびにイベントが出て Sentry の割り当てを
 * 数分で焼き切る（＝肝心なときに他の異常が届かなくなる）。知りたいのは
 * 「読めない状態が続いている」という事実であって回数ではないので、理由ごとに
 * この間隔まで間引く。キャッシュ TTL と同じ 60 秒にしてあるのは、これが
 * 「逆引きが実際に外へ出ていきうる最短間隔」だから。
 */
const LINKAGE_REPORT_COOLDOWN_MS = LINKAGE_CACHE_TTL_MS;

/** 向き + 理由ごとの最終送信時刻。 */
const lastReportedAt = new Map<string, number>();

/**
 * 連携台帳の読み取り失敗を Sentry に残す（console.warn と対で呼ぶ）。
 *
 * ## なぜ console.warn だけでは足りないのか
 *
 * 本番の Vercel Runtime Logs は **Hobby プランで保持 1 時間**
 * （`scripts/ops/monitor-line-prod.mjs` 冒頭の注記が出典）。監視 cron が遅れれば
 * 痕跡ごと消えるので、ログは best-effort の検知路でしかない。連携が読めない
 * 状態は「連携済みの人が未連携の棚を見る」＝ **お気に入りが消えたように見える**
 * 事故そのものなので、後から必ず辿れる記録が要る。それを Sentry 側に持たせる。
 *
 * ## 順引きが長く無音だった話（as-is D-15）
 *
 * この関数は当初 **逆引きからしか呼ばれていなかった**。順引き
 * （`fetchLineLinkageStatus`）は Sentry を一切鳴らさず、ログ文言も監視の
 * どの正規表現にも当たらず、しかも監視は path 縛りで SSR（`/ja/account`）を
 * 見ていなかった。3 段とも漏れていたので、本番で順引きが timeout し続けても
 * **どこにも一行も残らなかった**。向きを引数にして両方から呼ぶ形に変えたのは、
 * 「読み取り口が 2 実装ある」という現実を、少なくとも観測の側では 1 本に
 * 束ねるため（実装の統合そのものは後の波）。
 *
 * ⚠ LINE userId・顧客 ID・秘密は載せない（`extra` を使わないのはそのため）。
 *   分かるのは「いつ・どちら向きが・どの理由で読めなかったか」だけで、
 *   原因の切り分けには足りる。
 */
function reportLinkageReadFailure(
  direction: LinkageReadDirection,
  reason: LinkageReadFailure,
  now: number,
): void {
  /* 間引きは向きごとに独立させる。片方が鳴り続けている間にもう片方が壊れても
     取りこぼさないため（同じ理由でも壊れている場所が違う）。 */
  const key = `${direction}:${reason}`;
  const last = lastReportedAt.get(key);
  if (last !== undefined && now - last < LINKAGE_REPORT_COOLDOWN_MS) return;
  lastReportedAt.set(key, now);

  Sentry.captureMessage(
    direction === "forward"
      ? "LINE linkage forward lookup failed"
      : "LINE linkage reverse lookup failed",
    {
      level: "warning",
      tags: { subsystem: "identity-link", reason, direction },
    },
  );
}

/** テスト用。プロセス内キャッシュを空にする（間引きの記録も一緒に捨てる）。 */
export function __clearLinkageCacheForTest(): void {
  reverseCache.clear();
  lastReportedAt.clear();
}

/**
 * この LINE userId の逆引きキャッシュを捨てる。
 *
 * 解除（`DELETE /api/user/line-link`）の直後に呼ぶ。呼ばないと、解除した本人が
 * `router.refresh()` で引き直したマイページに **最大 60 秒間「連携済み」が出たまま**
 * になり、「解除できていないのでは」と受け取られる（この機能で直している嘘の親戚）。
 * 台帳の側はもう外れているので、捨てるだけで次の読み取りが正しい答えを取ってくる。
 */
export function invalidateReverseLinkage(lineUserId: string): void {
  if (lineUserId) reverseCache.delete(lineUserId);
}

/**
 * この Shopify 顧客に紐付いていた逆引きキャッシュを **LINE userId を知らずに** 捨てる。
 *
 * ## なぜ ID 無しで捨てられる必要があるのか
 *
 * 解除には 2 つの入口がある。
 *   - LINE セッションから … 自分の LINE userId が分かるので `invalidateReverseLinkage` で足りる
 *   - **メール（Shopify）セッションから** … 顧客 ID しか分からない
 *
 * 後者では捨てる鍵が分からず、キャッシュに「連携済み」が最大 60 秒残っていた。
 * その窓の中でこの人が LINE 側から画面を開くと、**解除したはずの顧客の棚が見える**。
 * 解除は「もう結び付けないでほしい」という操作なので、ここに窓があってはいけない。
 *
 * ## なぜ cx-agent に LINE userId を返させないのか
 *
 * 解除 API に「外した line_user_id」を返させれば鍵は分かるが、それは
 * **web-app が知る必要の無い LINE の生 ID を新たに渡す**ことになる（順引きが
 * `line_user_id` を返さない最小開示の約束を、解除のためだけに崩す）。
 * キャッシュは `lineUserId → 連携先顧客` の対応をこちら側で持っているので、
 * **値の側から引いて消せば足りる**。API も応答も変えずに窓が閉じる。
 *
 * 走査は解除のときだけで、対象は上限 5000 件のプロセス内 Map。実質ゼロコスト。
 *
 * ⚠ 消えるのは **このプロセスのキャッシュだけ**。serverless で別インスタンスが
 *   同じ人を抱えていれば、そちらは最大 60 秒古いままになる。これは解除 API に
 *   ID を返させても変わらない（他インスタンスには届かない）ので、本関数の
 *   選択によって生まれた制約ではない。TTL がその上限を保証している。
 *
 * @param shopifyCustomerId GID / 数値どちらでもよい（内部で数値部分に正規化して比較する）。
 */
export function invalidateReverseLinkageForCustomer(
  shopifyCustomerId: string,
): void {
  if (!shopifyCustomerId) return;
  const target = extractCustomerId(shopifyCustomerId);

  for (const [lineUserId, entry] of reverseCache) {
    const customer = entry.value.customer;
    if (typeof customer !== "string") continue;
    if (extractCustomerId(customer) === target) reverseCache.delete(lineUserId);
  }
}

/**
 * サーバ検証済みの LINE userId から、連携先の Shopify 顧客 ID を引く。
 *
 * @param lineUserId **サーバ側で検証済み**の LINE userId のみを渡すこと
 *   （暗号化 cookie `line_uid` の復号結果 / id_token の `sub`）。ブラウザ自己申告の
 *   値を渡してはならない — 渡した瞬間、任意の LINE ID を名乗って他人の棚を開ける。
 *   本モジュールは渡された値を検証できないため、これは呼び出し側の責務。
 * @param now テスト用の時刻注入。
 * @returns `ResolvedShopifyCustomer`。**決して throw しない**。
 */
export async function fetchShopifyCustomerIdForLineUser(
  lineUserId: string,
  now: number = Date.now(),
): Promise<ResolvedShopifyCustomer> {
  return (await fetchReverseLinkage(lineUserId, now)).customer;
}

/**
 * サーバ検証済みの LINE userId から、**その人自身の連携状態**を引く。
 *
 * 順引き（`fetchLineLinkageStatus`）と戻り値の型を揃えてあるのは、マイページが
 * ログイン経路によらず同じ 1 つの節を描くため。Shopify セッションがあるときは
 * 顧客 ID で順引きし、LINE だけのときはここで逆引きする — 画面から見れば
 * どちらも「連携済み / 未連携 / 不明」の 3 値でしかない。
 *
 * @returns 連携状態。**決して throw しない**（読めなければ `UNKNOWN_LINE_LINKAGE`）。
 */
export async function fetchLineLinkageStatusForLineUser(
  lineUserId: string,
  now: number = Date.now(),
): Promise<LineLinkageStatus> {
  const reverse = await fetchReverseLinkage(lineUserId, now);

  if (reverse.customer === null) return UNKNOWN_LINE_LINKAGE;
  if (reverse.customer === false) return { linked: false, linkedAt: null };
  return { linked: true, linkedAt: reverse.linkedAt };
}

/**
 * 逆引きの実体（顧客 ID と連携日をまとめて取り、キャッシュする）。
 *
 * `fetchShopifyCustomerIdForLineUser` と `fetchLineLinkageStatusForLineUser` の
 * 共通の下地。連携の「読み方」をここ 1 か所に閉じてあるので、2 つの呼び口が
 * 別々に cx-agent を叩いたり、fail-soft の倒し方がずれたりしない。
 */
async function fetchReverseLinkage(
  lineUserId: string,
  now: number,
): Promise<ReverseLinkage> {
  if (!lineUserId) return { customer: false, linkedAt: null };

  const cached = reverseCache.get(lineUserId);
  if (cached && cached.expiresAt > now) return cached.value;

  const unknown: ReverseLinkage = { customer: null, linkedAt: null };

  const secret = process.env.SYNC_API_SECRET;
  if (!secret) {
    // 秘密が無ければ cx-agent は 401 を返すので、無駄打ちせず「不明」に倒す。
    // 設定漏れを「未連携」と決めつけない。
    //
    // 文言が "reverse lookup" で始まるのは監視の都合（下の 3 か所と揃えてある）。
    // "SYNC_API_SECRET not set" も残してあるので、監視の not-configured 規則と
    // 新しい linkage-read-failed 規則の両方に当たる。
    console.warn(
      "[line-linkage-status] reverse lookup unknown: SYNC_API_SECRET not set",
    );
    reportLinkageReadFailure("reverse", "secret-missing", now);
    return unknown;
  }

  const url = `${CX_AGENT_BASE_URL}/api/identity/linkage-status?line_user_id=${encodeURIComponent(
    lineUserId,
  )}`;

  let resolved: ReverseLinkage;
  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: { "X-API-Key": secret },
      // 連携の生存は都度確かめる（解除直後に古い「連携済み」で他人の棚を開けない）。
      cache: "no-store",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!upstream.ok) {
      console.warn(
        `[line-linkage-status] reverse lookup returned ${upstream.status}`,
      );
      reportLinkageReadFailure("reverse", "upstream-status", now);
      return unknown;
    }

    const data = (await upstream.json()) as {
      linked?: unknown;
      linkedAt?: unknown;
      shopify_customer_id?: unknown;
    };

    if (data.linked !== true) {
      // 明示的に「連携が無い」と言われた。従来どおり LINE 単独の人格。
      resolved = { customer: false, linkedAt: null };
    } else if (
      typeof data.shopify_customer_id === "string" &&
      data.shopify_customer_id !== ""
    ) {
      resolved = {
        customer: data.shopify_customer_id,
        // 日付は「取れたら出す」。壊れていても連携の有無までは落とさない。
        linkedAt: typeof data.linkedAt === "string" ? data.linkedAt : null,
      };
    } else {
      // linked=true なのに顧客 ID が無い＝応答が壊れている。棚を推測しない。
      console.warn(
        "[line-linkage-status] reverse lookup: linked without customer id",
      );
      reportLinkageReadFailure("reverse", "linked-without-customer-id", now);
      return unknown;
    }
  } catch (err) {
    console.warn(
      "[line-linkage-status] reverse lookup unreachable:",
      err instanceof Error ? err.message : err,
    );
    reportLinkageReadFailure("reverse", "unreachable", now);
    return unknown;
  }

  // 確定した答え（連携先 or 未連携）だけを短時間キャッシュする。
  evictIfNeeded(now);
  reverseCache.set(lineUserId, {
    value: resolved,
    expiresAt: now + LINKAGE_CACHE_TTL_MS,
  });
  return resolved;
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
