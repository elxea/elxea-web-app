/**
 * 「まだ答えていない一杯」を決める（顧客プロファイル 第1段 ①・純粋）。
 *
 * 設計正本: elxea顧客プロファイル設計 rev.3.2 §2「『届いた後の2択』はどうやって
 * 届くか」/「無回答の扱い」/ §6 第1段 ①。
 *
 * ## 何を「届いた一杯」と見なすか（限界の明示・重要）
 *
 * 設計 §6 の ⓪「送った記録の台帳」は **cx-agent 側にある**
 * （`tea_delivery_ledger` / `roji_delivery_ledger` と L0 の `shipment.sent`）。
 * web-app からその台帳を引く口はまだ無い。
 *
 * よってこの段では **号（elxea Journal の 1 号）に入っているお茶** を
 * 「その号を受け取った人に届いた一杯」と見なす。roji の定期便は「今月号 + その号の
 * お茶」で 1 箱なので、号が決まれば銘柄は決まる（Sanity `journal.teaMenus`）。
 *
 * ここで割り切っていること（QA・後段の設計判断のために明記する）:
 *
 *   - **誰に届いたかは検証していない。** ログインは要るが、その人が本当にこの号の
 *     箱を受け取ったかまでは web-app から確かめられない。台帳の口ができたら
 *     `pickAskableCups` の入力を台帳由来に差し替える（関数の形は変えずに済む）。
 *   - だから号は**評価の器**であって、送付の事実ではない。`rating.submitted` の
 *     `delivery_ref` には号の slug を載せる（契約の任意項目）。数の正本は台帳の側。
 *
 * ## 期限の切り方（§2「無回答の扱い」）
 *
 *   - 次の号が出た時点で、前の号の設問は**期限切れ**にする。しつこくしない。
 *   - 遡るのは **前号まで**、かつ未回答は合計 `ASKABLE_CUP_LIMIT` 杯まで。
 *   - 無回答は第 3 の値であって否定信号ではない。だから「答えなかった」を
 *     ここで数え直したり、再掲の順位を下げたりはしない。
 */

/** 号 1 つ（Sanity `journal` の必要な分だけ）。 */
export interface IssueForCups {
  slug: string;
  title: string;
  featured?: boolean | null;
  /** Sanity の作成日時（号の新しさの代理。ISO 8601）。 */
  createdAt?: string | null;
  teas: IssueTea[];
}

/** 号に入っているお茶 1 つ。 */
export interface IssueTea {
  /** Tea Menu の 5 桁番号。5 桁でないものはこの画面に出さない。 */
  productNumber?: string | number | null;
  title: string;
  displayName?: string | null;
  slug?: string | null;
}

/** 画面に出す 1 杯。`productNo` は 5 桁であることが確定している。 */
export interface AskableCup {
  productNo: string;
  name: string;
  teaSlug: string | null;
  issueRef: string;
  issueTitle: string;
}

/**
 * 再掲する未回答の上限（設計 §2「遡るのは最大 2 杯」）。
 *
 * 今号の分はこの上限の外。上限がかかるのは**前号の積み残し**だけである
 * （今号を隠すと、いちばん新しい反応が取れなくなる）。
 */
export const ASKABLE_CUP_LIMIT = 2;

/** 5 桁の銘柄番号だけを通す（cx-agent の `product_no` の形と同じ）。 */
function productNoOf(tea: IssueTea): string | null {
  if (tea.productNumber === null || tea.productNumber === undefined) return null;
  const key = String(tea.productNumber).trim();
  return /^\d{5}$/.test(key) ? key : null;
}

/**
 * 号の並びから「今号」と「前号」を決める（純粋）。
 *
 * 今号は `featured` が立っている号のうちいちばん新しいもの。1 つも立っていなければ
 * いちばん新しい号を今号と見なす（編集側が旗を立て忘れても画面が空にならない）。
 * 前号は今号を除いたいちばん新しい号。
 */
export function pickIssues(issues: readonly IssueForCups[]): {
  current: IssueForCups | null;
  previous: IssueForCups | null;
} {
  const byNewest = [...issues].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const current = byNewest.find((issue) => issue.featured === true) ?? byNewest[0] ?? null;
  if (!current) return { current: null, previous: null };
  const previous = byNewest.find((issue) => issue.slug !== current.slug) ?? null;
  return { current, previous };
}

/** 号 1 つを、画面に出せる形の杯に畳む（5 桁でないものは落とす）。 */
function cupsOf(issue: IssueForCups): AskableCup[] {
  return issue.teas
    .map((tea): AskableCup | null => {
      const productNo = productNoOf(tea);
      if (!productNo) return null;
      return {
        productNo,
        name: tea.displayName?.trim() || tea.title,
        teaSlug: tea.slug ?? null,
        issueRef: issue.slug,
        issueTitle: issue.title,
      };
    })
    .filter((cup): cup is AskableCup => cup !== null);
}

/**
 * まだ答えていない杯を、聞いてよい順に返す（純粋）。
 *
 * 並びは **今号が先、前号の積み残しが後**。前号は `ASKABLE_CUP_LIMIT` 杯まで。
 * `answered` に入っている銘柄番号は、答えたものと「いまは答えない」を押したものの
 * 両方を含む（どちらも二度は聞かない。§2「追いかけない」）。
 */
export function pickAskableCups(
  issues: { current: IssueForCups | null; previous: IssueForCups | null },
  answered: ReadonlySet<string>,
): AskableCup[] {
  const seen = new Set<string>();
  const take = (cups: AskableCup[]) =>
    cups.filter((cup) => {
      if (answered.has(cup.productNo) || seen.has(cup.productNo)) return false;
      seen.add(cup.productNo);
      return true;
    });

  const currentCups = issues.current ? take(cupsOf(issues.current)) : [];
  const previousCups = issues.previous
    ? take(cupsOf(issues.previous)).slice(0, ASKABLE_CUP_LIMIT)
    : [];

  return [...currentCups, ...previousCups];
}
